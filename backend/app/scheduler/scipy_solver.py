import time
from typing import List, Dict, Any, Optional
import numpy as np
from scipy.optimize import milp, LinearConstraint, Bounds

from app.models.domain import Machine
from app.scheduler.solver_interface import BaseSchedulerSolver

class ScipyMILPSolver(BaseSchedulerSolver):
    """MILP Solver using SciPy's HiGHS solver backend.
    Serves as the serverless lightweight fallback if OR-Tools bundle size is constrained.
    """

    def solve(
        self,
        machines: List[Machine],
        solar: List[float],
        tariff: List[float],
        demand_charge_rate: float,
        base_load: List[float],
        p_max_kw: float,
        strategy: str,
        time_limit_sec: float = 8.0
    ) -> Dict[str, Any]:
        start_time = time.perf_counter()

        if strategy == "baseline":
            schedule = {m.id: m.earliest_start for m in machines}
            return {
                "status": "OPTIMAL",
                "schedule": schedule,
                "solver_duration_ms": (time.perf_counter() - start_time) * 1000.0,
                "solver_name": "DeterministicBaseline",
                "diagnosis": None
            }

        # Indexing decision variables:
        # 1. Binary variables x[m, s] for each machine m and valid start slot s
        var_indices: Dict[str, Dict[int, int]] = {}
        idx_to_machine_slot: Dict[int, tuple] = {}
        curr_idx = 0

        for m in machines:
            var_indices[m.id] = {}
            max_start = min(m.latest_start, m.deadline_interval - m.duration_intervals)
            slots = [m.earliest_start] if not m.flexible else list(range(m.earliest_start, max_start + 1))
            if not slots or max_start < m.earliest_start:
                return {
                    "status": "INFEASIBLE",
                    "schedule": {},
                    "solver_duration_ms": (time.perf_counter() - start_time) * 1000.0,
                    "solver_name": "ScipyHiGHS",
                    "diagnosis": f"Machine '{m.name}' deadline margin infeasible."
                }
            for s in slots:
                var_indices[m.id][s] = curr_idx
                idx_to_machine_slot[curr_idx] = (m.id, s)
                curr_idx += 1

        n_bin_vars = curr_idx
        # 2. Continuous variables: grid[t] for t=0..95 (96 variables)
        grid_start_idx = curr_idx
        curr_idx += 96
        # 3. Continuous variable: peak (1 variable)
        peak_idx = curr_idx
        curr_idx += 1

        n_total_vars = curr_idx

        # Objective vector c
        c = np.zeros(n_total_vars)
        dt = 0.25

        if strategy == "solar_aware":
            # Minimize total grid energy imported + slight peak penalty
            for t in range(96):
                c[grid_start_idx + t] = 1.0
            c[peak_idx] = 0.05
        elif strategy == "cost_optimized":
            for t in range(96):
                c[grid_start_idx + t] = tariff[t] * dt
            c[peak_idx] = demand_charge_rate
        else:
            return {
                "status": "ERROR",
                "schedule": {},
                "solver_duration_ms": (time.perf_counter() - start_time) * 1000.0,
                "solver_name": "ScipyHiGHS",
                "diagnosis": f"Unknown strategy: '{strategy}'"
            }

        # Integrality: 1 for binary machine vars, 0 for grid & peak
        integrality = np.zeros(n_total_vars)
        integrality[:n_bin_vars] = 1

        # Bounds: [0, 1] for binary, [0, P_max] for grid and peak
        lb = np.zeros(n_total_vars)
        ub = np.zeros(n_total_vars)
        ub[:n_bin_vars] = 1.0
        ub[grid_start_idx:grid_start_idx + 96] = p_max_kw
        ub[peak_idx] = p_max_kw
        bounds = Bounds(lb, ub)

        # Constraints
        # A_eq: exactly one start slot per machine
        eq_rows = []
        for m in machines:
            row = np.zeros(n_total_vars)
            for s, v_idx in var_indices[m.id].items():
                row[v_idx] = 1.0
            eq_rows.append(row)

        A_eq = np.array(eq_rows)
        b_eq = np.ones(len(eq_rows))
        cons_eq = LinearConstraint(A_eq, b_eq, b_eq)

        # A_ineq:
        # 1. Grid import: grid[t] - sum_{m active at t} P_m * x[m,s] >= base_load[t] - solar[t]
        # 2. Peak: peak - grid[t] >= 0
        ineq_rows = []
        lhs_bounds = []
        rhs_bounds = []

        for t in range(96):
            row_grid = np.zeros(n_total_vars)
            row_grid[grid_start_idx + t] = 1.0
            for m in machines:
                for s, v_idx in var_indices[m.id].items():
                    if s <= t < s + m.duration_intervals:
                        row_grid[v_idx] -= m.power_kw
            ineq_rows.append(row_grid)
            lhs_bounds.append(base_load[t] - solar[t])
            rhs_bounds.append(np.inf)

            # Peak tracking: peak - grid[t] >= 0
            row_peak = np.zeros(n_total_vars)
            row_peak[peak_idx] = 1.0
            row_peak[grid_start_idx + t] = -1.0
            ineq_rows.append(row_peak)
            lhs_bounds.append(0.0)
            rhs_bounds.append(np.inf)

        A_ineq = np.array(ineq_rows)
        cons_ineq = LinearConstraint(A_ineq, np.array(lhs_bounds), np.array(rhs_bounds))

        # Solve with SciPy HiGHS
        res = milp(
            c=c,
            integrality=integrality,
            bounds=bounds,
            constraints=[cons_eq, cons_ineq],
            options={"time_limit": time_limit_sec}
        )
        duration_ms = (time.perf_counter() - start_time) * 1000.0

        if res.success:
            schedule = {}
            for v_idx in range(n_bin_vars):
                if res.x[v_idx] > 0.5:
                    m_id, s = idx_to_machine_slot[v_idx]
                    schedule[m_id] = s
            return {
                "status": "OPTIMAL",
                "schedule": schedule,
                "solver_duration_ms": duration_ms,
                "solver_name": "ScipyHiGHS",
                "diagnosis": None
            }
        else:
            return {
                "status": "INFEASIBLE",
                "schedule": {},
                "solver_duration_ms": duration_ms,
                "solver_name": "ScipyHiGHS",
                "diagnosis": res.status_message or "Problem infeasible."
            }
