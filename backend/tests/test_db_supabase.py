
import pytest
import httpx

from app.core.config import settings
from app.core.db import DataRepository
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
