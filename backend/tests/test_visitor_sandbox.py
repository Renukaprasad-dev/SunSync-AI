import uuid
import pytest
import httpx
from fastapi import HTTPException
from app.core.config import settings
from app.core.db import DataRepository
from app.models.domain import Machine, Tariff

DEMO_SITE_ID = "00000000-0000-0000-0000-000000000001"
VISITOR_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
VISITOR_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

def test_writes_to_shared_seeded_demo_site_are_rejected():
    """Direct writes to the shared demo site must be rejected with 403 Forbidden."""
    repo = DataRepository()
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
    """First write clones demo site into a visitor-scoped site with new UUID and visitor ownership."""
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://mockproject.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "mock-service-key")

    mock_db = {}
    def mock_post(url, headers=None, json=None, **kwargs):
        if "/sites" in url:
            mock_db["site"] = json
            return httpx.Response(201, json=json)
        return httpx.Response(200, json={})

    monkeypatch.setattr(httpx, "post", mock_post)

    repo = DataRepository(storage_mode="supabase")
    assert repo.is_supabase_enabled

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
    repo = DataRepository()

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
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://mockproject.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "mock-service-key")

    deleted_urls = []
    def mock_delete(url, **kwargs):
        deleted_urls.append(url)
        return httpx.Response(204)

    monkeypatch.setattr(httpx, "delete", mock_delete)
    monkeypatch.setattr(httpx, "post", lambda url, **kw: httpx.Response(201, json={}))

    repo = DataRepository(storage_mode="supabase")

    # Create an expired visitor site (age > 24 hours)
    old_site_id = repo.clone_demo_site_for_visitor(visitor_id="old-visitor")
    repo._sites[old_site_id]["created_at"] = 1000.0 # Way in the past

    # Run cleanup with 3600s TTL
    purged_count = repo.cleanup_expired_sandboxes(max_age_seconds=3600)
    assert purged_count >= 1

    # Verify old visitor site was deleted
    assert old_site_id not in repo._sites

    # CRITICAL: Confirm shared demo site was NOT deleted
    assert DEMO_SITE_ID in repo._sites
    assert repo.get_site(DEMO_SITE_ID) is not None
    assert not any(DEMO_SITE_ID in url for url in deleted_urls)
