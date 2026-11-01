import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_bill_reality_check_success():
    payload = {
        "site_id": "00000000-0000-0000-0000-000000000001",
        "operating_days": 26,
        "real_energy_kwh": 2500.0,
        "real_energy_charge_rs": 18500.0,
        "real_demand_kw": 19.5,
        "real_demand_charge_rs": 390.0
    }
    resp = client.post("/billing/reality-check", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["operating_days"] == 26
    assert data["real_total_bill_rs"] == 18890.0
    assert data["model_baseline_total_bill_rs"] > 0
    assert "metrics" in data
    assert "energy_kwh" in data["metrics"]
    assert "peak_demand_kw" in data["metrics"]
    assert len(data["likely_causes"]) >= 2
    assert "sanity_status" in data
    assert "sanity check" in data["disclaimer"].lower()

def test_bill_reality_check_discrepancy_diagnosis():
    # Massive surge in real demand (45 kW vs 18.5 kW baseline)
    payload = {
        "site_id": "00000000-0000-0000-0000-000000000001",
        "operating_days": 26,
        "real_energy_kwh": 5000.0,
        "real_energy_charge_rs": 45000.0,
        "real_demand_kw": 45.0,
        "real_demand_charge_rs": 900.0
    }
    resp = client.post("/billing/reality-check", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    assert data["sanity_status"] == "HIGH_DISCREPANCY"
    # Check that inrush / auxiliary loads are suggested in likely causes
    causes_text = " ".join(data["likely_causes"]).lower()
    assert "inrush" in causes_text or "auxiliary" in causes_text
    assert "overtime" in causes_text or "leak" in causes_text

def test_bill_reality_check_validation_errors():
    # Negative energy
    resp1 = client.post("/billing/reality-check", json={
        "operating_days": 26,
        "real_energy_kwh": -100.0,
        "real_energy_charge_rs": 1000.0,
        "real_demand_kw": 20.0,
        "real_demand_charge_rs": 400.0
    })
    assert resp1.status_code == 422

    # Negative demand
    resp2 = client.post("/billing/reality-check", json={
        "operating_days": 26,
        "real_energy_kwh": 1000.0,
        "real_energy_charge_rs": 1000.0,
        "real_demand_kw": -5.0,
        "real_demand_charge_rs": 400.0
    })
    assert resp2.status_code == 422

    # Operating days > 31
    resp3 = client.post("/billing/reality-check", json={
        "operating_days": 40,
        "real_energy_kwh": 1000.0,
        "real_energy_charge_rs": 1000.0,
        "real_demand_kw": 20.0,
        "real_demand_charge_rs": 400.0
    })
    assert resp3.status_code == 422
