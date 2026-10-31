import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from app.models.domain import (
    OptimizationRequest,
    OptimizationResponse,
    StrategySchedule,
    Machine
)
from app.scheduler.solver_interface import BaseSchedulerSolver
from app.scheduler.ortools_solver import ORToolsCPSATSolver
from app.scheduler.scipy_solver import ScipyMILPSolver
from app.scheduler.verifier import ScheduleVerifier
from app.scheduler.reason_engine import ReasonEngine

logger = logging.getLogger("sunsync.scheduler")

class SchedulerService:
    def __init__(self, solver: Optional[BaseSchedulerSolver] = None):
        if solver is not None:
            self.solver = solver
        else:
            try:
                self.solver = ORToolsCPSATSolver()
            except Exception as e:
                logger.warning(f"Failed to load OR-Tools solver ({e}); falling back to SciPy HiGHS.")
                self.solver = ScipyMILPSolver()

    def run_optimization(self, req: OptimizationRequest) -> OptimizationResponse:
        base_load = req.base_load or [0.8 if (i < 32 or i >= 76) else 1.5 for i in range(96)]
        solar = req.solar_profile.generation
        tariff = req.tariff.rates
        demand_charge_rate = req.tariff.demand_charge_rate_per_kw
        p_max = req.p_max_grid_kw

        strategy_results: Dict[str, StrategySchedule] = {}
        raw_schedules: Dict[str, Dict[str, int]] = {}
        infeasibility_diagnosis = None

        display_titles = {
            "baseline": "Baseline (Earliest Feasible Start)",
            "solar_aware": "Solar-Aware (Maximize Solar Self-Consumption)",
            "cost_optimized": "Cost-Optimized (Solar + Tariff + Demand Arbitrage)"
        }

        # 1. Run Baseline first to serve as reference
        baseline_res = self.solver.solve(
            machines=req.machines,
            solar=solar,
            tariff=tariff,
            demand_charge_rate=demand_charge_rate,
            base_load=base_load,
            p_max_kw=p_max,
            strategy="baseline"
        )
        raw_schedules["baseline"] = baseline_res["schedule"]

        base_kpis, base_load_prof, base_grid_prof, base_solar_used_prof, base_m_res, base_notes = (
            ScheduleVerifier.verify_and_compute_kpis(
                schedule=baseline_res["schedule"],
                machines=req.machines,
                solar=solar,
                tariff=tariff,
                demand_charge_rate=demand_charge_rate,
                base_load=base_load,
                p_max_kw=p_max
            )
        )

        strategy_results["baseline"] = StrategySchedule(
            strategy_name="baseline",
            display_title=display_titles.get("baseline", "Baseline"),
            status=baseline_res["status"],
            solver_duration_ms=round(baseline_res["solver_duration_ms"], 2),
            machine_schedules=base_m_res,
            load_profile=base_load_prof,
            grid_profile=base_grid_prof,
            solar_profile=solar,
            solar_used_profile=base_solar_used_prof,
            kpis=base_kpis,
            reasons=["All machines dispatched at their earliest start slot without shifting."],
            verifier_passed=len(base_notes) == 0,
            verifier_notes="; ".join(base_notes) if base_notes else None
        )

        # 2. Run other requested strategies
        for strat in req.strategies:
            if strat == "baseline":
                continue

            solve_out = self.solver.solve(
                machines=req.machines,
                solar=solar,
                tariff=tariff,
                demand_charge_rate=demand_charge_rate,
                base_load=base_load,
                p_max_kw=p_max,
                strategy=strat
            )
            raw_schedules[strat] = solve_out.get("schedule", {})

            if solve_out["status"] in ("OPTIMAL", "FEASIBLE"):
                kpis, load_prof, grid_prof, solar_used_prof, m_res, notes = (
                    ScheduleVerifier.verify_and_compute_kpis(
                        schedule=solve_out["schedule"],
                        machines=req.machines,
                        solar=solar,
                        tariff=tariff,
                        demand_charge_rate=demand_charge_rate,
                        base_load=base_load,
                        p_max_kw=p_max
                    )
                )

                strategy_results[strat] = StrategySchedule(
                    strategy_name=strat,
                    display_title=display_titles.get(strat, strat.replace("_", " ").title()),
                    status=solve_out["status"],
                    solver_duration_ms=round(solve_out["solver_duration_ms"], 2),
                    machine_schedules=m_res,
                    load_profile=load_prof,
                    grid_profile=grid_prof,
                    solar_profile=solar,
                    solar_used_profile=solar_used_prof,
                    kpis=kpis,
                    reasons=[],
                    verifier_passed=len(notes) == 0,
                    verifier_notes="; ".join(notes) if notes else None
                )
            else:
                infeasibility_diagnosis = solve_out.get("diagnosis", "Solver could not find a feasible schedule.")
                strategy_results[strat] = StrategySchedule(
                    strategy_name=strat,
                    display_title=display_titles.get(strat, strat.replace("_", " ").title()),
                    status=solve_out["status"],
                    solver_duration_ms=round(solve_out["solver_duration_ms"], 2),
                    machine_schedules=[],
                    load_profile=[0.0] * 96,
                    grid_profile=[0.0] * 96,
                    solar_profile=solar,
                    solar_used_profile=[0.0] * 96,
                    kpis=base_kpis, # fallback to base
                    reasons=[infeasibility_diagnosis],
                    verifier_passed=False,
                    verifier_notes=infeasibility_diagnosis
                )

        # 3. Generate plain-language reasons
        primary_strat = "cost_optimized" if "cost_optimized" in strategy_results else "solar_aware"
        machine_reasons = {}
        if primary_strat in raw_schedules and raw_schedules[primary_strat]:
            machine_reasons = ReasonEngine.generate_machine_reasons(
                baseline_schedule=raw_schedules["baseline"],
                optimized_schedule=raw_schedules[primary_strat],
                machines=req.machines,
                solar=solar,
                tariff=tariff
            )

            # Assign reasons back to machine schedule results
            if primary_strat in strategy_results:
                for m_item in strategy_results[primary_strat].machine_schedules:
                    if m_item.machine_id in machine_reasons:
                        m_item.reason = machine_reasons[m_item.machine_id]

                strategy_results[primary_strat].reasons = list(machine_reasons.values())

        return OptimizationResponse(
            site_id=req.site_id,
            scenario=req.scenario,
            timestamp=datetime.now(timezone.utc).isoformat(),
            strategies=strategy_results,
            machine_reasons=machine_reasons,
            infeasibility_diagnosis=infeasibility_diagnosis
        )
