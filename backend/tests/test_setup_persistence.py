import uuid
import pytest
from app.core.config import settings
from app.core import db
from app.core.auth import AnonymousPrincipal, issue_token
from app.core.db import DataRepository
from app.models.domain import Machine, SiteUpdate, Tariff
from app.routers import optimize, sites
from app.routers.sites import get_site, update_site, get_machines, update_machines, get_tariff, update_tariff
from app.routers.optimize import run_optimization, OptimizeEndpointPayload
from starlette.requests import Request

DEMO_SITE_ID = "00000000-0000-0000-0000-000000000001"

def test_setup_pmax_and_machines_persistence(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "SESSION_SIGNING_SECRET", "setup-persistence-test-secret-32-bytes")
    monkeypatch.setattr(db, "LOCAL_STORE_PATH", tmp_path / "local_store.json")
    test_repo = DataRepository(storage_mode="local_file")
    monkeypatch.setattr(sites, "repo", test_repo)
    monkeypatch.setattr(optimize, "repo", test_repo)
    subject = str(uuid.uuid4())
    site_id = test_repo.clone_demo_site_for_visitor(subject)
    principal = AnonymousPrincipal(subject, site_id, 4_000_000_000)
    # 1. Update site P_max from 25.0 to 24.0 kW
    site_update = SiteUpdate(p_max_grid_kw=24.0)
    res_site = update_site(site_id, site_update, principal)
    assert res_site["p_max_grid_kw"] == 24.0

    # Verify get_site returns the new 24.0 kW
    fetched_site = get_site(site_id, principal)
    assert fetched_site["p_max_grid_kw"] == 24.0

    # 2. Fetch existing machines, add a machine, and save
    existing_machines = get_machines(site_id, principal)
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
    saved_machines = update_machines(site_id, updated_machines_list, principal)

    assert len(saved_machines) == initial_count + 1
    assert any(m.id == new_machine_id for m in saved_machines)

    # Re-fetch to ensure persistence
    re_fetched = get_machines(site_id, principal)
    assert len(re_fetched) == initial_count + 1
    laser = next(m for m in re_fetched if m.id == new_machine_id)
    assert laser.name == "High-Precision Laser Cutter"
    assert laser.power_kw == 3.2

    # 3. Test deletion: remove the added machine
    pruned_list = [m for m in re_fetched if m.id != new_machine_id]
    saved_pruned = update_machines(site_id, pruned_list, principal)
    assert len(saved_pruned) == initial_count
    assert not any(m.id == new_machine_id for m in saved_pruned)

    # 4. Update tariff demand charge
    tariff = get_tariff(site_id, principal)
    tariff.demand_charge_rate_per_kw = 25.5
    saved_tariff = update_tariff(site_id, tariff, principal)
    assert saved_tariff.demand_charge_rate_per_kw == 25.5

    re_fetched_tariff = get_tariff(site_id, principal)
    assert re_fetched_tariff.demand_charge_rate_per_kw == 25.5

    # 5. Verify local store survives a fresh DataRepository reload (simulating server reboot)
    fresh_repo = DataRepository(storage_mode="local_file")
    reboot_site = fresh_repo.get_site(site_id)
    assert reboot_site["p_max_grid_kw"] == 24.0
    reboot_tariff = fresh_repo.get_tariff(site_id)
    assert reboot_tariff.demand_charge_rate_per_kw == 25.5

    # 6. Optimize without specifying p_max_grid_kw in payload -> must inherit site's 24.0 kW
    opt_payload = OptimizeEndpointPayload(
        site_id=site_id,
        scenario="sunny",
        strategies=["cost_optimized"]
    )
    token, _ = issue_token(subject, site_id)
    request = Request({"type": "http", "method": "POST", "headers": [(b"authorization", f"Bearer {token}".encode())], "client": ("127.0.0.1", 1234), "server": ("test", 80), "scheme": "http", "path": "/optimize", "query_string": b""})
    opt_res = run_optimization(opt_payload, request)
    strat = opt_res.strategies["cost_optimized"]
    assert strat.kpis.peak_grid_demand_kw <= 24.0

    # Cleanup / Restore baseline state for test idempotency
    update_site(site_id, SiteUpdate(p_max_grid_kw=25.0), principal)
    tariff.demand_charge_rate_per_kw = 20.0
    update_tariff(site_id, tariff, principal)

