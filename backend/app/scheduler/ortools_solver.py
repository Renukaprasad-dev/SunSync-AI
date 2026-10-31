import time
from typing import List, Dict, Any, Optional
from ortools.sat.python import cp_model

from app.models.domain import Machine
from app.scheduler.solver_interface import BaseSchedulerSolver

class ORToolsCPSATSolver(BaseSchedulerSolver):
    """MILP/CP-SAT Solver using Google OR-Tools.
    Models 96-interval machine scheduling with peak grid constraints and time-of-day tariffs.
    """

    SCALE = 100  # Multiplier for 2-decimal kW and Rs precision: 1 unit = 0.01 kW

    def diagnose_infeasibility(
        self,
        machines: List[Machine],
        p_max_kw: float,
        base_load: List[float]
    ) -> Optional[str]:
        """Identifies root cause when a schedule is infeasible."""
        # 1. Check individual machine deadlines & windows
        for m in machines:
            if m.earliest_start + m.duration_intervals > m.deadline_interval:
                return (
                    f"Machine '{m.name}' has an impossible deadline: earliest completion slot is "
                    f"{m.earliest_start + m.duration_intervals} ({m.earliest_start*15//60:02d}:{m.earliest_start*15%60:02d}), "
                    f"which exceeds deadline {m.deadline_interval} ({m.deadline_interval*15//60:02d}:{m.deadline_interval*15%60:02d})."
                )
            if m.earliest_start > m.latest_start:
                return (
                    f"Machine '{m.name}' has invalid start window: earliest_start ({m.earliest_start}) "
                    f"> latest_start ({m.latest_start})."
                )

        # 2. Check base load alone vs P_max
        for t, b in enumerate(base_load):
            if b > p_max_kw:
                return (
                    f"Base load alone ({b:.2f} kW) at slot {t} exceeds the maximum grid limit "
                    f"P_max ({p_max_kw:.2f} kW)."
                )

        # 3. Check fixed (non-flexible) machines concurrent power
        fixed_load = [b for b in base_load]
        for m in machines:
            if not m.flexible:
                for t in range(m.earliest_start, min(96, m.earliest_start + m.duration_intervals)):
                    fixed_load[t] += m.power_kw
                    if fixed_load[t] > p_max_kw:
                        return (
                            f"Non-flexible machine '{m.name}' causes total fixed load to reach "
                            f"{fixed_load[t]:.2f} kW at slot {t}, exceeding grid limit P_max ({p_max_kw:.2f} kW)."
                        )

        return (
            "Cumulative load exceeds peak power limit (P_max) or machine availability windows "
            "conflict with completion deadlines."
        )

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

        # Handle Baseline Strategy: directly place every machine at its earliest start
        if strategy == "baseline":
            schedule = {}
            for m in machines:
                schedule[m.id] = m.earliest_start

            duration_ms = (time.perf_counter() - start_time) * 1000.0
            return {
                "status": "OPTIMAL",
                "schedule": schedule,
                "solver_duration_ms": duration_ms,
                "solver_name": "DeterministicBaseline",
                "diagnosis": None
            }

        # First, run diagnostic checks before building model
        pre_diagnosis = self.diagnose_infeasibility(machines, p_max_kw, base_load)
        for m in machines:
            # If start window is fully after deadline - duration, infeasible
            max_start = min(m.latest_start, m.deadline_interval - m.duration_intervals)
            if max_start < m.earliest_start:
                return {
                    "status": "INFEASIBLE",
                    "schedule": {},
                    "solver_duration_ms": (time.perf_counter() - start_time) * 1000.0,
                    "solver_name": "ORToolsCPSAT",
                    "diagnosis": (
                        f"Machine '{m.name}' cannot start before deadline margin: "
                        f"latest valid start is {max_start}, but earliest start is {m.earliest_start}."
                    )
                }

        # Build CP-SAT Model
        model = cp_model.CpModel()
        SCALE = self.SCALE
        p_max_scaled = int(round(p_max_kw * SCALE))
        dt = 0.25  # 15 min = 0.25 hours

        # Decision variables: x[m, s] = 1 if machine m starts at slot s
        start_vars: Dict[str, Dict[int, cp_model.IntVar]] = {}
        valid_slots: Dict[str, List[int]] = {}

        for m in machines:
            start_vars[m.id] = {}
            max_start = min(m.latest_start, m.deadline_interval - m.duration_intervals)
            if not m.flexible:
                slots = [m.earliest_start]
            else:
                slots = list(range(m.earliest_start, max_start + 1))
            valid_slots[m.id] = slots

            # One binary variable per candidate start slot
            for s in slots:
                start_vars[m.id][s] = model.NewBoolVar(f"start_{m.id}_{s}")

            # Constraint: Exactly one start slot per machine
            model.Add(sum(start_vars[m.id][s] for s in slots) == 1)

        # Pre-scale base load and solar
        solar_scaled = [int(round(s * SCALE)) for s in solar]
        base_scaled = [int(round(b * SCALE)) for b in base_load]

        # Max grid demand (scaled)
        peak_var = model.NewIntVar(0, p_max_scaled, "peak_grid_scaled")
        grid_vars: List[cp_model.IntVar] = []

        # Formulate per-interval load and grid variables
        for t in range(96):
            # Machines active at slot t
            active_load_terms = []
            for m in machines:
                power_scaled = int(round(m.power_kw * SCALE))
                # Machine m is running at slot t if it started at s in [t - duration + 1, t]
                for s in valid_slots[m.id]:
                    if s <= t < s + m.duration_intervals:
                        active_load_terms.append(power_scaled * start_vars[m.id][s])

            # Total load at slot t
            load_at_t = base_scaled[t] + sum(active_load_terms)

            # Grid variable at slot t
            grid_t = model.NewIntVar(0, p_max_scaled, f"grid_{t}")
            grid_vars.append(grid_t)

            # Grid import must cover (load - solar)
            # grid_t >= load_at_t - solar_scaled[t]
            model.Add(grid_t >= load_at_t - solar_scaled[t])

            # Peak tracking: peak >= grid_t
            model.Add(peak_var >= grid_t)

        # Define Objective per strategy
        if strategy == "solar_aware":
            # Primary: Minimize grid energy imported (sum of grid_vars)
            # Secondary tie-breaker: slight penalty on peak (0.05 * peak)
            model.Minimize(sum(grid_vars) * 10 + peak_var)

        elif strategy == "cost_optimized":
            # Minimize energy cost (tariff_t * grid_t * dt) + demand_charge * peak
            # To preserve integer precision:
            # cost_t_term = round(tariff[t] * dt * 100) * grid_t
            # demand_term = round(demand_charge_rate * 100) * peak_var
            cost_terms = []
            for t in range(96):
                rate_weight = int(round(tariff[t] * dt * 100))
                cost_terms.append(rate_weight * grid_vars[t])

            demand_weight = int(round(demand_charge_rate * 100))
            model.Minimize(sum(cost_terms) + demand_weight * peak_var)

        else:
            return {
                "status": "ERROR",
                "schedule": {},
                "solver_duration_ms": (time.perf_counter() - start_time) * 1000.0,
                "solver_name": "ORToolsCPSAT",
                "diagnosis": f"Unknown strategy: '{strategy}'"
            }

        # Solve with CP-SAT
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = float(time_limit_sec)
        solver.parameters.num_workers = 2 # Efficient parallel search

        solver_status = solver.Solve(model)
        duration_ms = (time.perf_counter() - start_time) * 1000.0

        if solver_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            schedule = {}
            for m in machines:
                for s in valid_slots[m.id]:
                    if solver.Value(start_vars[m.id][s]) == 1:
                        schedule[m.id] = s
                        break
            return {
                "status": "OPTIMAL" if solver_status == cp_model.OPTIMAL else "FEASIBLE",
                "schedule": schedule,
                "solver_duration_ms": duration_ms,
                "solver_name": "ORToolsCPSAT",
                "diagnosis": None
            }
        else:
            diagnosis = pre_diagnosis or self.diagnose_infeasibility(machines, p_max_kw, base_load)
            return {
                "status": "INFEASIBLE",
                "schedule": {},
                "solver_duration_ms": duration_ms,
                "solver_name": "ORToolsCPSAT",
                "diagnosis": diagnosis
            }
