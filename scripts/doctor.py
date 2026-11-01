#!/usr/bin/env python3
"""
SunSync AI - Diagnostic Health & Environment Doctor Tool
Inspects Python, Node.js, virtualenv, dependencies, ports, env files,
FastAPI /health reachability, and CORS preflights.

Usage:
    python scripts/doctor.py
"""

import sys
import os
import re
import socket
import subprocess
from pathlib import Path

# Fix Windows stdout charset for emojis/box characters
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
FRONTEND_DIR = ROOT_DIR / "frontend"

PASS = "[PASS]"
WARN = "[WARN]"
FAIL = "[FAIL]"

def run_cmd(cmd, cwd=None):
    try:
        res = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=True)
        return res.returncode == 0, res.stdout.strip(), res.stderr.strip()
    except Exception as e:
        return False, "", str(e)

def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0

def main():
    print("\n" + "=" * 65)
    print("  SunSync AI — Pre-Flight Environment & Diagnostics Doctor")
    print("=" * 65)

    issues = []
    warnings = []

    # 1. Python Version Check
    print("\n[1/8] Checking Python Runtime...")
    py_ver = sys.version_info
    py_str = f"{py_ver.major}.{py_ver.minor}.{py_ver.micro}"
    if py_ver >= (3, 11):
        print(f"  {PASS} Python version {py_str} (>= 3.11 required)")
    else:
        print(f"  {FAIL} Python version {py_str} is below 3.11!")
        issues.append("Upgrade Python to 3.11 or higher.")

    # 2. Node.js Version Check
    print("\n[2/8] Checking Node.js Runtime...")
    ok, node_out, _ = run_cmd("node -v")
    if ok and node_out:
        print(f"  {PASS} Node.js version {node_out} detected")
        m = re.search(r"v(\d+)", node_out)
        if m and int(m.group(1)) < 18:
            print(f"  {WARN} Node version {node_out} is below recommended v18+")
            warnings.append("Consider upgrading Node.js to v18 or v20 LTS.")
    else:
        print(f"  {FAIL} Node.js not detected in PATH!")
        issues.append("Install Node.js 18+ (https://nodejs.org).")

    # 3. Virtual Environment & Dependencies Check
    print("\n[3/8] Checking Backend Virtual Environment & Dependencies...")
    is_win = sys.platform == "win32"
    venv_py = BACKEND_DIR / (".venv" if not is_win else ".venv/Scripts/python.exe")
    if not is_win:
        venv_py = BACKEND_DIR / ".venv/bin/python"

    if venv_py.exists():
        print(f"  {PASS} Backend virtualenv found at {venv_py.parent}")
        # Test required production imports
        test_code = (
            "import fastapi, uvicorn, scipy, numpy, httpx, pydantic; "
            "print('DEPS_OK')"
        )
        ok, out, _ = run_cmd(f'"{venv_py}" -c "{test_code}"')
        if "DEPS_OK" in out:
            print(f"  {PASS} Core production dependencies verified (FastAPI, SciPy, NumPy, HTTPX, Pydantic)")
        else:
            print(f"  {FAIL} Missing core packages in backend .venv!")
            issues.append(f"Run: cd backend && \"{venv_py}\" -m pip install -r requirements.txt")
    else:
        print(f"  {FAIL} Backend .venv not found at {BACKEND_DIR / '.venv'}")
        issues.append("Create virtualenv: cd backend && python -m venv .venv && pip install -r requirements.txt")

    # 4. Port Availability Check (8000 & 3000)
    print("\n[4/8] Checking Network Ports (8000 & 3000)...")
    p8000 = is_port_in_use(8000)
    p3000 = is_port_in_use(3000)

    if p8000:
        print(f"  {PASS} Port 8000 is IN USE (FastAPI backend is active or process listening)")
    else:
        print(f"  {WARN} Port 8000 is FREE (FastAPI backend is not running yet)")
        warnings.append("FastAPI backend is not running. Start it with: npm run dev:all (or cd backend && uvicorn app.main:app --port 8000)")

    if p3000:
        print(f"  {PASS} Port 3000 is IN USE (Next.js frontend is active or process listening)")
    else:
        print(f"  {WARN} Port 3000 is FREE (Next.js frontend is not running yet)")

    # 5. Environment Files Hygiene Check (Names only, never values)
    print("\n[5/8] Inspecting Environment Files Configuration...")
    backend_env = BACKEND_DIR / ".env"
    if backend_env.exists():
        with open(backend_env, "r", encoding="utf-8") as f:
            lines = f.readlines()
        var_names = []
        for line in lines:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                var_names.append(line.split("=")[0].strip())
        print(f"  {PASS} backend/.env exists with {len(var_names)} configured keys:")
        for name in var_names:
            print(f"      - {name}")
    else:
        print(f"  {WARN} backend/.env does not exist (using default local_file store & settings)")

    frontend_env = FRONTEND_DIR / ".env.local"
    if frontend_env.exists():
        with open(frontend_env, "r", encoding="utf-8") as f:
            f_lines = [l.strip().split("=")[0] for l in f if l.strip() and not l.startswith("#") and "=" in l]
        print(f"  {PASS} frontend/.env.local exists with keys: {', '.join(f_lines)}")
    else:
        print(f"  {WARN} frontend/.env.local not found. (Defaults to NEXT_PUBLIC_API_BASE_URL=http://localhost:8000)")
        print(f"      To create: cp frontend/.env.local.example frontend/.env.local")

    # 6. Live /health Endpoint Diagnostic
    print("\n[6/8] Testing Live FastAPI /health Reachability...")
    if p8000:
        try:
            import urllib.request
            import json
            req = urllib.request.Request("http://127.0.0.1:8000/health")
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode())
                    print(f"  {PASS} /health responded HTTP 200 OK")
                    print(f"      - Status: {data.get('status')}")
                    print(f"      - Storage Mode: {data.get('storage_mode')} (Durable: {data.get('durable')})")
                    print(f"      - Supabase Connected: {data.get('supabase_configured')}")
                else:
                    print(f"  {FAIL} /health returned HTTP {resp.status}")
                    issues.append("FastAPI /health returned non-200 status code.")
        except Exception as e:
            print(f"  {FAIL} Could not connect to http://127.0.0.1:8000/health: {e}")
            issues.append(f"Backend on port 8000 unreachable: {e}")
    else:
        print("  [SKIP] Skipped because port 8000 is not currently active.")

    # 7. CORS Preflight Check from Frontend Dev Origin
    print("\n[7/8] Testing CORS Preflight (OPTIONS) from http://localhost:3000...")
    if p8000:
        try:
            import urllib.request
            req = urllib.request.Request("http://127.0.0.1:8000/optimize", method="OPTIONS")
            req.add_header("Origin", "http://localhost:3000")
            req.add_header("Access-Control-Request-Method", "POST")
            req.add_header("Access-Control-Request-Headers", "content-type,x-visitor-session-id")
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                allow_origin = resp.headers.get("access-control-allow-origin")
                if allow_origin == "http://localhost:3000":
                    print(f"  {PASS} CORS Preflight allowed for http://localhost:3000")
                else:
                    print(f"  {FAIL} CORS Preflight header mismatch: {allow_origin}")
                    issues.append("CORS configuration not allowing http://localhost:3000.")
        except Exception as e:
            print(f"  {FAIL} CORS Preflight failed: {e}")
            issues.append(f"CORS preflight request failed: {e}")
    else:
        print("  [SKIP] Skipped because port 8000 is not currently active.")

    # 8. Summary & Actionable Fixes
    print("\n" + "=" * 65)
    print("  Diagnostic Summary")
    print("=" * 65)

    if not issues and not warnings:
        print(f"\n{PASS} All checks passed! Your environment is in optimal health.")
        print("Run the full application locally with: npm run dev:all\n")
        return 0

    if warnings:
        print(f"\n{WARN} Notices & Advisory Warnings ({len(warnings)}):")
        for w in warnings:
            print(f"   * {w}")

    if issues:
        print(f"\n{FAIL} Actionable Issues Found ({len(issues)}):")
        for i, issue in enumerate(issues, 1):
            print(f"   {i}. {issue}")
        print("\nPlease resolve the above issues to ensure SunSync AI functions reliably.\n")
        return 1

    print("\nEnvironment is ready for development.\n")
    return 0

if __name__ == "__main__":
    sys.exit(main())
