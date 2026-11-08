import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core import config
from app.core.db import DataRepository, repo
from app.core.security import RateLimiter
from app.routers import billing, optimize, session, sites

client = TestClient(app)

def test_runs_list_and_get():
    # 1. Trigger an optimization run on the demo site
    opt_payload = {
        "site_id": repo.DEMO_SITE_ID,
        "scenario": "sunny",
        "strategies": ["baseline", "cost_optimized"]
    }
    opt_res = client.post("/optimize", json=opt_payload)
    assert opt_res.status_code == 200, opt_res.text
    run_id = opt_res.json().get("run_id")
    assert run_id is not None

    # 2. List runs
    list_res = client.get("/runs")
    assert list_res.status_code == 200, list_res.text
    runs = list_res.json()
    assert len(runs) >= 1
    target = next((r for r in runs if r["id"] == run_id), None)
    assert target is not None
    assert target["scenario"] == "sunny"
    assert target["verifier_passed"] is True
    assert "baseline_cost" in target["summary"]
    assert "optimized_cost" in target["summary"]
    assert target["summary"]["optimized_cost"] <= target["summary"]["baseline_cost"]

    # 3. Get single run details
    detail_res = client.get(f"/runs/{run_id}")
    assert detail_res.status_code == 200, detail_res.text
    detail = detail_res.json()
    assert detail["id"] == run_id
    assert "inputs" in detail
    assert "results" in detail
    assert "strategies" in detail["results"]

def test_visitor_scoping_for_runs(monkeypatch):
    test_repo = DataRepository(storage_mode="memory")
    monkeypatch.setattr(config.settings, "SESSION_SIGNING_SECRET", "run-history-test-secret-at-least-32-bytes")
    monkeypatch.setattr(session, "issuance_limiter", RateLimiter(max_requests=100, window_seconds=60.0))
    for module in (session, optimize, sites, billing):
        monkeypatch.setattr(module, "repo", test_repo)

    session_a = client.post("/auth/session")
    session_b = client.post("/auth/session")
    assert session_a.status_code == session_b.status_code == 200
    headers_a = {"Authorization": f"Bearer {session_a.json()['access_token']}"}
    headers_b = {"Authorization": f"Bearer {session_b.json()['access_token']}"}
    site_a_id = session_a.json()["site_id"]

    # Visitor A runs optimization on their private site
    opt_payload = {
        "site_id": site_a_id,
        "scenario": "overcast",
        "strategies": ["baseline", "cost_optimized"]
    }
    res_a = client.post("/optimize", json=opt_payload, headers=headers_a)
    assert res_a.status_code == 200
    run_a_id = res_a.json().get("run_id")
    assert run_a_id is not None

    # Visitor A can retrieve their run
    res_get_a = client.get(f"/runs/{run_a_id}", headers=headers_a)
    assert res_get_a.status_code == 200

    # Visitor B CANNOT retrieve Visitor A's run (403 Forbidden)
    res_get_b = client.get(f"/runs/{run_a_id}", headers=headers_b)
    assert res_get_b.status_code == 404

    # Visitor B listing runs does NOT contain Visitor A's sandbox run
    res_list_b = client.get("/runs", headers=headers_b)
    assert res_list_b.status_code == 200
    b_run_ids = [r["id"] for r in res_list_b.json()]
    assert run_a_id not in b_run_ids


def test_summary_reconstruction_all_three_strategies():
    from app.core.db import _derive_summary_from_results
    results = {
        "strategies": {
            "baseline": {
                "kpis": {"daily_cost_rs": 600.0, "peak_grid_demand_kw": 20.0, "deadline_violations": 0}
            },
            "solar_aware": {
                "kpis": {"daily_cost_rs": 520.0, "peak_grid_demand_kw": 16.0, "deadline_violations": 0}
            },
            "cost_optimized": {
                "kpis": {"daily_cost_rs": 480.0, "peak_grid_demand_kw": 14.0, "deadline_violations": 0}
            }
        }
    }
    summary = _derive_summary_from_results(results)
    assert summary["baseline_cost"] == 600.0
    assert summary["optimized_cost"] == 480.0
    assert summary["savings_pct"] == 20.0
    assert summary["baseline_peak_kw"] == 20.0
    assert summary["optimized_peak_kw"] == 14.0
    assert summary["deadline_violations"] == 0


def test_summary_reconstruction_baseline_plus_cost_optimized_only():
    from app.core.db import _derive_summary_from_results
    results = {
        "strategies": {
            "baseline": {
                "kpis": {"daily_cost_rs": 500.0, "peak_grid_demand_kw": 18.0, "deadline_violations": 0}
            },
            "cost_optimized": {
                "kpis": {"daily_cost_rs": 400.0, "peak_grid_demand_kw": 15.0, "deadline_violations": 0}
            }
        }
    }
    summary = _derive_summary_from_results(results)
    assert summary["baseline_cost"] == 500.0
    assert summary["optimized_cost"] == 400.0
    assert summary["savings_pct"] == 20.0
    assert summary["baseline_peak_kw"] == 18.0
    assert summary["optimized_peak_kw"] == 15.0


def test_summary_reconstruction_cost_optimized_only():
    from app.core.db import _derive_summary_from_results
    results = {
        "strategies": {
            "cost_optimized": {
                "kpis": {"daily_cost_rs": 450.0, "peak_grid_demand_kw": 12.5, "deadline_violations": 0}
            }
        }
    }
    summary = _derive_summary_from_results(results)
    assert summary["optimized_cost"] == 450.0
    assert summary["optimized_peak_kw"] == 12.5
    assert "baseline_cost" not in summary
    assert "savings_pct" not in summary


def test_summary_reconstruction_invalid_or_incomplete_results():
    from app.core.db import _derive_summary_from_results
    assert _derive_summary_from_results(None) == {}
    assert _derive_summary_from_results({}) == {}
    assert _derive_summary_from_results({"strategies": None}) == {}
    assert _derive_summary_from_results({"strategies": {}}) == {}
    assert _derive_summary_from_results({"strategies": {"cost_optimized": {"kpis": {"daily_cost_rs": "not-a-number"}}}}) == {}
    assert _derive_summary_from_results({"strategies": {"cost_optimized": {"kpis": {"daily_cost_rs": float("nan")}}}}) == {}
    assert _derive_summary_from_results({"strategies": {"cost_optimized": {"kpis": {"daily_cost_rs": float("inf")}}}}) == {}


def test_summary_reconstruction_missing_summary_fields():
    from app.core.db import _resolve_run_summary
    existing_partial = {"baseline_cost": 500.0}
    results = {
        "strategies": {
            "baseline": {"kpis": {"daily_cost_rs": 500.0, "peak_grid_demand_kw": 18.0}},
            "cost_optimized": {"kpis": {"daily_cost_rs": 400.0, "peak_grid_demand_kw": 14.0}}
        }
    }
    resolved = _resolve_run_summary(existing_partial, results)
    assert resolved["baseline_cost"] == 500.0
    assert resolved["optimized_cost"] == 400.0
    assert resolved["optimized_peak_kw"] == 14.0
    assert resolved["savings_pct"] == 20.0


def test_existing_valid_summary_remains_unchanged():
    from app.core.db import _resolve_run_summary
    existing_valid = {
        "baseline_cost": 593.42,
        "optimized_cost": 481.18,
        "savings_pct": 18.91,
        "baseline_peak_kw": 18.5,
        "optimized_peak_kw": 14.0,
        "deadline_violations": 0
    }
    results = {
        "strategies": {
            "baseline": {"kpis": {"daily_cost_rs": 999.0}},
            "cost_optimized": {"kpis": {"daily_cost_rs": 111.0}}
        }
    }
    resolved = _resolve_run_summary(existing_valid, results)
    assert resolved["baseline_cost"] == 593.42
    assert resolved["optimized_cost"] == 481.18
    assert resolved["savings_pct"] == 18.91
    assert resolved["baseline_peak_kw"] == 18.5
    assert resolved["optimized_peak_kw"] == 14.0
    assert resolved["deadline_violations"] == 0
