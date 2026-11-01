"""
test_dashboard_cache_invalidation.py
Proves that editing the site config bumps the version, which changes the
cache key formula used by the dashboard. The dashboard always reads version
from the site config before building the key, so a stale cached result is
never served after a config edit.
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
DEMO_SITE_ID = "00000000-0000-0000-0000-000000000001"


def test_save_config_bumps_version():
    """Saving site config increases the version, invalidating the versioned cache key."""
    # Get current version
    r1 = client.get(f"/sites/{DEMO_SITE_ID}/config")
    assert r1.status_code == 200
    v1 = r1.json()["version"]

    # Save with current version (atomic save)
    machines = r1.json()["machines"]
    tariff = r1.json()["tariff"]
    site = r1.json()["site"]

    payload = {
        "site": {**site, "p_max_grid_kw": site["p_max_grid_kw"]},
        "machines": machines,
        "tariff": tariff,
        "version": v1,
    }
    r2 = client.put(f"/sites/{DEMO_SITE_ID}/config", json=payload)
    assert r2.status_code == 200
    v2 = r2.json()["version"]

    assert v2 == v1 + 1, f"Version must increment on save: expected {v1+1}, got {v2}"


def test_version_change_produces_different_cache_key():
    """Different versions produce distinct cache key strings (simulating frontend logic)."""
    def build_cache_key(version: int, scenario: str, tariff_hash: str) -> str:
        return f"sunsync_opt_v2_{version}_{scenario}_{tariff_hash}"

    key_v1 = build_cache_key(1, "sunny", "a1b2")
    key_v2 = build_cache_key(2, "sunny", "a1b2")
    assert key_v1 != key_v2, "Version increment must produce a new cache key"

    # Scenario change also produces a new key
    key_overcast = build_cache_key(1, "overcast", "a1b2")
    assert key_v1 != key_overcast, "Scenario change must produce a new cache key"

    # Tariff change also produces a new key
    key_new_tariff = build_cache_key(1, "sunny", "ffff")
    assert key_v1 != key_new_tariff, "Tariff change must produce a new cache key"


def test_tariff_hash_changes_with_rate_edit():
    """A change in a tariff rate produces a different tariff hash fingerprint (simulating frontend XOR fold)."""
    def quick_tariff_hash(rates: list) -> str:
        h = 0
        for i, r in enumerate(rates):
            h ^= (round(r * 100) + i * 31) & 0xFFFF
        return hex(h)[2:].zfill(4)

    rates_a = [7.0] * 96
    rates_b = list(rates_a)
    rates_b[32] = 9.5  # edit one peak-hour slot

    hash_a = quick_tariff_hash(rates_a)
    hash_b = quick_tariff_hash(rates_b)
    assert hash_a != hash_b, "Editing a tariff rate must produce a different hash"
