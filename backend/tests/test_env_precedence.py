import os
import pytest
from app.core.config import Settings

def test_environment_variable_precedence_over_defaults(monkeypatch):
    """Proves that OS environment variables take precedence over class defaults."""
    # 1. Without env var override, class default applies
    default_settings = Settings(_env_file=None)
    assert default_settings.STORAGE_MODE == ""
    assert default_settings.DEFAULT_P_MAX_GRID_KW == 25.0

    # 2. When an OS environment variable is set, it overrides the default
    monkeypatch.setenv("STORAGE_MODE", "memory")
    monkeypatch.setenv("DEFAULT_P_MAX_GRID_KW", "30.0")
    custom_settings = Settings(_env_file=None)
    assert custom_settings.STORAGE_MODE == "memory"
    assert custom_settings.DEFAULT_P_MAX_GRID_KW == 30.0

def test_explicit_env_overrides_env_file(tmp_path, monkeypatch):
    """Proves that explicit OS process environment variables override .env file contents."""
    # Create a temporary .env file
    env_file = tmp_path / ".test_env"
    env_file.write_text("STORAGE_MODE=supabase\nDEFAULT_P_MAX_GRID_KW=40.0\n", encoding="utf-8")

    # When no OS env var is present, .env file value is read
    file_settings = Settings(_env_file=str(env_file))
    assert file_settings.STORAGE_MODE == "supabase"
    assert file_settings.DEFAULT_P_MAX_GRID_KW == 40.0

    # When OS env var IS present, it overrides the .env file value
    monkeypatch.setenv("STORAGE_MODE", "local_file")
    monkeypatch.setenv("DEFAULT_P_MAX_GRID_KW", "50.0")
    overridden_settings = Settings(_env_file=str(env_file))
    assert overridden_settings.STORAGE_MODE == "local_file"
    assert overridden_settings.DEFAULT_P_MAX_GRID_KW == 50.0
