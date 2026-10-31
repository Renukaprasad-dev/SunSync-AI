import pytest
import httpx
from app.core.config import settings
from app.core.db import DataRepository
from app.models.domain import Machine

def test_db_in_memory_fallback():
    # Guarantee empty supabase settings
    orig_url = settings.SUPABASE_URL
    orig_key = settings.SUPABASE_SERVICE_ROLE_KEY
    settings.SUPABASE_URL = ""
    settings.SUPABASE_SERVICE_ROLE_KEY = ""

    repo = DataRepository()
    assert not repo.is_supabase_enabled

    # List sites
    sites = repo.list_sites()
    assert len(sites) >= 1
    demo_id = sites[0]["id"]

    # Machines
    machines = repo.get_machines(demo_id)
    assert len(machines) == 7

    # Tariff
    tariff = repo.get_tariff(demo_id)
    assert len(tariff.rates) == 96

    # Solar
    solar = repo.get_solar_profile(demo_id, "sunny")
    assert len(solar.generation) == 96

    # Restore settings
    settings.SUPABASE_URL = orig_url
    settings.SUPABASE_SERVICE_ROLE_KEY = orig_key

def test_db_supabase_mock_mode(monkeypatch):
    settings.SUPABASE_URL = "https://mockproject.supabase.co"
    settings.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key"

    repo = DataRepository()
    assert repo.is_supabase_enabled

    # Mock httpx.get to return a custom site
    mock_sites = [{"id": "sb_site_1", "name": "Supabase Remote Factory", "location": "Bengaluru"}]
    mock_machines = [{
        "id": "sb_m_1",
        "site_id": "sb_site_1",
        "name": "Supabase CNC Lathe",
        "power_kw": 5.5,
        "duration_intervals": 12,
        "earliest_start": 32,
        "latest_start": 40,
        "deadline_interval": 60,
        "flexible": True
    }]

    def mock_get(url, **kwargs):
        if "/sites" in url:
            return httpx.Response(200, json=mock_sites)
        elif "/machines" in url:
            return httpx.Response(200, json=mock_machines)
        return httpx.Response(404, json=[])

    def mock_post(url, **kwargs):
        return httpx.Response(200, json=[{"status": "ok"}])

    monkeypatch.setattr(httpx, "get", mock_get)
    monkeypatch.setattr(httpx, "post", mock_post)

    sites = repo.list_sites()
    assert len(sites) == 1
    assert sites[0]["name"] == "Supabase Remote Factory"

    machines = repo.get_machines("sb_site_1")
    assert len(machines) == 1
    assert machines[0].name == "Supabase CNC Lathe"
    assert machines[0].power_kw == 5.5

    # Test save
    saved = repo.save_machines("sb_site_1", machines)
    assert len(saved) == 1

    # Cleanup
    settings.SUPABASE_URL = ""
    settings.SUPABASE_SERVICE_ROLE_KEY = ""
