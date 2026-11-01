import uuid
import pytest
from app.core.config import settings
from app.core.db import DataRepository, repo
from app.models.domain import Machine, SiteUpdate, Tariff
from app.routers.sites import get_site, update_site, get_machines, update_machines, get_tariff, update_tariff
from app.routers.optimize import run_optimization, OptimizeEndpointPayload

DEMO_SITE_ID = "00000000-0000-0000-0000-000000000001"

def test_setup_pmax_and_machines_persistence():
    # 1. Update site P_max from 25.0 to 24.0 kW
    site_update = SiteUpdate(p_max_grid_kw=24.0)
    res_site = update_site(DEMO_SITE_ID, site_update)
    assert res_site["p_max_grid_kw"] == 24.0

    # Verify get_site returns the new 24.0 kW
    fetched_site = get_site(DEMO_SITE_ID)
    assert fetched_site["p_max_grid_kw"] == 24.0

    # 2. Fetch existing machines, add a machine, and save
    existing_machines = get_machines(DEMO_SITE_ID)
    initial_count = len(existing_machines)

    new_machine_id = str(uuid.uuid4())
    new_machine = Machine(
        id=new_machine_id,
        name="High-Precision Laser Cutter",
        power_kw=3.2,
        duration_intervals=8,
        earliest_start=34,
        latest_start=50,
        deadline_interval=66,
        flexible=True
    )
    updated_machines_list = existing_machines + [new_machine]
    saved_machines = update_machines(DEMO_SITE_ID, updated_machines_list)

    assert len(saved_machines) == initial_count + 1
    assert any(m.id == new_machine_id for m in saved_machines)

    # Re-fetch to ensure persistence
    re_fetched = get_machines(DEMO_SITE_ID)
    assert len(re_fetched) == initial_count + 1
    laser = next(m for m in re_fetched if m.id == new_machine_id)
    assert laser.name == "High-Precision Laser Cutter"
    assert laser.power_kw == 3.2

    # 3. Test deletion: remove the added machine
    pruned_list = [m for m in re_fetched if m.id != new_machine_id]
    saved_pruned = update_machines(DEMO_SITE_ID, pruned_list)
    assert len(saved_pruned) == initial_count
    assert not any(m.id == new_machine_id for m in saved_pruned)

    # 4. Update tariff demand charge
    tariff = get_tariff(DEMO_SITE_ID)
    tariff.demand_charge_rate_per_kw = 25.5
    saved_tariff = update_tariff(DEMO_SITE_ID, tariff)
    assert saved_tariff.demand_charge_rate_per_kw == 25.5

    re_fetched_tariff = get_tariff(DEMO_SITE_ID)
    assert re_fetched_tariff.demand_charge_rate_per_kw == 25.5

    # 5. Verify local store survives a fresh DataRepository reload (simulating server reboot)
    fresh_repo = DataRepository()
    reboot_site = fresh_repo.get_site(DEMO_SITE_ID)
    assert reboot_site["p_max_grid_kw"] == 24.0
    reboot_tariff = fresh_repo.get_tariff(DEMO_SITE_ID)
    assert reboot_tariff.demand_charge_rate_per_kw == 25.5

    # 6. Optimize without specifying p_max_grid_kw in payload -> must inherit site's 24.0 kW
    opt_payload = OptimizeEndpointPayload(
        site_id=DEMO_SITE_ID,
        scenario="sunny",
        strategies=["cost_optimized"]
    )
    opt_res = run_optimization(opt_payload)
    strat = opt_res.strategies["cost_optimized"]
    assert strat.kpis.peak_grid_demand_kw <= 24.0

    # Cleanup / Restore baseline state for test idempotency
    update_site(DEMO_SITE_ID, SiteUpdate(p_max_grid_kw=25.0))
    tariff.demand_charge_rate_per_kw = 20.0
    update_tariff(DEMO_SITE_ID, tariff)

