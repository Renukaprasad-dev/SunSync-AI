import pytest
from app.core.config import settings

@pytest.fixture(autouse=True)
def isolate_test_environment(monkeypatch):
    """Ensure tests run against hermetic local/memory storage unless a test explicitly configures Supabase."""
    monkeypatch.setattr(settings, "STORAGE_MODE", "")
    monkeypatch.setattr(settings, "SUPABASE_URL", "")
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "")
