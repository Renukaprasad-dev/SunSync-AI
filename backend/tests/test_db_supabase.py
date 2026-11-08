
import pytest
import httpx
from pathlib import Path

from app.core.config import settings
from app.core.db import DataRepository, DatabaseMigrationRequired, DatabaseUnavailable, SiteCreationLimitReached
from app.models.domain import Machine


DEMO_SITE_ID = "00000000-0000-0000-0000-000000000001"


def test_db_in_memory_fallback(monkeypatch):
    """Verify the repository provides demo data when Supabase is disabled."""
    monkeypatch.setattr(settings, "SUPABASE_URL", "")
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "")

    repository = DataRepository()

    assert not repository.is_supabase_enabled
    assert repository.storage_mode == "local_file"

    sites = repository.list_sites()
    assert len(sites) >= 1

    demo_id = DEMO_SITE_ID
    machines = repository.get_machines(demo_id)
    assert len(machines) == 7

    tariff = repository.get_tariff(demo_id)
    assert len(tariff.rates) == 96

    solar = repository.get_solar_profile(demo_id, "sunny")
    assert len(solar.generation) == 96


def test_db_supabase_mock_mode(monkeypatch):
    """Verify mocked Supabase reads and successful machine saves."""
    monkeypatch.setattr(
        settings, "SUPABASE_URL", "https://mockproject.supabase.co"
    )
    monkeypatch.setattr(
        settings, "SUPABASE_SERVICE_ROLE_KEY", "mock-service-key"
    )

    repository = DataRepository()
    assert repository.is_supabase_enabled
    assert repository.storage_mode == "supabase"

    mock_sites = [
        {
            "id": "00000000-0000-0000-0000-000000000010",
            "name": "Supabase Remote Factory",
            "location": "Bengaluru",
        }
    ]

    mock_machines = [
        {
            "id": "10000000-0000-0000-0000-000000000010",
            "site_id": mock_sites[0]["id"],
            "name": "Supabase CNC Lathe",
            "power_kw": 5.5,
            "duration_intervals": 12,
            "earliest_start": 32,
            "latest_start": 40,
            "deadline_interval": 60,
            "flexible": True,
        }
    ]

    def mock_get(url, **kwargs):
        if "/sites" in url:
            return httpx.Response(200, json=mock_sites)
        if "/machines" in url:
            return httpx.Response(200, json=mock_machines)
        return httpx.Response(200, json=[])

    def mock_post(url, **kwargs):
        return httpx.Response(201, json=[{"status": "ok"}])

    def mock_delete(url, **kwargs):
        return httpx.Response(204)

    monkeypatch.setattr(httpx, "get", mock_get)
    monkeypatch.setattr(httpx, "post", mock_post)
    monkeypatch.setattr(httpx, "delete", mock_delete)

    sites = repository.list_sites()
    assert len(sites) == 1
    assert sites[0]["name"] == "Supabase Remote Factory"

    machines = repository.get_machines(mock_sites[0]["id"])
    assert len(machines) == 1
    assert machines[0].name == "Supabase CNC Lathe"
    assert machines[0].power_kw == 5.5

    saved = repository.save_machines(mock_sites[0]["id"], machines)
    assert len(saved) == 1
    assert saved[0].name == "Supabase CNC Lathe"


def test_supabase_machine_write_failure_is_not_silently_accepted(
    monkeypatch, tmp_path
):
    """A failed remote write must not be mistaken for a successful save."""
    monkeypatch.setattr(
        settings, "SUPABASE_URL", "https://mockproject.supabase.co"
    )
    monkeypatch.setattr(
        settings, "SUPABASE_SERVICE_ROLE_KEY", "mock-service-key"
    )

    repository = DataRepository()

    # Keep this regression test's local file effects isolated.
    import app.core.db as db_module

    monkeypatch.setattr(db_module, "LOCAL_DATA_DIR", tmp_path)
    monkeypatch.setattr(
        db_module, "LOCAL_STORE_PATH", tmp_path / "local_store.json"
    )

    # The remote lookup succeeds and reports no existing machines.
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, **kwargs: httpx.Response(200, json=[]),
    )

    # The actual remote upsert fails.
    monkeypatch.setattr(
        httpx,
        "post",
        lambda url, **kwargs: httpx.Response(
            500, json={"message": "simulated database failure"}
        ),
    )

    machine = Machine(
        id="10000000-0000-0000-0000-000000000099",
        name="Failure Test Machine",
        power_kw=2.0,
        duration_intervals=4,
        earliest_start=32,
        latest_start=40,
        deadline_interval=48,
        flexible=True,
    )

    with pytest.raises(Exception):
        repository.save_machines(DEMO_SITE_ID, [machine])

def test_supabase_tariff_write_failure_is_not_silently_accepted(
    monkeypatch, tmp_path
):
    """A failed Supabase tariff write must raise an error."""
    monkeypatch.setattr(
        settings, "SUPABASE_URL", "https://mockproject.supabase.co"
    )
    monkeypatch.setattr(
        settings, "SUPABASE_SERVICE_ROLE_KEY", "mock-service-key"
    )

    import app.core.db as db_module

    monkeypatch.setattr(db_module, "LOCAL_DATA_DIR", tmp_path)
    monkeypatch.setattr(
        db_module, "LOCAL_STORE_PATH", tmp_path / "local_store.json"
    )

    repository = DataRepository()

    # No existing tariff: the repository should attempt an INSERT.
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, **kwargs: httpx.Response(200, json=[]),
    )
    monkeypatch.setattr(
        httpx,
        "post",
        lambda url, **kwargs: httpx.Response(
            500, json={"message": "simulated tariff write failure"}
        ),
    )

    tariff = repository.get_tariff(DEMO_SITE_ID)

    with pytest.raises(RuntimeError, match="Supabase save_tariff failed"):
        repository.save_tariff(DEMO_SITE_ID, tariff)

def test_supabase_site_write_failure_is_not_silently_accepted(
    monkeypatch, tmp_path
):
    """A failed Supabase site update must raise an error."""
    monkeypatch.setattr(
        settings, "SUPABASE_URL", "https://mockproject.supabase.co"
    )
    monkeypatch.setattr(
        settings, "SUPABASE_SERVICE_ROLE_KEY", "mock-service-key"
    )

    import app.core.db as db_module

    monkeypatch.setattr(db_module, "LOCAL_DATA_DIR", tmp_path)
    monkeypatch.setattr(
        db_module, "LOCAL_STORE_PATH", tmp_path / "local_store.json"
    )

    repository = DataRepository()

    # Return the existing site so update_site() has a valid record.
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, **kwargs: httpx.Response(
            200,
            json=[{
                "id": DEMO_SITE_ID,
                "name": "Test Factory",
                "location": "Bengaluru",
                "p_max_grid_kw": 25.0,
            }],
        ),
    )

    # Simulate a failed Supabase update.
    monkeypatch.setattr(
        httpx,
        "patch",
        lambda url, **kwargs: httpx.Response(
            500, json={"message": "simulated site write failure"}
        ),
    )

    with pytest.raises(RuntimeError, match="Supabase update_site failed"):
        repository.update_site(DEMO_SITE_ID, {"p_max_grid_kw": 20.0})


def test_supabase_owned_site_limit_is_decided_by_atomic_rpc(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://mockproject.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "mock-service-key")
    repository = DataRepository()
    calls = []

    def mock_post(url, **kwargs):
        calls.append((url, kwargs["json"]))
        return httpx.Response(200, json={"limit_reached": True})

    monkeypatch.setattr(httpx, "post", mock_post)
    owner = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"

    stale = "2000-01-01T00:00:00+00:00"
    with pytest.raises(SiteCreationLimitReached):
        repository.create_owned_site(
            {"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "created_at": stale, "updated_at": stale},
            owner,
            max_sites=3,
        )

    assert len(calls) == 1
    url, payload = calls[0]
    assert url == "https://mockproject.supabase.co/rest/v1/rpc/create_owned_site_with_limit"
    assert payload["p_site_data"]["id"] == "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    assert payload["p_site_data"]["owner_session_id"] == owner
    assert payload["p_owner_session_id"] == owner
    assert payload["p_max_sites"] == 3
    assert payload["p_site_data"]["created_at"] != stale
    assert payload["p_site_data"]["updated_at"] != stale


def test_supabase_site_creation_sql_replaces_both_timestamps_with_now():
    migration = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "004_site_limits_and_session_cleanup.sql"
    sql = migration.read_text(encoding="utf-8")
    rpc_body = sql.split("CREATE OR REPLACE FUNCTION public.create_owned_site_with_limit", 1)[1].split("$$;", 1)[0]

    assert "'created_at', to_jsonb(NOW())" in rpc_body
    assert "'updated_at', to_jsonb(NOW())" in rpc_body
    assert "p_site_data->'created_at'" not in rpc_body
    assert "p_site_data->'updated_at'" not in rpc_body


def test_supabase_rpc_404_raises_migration_required(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://mockproject.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "mock-service-key")
    repository = DataRepository()

    monkeypatch.setattr(httpx, "post", lambda url, **kwargs: httpx.Response(404, json={"message": "function not found"}))

    with pytest.raises(DatabaseMigrationRequired) as exc_info:
        repository.create_owned_site(
            {"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
            "owner-1234-5678-9012-345678901234",
            max_sites=3,
        )
    assert exc_info.value.rpc_name == "create_owned_site_with_limit"
    assert "004_site_limits_and_session_cleanup.sql" in exc_info.value.migration_hint


def test_supabase_rpc_network_error_raises_database_unavailable(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://mockproject.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "mock-service-key")
    repository = DataRepository()

    def mock_post_fail(*args, **kwargs):
        raise httpx.ConnectError("Connection refused")

    monkeypatch.setattr(httpx, "post", mock_post_fail)

    with pytest.raises(DatabaseUnavailable) as exc_info:
        repository.create_owned_site(
            {"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
            "owner-1234-5678-9012-345678901234",
            max_sites=3,
        )
    assert "ConnectError" in str(exc_info.value)
