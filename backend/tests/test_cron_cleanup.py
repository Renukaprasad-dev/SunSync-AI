"""
test_cron_cleanup.py
Tests for the /internal/cleanup Vercel Cron endpoint.
Verifies:
  - Unauthorized without CRON_SECRET returns 503.
  - Valid Bearer token triggers cleanup and returns purged count.
  - Invalid/missing Authorization returns 401.
  - Demo site is never deleted after cleanup.
"""
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
DEMO_SITE_ID = "00000000-0000-0000-0000-000000000001"


def test_cleanup_disabled_when_no_cron_secret(monkeypatch):
    """Returns 503 Service Unavailable when CRON_SECRET is not set."""
    monkeypatch.delenv("CRON_SECRET", raising=False)
    with patch.dict("os.environ", {}, clear=False):
        import os
        os.environ.pop("CRON_SECRET", None)
        resp = client.get("/internal/cleanup", headers={"Authorization": "Bearer anything"})
    assert resp.status_code == 503
    assert "CRON_SECRET is not configured" in resp.json()["detail"]


def test_cleanup_rejects_missing_authorization(monkeypatch):
    """Returns 401 when Authorization header is absent."""
    monkeypatch.setenv("CRON_SECRET", "test-secret-value-1234567890")
    resp = client.get("/internal/cleanup")
    assert resp.status_code == 401
    assert "Unauthorized" in resp.json()["detail"]


def test_cleanup_rejects_wrong_secret(monkeypatch):
    """Returns 401 when Authorization header contains an incorrect secret."""
    monkeypatch.setenv("CRON_SECRET", "correct-secret-abcdefghijkl")
    resp = client.get("/internal/cleanup", headers={"Authorization": "Bearer wrong-secret"})
    assert resp.status_code == 401
    assert "Unauthorized" in resp.json()["detail"]


def test_cleanup_succeeds_with_correct_secret(monkeypatch):
    """Returns 200 with purged count when the correct Bearer token is provided."""
    secret = "correct-secret-abcdefghijkl"
    monkeypatch.setenv("CRON_SECRET", secret)
    resp = client.get("/internal/cleanup", headers={"Authorization": f"Bearer {secret}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert isinstance(body["purged"], int)


def test_cleanup_never_deletes_demo_site(monkeypatch):
    """After cleanup, the shared demo site still exists in the repository."""
    from app.core.db import repo

    secret = "correct-secret-for-cleanup-test"
    monkeypatch.setenv("CRON_SECRET", secret)

    # Seed an expired visitor sandbox (created far in the past)
    import time
    import uuid
    fake_visitor_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
    old_site_id = str(uuid.uuid4())
    repo._sites[old_site_id] = {
        "id": old_site_id,
        "name": "Stale Visitor Sandbox",
        "owner_session_id": fake_visitor_id,
        "created_at": 1000.0,  # epoch seconds far in the past
        "version": 1,
    }

    resp = client.get("/internal/cleanup", headers={"Authorization": f"Bearer {secret}"})
    assert resp.status_code == 200
    assert resp.json()["purged"] >= 1

    # Critical: demo site was NOT deleted
    demo = repo.get_site(DEMO_SITE_ID)
    assert demo is not None
    assert demo["id"] == DEMO_SITE_ID
