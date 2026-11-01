import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.db import repo

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

def test_visitor_scoping_for_runs():
    visitor_a = str(uuid.uuid4())
    visitor_b = str(uuid.uuid4())

    # Visitor A clones demo site to get a private sandbox site
    site_a_id = repo.clone_demo_site_for_visitor(visitor_a)

    # Visitor A runs optimization on their private site
    opt_payload = {
        "site_id": site_a_id,
        "scenario": "overcast",
        "strategies": ["baseline", "cost_optimized"]
    }
    res_a = client.post("/optimize", json=opt_payload, headers={"X-Visitor-Id": visitor_a})
    assert res_a.status_code == 200
    run_a_id = res_a.json().get("run_id")
    assert run_a_id is not None

    # Visitor A can retrieve their run
    res_get_a = client.get(f"/runs/{run_a_id}", headers={"X-Visitor-Id": visitor_a})
    assert res_get_a.status_code == 200

    # Visitor B CANNOT retrieve Visitor A's run (403 Forbidden)
    res_get_b = client.get(f"/runs/{run_a_id}", headers={"X-Visitor-Id": visitor_b})
    assert res_get_b.status_code == 403

    # Visitor B listing runs does NOT contain Visitor A's sandbox run
    res_list_b = client.get("/runs", headers={"X-Visitor-Id": visitor_b})
    assert res_list_b.status_code == 200
    b_run_ids = [r["id"] for r in res_list_b.json()]
    assert run_a_id not in b_run_ids
