from app.main import health_check
from app.routers.sites import list_sites, get_machines, get_tariff, get_solar_profile
from app.routers.optimize import run_optimization, OptimizeEndpointPayload
from app.routers.scenarios import simulate_scenario, ScenarioSimulateRequest
from app.routers.forecast import get_day_forecast

DEMO_SITE_ID = "00000000-0000-0000-0000-000000000001"

def test_health_endpoint():
    res = health_check()
    assert res["status"] == "healthy"
    assert res["intervals_per_day"] == 96
    assert res["interval_minutes"] == 15

def test_sites_and_resources_endpoints():
    sites = list_sites()
    assert len(sites) >= 1
    assert sites[0]["id"] == DEMO_SITE_ID

    machines = get_machines(DEMO_SITE_ID)
    assert len(machines) == 7
    assert any(m.flexible is False for m in machines)

    tariff = get_tariff(DEMO_SITE_ID)
    assert len(tariff.rates) == 96
    assert tariff.demand_charge_rate_per_kw == 20.0

    solar = get_solar_profile(DEMO_SITE_ID, "sunny")
    assert len(solar.generation) == 96
    assert max(solar.generation) == 5.0

def test_optimize_endpoint_execution():
    payload = OptimizeEndpointPayload(
        site_id=DEMO_SITE_ID,
        scenario="sunny",
        strategies=["baseline", "solar_aware", "cost_optimized"]
    )
    res = run_optimization(payload)
    assert "baseline" in res.strategies
    assert "solar_aware" in res.strategies
    assert "cost_optimized" in res.strategies

    base_kpis = res.strategies["baseline"].kpis
    cost_kpis = res.strategies["cost_optimized"].kpis
    solar_kpis = res.strategies["solar_aware"].kpis

    # Cost-optimized achieves lower cost
    assert cost_kpis.daily_cost_rs < base_kpis.daily_cost_rs
    assert cost_kpis.deadline_violations == 0

    # Solar-aware achieves high solar energy usage
    assert solar_kpis.solar_energy_used_kwh >= base_kpis.solar_energy_used_kwh
    assert solar_kpis.deadline_violations == 0

    # Check reasons generated for machines
    assert len(res.machine_reasons) == 7

def test_scenarios_simulate_endpoint():
    payload = ScenarioSimulateRequest(
        site_id=DEMO_SITE_ID,
        scenario="overcast",
        p_max_grid_kw=25.0
    )
    res = simulate_scenario(payload)
    assert res.scenario == "overcast"
    assert "cost_optimized" in res.strategies
    assert res.strategies["cost_optimized"].kpis.deadline_violations == 0

def test_forecast_endpoint():
    res = get_day_forecast(scenario="sunny")
    assert "solar_forecast" in res
    assert len(res["solar_forecast"]) == 96
    assert "load_forecast" in res
    assert len(res["load_forecast"]) == 96
    assert "metrics" in res
    assert "solar_mae_kw" in res["metrics"]
