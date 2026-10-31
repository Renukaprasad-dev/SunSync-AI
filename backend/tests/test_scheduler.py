import pytest
import math
from app.models.domain import Machine, Tariff, SolarProfile, OptimizationRequest
from app.scheduler.ortools_solver import ORToolsCPSATSolver
from app.scheduler.scipy_solver import ScipyMILPSolver
from app.scheduler.verifier import ScheduleVerifier
from app.scheduler.reason_engine import ReasonEngine
from app.scheduler.service import SchedulerService

# Helper fixtures
def create_demo_machines():
    return [
        Machine(
            id="m1_cnc",
            name="CNC Milling Center",
            power_kw=4.0,
            duration_intervals=16, # 4 hours
            earliest_start=32,     # 08:00
            latest_start=48,       # 12:00
            deadline_interval=68,  # 17:00
            flexible=True
        ),
        Machine(
            id="m2_compressor",
            name="Industrial Air Compressor",
            power_kw=3.5,
            duration_intervals=12, # 3 hours
            earliest_start=32,     # 08:00
            latest_start=48,       # 12:00
            deadline_interval=64,  # 16:00
            flexible=True
        ),
        Machine(
            id="m3_injection",
            name="Plastic Injection Molding",
            power_kw=5.0,
            duration_intervals=14, # 3.5 hours
            earliest_start=34,     # 08:30
            latest_start=44,       # 11:00
            deadline_interval=64,  # 16:00
            flexible=True
        ),
        Machine(
            id="m4_press_fixed",
            name="Hydraulic Stamping Press",
            power_kw=4.5,
            duration_intervals=10, # 2.5 hours
            earliest_start=32,     # 08:00
            latest_start=32,       # 08:00
            deadline_interval=50,  # 12:30
            flexible=False
        ),
        Machine(
            id="m5_oven",
            name="Electric Curing Oven",
            power_kw=3.0,
            duration_intervals=8,  # 2 hours
            earliest_start=36,     # 09:00
            latest_start=56,       # 14:00
            deadline_interval=72,  # 18:00
            flexible=True
        )
    ]

def create_solar_curve(peak_kw=5.0):
    gen = [0.0] * 96
    center = 49.0
    width = 10.0
    for i in range(26, 72):
        gen[i] = round(peak_kw * math.exp(-((i - center)**2) / (2 * (width**2))), 2)
    return gen

def create_tod_tariff():
    tariff = [4.5] * 96
    for i in range(96):
        if 24 <= i < 32:
            tariff[i] = 7.0
        elif 32 <= i < 40:
            tariff[i] = 9.0  # Morning peak: 08:00 - 10:00
        elif 40 <= i < 72:
            tariff[i] = 7.0  # Normal day: 10:00 - 18:00
        elif 72 <= i < 88:
            tariff[i] = 9.5  # Evening peak: 18:00 - 22:00
        elif 88 <= i < 96:
            tariff[i] = 4.5  # Night off-peak: 22:00 - 24:00
    return tariff

def create_base_load():
    return [0.8 if (i < 32 or i >= 76) else 1.5 for i in range(96)]


# --- Tests ---

def test_baseline_and_cost_optimized_with_ortools():
    """Verify OR-Tools finds feasible, optimal schedule that strictly respects all constraints and cuts cost."""
    machines = create_demo_machines()
    solar = create_solar_curve(5.0)
    tariff = create_tod_tariff()
    base_load = create_base_load()
    p_max = 20.0
    demand_charge = 20.0

    solver = ORToolsCPSATSolver()

    # 1. Baseline
    base_res = solver.solve(machines, solar, tariff, demand_charge, base_load, p_max, "baseline")
    assert base_res["status"] == "OPTIMAL"
    base_kpis, base_load_p, base_grid_p, _, _, base_notes = ScheduleVerifier.verify_and_compute_kpis(
        base_res["schedule"], machines, solar, tariff, demand_charge, base_load, p_max
    )
    assert len(base_notes) == 0

    # 2. Cost-Optimized
    cost_res = solver.solve(machines, solar, tariff, demand_charge, base_load, p_max, "cost_optimized")
    assert cost_res["status"] in ("OPTIMAL", "FEASIBLE")
    cost_kpis, cost_load_p, cost_grid_p, _, _, cost_notes = ScheduleVerifier.verify_and_compute_kpis(
        cost_res["schedule"], machines, solar, tariff, demand_charge, base_load, p_max
    )
    assert len(cost_notes) == 0
    assert cost_kpis.deadline_violations == 0

    # Cost-optimized must lower or equal peak grid demand and total electricity cost
    assert cost_kpis.daily_cost_rs < base_kpis.daily_cost_rs, (
        f"Optimized cost ({cost_kpis.daily_cost_rs}) should be lower than baseline ({base_kpis.daily_cost_rs})"
    )
    assert cost_kpis.peak_grid_demand_kw <= base_kpis.peak_grid_demand_kw, (
        f"Optimized peak ({cost_kpis.peak_grid_demand_kw}) must not exceed baseline peak ({base_kpis.peak_grid_demand_kw})"
    )
    assert cost_kpis.peak_grid_demand_kw <= p_max

def test_all_constraints_strictly_enforced():
    """Test that all schedule results strictly honor earliest, latest, and deadline intervals."""
    machines = create_demo_machines()
    solar = create_solar_curve(5.0)
    tariff = create_tod_tariff()
    base_load = create_base_load()

    solver = ORToolsCPSATSolver()
    for strat in ["solar_aware", "cost_optimized"]:
        res = solver.solve(machines, solar, tariff, 20.0, base_load, 25.0, strat)
        assert res["status"] in ("OPTIMAL", "FEASIBLE")

        for m in machines:
            start_s = res["schedule"][m.id]
            end_s = start_s + m.duration_intervals
            # 1. Earliest start
            assert start_s >= m.earliest_start, f"Machine {m.name} started before earliest"
            # 2. Latest start
            assert start_s <= m.latest_start, f"Machine {m.name} started after latest"
            # 3. Completion deadline
            assert end_s <= m.deadline_interval, f"Machine {m.name} completed after deadline"
            # 4. Non-flexible fixed start
            if not m.flexible:
                assert start_s == m.earliest_start, f"Non-flexible machine {m.name} moved"

def test_overcast_day_tariff_arbitrage():
    """Overcast scenario with near-zero solar: savings must come from time-of-day tariff arbitrage alone."""
    machines = create_demo_machines()
    overcast_solar = [0.05] * 96 # near-zero solar
    tariff = create_tod_tariff()
    base_load = create_base_load()

    solver = ORToolsCPSATSolver()
    base_res = solver.solve(machines, overcast_solar, tariff, 20.0, base_load, 25.0, "baseline")
    cost_res = solver.solve(machines, overcast_solar, tariff, 20.0, base_load, 25.0, "cost_optimized")

    base_kpis, _, _, _, _, _ = ScheduleVerifier.verify_and_compute_kpis(
        base_res["schedule"], machines, overcast_solar, tariff, 20.0, base_load, 25.0
    )
    cost_kpis, _, _, _, _, _ = ScheduleVerifier.verify_and_compute_kpis(
        cost_res["schedule"], machines, overcast_solar, tariff, 20.0, base_load, 25.0
    )

    # In baseline, machines run at 08:00 (slot 32, morning peak tariff 9.0 Rs/kWh).
    # In cost-optimized, flexible machines shift out of morning peak into normal tariff 7.0 Rs/kWh.
    assert cost_kpis.daily_cost_rs < base_kpis.daily_cost_rs
    assert cost_kpis.deadline_violations == 0

def test_infeasible_diagnosis():
    """Infeasible input must return a plain explanation rather than an exception."""
    # 1. Pydantic validator catches impossible machine before solver
    with pytest.raises(Exception) as exc_info:
        Machine(
            id="bad_m",
            name="Impossible Machine",
            power_kw=5.0,
            duration_intervals=20,
            earliest_start=32,
            latest_start=35,
            deadline_interval=45, # 32 + 20 = 52 > 45!
            flexible=True
        )
    assert "exceeds deadline" in str(exc_info.value)

    # 2. Solver diagnostic catches concurrent fixed machines exceeding P_max
    machines = [
        Machine(
            id="m1_fixed",
            name="Fixed Line A",
            power_kw=12.0,
            duration_intervals=10,
            earliest_start=32,
            latest_start=32,
            deadline_interval=50,
            flexible=False
        ),
        Machine(
            id="m2_fixed",
            name="Fixed Line B",
            power_kw=12.0,
            duration_intervals=10,
            earliest_start=32,
            latest_start=32,
            deadline_interval=50,
            flexible=False
        )
    ]
    solver = ORToolsCPSATSolver()
    res = solver.solve(
        machines=machines,
        solar=[0.0] * 96,
        tariff=[7.0] * 96,
        demand_charge_rate=20.0,
        base_load=[1.0] * 96,
        p_max_kw=15.0, # 12 + 12 + 1 = 25 kW > 15 kW!
        strategy="cost_optimized"
    )
    assert res["status"] == "INFEASIBLE"
    assert res["diagnosis"] is not None
    assert "exceeding grid limit" in res["diagnosis"]

def test_pmax_exceeded_infeasible_diagnosis():
    """P_max smaller than fixed machine load must produce clear explanation."""
    machines = [
        Machine(
            id="huge_fixed",
            name="Massive Fixed Forge",
            power_kw=30.0,
            duration_intervals=10,
            earliest_start=32,
            latest_start=32,
            deadline_interval=60,
            flexible=False
        )
    ]
    solver = ORToolsCPSATSolver()
    res = solver.solve(
        machines=machines,
        solar=[0.0]*96,
        tariff=[7.0]*96,
        demand_charge_rate=20.0,
        base_load=[1.0]*96,
        p_max_kw=15.0, # smaller than 30 kW!
        strategy="cost_optimized"
    )
    assert res["status"] == "INFEASIBLE"
    assert "P_max" in res["diagnosis"]
    assert "exceeding grid limit" in res["diagnosis"]

def test_reason_engine_generates_quantitative_text():
    """Verify reason engine generates informative strings with numbers."""
    machines = create_demo_machines()
    solar = create_solar_curve(5.0)
    tariff = create_tod_tariff()

    base_schedule = {m.id: m.earliest_start for m in machines}
    opt_schedule = {
        "m1_cnc": 44,          # shifted from 32 (08:00) to 44 (11:00)
        "m2_compressor": 46,   # shifted from 32 to 46 (11:30)
        "m3_injection": 40,    # shifted
        "m4_press_fixed": 32,  # fixed
        "m5_oven": 48          # shifted
    }

    reasons = ReasonEngine.generate_machine_reasons(base_schedule, opt_schedule, machines, solar, tariff)
    assert len(reasons) == len(machines)
    assert "Shifted from 08:00 to 11:00" in reasons["m1_cnc"]
    assert "Fixed at 08:00" in reasons["m4_press_fixed"]
    assert "deadline" in reasons["m1_cnc"].lower()

def test_full_scheduler_service():
    """Test full end-to-end service running all three strategies."""
    machines = create_demo_machines()
    solar_profile = SolarProfile(scenario="sunny", generation=create_solar_curve(5.0))
    tariff = Tariff(rates=create_tod_tariff(), demand_charge_rate_per_kw=20.0)

    req = OptimizationRequest(
        site_id="test_site",
        scenario="sunny",
        machines=machines,
        tariff=tariff,
        solar_profile=solar_profile,
        p_max_grid_kw=25.0
    )

    service = SchedulerService()
    resp = service.run_optimization(req)

    assert "baseline" in resp.strategies
    assert "solar_aware" in resp.strategies
    assert "cost_optimized" in resp.strategies

    assert resp.strategies["baseline"].verifier_passed
    assert resp.strategies["solar_aware"].verifier_passed
    assert resp.strategies["cost_optimized"].verifier_passed

    assert resp.strategies["cost_optimized"].kpis.deadline_violations == 0
    assert len(resp.machine_reasons) > 0


def test_scipy_solver_fallback():
    """Verify SciPy HiGHS fallback solver works correctly and produces feasible schedule."""
    machines = create_demo_machines()
    solar = create_solar_curve(5.0)
    tariff = create_tod_tariff()
    base_load = create_base_load()

    scipy_solver = ScipyMILPSolver()
    res = scipy_solver.solve(
        machines=machines,
        solar=solar,
        tariff=tariff,
        demand_charge_rate=20.0,
        base_load=base_load,
        p_max_kw=25.0,
        strategy="cost_optimized"
    )
    assert res["status"] in ("OPTIMAL", "FEASIBLE")
    assert len(res["schedule"]) == len(machines)
    kpis, _, _, _, _, notes = ScheduleVerifier.verify_and_compute_kpis(
        schedule=res["schedule"],
        machines=machines,
        solar=solar,
        tariff=tariff,
        demand_charge_rate=20.0,
        base_load=base_load,
        p_max_kw=25.0
    )
    assert kpis.deadline_violations == 0
    assert len(notes) == 0
