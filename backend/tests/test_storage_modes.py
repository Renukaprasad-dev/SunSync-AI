import os
import pytest
from unittest.mock import patch
from app.core.config import settings
from app.core.db import DataRepository, LOCAL_STORE_PATH
from app.main import health_check

def test_supabase_mode():
    repo = DataRepository(storage_mode="supabase")
    assert repo.storage_mode == "supabase"
    assert repo.is_durable is True

def test_local_file_mode_durability_and_atomic_replace(tmp_path, monkeypatch):
    test_store = tmp_path / "test_store.json"
    monkeypatch.setattr("app.core.db.LOCAL_STORE_PATH", test_store)
    monkeypatch.setattr("app.core.db.LOCAL_DATA_DIR", tmp_path)

    repo = DataRepository(storage_mode="local_file")
    assert repo.storage_mode == "local_file"
    assert repo.is_durable is True

    # Mutate site
    repo.update_site("00000000-0000-0000-0000-000000000001", {"p_max_grid_kw": 22.5})
    assert test_store.exists()

    # Verify a new repo instance reloads this persisted data
    reloaded_repo = DataRepository(storage_mode="local_file")
    site = reloaded_repo.get_site("00000000-0000-0000-0000-000000000001")
    assert site["p_max_grid_kw"] == 22.5

def test_memory_mode_on_vercel(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    # Ensure supabase credentials are not set
    monkeypatch.setattr(settings, "SUPABASE_URL", "")
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "")

    repo = DataRepository()
    assert repo.storage_mode == "memory"
    assert repo.is_durable is False

    # Modifying data in memory mode updates in-memory cache but never writes to file
    repo.update_site("00000000-0000-0000-0000-000000000001", {"p_max_grid_kw": 18.0})
    assert repo.get_site("00000000-0000-0000-0000-000000000001")["p_max_grid_kw"] == 18.0

def test_simulated_read_only_filesystem(monkeypatch):
    repo = DataRepository(storage_mode="local_file")

    def mock_replace(self, target):
        raise OSError(30, "Read-only file system")

    monkeypatch.setattr("pathlib.Path.replace", mock_replace)

    # Calling _save_local_store must not raise uncaught exception
    try:
        repo._save_local_store()
    except Exception as e:
        pytest.fail(f"_save_local_store crashed on read-only filesystem: {e}")

def test_health_endpoint_no_secrets():
    res = health_check()
    assert "storage_mode" in res
    assert "durable" in res
    assert isinstance(res["durable"], bool)
    # Ensure no secrets leak
    assert "SUPABASE_SERVICE_ROLE_KEY" not in res
    assert "service_role" not in str(res).lower()
