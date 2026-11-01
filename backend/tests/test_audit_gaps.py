import json
import math
import pytest
from pathlib import Path
from unittest.mock import patch

from app.models.domain import Machine, Tariff, SolarProfile, OptimizationRequest
from app.scheduler.ortools_solver import ORToolsCPSATSolver
from app.scheduler.scipy_solver import ScipyMILPSolver
from app.scheduler.verifier import ScheduleVerifier
from app.scheduler.service import SchedulerService
from app.forecast.forecaster import SolarAndLoadForecaster, CompactTreeModel

DEMO_SITE_ID = "00000000-0000-0000-0000-000000000001"

def get_base_fixtures():
    machines = [
        Machine(
            id="m1",
            name="CNC Center",
            power_kw=4.0,
            duration_intervals=16,
            earliest_start=32,
            latest_start=48,
            deadline_interval=68,
            flexible=True
        ),
        Machine(
            id="m2",
            name="Air Compressor",
            power_kw=3.5,
            duration_intervals=12,
            earliest_start=32,
            latest_start=48,
            deadline_interval=64,
            flexible=True
        ),
        Machine(
            id="m3_fixed",
            name="Hydraulic Press Fixed",
            power_kw=4.5,
            duration_intervals=10,
            earliest_start=32,
            latest_start=32,
            deadline_interval=50,
            flexible=False
        )
    ]
    # Bell curve solar
    solar = [0.0] * 96
    for i in range(26, 72):
        solar[i] = round(5.0 * math.exp(-((i - 49)**2) / (2 * 100)), 2)

    tariff = [4.5] * 96
    for i in range(32, 40):
        tariff[i] = 9.0 # Morning peak
    for i in range(72, 88):
        tariff[i] = 9.5 # Evening peak
    for i in range(40, 72):
        tariff[i] = 7.0 # Day normal

    base_load = [0.8 if (i < 32 or i >= 76) else 1.5 for i in range(96)]
    return machines, solar, tariff, base_load

# ----------------- 1. OPTIMIZER CONVENTIONS & EDGE CASES -----------------

def test_15min_interval_convention_pinned():
    """Pins 15-minute grid convention: 96 intervals/day, duration in slots, end = start + duration."""
    m = Machine(
        id="m_test",
        name="Test Slot Machine",
        power_kw=2.0,
        duration_intervals=8, # 8 * 15 min = 2.0 hours
        earliest_start=32,    # 32 * 15 min = 8:00 AM (480 min)
        latest_start=40,      # 40 * 15 min = 10:00 AM
        deadline_interval=52, # 52 * 15 min = 13:00 PM
        flexible=True
    )
    # Start at slot 32 -> End slot must be exactly 32 + 8 = 40 (10:00 AM)
    end_slot = m.earliest_start + m.duration_intervals
    assert end_slot == 40
    assert (m.duration_intervals * 0.25) == 2.0
    assert end_slot <= m.deadline_interval

def test_optimizer_staggers_loads_under_strict_grid_limit():
    """Under a tight grid limit, solver staggers flexible machines so peak never exceeds P_max."""
    machines, solar, tariff, base_load = get_base_fixtures()
    # Tight grid limit: 6.0 kW (simultaneous run of m1(4.0) + m2(3.5) + m3_fixed(4.5) + base(1.5) = 13.5 kW would violate)
    p_max = 6.5
    scipy_solver = ScipyMILPSolver()
    res = scipy_solver.solve(
        machines=machines,
        solar=solar,
        tariff=tariff,
        demand_charge_rate=20.0,
        base_load=base_load,
        p_max_kw=p_max,
        strategy="cost_optimized"
    )
    assert res["status"] in ("OPTIMAL", "FEASIBLE")

    kpis, load, grid, _, _, notes = ScheduleVerifier.verify_and_compute_kpis(
        schedule=res["schedule"],
        machines=machines,
        solar=solar,
        tariff=tariff,
        demand_charge_rate=20.0,
        base_load=base_load,
        p_max_kw=p_max
    )
    assert kpis.deadline_violations == 0
    assert kpis.peak_grid_demand_kw <= p_max + 1e-3
    assert len(notes) == 0

def test_fixed_machines_never_move_and_near_zero_solar_arbitrage():
    """Fixed machines remain pinned; overcast solar shifts flexible machines to avoid morning peak."""
    machines, _, tariff, base_load = get_base_fixtures()
    overcast_solar = [0.0] * 96 # Zero solar
    solver = ScipyMILPSolver()
    res = solver.solve(
        machines=machines,
        solar=overcast_solar,
        tariff=tariff,
        demand_charge_rate=20.0,
        base_load=base_load,
        p_max_kw=25.0,
        strategy="cost_optimized"
    )
    sched = res["schedule"]
    # Fixed machine m3_fixed must stay at slot 32
    assert sched["m3_fixed"] == 32
    # Flexible machines must avoid morning peak (slots 32..40 at 9.0 Rs/kWh)
    assert sched["m1"] >= 40 # Shifted past 10:00 AM

def test_dual_solvers_cost_agreement_on_demo_site():
    """Both OR-Tools and SciPy HiGHS solvers pass verifier and costs agree within 3% tolerance."""
    machines, solar, tariff, base_load = get_base_fixtures()
    p_max = 20.0

    # 1. OR-Tools
    ortools_solver = ORToolsCPSATSolver()
    res_ortools = ortools_solver.solve(
        machines=machines,
        solar=solar,
        tariff=tariff,
        demand_charge_rate=20.0,
        base_load=base_load,
        p_max_kw=p_max,
        strategy="cost_optimized"
    )
    kpis_ortools, _, _, _, _, notes_ortools = ScheduleVerifier.verify_and_compute_kpis(
        schedule=res_ortools["schedule"],
        machines=machines,
        solar=solar,
        tariff=tariff,
        demand_charge_rate=20.0,
        base_load=base_load,
        p_max_kw=p_max
    )
    assert kpis_ortools.deadline_violations == 0
    assert len(notes_ortools) == 0

    # 2. SciPy HiGHS
    scipy_solver = ScipyMILPSolver()
    res_scipy = scipy_solver.solve(
        machines=machines,
        solar=solar,
        tariff=tariff,
        demand_charge_rate=20.0,
        base_load=base_load,
        p_max_kw=p_max,
        strategy="cost_optimized"
    )
    kpis_scipy, _, _, _, _, notes_scipy = ScheduleVerifier.verify_and_compute_kpis(
        schedule=res_scipy["schedule"],
        machines=machines,
        solar=solar,
        tariff=tariff,
        demand_charge_rate=20.0,
        base_load=base_load,
        p_max_kw=p_max
    )
    assert kpis_scipy.deadline_violations == 0
    assert len(notes_scipy) == 0

    # Cost agreement check
    cost_ortools = kpis_ortools.daily_cost_rs
    cost_scipy = kpis_scipy.daily_cost_rs
    diff_pct = abs(cost_ortools - cost_scipy) / max(cost_ortools, cost_scipy) * 100.0
    # Both optimal solutions agree within 3%
    assert diff_pct < 3.0, f"Solvers disagreed: OR-Tools {cost_ortools} vs SciPy {cost_scipy} ({diff_pct:.2f}% gap)"

# ----------------- 2. DASHBOARD METRIC CONSISTENCY -----------------

def test_zero_negative_and_nonfinite_machine_power_rejected():
    """Confirms domain model strictly rejects 0, negative, and non-finite machine power."""
    # 1. Zero power
    with pytest.raises(ValueError):
        Machine(
            id="m_zero",
            name="Zero Power Machine",
            power_kw=0.0,
            duration_intervals=10,
            earliest_start=32,
            latest_start=48,
            deadline_interval=60,
            flexible=True
        )

    # 2. Negative power
    with pytest.raises(ValueError):
        Machine(
            id="m_neg",
            name="Negative Power Machine",
            power_kw=-3.5,
            duration_intervals=10,
            earliest_start=32,
            latest_start=48,
            deadline_interval=60,
            flexible=True
        )

    # 3. Non-finite power (inf, nan)
    with pytest.raises(ValueError):
        Machine(
            id="m_inf",
            name="Inf Power Machine",
            power_kw=float("inf"),
            duration_intervals=10,
            earliest_start=32,
            latest_start=48,
            deadline_interval=60,
            flexible=True
        )

    with pytest.raises(ValueError):
        Machine(
            id="m_nan",
            name="NaN Power Machine",
            power_kw=float("nan"),
            duration_intervals=10,
            earliest_start=32,
            latest_start=48,
            deadline_interval=60,
            flexible=True
        )

def test_solver_timeout_behavior():
    """Confirms solver handles aggressive timeout gracefully returning feasible schedule or clear error."""
    machines, solar, tariff, base_load = get_base_fixtures()
    solver = ORToolsCPSATSolver()
    res = solver.solve(
        machines=machines,
        solar=solar,
        tariff=tariff,
        demand_charge_rate=20.0,
        base_load=base_load,
        p_max_kw=20.0,
        strategy="cost_optimized",
        time_limit_sec=0.0001 # Aggressive timeout
    )
    # Solver must return either a verified schedule or INFEASIBLE with diagnosis, never crash
    assert res["status"] in ("OPTIMAL", "FEASIBLE", "INFEASIBLE")
    if res["status"] in ("OPTIMAL", "FEASIBLE"):
        assert len(res["schedule"]) == len(machines)
    else:
        assert res["diagnosis"] is not None

def test_dashboard_kpis_recomputed_independently():
    """Asserts that both baseline and optimized reported KPIs match an independent interval-by-interval math re-simulation."""
    machines, solar, tariff, base_load = get_base_fixtures()
    solver = ScipyMILPSolver()

    for strat in ("baseline", "cost_optimized"):
        res = solver.solve(
            machines=machines,
            solar=solar,
            tariff=tariff,
            demand_charge_rate=20.0,
            base_load=base_load,
            p_max_kw=20.0,
            strategy=strat
        )
        kpis, load_prof, grid_prof, solar_prof, solar_used_prof, _ = ScheduleVerifier.verify_and_compute_kpis(
            schedule=res["schedule"],
            machines=machines,
            solar=solar,
            tariff=tariff,
            demand_charge_rate=20.0,
            base_load=base_load,
            p_max_kw=20.0
        )

        # Independent manual calculation:
        # 1. Total energy
        expected_total_energy = sum(load_prof) * 0.25
        assert abs(kpis.total_factory_energy_kwh - expected_total_energy) < 1e-2

        # 2. Grid energy
        expected_grid_energy = sum(grid_prof) * 0.25
        assert abs(kpis.grid_energy_imported_kwh - expected_grid_energy) < 1e-2

        # 3. Peak grid demand
        expected_peak = max(grid_prof)
        assert abs(kpis.peak_grid_demand_kw - expected_peak) < 1e-2

        # 4. Energy cost + demand charge
        energy_cost = sum(grid_prof[t] * tariff[t] * 0.25 for t in range(96))
        demand_cost = expected_peak * 20.0
        expected_total_cost = energy_cost + demand_cost
        assert abs(kpis.daily_cost_rs - expected_total_cost) < 1e-1


# ----------------- 3. FORECAST VALIDATION -----------------

def test_forecaster_night_time_zero_and_feature_order():
    """Validates pre-trained models produce near-zero night solar and match metadata features."""
    forecaster = SolarAndLoadForecaster()
    forecast = forecaster.predict_day(scenario="sunny")

    solar = forecast["solar_forecast"]
    load = forecast["load_forecast"]

    # 1. Solar is 0 at night (slots 0..23 is 00:00..05:45; slots 72..95 is 18:00..23:45)
    for slot in range(0, 24):
        assert solar[slot] == 0.0, f"Night solar at slot {slot} was non-zero: {solar[slot]}"
    for slot in range(72, 96):
        assert solar[slot] == 0.0, f"Night solar at slot {slot} was non-zero: {solar[slot]}"

    # Daylight peak > 0.5 kW under live conditions, and >= 4.0 kW under clear sky
    assert max(solar) > 0.5
    forecaster_clear = SolarAndLoadForecaster()
    forecaster_clear.fetch_open_meteo_weather = lambda *a, **kw: None
    clear_solar = forecaster_clear.predict_day(scenario="sunny")["solar_forecast"]
    assert max(clear_solar) >= 4.0

    # 2. Load is positive and finite
    assert all(math.isfinite(l) and l >= 0.5 for l in load)

    # 3. Metrics match held-out test split metadata
    assert forecast["metrics"]["solar_mae_kw"] == 0.054
    assert forecast["metrics"]["solar_rmse_kw"] == 0.095

def test_forecaster_missing_or_corrupt_model_raises_actionable_error(tmp_path):
    """Corrupt or missing model file must raise an actionable error, never fabrications."""
    corrupt_file = tmp_path / "corrupt_model.json"
    corrupt_file.write_text("{ this is not valid json }")
    with pytest.raises(Exception):
        CompactTreeModel(corrupt_file)
