from datetime import datetime, timedelta, timezone
import uuid

import jwt
import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient

from app.core import auth
from app.core.config import Settings, settings
from app.core.db import DataRepository
from app.core.security import RateLimiter
from app.main import app
from app.routers import billing, optimize, session, sites

TEST_SECRET = "test-only-signing-secret-with-at-least-32-bytes"
DEMO_SITE_ID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture
def secured_client(monkeypatch):
    test_repo = DataRepository(storage_mode="memory")
    monkeypatch.setattr(settings, "SESSION_SIGNING_SECRET", TEST_SECRET)
    monkeypatch.setattr(settings, "SESSION_TOKEN_TTL_SECONDS", 3600)
    monkeypatch.setattr(session, "issuance_limiter", RateLimiter(max_requests=100, window_seconds=60.0))
    for module in (session, sites, optimize, billing):
        monkeypatch.setattr(module, "repo", test_repo)
    return TestClient(app), test_repo


def new_session(client, body=None):
    response = client.post("/auth/session", json=body) if body is not None else client.post("/auth/session")
    assert response.status_code == 200, response.text
    data = response.json()
    return data, {"Authorization": f"Bearer {data['access_token']}"}


def site_config(client, site_id, headers):
    response = client.get(f"/sites/{site_id}/config", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_session_is_server_issued_and_does_not_accept_a_caller_subject(secured_client):
    client, _ = secured_client
    requested_subject = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    session_data, _ = new_session(client, {"sub": requested_subject, "site_id": DEMO_SITE_ID})
    claims = jwt.decode(
        session_data["access_token"],
        TEST_SECRET,
        algorithms=["HS256"],
        audience=auth.AUDIENCE,
        issuer=auth.ISSUER,
    )
    assert claims["sub"] != requested_subject
    assert claims["site_id"] == session_data["site_id"]
    assert session_data["token_type"] == "bearer"
    assert session_data["expires_at"] > int(datetime.now(timezone.utc).timestamp())
    assert "subject" not in session_data


@pytest.mark.parametrize("token", ["not-a-jwt", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJhdHRhY2tlciJ9."])
def test_malformed_and_tampered_tokens_fail_closed(secured_client, token):
    client, _ = secured_client
    response = client.get(f"/sites/{DEMO_SITE_ID}/config", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_expired_token_fails_closed(secured_client):
    client, _ = secured_client
    now = datetime.now(timezone.utc)
    expired = jwt.encode({
        "iss": auth.ISSUER,
        "aud": auth.AUDIENCE,
        "sub": str(uuid.uuid4()),
        "site_id": DEMO_SITE_ID,
        "iat": int((now - timedelta(hours=2)).timestamp()),
        "exp": int((now - timedelta(hours=1)).timestamp()),
        "jti": str(uuid.uuid4()),
    }, TEST_SECRET, algorithm="HS256")
    response = client.get(f"/sites/{DEMO_SITE_ID}/config", headers={"Authorization": f"Bearer {expired}"})
    assert response.status_code == 401


def test_unsigned_legacy_visitor_headers_do_not_authorize_private_reads_or_writes(secured_client):
    client, _ = secured_client
    _, owner_headers = new_session(client)
    private_id = site_config(client, owner_headers and client.get("/auth/session", headers=owner_headers).json()["site_id"], owner_headers)["site"]["id"]
    forged_headers = {"X-Visitor-Session-Id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "X-Visitor-Id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}
    assert client.get(f"/sites/{private_id}/config", headers=forged_headers).status_code == 404
    assert client.put(f"/sites/{private_id}", json={"name": "forged"}, headers=forged_headers).status_code == 401


def test_public_demo_reads_remain_available_but_demo_writes_are_rejected(secured_client):
    client, repo = secured_client
    before = repo.get_site_config(DEMO_SITE_ID)
    assert client.get(f"/sites/{DEMO_SITE_ID}/config").status_code == 200
    _, headers = new_session(client)
    response = client.put(f"/sites/{DEMO_SITE_ID}", json={"name": "mutated"}, headers=headers)
    assert response.status_code == 403
    assert repo.get_site_config(DEMO_SITE_ID)["site"]["name"] == before["site"]["name"]


def test_private_site_reads_and_updates_are_owner_scoped_without_partial_writes(secured_client):
    client, repo = secured_client
    session_a, headers_a = new_session(client)
    session_b, headers_b = new_session(client)
    site_b_id = session_b["site_id"]
    before = site_config(client, site_b_id, headers_b)

    assert client.get(f"/sites/{site_b_id}/config", headers=headers_a).status_code == 404
    update = {
        "site": {"p_max_grid_kw": 17.0},
        "machines": before["machines"],
        "tariff": before["tariff"],
        "expected_version": before["version"],
    }
    assert client.put(f"/sites/{site_b_id}/config", json=update, headers=headers_a).status_code == 404
    assert repo.get_site(site_b_id)["p_max_grid_kw"] == before["site"]["p_max_grid_kw"]

    own_before = site_config(client, session_a["site_id"], headers_a)
    own_update = {
        "site": {"p_max_grid_kw": 17.0},
        "machines": own_before["machines"],
        "tariff": own_before["tariff"],
        "expected_version": own_before["version"],
    }
    assert client.put(f"/sites/{session_a['site_id']}/config", json=own_update, headers=headers_a).status_code == 200


def test_machine_replacement_and_all_private_site_reads_require_ownership(secured_client):
    client, repo = secured_client
    session_a, headers_a = new_session(client)
    session_b, headers_b = new_session(client)
    site_b_id = session_b["site_id"]
    before = site_config(client, site_b_id, headers_b)
    for suffix in ("", "/config", "/machines", "/tariff", "/solar", "/base-load"):
        assert client.get(f"/sites/{site_b_id}{suffix}", headers=headers_a).status_code == 404
    assert client.put(f"/sites/{site_b_id}/machines", json=[], headers=headers_a).status_code == 404
    assert [m.id for m in repo.get_machines(site_b_id)] == [m["id"] for m in before["machines"]]
    assert client.put(f"/sites/{site_b_id}/machines", json=[], headers=headers_b).status_code == 200
    assert repo.get_machines(session_a["site_id"])


def test_site_listing_hides_other_owners_and_rejects_caller_assigned_ownership(secured_client):
    client, _ = secured_client
    session_a, headers_a = new_session(client)
    session_b, _ = new_session(client)
    listed = client.get("/sites", headers=headers_a).json()
    ids = {site["id"] for site in listed}
    assert DEMO_SITE_ID in ids
    assert session_a["site_id"] in ids
    assert session_b["site_id"] not in ids
    assert all("owner_session_id" not in site for site in listed)
    assert client.post("/sites", json={"name": "forged", "owner_session_id": "victim"}, headers=headers_a).status_code == 422
    assert client.post("/sites", json={"name": "private"}).status_code == 401


def test_site_creation_limit_is_configurable_and_scoped_to_each_session(secured_client, monkeypatch):
    client, repo = secured_client
    monkeypatch.setattr(settings, "SITE_CREATION_LIMIT_PER_SESSION", 2)
    session_a, headers_a = new_session(client)
    session_b, headers_b = new_session(client)

    created_a = client.post("/sites", json={"name": "A second site"}, headers=headers_a)
    assert created_a.status_code == 200, created_a.text
    assert "owner_session_id" not in created_a.json()

    limited_a = client.post("/sites", json={"name": "A third site"}, headers=headers_a)
    assert limited_a.status_code == 429
    assert limited_a.json()["detail"] == "This session has reached its site limit. Existing sites remain available."

    # Hitting the creation limit leaves existing owned sites readable and usable.
    assert client.get(f"/sites/{session_a['site_id']}/config", headers=headers_a).status_code == 200
    assert repo.get_site(session_a["site_id"])["owner_session_id"] == repo.get_site(created_a.json()["id"])["owner_session_id"]
    updated_existing = client.put(
        f"/sites/{session_a['site_id']}",
        json={"name": "Existing site remains editable"},
        headers=headers_a,
    )
    assert updated_existing.status_code == 200, updated_existing.text

    # A different session has its own independent quota.
    created_b = client.post("/sites", json={"name": "B second site"}, headers=headers_b)
    assert created_b.status_code == 200, created_b.text


def test_limit_one_is_consumed_by_initial_workspace_and_keeps_it_accessible(secured_client, monkeypatch):
    client, _ = secured_client
    monkeypatch.setattr(settings, "SITE_CREATION_LIMIT_PER_SESSION", 1)
    session_data, headers = new_session(client)

    assert client.post("/sites", json={"name": "Over quota"}, headers=headers).status_code == 429
    assert client.get(f"/sites/{session_data['site_id']}/config", headers=headers).status_code == 200
    updated = client.put(
        f"/sites/{session_data['site_id']}",
        json={"name": "Still editable", "updated_at": "2000-01-01T00:00:00+00:00"},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["updated_at"] != "2000-01-01T00:00:00+00:00"


@pytest.mark.parametrize("limit", [1, 100])
def test_site_creation_limit_accepts_inclusive_bounds(limit):
    assert Settings(_env_file=None, SITE_CREATION_LIMIT_PER_SESSION=limit).SITE_CREATION_LIMIT_PER_SESSION == limit


@pytest.mark.parametrize("limit", [0, 101])
def test_site_creation_limit_rejects_values_outside_bounds(limit):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, SITE_CREATION_LIMIT_PER_SESSION=limit)


def test_create_site_ignores_stale_timestamps_and_cleanup_keeps_new_site(secured_client, monkeypatch):
    client, repository = secured_client
    monkeypatch.setattr(settings, "SESSION_TOKEN_TTL_SECONDS", 3600)
    _, headers = new_session(client)
    stale = "2000-01-01T00:00:00+00:00"

    response = client.post(
        "/sites",
        json={"name": "Fresh site", "created_at": stale, "updated_at": stale},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    site_id = response.json()["id"]
    stored = repository.get_site(site_id)
    assert stored["created_at"] != stale
    assert stored["updated_at"] != stale

    assert repository.cleanup_expired_sandboxes(max_age_seconds=60) == 0
    assert repository.get_site(site_id)["id"] == site_id


def test_session_renewal_refreshes_cleanup_activity_timestamp(secured_client):
    client, repository = secured_client
    session_data, headers = new_session(client)
    site = repository.get_site(session_data["site_id"])
    site["updated_at"] = "2000-01-01T00:00:00+00:00"

    renewed = client.post("/auth/session", headers=headers)
    assert renewed.status_code == 200, renewed.text
    assert repository.get_site(session_data["site_id"])["updated_at"] != "2000-01-01T00:00:00+00:00"


def test_private_run_history_is_owner_scoped(secured_client):
    client, _ = secured_client
    session_a, headers_a = new_session(client)
    _, headers_b = new_session(client)
    result = client.post("/optimize", json={"site_id": session_a["site_id"], "strategies": ["cost_optimized"]}, headers=headers_a)
    assert result.status_code == 200, result.text
    run_id = result.json()["run_id"]
    assert client.get(f"/runs/{run_id}", headers=headers_a).status_code == 200
    assert client.get(f"/runs/{run_id}", headers=headers_b).status_code == 404
    assert all(run["id"] != run_id for run in client.get("/runs", headers=headers_b).json())


def test_missing_signing_secret_disables_session_and_protected_requests(secured_client, monkeypatch):
    client, _ = secured_client
    monkeypatch.setattr(settings, "SESSION_SIGNING_SECRET", "")
    assert client.post("/auth/session").status_code == 503
    assert client.get(f"/sites/{DEMO_SITE_ID}/config", headers={"Authorization": "Bearer malformed"}).status_code == 503


def test_authorization_preflight_allows_configured_origin_and_denies_untrusted_origin(secured_client):
    client, _ = secured_client
    allowed = client.options("/sites", headers={
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
    })
    assert allowed.status_code == 200
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "authorization" in allowed.headers.get("access-control-allow-headers", "").lower()

    denied = client.options("/sites", headers={
        "Origin": "https://attacker.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
    })
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers


def test_weak_signing_secret_disables_session(secured_client, monkeypatch):
    client, _ = secured_client
    monkeypatch.setattr(settings, "SESSION_SIGNING_SECRET", "too-short-secret")
    response = client.post("/auth/session")
    assert response.status_code == 503
    assert "too short" in response.json()["detail"].lower()


def test_validate_signing_secret_direct():
    ok, msg = auth.validate_signing_secret("")
    assert not ok
    assert "not configured" in msg.lower()

    ok, msg = auth.validate_signing_secret("short")
    assert not ok
    assert "too short" in msg.lower()

    ok, msg = auth.validate_signing_secret("at-least-32-bytes-long-super-secret-key-1234")
    assert ok
    assert msg == "OK"


def test_public_health_does_not_require_session(secured_client, monkeypatch):
    client, _ = secured_client
    # Even if signing secret is unconfigured, public /health must respond 200
    monkeypatch.setattr(settings, "SESSION_SIGNING_SECRET", "")
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"


def test_missing_rpc_returns_migration_required_diagnostic(secured_client, monkeypatch):
    client, repo = secured_client
    from app.core.db import DatabaseMigrationRequired
    def mock_clone_rpc_missing(*args, **kwargs):
        raise DatabaseMigrationRequired(
            rpc_name="create_owned_site_with_limit",
            migration_hint="Apply migration 004_site_limits_and_session_cleanup.sql to Supabase."
        )
    monkeypatch.setattr(repo, "clone_demo_site_for_visitor", mock_clone_rpc_missing)
    response = client.post("/auth/session")
    assert response.status_code == 503
    assert "Database migration required" in response.json()["detail"]
    assert "create_owned_site_with_limit" in response.json()["detail"]


def test_database_connection_failure_returns_service_unavailable(secured_client, monkeypatch):
    client, repo = secured_client
    from app.core.db import DatabaseUnavailable
    def mock_clone_db_unavailable(*args, **kwargs):
        raise DatabaseUnavailable("Database connection error: ConnectTimeout")
    monkeypatch.setattr(repo, "clone_demo_site_for_visitor", mock_clone_db_unavailable)
    response = client.post("/auth/session")
    assert response.status_code == 503
    assert "Database service is currently unreachable" in response.json()["detail"]
