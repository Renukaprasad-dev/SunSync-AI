import uuid
import pytest
from fastapi import HTTPException
from app.core.config import settings
from app.core.db import DataRepository, repo
from app.models.domain import Machine, SiteUpdate, Tariff, SiteConfigPayload
from app.core.auth import AnonymousPrincipal
from app.routers import sites
from app.routers.sites import get_site_config_endpoint, update_site_config_endpoint

DEMO_SITE_ID = "00000000-0000-0000-0000-000000000001"

def test_atomic_config_save_and_conflict_detection(monkeypatch):
    test_repo = DataRepository(storage_mode="memory")
    monkeypatch.setattr(sites, "repo", test_repo)
    subject = str(uuid.uuid4())
    site_id = test_repo.clone_demo_site_for_visitor(subject)
    principal = AnonymousPrincipal(subject, site_id, 4_000_000_000)
    # 1. Fetch current config
    config = get_site_config_endpoint(site_id, principal)
    assert config["site"]["id"] == site_id
    assert len(config["machines"]) == 7
    current_version = config.get("version", 1)

    # 2. Modify: Change grid limit to 23.0, delete last machine, add a new machine
    machines = [Machine(**m.model_dump()) for m in config["machines"][:-1]] # Remove 1 machine
    new_m_id = str(uuid.uuid4())
    new_m = Machine(
        id=new_m_id,
        name="Precision CNC Lathe v2",
        power_kw=4.2,
        duration_intervals=10,
        earliest_start=32,
        latest_start=48,
        deadline_interval=60,
        flexible=True
    )
    machines.append(new_m)

    payload = SiteConfigPayload(
        site=SiteUpdate(p_max_grid_kw=23.0),
        machines=machines,
        tariff=config["tariff"],
        expected_version=current_version
    )

    saved = update_site_config_endpoint(site_id, payload, principal)
    assert saved["site"]["p_max_grid_kw"] == 23.0
    assert saved["version"] == current_version + 1
    assert len(saved["machines"]) == 7 # 6 remaining + 1 new = 7
    assert any(m.id == new_m_id for m in saved["machines"])

    # 3. Reload config to confirm persistence & machine deletion
    reloaded = get_site_config_endpoint(site_id, principal)
    assert reloaded["site"]["p_max_grid_kw"] == 23.0
    assert reloaded["version"] == current_version + 1
    assert any(m.id == new_m_id for m in reloaded["machines"])

    # 4. Conflict detection: Submitting with stale expected_version must raise 409
    stale_payload = SiteConfigPayload(
        site=SiteUpdate(p_max_grid_kw=22.0),
        machines=machines,
        tariff=config["tariff"],
        expected_version=current_version # Stale! current is now current_version + 1
    )
    with pytest.raises(HTTPException) as exc_info:
        update_site_config_endpoint(site_id, stale_payload, principal)
    assert exc_info.value.status_code == 409
    assert "Conflict" in str(exc_info.value.detail)

    # 5. Validation rejection: Invalid power or bounds must raise 422 with structured field errors
    invalid_m = Machine.model_construct(
        id=str(uuid.uuid4()),
        name="Broken Machine",
        power_kw=-5.0, # Negative power
        duration_intervals=10,
        earliest_start=40,
        latest_start=30, # Earliest > Latest!
        deadline_interval=50,
        flexible=True
    )
    invalid_payload = SiteConfigPayload.model_construct(
        site=SiteUpdate(p_max_grid_kw=25.0),
        machines=machines + [invalid_m],
        tariff=config["tariff"],
        expected_version=reloaded["version"]
    )
    with pytest.raises(HTTPException) as exc_info_val:
        update_site_config_endpoint(site_id, invalid_payload, principal)
    assert exc_info_val.value.status_code == 422
    assert "errors" in exc_info_val.value.detail

    # Cleanup / Restore baseline state
    restore_payload = SiteConfigPayload(
        site=SiteUpdate(p_max_grid_kw=25.0),
        machines=config["machines"],
        tariff=config["tariff"],
        expected_version=reloaded["version"]
    )
    update_site_config_endpoint(site_id, restore_payload, principal)

def test_atomic_failure_leaves_all_entities_unchanged(monkeypatch):
    test_repo = DataRepository(storage_mode="memory")
    monkeypatch.setattr(sites, "repo", test_repo)
    subject = str(uuid.uuid4())
    site_id = test_repo.clone_demo_site_for_visitor(subject)
    principal = AnonymousPrincipal(subject, site_id, 4_000_000_000)
    # 1. Capture exact baseline state
    baseline = get_site_config_endpoint(site_id, principal)
    baseline_pmax = baseline["site"]["p_max_grid_kw"]
    baseline_machine_names = [m.name for m in baseline["machines"]]
    baseline_version = baseline["version"]

    # 2. Attempt save with invalid version -> 409 Conflict
    failing_payload_conflict = SiteConfigPayload(
        site=SiteUpdate(p_max_grid_kw=99.0), # Altered grid limit
        machines=[baseline["machines"][0]], # Pruned to only 1 machine
        tariff=baseline["tariff"],
        expected_version=baseline_version + 999 # Wrong version!
    )
    with pytest.raises(HTTPException) as exc_info:
        update_site_config_endpoint(site_id, failing_payload_conflict, principal)
    assert exc_info.value.status_code == 409

    # Assert no partial write occurred
    after_conflict = get_site_config_endpoint(site_id, principal)
    assert after_conflict["site"]["p_max_grid_kw"] == baseline_pmax
    assert [m.name for m in after_conflict["machines"]] == baseline_machine_names
    assert after_conflict["version"] == baseline_version

    # 3. Attempt save with invalid validation -> 422 Unprocessable Entity
    invalid_m = Machine.model_construct(
        id=str(uuid.uuid4()),
        name="Invalid Machine",
        power_kw=-10.0,
        duration_intervals=10,
        earliest_start=32,
        latest_start=40,
        deadline_interval=60,
        flexible=True
    )
    failing_payload_validation = SiteConfigPayload.model_construct(
        site=SiteUpdate(p_max_grid_kw=12.0), # Altered
        machines=[invalid_m],
        tariff=baseline["tariff"],
        expected_version=baseline_version
    )
    with pytest.raises(HTTPException) as exc_val:
        update_site_config_endpoint(site_id, failing_payload_validation, principal)
    assert exc_val.value.status_code == 422

    # Assert no partial write occurred: site limit, machines, and tariff are completely unchanged
    after_val = get_site_config_endpoint(site_id, principal)
    assert after_val["site"]["p_max_grid_kw"] == baseline_pmax
    assert [m.name for m in after_val["machines"]] == baseline_machine_names
    assert after_val["version"] == baseline_version

