import uuid
import time
from concurrent.futures import ThreadPoolExecutor
import pytest
import httpx
from fastapi import HTTPException
from app.core.config import settings
from app.core.db import DataRepository, SiteCreationLimitReached
from app.models.domain import Machine, SolarProfile, Tariff

DEMO_SITE_ID = "00000000-0000-0000-0000-000000000001"
VISITOR_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
VISITOR_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

def test_writes_to_shared_seeded_demo_site_are_rejected():
    """Direct writes to the shared demo site must be rejected with 403 Forbidden."""
    repo = DataRepository(storage_mode="memory")
    machines = repo.get_machines(DEMO_SITE_ID)
    tariff = repo.get_tariff(DEMO_SITE_ID)

    with pytest.raises(HTTPException) as exc_info:
        repo.save_site_config_for_visitor(
            site_id=DEMO_SITE_ID,
            site_data={"p_max_grid_kw": 20.0},
            machines=machines,
            tariff=tariff,
            expected_version=1,
            visitor_id=VISITOR_A
        )
    assert exc_info.value.status_code == 403
    assert "Direct mutation of the shared demo site is rejected" in exc_info.value.detail

def test_first_write_clones_demo_site_into_visitor_scoped_site(monkeypatch):
    """A memory repository clones the demo site with new IDs and server ownership."""
    repo = DataRepository(storage_mode="memory")

    # Clone demo site for Visitor A
    sandbox_site_id = repo.clone_demo_site_for_visitor(visitor_id=VISITOR_A)

    assert sandbox_site_id != DEMO_SITE_ID
    sandbox_site = repo.get_site(sandbox_site_id)
    assert sandbox_site["id"] == sandbox_site_id
    assert sandbox_site["owner_session_id"] == VISITOR_A
    assert "Visitor Sandbox" in sandbox_site["name"]

    # Verify machines were cloned
    cloned_machines = repo.get_machines(sandbox_site_id)
    assert len(cloned_machines) == 7
    # Machine IDs must be new UUIDs, not identical to demo site machine IDs
    demo_machine_ids = {m.id for m in repo.get_machines(DEMO_SITE_ID)}
    assert not any(m.id in demo_machine_ids for m in cloned_machines)

def test_visitor_a_cannot_read_or_modify_visitor_b_sandbox():
    """Visitor A cannot read or modify Visitor B's sandbox site."""
    repo = DataRepository(storage_mode="memory")

    # Visitor B creates a sandbox site
    site_b_id = repo.clone_demo_site_for_visitor(visitor_id=VISITOR_B)
    assert repo.get_site(site_b_id)["owner_session_id"] == VISITOR_B

    # Visitor A attempts to read Visitor B's sandbox site -> 403 Forbidden
    with pytest.raises(HTTPException) as exc_read:
        repo.get_site_for_visitor(site_id=site_b_id, visitor_id=VISITOR_A)
    assert exc_read.value.status_code == 403
    assert "cannot access sandbox site" in exc_read.value.detail

    # Visitor A attempts to modify Visitor B's sandbox site -> 403 Forbidden
    machines_b = repo.get_machines(site_b_id)
    tariff_b = repo.get_tariff(site_b_id)
    with pytest.raises(HTTPException) as exc_write:
        repo.save_site_config_for_visitor(
            site_id=site_b_id,
            site_data={"p_max_grid_kw": 18.0},
            machines=machines_b,
            tariff=tariff_b,
            expected_version=1,
            visitor_id=VISITOR_A
        )
    assert exc_write.value.status_code == 403
    assert "cannot modify sandbox site" in exc_write.value.detail

    # But Visitor B can read and modify their own sandbox site
    own_site = repo.get_site_for_visitor(site_id=site_b_id, visitor_id=VISITOR_B)
    assert own_site["id"] == site_b_id

def test_sandbox_cleanup_does_not_delete_shared_demo_site(monkeypatch):
    """Sandbox TTL cleanup purges expired visitor sites but NEVER deletes the shared demo site."""
    deleted_urls = []
    def mock_delete(url, **kwargs):
        deleted_urls.append(url)
        return httpx.Response(204)

    monkeypatch.setattr(httpx, "delete", mock_delete)
    repo = DataRepository(storage_mode="memory")

    # Create an expired visitor site by aging the timestamp cleanup evaluates.
    old_visitor_id = "cccccccc-cccc-cccc-cccc-cccccccccccc"
    old_site_id = repo.clone_demo_site_for_visitor(visitor_id=old_visitor_id)
    repo._sites[old_site_id]["updated_at"] = 1000.0 # Way in the past

    # Run cleanup with 3600s TTL
    purged_count = repo.cleanup_expired_sandboxes(max_age_seconds=3600)
    assert purged_count >= 1

    # Verify old visitor site was deleted
    assert old_site_id not in repo._sites

    # CRITICAL: Confirm shared demo site was NOT deleted
    assert DEMO_SITE_ID in repo._sites
    assert repo.get_site(DEMO_SITE_ID) is not None
    assert not any(DEMO_SITE_ID in url for url in deleted_urls)


def test_cleanup_uses_session_ttl_plus_grace_and_preserves_demo(monkeypatch):
    monkeypatch.setattr(settings, "SESSION_TOKEN_TTL_SECONDS", 3600)
    repo = DataRepository(storage_mode="memory")
    active_id = repo.clone_demo_site_for_visitor(VISITOR_A)
    expired_id = repo.clone_demo_site_for_visitor(VISITOR_B)
    now = time.time()
    repo._sites[active_id]["updated_at"] = now - 3500
    repo._sites[expired_id]["updated_at"] = now - 7300

    purged = repo.cleanup_expired_sandboxes(max_age_seconds=60)

    assert purged == 1
    assert active_id in repo._sites
    assert expired_id not in repo._sites
    assert DEMO_SITE_ID in repo._sites


def _set_site_storage_data(repo, site_id, solar_value, base_load_value):
    repo._solar_profiles[site_id] = {
        "sunny": SolarProfile(scenario="sunny", generation=[solar_value] * 96, capacity_kw=5.0)
    }
    repo._base_loads[site_id] = [base_load_value] * 96


def _append_site_run(repo, site_id, run_id):
    repo._optimization_runs.append({"id": run_id, "site_id": site_id, "results": {"sample": True}})


def test_cleanup_removes_expired_site_data_and_preserves_active_and_demo_data(monkeypatch):
    monkeypatch.setattr(settings, "SESSION_TOKEN_TTL_SECONDS", 3600)
    repo = DataRepository(storage_mode="memory")
    expired_id = repo.clone_demo_site_for_visitor(VISITOR_A)
    active_id = repo.clone_demo_site_for_visitor(VISITOR_B)
    _set_site_storage_data(repo, expired_id, solar_value=1.25, base_load_value=2.5)
    _set_site_storage_data(repo, active_id, solar_value=3.5, base_load_value=4.5)
    _append_site_run(repo, expired_id, "expired-run")
    _append_site_run(repo, active_id, "active-run")
    _append_site_run(repo, DEMO_SITE_ID, "demo-run")
    repo._sites[expired_id]["updated_at"] = time.time() - 8000
    repo._sites[active_id]["updated_at"] = time.time() - 1000

    active_machines = [machine.model_dump() for machine in repo._machines[active_id]]
    active_tariff = repo._tariffs[active_id].model_dump()
    active_solar = repo._solar_profiles[active_id]["sunny"].model_dump()
    active_base_load = list(repo._base_loads[active_id])
    demo_machines = [machine.model_dump() for machine in repo._machines[DEMO_SITE_ID]]
    demo_tariff = repo._tariffs[DEMO_SITE_ID].model_dump()
    demo_solar = {
        scenario: profile.model_dump()
        for scenario, profile in repo._solar_profiles[DEMO_SITE_ID].items()
    }
    demo_base_load = list(repo._base_loads[DEMO_SITE_ID])

    assert repo.cleanup_expired_sandboxes(max_age_seconds=60) == 1

    assert expired_id not in repo._sites
    assert expired_id not in repo._machines
    assert expired_id not in repo._tariffs
    assert expired_id not in repo._solar_profiles
    assert expired_id not in repo._base_loads
    assert all(run["site_id"] != expired_id for run in repo._optimization_runs)

    assert active_id in repo._sites
    assert [machine.model_dump() for machine in repo._machines[active_id]] == active_machines
    assert repo._tariffs[active_id].model_dump() == active_tariff
    assert repo._solar_profiles[active_id]["sunny"].model_dump() == active_solar
    assert repo._base_loads[active_id] == active_base_load
    assert any(run["id"] == "active-run" for run in repo._optimization_runs)

    assert DEMO_SITE_ID in repo._sites
    assert [machine.model_dump() for machine in repo._machines[DEMO_SITE_ID]] == demo_machines
    assert repo._tariffs[DEMO_SITE_ID].model_dump() == demo_tariff
    assert {
        scenario: profile.model_dump()
        for scenario, profile in repo._solar_profiles[DEMO_SITE_ID].items()
    } == demo_solar
    assert repo._base_loads[DEMO_SITE_ID] == demo_base_load
    assert any(run["id"] == "demo-run" for run in repo._optimization_runs)


def test_cleanup_handles_missing_optional_site_data(monkeypatch):
    monkeypatch.setattr(settings, "SESSION_TOKEN_TTL_SECONDS", 3600)
    repo = DataRepository(storage_mode="memory")
    site_id = str(uuid.uuid4())
    repo._sites[site_id] = {
        "id": site_id,
        "owner_session_id": VISITOR_A,
        "updated_at": time.time() - 8000,
    }

    assert repo.cleanup_expired_sandboxes(max_age_seconds=60) == 1
    assert site_id not in repo._sites


def test_file_backed_cleanup_persists_site_data_removals_after_reload(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "SESSION_TOKEN_TTL_SECONDS", 3600)
    store_path = tmp_path / "isolated-store.json"
    monkeypatch.setattr("app.core.db.LOCAL_STORE_PATH", store_path)
    monkeypatch.setattr("app.core.db.LOCAL_DATA_DIR", tmp_path)
    repo = DataRepository(storage_mode="local_file")
    expired_id = repo.clone_demo_site_for_visitor(VISITOR_A)
    active_id = repo.clone_demo_site_for_visitor(VISITOR_B)
    _set_site_storage_data(repo, expired_id, solar_value=1.25, base_load_value=2.5)
    _set_site_storage_data(repo, active_id, solar_value=3.5, base_load_value=4.5)
    _append_site_run(repo, expired_id, "expired-run")
    _append_site_run(repo, active_id, "active-run")
    _append_site_run(repo, DEMO_SITE_ID, "demo-run")
    repo._sites[expired_id]["updated_at"] = time.time() - 8000
    repo._sites[active_id]["updated_at"] = time.time() - 1000
    active_machines = [machine.model_dump() for machine in repo._machines[active_id]]
    active_tariff = repo._tariffs[active_id].model_dump()
    demo_machines = [machine.model_dump() for machine in repo._machines[DEMO_SITE_ID]]
    demo_tariff = repo._tariffs[DEMO_SITE_ID].model_dump()
    repo._save_local_store()

    assert repo.cleanup_expired_sandboxes(max_age_seconds=60) == 1

    reloaded = DataRepository(storage_mode="local_file")
    assert expired_id not in reloaded._sites
    assert expired_id not in reloaded._machines
    assert expired_id not in reloaded._tariffs
    assert expired_id not in reloaded._solar_profiles
    assert expired_id not in reloaded._base_loads
    assert all(run["site_id"] != expired_id for run in reloaded._optimization_runs)

    assert active_id in reloaded._sites
    assert active_id in reloaded._machines
    assert active_id in reloaded._tariffs
    assert [machine.model_dump() for machine in reloaded._machines[active_id]] == active_machines
    assert reloaded._tariffs[active_id].model_dump() == active_tariff
    assert reloaded._solar_profiles[active_id]["sunny"].generation == [3.5] * 96
    assert reloaded._base_loads[active_id] == [4.5] * 96
    assert any(run["id"] == "active-run" for run in reloaded._optimization_runs)

    assert DEMO_SITE_ID in reloaded._sites
    assert DEMO_SITE_ID in reloaded._machines
    assert DEMO_SITE_ID in reloaded._tariffs
    assert [machine.model_dump() for machine in reloaded._machines[DEMO_SITE_ID]] == demo_machines
    assert reloaded._tariffs[DEMO_SITE_ID].model_dump() == demo_tariff
    assert DEMO_SITE_ID in reloaded._solar_profiles
    assert DEMO_SITE_ID in reloaded._base_loads
    assert any(run["id"] == "demo-run" for run in reloaded._optimization_runs)


def test_local_site_creation_limit_is_atomic_within_repository_instance():
    repo = DataRepository(storage_mode="memory")
    owner = "dddddddd-dddd-dddd-dddd-dddddddddddd"
    repo.create_owned_site({"id": str(uuid.uuid4())}, owner, max_sites=2)

    def create_one(index):
        try:
            return repo.create_owned_site({"id": str(uuid.uuid4()), "name": str(index)}, owner, max_sites=2)
        except SiteCreationLimitReached:
            return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(create_one, range(8)))

    assert sum(result is not None for result in results) == 1
    assert sum(site.get("owner_session_id") == owner for site in repo._sites.values()) == 2

def test_short_spoofed_visitor_ids_rejected():
    """Visitor session IDs shorter than 32 hex characters must be rejected with 400 Bad Request."""
    repo = DataRepository(storage_mode="memory")

    for invalid_id in ["short-id", "abc123", "12345", "", "a" * 31]:
        with pytest.raises(HTTPException) as exc_clone:
            repo.clone_demo_site_for_visitor(visitor_id=invalid_id)
        assert exc_clone.value.status_code == 400
        assert "Invalid visitor session ID" in exc_clone.value.detail or "required" in exc_clone.value.detail

        with pytest.raises(HTTPException) as exc_get:
            repo.get_site_for_visitor(site_id=DEMO_SITE_ID, visitor_id=invalid_id)
        assert exc_get.value.status_code == 400

