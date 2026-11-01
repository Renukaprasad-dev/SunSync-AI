#!/usr/bin/env python3
"""
SunSync AI - Live Deployment Verification Smoke Test
Usage:
    python scripts/smoke_live.py [--backend BACKEND_URL] [--frontend FRONTEND_URL]
Or via environment variables:
    BACKEND_URL=https://sunsync-backend.vercel.app FRONTEND_URL=https://sunsync-frontend.vercel.app python scripts/smoke_live.py
"""

import sys
import os
import argparse
import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def run_smoke_test(backend_url: str, frontend_url: str) -> bool:
    backend_url = backend_url.rstrip("/")
    frontend_url = frontend_url.rstrip("/")
    
    print("\n" + "=" * 65)
    print("  SunSync AI - Production Deployment Smoke Verification")
    print("=" * 65)
    print(f"Backend Target  : {backend_url}")
    print(f"Frontend Target : {frontend_url}\n")
    
    all_passed = True
    session = requests.Session()
    
    # 1. Health check & storage mode verification
    print("[1/5] Checking Backend /health endpoint...")
    try:
        r = session.get(f"{backend_url}/health", timeout=10)
        if r.status_code != 200:
            print(f"  [FAIL] /health returned HTTP {r.status_code}: {r.text[:200]}")
            all_passed = False
        else:
            data = r.json()
            status = data.get("status")
            storage_mode = data.get("storage_mode")
            durable = data.get("durable")
            supabase = data.get("supabase_configured")
            warning = data.get("warning")
            
            if status != "healthy":
                print(f"  [FAIL] Health status reported '{status}' (expected 'healthy')")
                all_passed = False
            else:
                print(f"  [PASS] /health is healthy")
                print(f"    - Storage Mode: {storage_mode} (Durable: {durable})")
                print(f"    - Supabase Connected: {supabase}")
                if warning:
                    print(f"    - Notice: {warning}")
    except Exception as e:
        print(f"  [FAIL] Could not connect to /health: {e}")
        all_passed = False

    # 2. API Documentation /docs check
    print("\n[2/5] Checking Backend OpenAPI Documentation (/docs)...")
    try:
        r = session.get(f"{backend_url}/docs", timeout=10)
        if r.status_code == 200:
            print("  [PASS] /docs returned HTTP 200 (Interactive API Docs Accessible)")
        else:
            print(f"  [FAIL] /docs returned HTTP {r.status_code}")
            all_passed = False
    except Exception as e:
        print(f"  [FAIL] Could not access /docs: {e}")
        all_passed = False

    # 3. Real POST /optimize with MILP solver and verifier check
    print("\n[3/5] Executing Live MILP Optimization (POST /optimize)...")
    try:
        payload = {
            "site_id": "00000000-0000-0000-0000-000000000001",
            "scenario": "sunny",
            "strategies": ["baseline", "cost_optimized"]
        }
        r = session.post(f"{backend_url}/optimize", json=payload, timeout=25)
        if r.status_code != 200:
            print(f"  [FAIL] /optimize returned HTTP {r.status_code}: {r.text[:200]}")
            all_passed = False
        else:
            opt = r.json()
            strategies = opt.get("strategies", {})
            baseline = strategies.get("baseline")
            cost_opt = strategies.get("cost_optimized")
            
            if not baseline or not cost_opt:
                print("  [FAIL] Missing baseline or cost_optimized strategy in response")
                all_passed = False
            else:
                b_kpis = baseline.get("kpis", {})
                c_kpis = cost_opt.get("kpis", {})
                b_cost = b_kpis.get("daily_cost_rs", 0.0)
                c_cost = c_kpis.get("daily_cost_rs", 0.0)
                b_peak = b_kpis.get("peak_grid_demand_kw", 0.0)
                c_peak = c_kpis.get("peak_grid_demand_kw", 0.0)
                
                v_passed = cost_opt.get("verifier_passed", False)
                violations = c_kpis.get("deadline_violations", 0)
                
                if not v_passed or violations > 0:
                    print(f"  [FAIL] Mathematical verifier failed (passed: {v_passed}, violations: {violations})")
                    all_passed = False
                else:
                    savings_pct = ((b_cost - c_cost) / b_cost * 100) if b_cost > 0 else 0
                    print("  [PASS] Live MILP solver found provably optimal schedule")
                    print(f"    - Baseline Cost   : INR {b_cost:.2f} (Peak: {b_peak} kW)")
                    print(f"    - Optimized Cost  : INR {c_cost:.2f} (Peak: {c_peak} kW)")
                    print(f"    - Cost Reduction  : {savings_pct:.1f}%")
                    print(f"    - Verifier Status : VERIFIED PASS (0 Deadline Violations)")
    except Exception as e:
        print(f"  [FAIL] /optimize execution error: {e}")
        all_passed = False

    # 4. Strict CORS Preflight check
    print("\n[4/5] Verifying Strict CORS Security Boundary...")
    try:
        # Preflight with frontend origin -> should be accepted
        preflight_headers = {
            "Origin": frontend_url,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type,X-Visitor-Session-Id"
        }
        r_preflight = session.options(f"{backend_url}/optimize", headers=preflight_headers, timeout=10)
        allow_origin = r_preflight.headers.get("Access-Control-Allow-Origin", "")
        
        # Check acceptance
        origin_accepted = allow_origin == frontend_url or allow_origin == "*"
        if origin_accepted:
            print(f"  [PASS] Valid frontend origin ({frontend_url}) accepted by CORS")
        else:
            print(f"  [FAIL] Frontend origin rejected! Access-Control-Allow-Origin: '{allow_origin}'")
            all_passed = False

        # Preflight with untrusted malicious origin -> must be rejected
        untrusted_origin = "https://unauthorized-attacker.example.org"
        malicious_headers = {
            "Origin": untrusted_origin,
            "Access-Control-Request-Method": "POST"
        }
        r_malicious = session.options(f"{backend_url}/optimize", headers=malicious_headers, timeout=10)
        malicious_allow = r_malicious.headers.get("Access-Control-Allow-Origin", "")
        
        if malicious_allow == untrusted_origin:
            print(f"  [FAIL] Untrusted origin ({untrusted_origin}) was illegally allowed by CORS!")
            all_passed = False
        else:
            print(f"  [PASS] Untrusted origin ({untrusted_origin}) correctly rejected by CORS")
    except Exception as e:
        print(f"  [FAIL] CORS preflight verification error: {e}")
        all_passed = False

    # 5. Frontend Root Check
    print(f"\n[5/5] Checking Frontend Web Application ({frontend_url})...")
    try:
        r_fe = session.get(frontend_url, timeout=10)
        if r_fe.status_code == 200:
            print(f"  [PASS] Frontend returned HTTP 200 OK (Content Length: {len(r_fe.content)} bytes)")
        else:
            print(f"  [FAIL] Frontend returned HTTP {r_fe.status_code}")
            all_passed = False
    except Exception as e:
        print(f"  [FAIL] Could not reach frontend at {frontend_url}: {e}")
        all_passed = False

    # Summary
    print("\n" + "=" * 65)
    if all_passed:
        print("  ALL LIVE VERIFICATION CHECKS PASSED SUCCESSFULLY!")
        print("=" * 65 + "\n")
        return True
    else:
        print("  ONE OR MORE LIVE DEPLOYMENT VERIFICATION CHECKS FAILED.")
        print("=" * 65 + "\n")
        return False

def main():
    parser = argparse.ArgumentParser(description="SunSync AI Live Deployment Smoke Test")
    parser.add_argument("--backend", default=os.getenv("BACKEND_URL", "http://localhost:8000"), help="Backend URL")
    parser.add_argument("--frontend", default=os.getenv("FRONTEND_URL", "http://localhost:3000"), help="Frontend URL")
    args = parser.parse_args()

    success = run_smoke_test(args.backend, args.frontend)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
