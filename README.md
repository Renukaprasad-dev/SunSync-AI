# SunSync AI — Solar-Aware Industrial Machine Scheduling

> **AI-powered, production-aware machine scheduling to cut peak grid demand charges and maximize rooftop solar utilization in small and medium industrial enterprises.**  
> Domain: Industrial Energy Optimization • Theme: Sustainability and Renewable Energy • Event: IDEATHON2026, Team Techies.

---

## 1. Executive Summary

Small and medium manufacturing enterprises (SMEs) face punishing electricity costs characterized by two structural challenges:
1. **Punitive Peak-Demand Charges:** Shift-start operations cause high-power machines (furnaces, compressors, pumps, molding units) to turn on simultaneously, setting high monthly peak demand (kVA/kW) charges that can constitute 25–40% of the entire utility bill.
2. **Underutilized Rooftop Solar:** Solar generation peaks around midday (11:00 AM – 2:30 PM), while rigid shift schedules often run critical loads early in the morning or late into evening peak-tariff intervals, leaving solar energy exported to the grid at low feed-in tariffs or wasted.

**SunSync AI** solves this with production-aware **Mixed-Integer Linear Programming (MILP)** and **XGBoost weather-aware forecasting**. It shifts flexible machine operations into peak solar hours and away from high-tariff intervals, strictly enforcing availability windows, completion deadlines, and continuous (non-preemptive) execution.

---

## 2. Architecture & Data Flow

```
+-------------------------------------------------------------+
|   Weather Inputs (Open-Meteo Irradiance & Cloud Cover API)  |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|     XGBoost Forecaster (Solar Output & Factory Base Load)   |
|   - Pre-trained pure-Python JSON decision trees (< 200 KB)  |
|   - Zero C++ runtime dependencies (no pandas / xgboost)     |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|        MILP Scheduler Engine (96 x 15-min Intervals)        |
|   - SciPy HiGHS (Serverless) / Google OR-Tools (Dev)        |
|   - Availability Windows: Earliest Start <= s <= Latest     |
|   - Non-Preemption: Exactly one start, continuous run       |
|   - Deadline Guarantee: s + duration <= T_due               |
|   - Grid Balance: Grid[t] >= Load[t] - Solar[t]             |
|   - Peak Ceiling: Peak >= Grid[t], Grid[t] <= P_max         |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|      Independent Verifier & Plain-Language Reason Engine    |
|   - Re-simulates schedule independently across all 96 slots |
|   - Asserts 0 deadline violations & 0 grid ceiling breaches |
|   - Quantified plain-language shift explanations            |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|          FastAPI REST API & Next.js 14+ Dashboard           |
|   - Stacked Plotly Net Grid / Solar / Machine Curves        |
|   - Interactive Gantt Dispatch (Baseline vs Optimized)      |
|   - Run History, ToD Tariff Editor, Bill Reality Check      |
|   - What-If Transient Parameter Simulator                   |
+-------------------------------------------------------------+
```

---

## 3. The Three Evaluated Strategies

| Strategy | Description | Typical Outcome |
| :--- | :--- | :--- |
| **Baseline** | Every machine runs at its earliest feasible start slot. | Severe morning peak (8–10 AM), solar underused, highest peak demand charges. |
| **Solar-Aware** | Minimizes total grid imported energy by maximizing solar self-consumption. | Shifts flexible runs into the 11:00 AM – 2:30 PM solar window. |
| **Cost-Optimized** | Joint optimization across solar generation, Time-of-Day (ToD) tariff arbitrage, and monthly peak demand charges. | Lowest total daily electricity cost and lowest peak grid demand. |

---

## 4. Key Application Features (Phase 2 Additions)

### 4.1 Optimization Run History (`/history`)
- Every execution of `POST /optimize` is recorded with input hashes, strategy KPIs (cost, peak demand, savings), solver solve time, and verifier status.
- Scoped to the signed anonymous session that created each private site; other sessions cannot list or reopen its runs.
- 1-click **"Reopen in Dashboard"** to reload and review any past dispatch run and Gantt schedule.

### 4.2 Time-of-Day (ToD) Tariff Slab Editor (`/setup`)
- Visual tariff editor supporting custom time slots (e.g., Morning Peak 06:00–10:00, Standard Day 10:00–18:00, Evening Peak 18:00–22:00, Night Off-Peak 22:00–06:00).
- Demand charge (₹/kW/month) input.
- Real-time 96-interval interactive preview chart with stepped rates.
- Strict 24-hour continuous coverage validation (no time gaps, no overlapping intervals).

### 4.3 Utility Bill Reality Check (`/bill-check`)
- Compares real industrial monthly bills (total kWh, recorded peak demand kVA/kW, total bill ₹) against SunSync's scaled baseline model.
- Automatically computes energy variance and peak demand gap percentages.
- Diagnoses likely industrial causes of discrepancies:
  - **Motor Inrush / Unmetered Surges:** Instantaneous starting currents from induction motors causing demand spikes.
  - **Auxiliary Base Loads:** 24/7 unmetered loads (compressor air leaks, cooling towers, lighting, HVAC).
  - **Overtime & Unscheduled Shifts:** Production operations outside modeled windows.
  - **Fuel Surcharges & Taxes:** Unmodelled regulatory line-items (FAC, electricity duty, power factor penalties).
- Prominent decision-support sanity check disclaimer.

### 4.4 What-If Parameter Sandbox (`/simulator`)
- Interactive sandbox allowing plant managers to adjust parameters transiently:
  - Modify factory grid ceiling ($P_{\max}$) dynamically.
  - Adjust individual machine earliest start, latest start, and deadline windows.
  - Apply global tariff price multipliers (e.g., test a 20% grid tariff hike).
- Re-runs optimization in-memory without overwriting the saved factory configuration in the database.

---

## 5. Storage Modes & Public Sandbox Architecture

SunSync AI features a tri-mode storage architecture defined by the `STORAGE_MODE` environment variable:

| Mode | Target | Durability | Description |
| :--- | :--- | :--- | :--- |
| `supabase` | Supabase PostgreSQL REST | **Durable** | Production target. PostgreSQL persistence and atomic RPC functions. |
| `local_file` | `backend/app/data/local_store.json` | **Durable (Local Dev)** | Persists to disk across restarts. Safe for single-instance local development. |
| `memory` | In-memory Python dictionaries | **Ephemeral** | Ephemeral fallback for test runners or serverless environments without Supabase. |

### Health Check Endpoint (`GET /health`)
The backend provides a structured health diagnostic:
```json
{
  "status": "healthy",
  "service": "SunSync AI",
  "version": "1.0.0",
  "storage_mode": "supabase",
  "durable": true,
  "supabase_configured": true,
  "warning": null,
  "intervals_per_day": 96,
  "interval_minutes": 15
}
```

### Public Sandbox & Visitor Session Isolation
The checked-in FastAPI routes issue signed, expiring anonymous bearer sessions and use the verified subject to authorize private site-owned resources. The shared demo is readable through the API and API writes to it are rejected. This describes the repository code only; it does not verify production security. Before enabling public production writes, verify the production environment variables (including `SESSION_SIGNING_SECRET` and the exact `ALLOWED_ORIGINS`), deployed route behavior, effective Supabase policies, and all direct database access paths and credentials.

---

## 6. Database Migrations (Supabase)

To initialize a Supabase project, execute the SQL migration scripts in the Supabase SQL Editor in the following order:

```
1. supabase/migrations/001_initial_schema.sql
2. supabase/seed.sql
3. supabase/migrations/002_atomic_config_rpc.sql
4. supabase/migrations/003_visitor_sandbox_ownership.sql
5. supabase/migrations/004_site_limits_and_session_cleanup.sql
6. supabase/verify_002.sql (Verification script; review before use)
```

### Migration Verification (`verify_002.sql`)
`002_atomic_config_rpc.sql` creates the canonical RPC `save_site_configuration`, which the backend calls. `sites.version` is the concurrency field read and written by the backend. The legacy `sites.site_version` column is preserved and synchronized for compatibility; wrapper RPC aliases are retained for older callers. Do not drop legacy objects until the deployed database and all external callers have been checked.

The RPC accepts these parameters:
```sql
save_site_configuration(
  p_site_id UUID,
  p_site_data JSONB,
  p_machines JSONB,
  p_tariff JSONB,
  p_expected_version INTEGER
)
```
This guarantees:
- **Atomicity:** Site profile, machine inventory, and tariff slabs update together in a single transaction. A failure in any table rolls back the entire operation.
- **Optimistic Concurrency Control:** Compares `p_expected_version` against `sites.version`. If a stale save is detected, it raises a version conflict and leaves existing records untouched.

Run `supabase/verify_002.sql` in the Supabase SQL editor to confirm the function signature, verify atomic updates, and test 409 conflict detection without leaving orphan test records.

---

## 7. Local Development Setup

### Prerequisites
- Python 3.11+
- Node.js 18+ (or 20+)
- Git

### Quick Start (Recommended: One-Command Runner)
SunSync AI includes a cross-platform orchestrator that launches the Python FastAPI backend, waits for `/health`, and launches the Next.js 14 frontend:

```bash
# 1. Install frontend dependencies (if not already done):
cd frontend && npm install && cd ..

# 2. Run diagnostic health check:
npm run doctor

# 3. Start both backend and frontend together:
npm run dev:all
```
Open `http://localhost:3000` to interact with the platform.

---

### Manual 2-Terminal Setup (Windows & POSIX)

#### Terminal 1: Backend (FastAPI on Port 8000)
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1  # On Linux/macOS: source .venv/bin/activate

# Install requirements (use requirements.txt for production, requirements-dev.txt for tests):
pip install -r requirements.txt

# Start backend listening on all interfaces (avoids Windows IPv6 ::1 resolution mismatches):
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
Open `http://localhost:8000/docs` to test Swagger OpenAPI documentation.

#### Terminal 2: Frontend (Next.js 14 on Port 3000)
```powershell
cd frontend
copy .env.local.example .env.local  # On Linux/macOS: cp .env.local.example .env.local
npm install
npm run dev
```
Open `http://localhost:3000` to access the application.

> [!NOTE]
> If you ever observe a "Cannot reach backend at http://localhost:8000" message in the UI, run `npm run doctor` to immediately diagnose whether port 8000 is running, whether your virtual environment is active, or whether CORS headers need updating.

---

## 8. Verification & Test Suite

The repository includes a comprehensive, multi-layer verification suite:

```bash
# 1. Backend Pytest Suite (50 tests covering MILP, Verifier, XGBoost, Security, History, Billing)
cd backend
pytest tests/ -v

# 2. Frontend Type Checking
cd frontend
npx tsc --noEmit

# 3. Frontend Production Build
npm run build

# 4. Playwright End-to-End Suite (18 tests against live FastAPI & Next.js production build)
npx playwright test

# 5. Live Deployment Smoke Test (Cross-Platform)
python scripts/smoke_live.py --backend http://localhost:8000 --frontend http://localhost:3000
```

### Serverless Bundle Size Verification
Vercel enforces a strict **250 MB** uncompressed limit on serverless functions.
- Production dependencies in `backend/requirements.txt` installed in a clean virtual environment occupy **205.96 MB** (**44.04 MB / 17.6% safety margin**).
- Made possible by evaluating pre-trained XGBoost JSON tree models via pure NumPy (`CompactTreeModel`) and using SciPy HiGHS as the serverless MILP solver.

---

## 9. Environment Variables Reference

### Backend (`backend/.env`)
| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `STORAGE_MODE` | No | `supabase` if keys set, else `local_file` | Explicit store: `supabase`, `local_file`, `memory` |
| `SUPABASE_URL` | For `supabase` | `""` | Supabase project REST URL |
| `SUPABASE_SERVICE_ROLE_KEY` | For `supabase` | `""` | Supabase service role key (backend-only, never expose) |
| `ALLOWED_ORIGINS` | Yes | `http://localhost:3000` | Comma-separated CORS allowed origins |
| `SESSION_SIGNING_SECRET` | Yes | none | Backend-only random signing key, at least 32 bytes; required for anonymous sessions |
| `SESSION_TOKEN_TTL_SECONDS` | No | `604800` | Anonymous bearer session lifetime in seconds (7 days) |
| `SESSION_ISSUANCE_MAX_REQUESTS` | No | `10` | Per-instance new-session requests per IP per minute |
| `INTERVALS_PER_DAY` | No | `96` | Number of 15-minute intervals per 24 hours |
| `INTERVAL_MINUTES` | No | `15` | Interval resolution in minutes |
| `SOLVER_TIME_LIMIT_SECONDS` | No | `8.0` | Serverless MILP solver execution ceiling |
| `DEFAULT_P_MAX_GRID_KW` | No | `25.0` | Default factory sanctioned peak import limit |
| `DEFAULT_GRID_EMISSION_FACTOR_KG_PER_KWH` | No | `0.8200` | CO₂ grid emission factor (CEA India baseline) |

### Frontend (`frontend/.env.local`)
| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_API_BASE_URL` | Yes | `http://localhost:8000` | Base URL of deployed FastAPI backend |

---

## 10. Step-by-Step Vercel Deployment

The repository documents two separate Vercel projects: backend root `backend` using `backend/vercel.json`, and Next.js frontend root `frontend` using `frontend/vercel.json`. There is no root `vercel.json`. Actual Vercel dashboard project roots and overrides are external settings and must be checked before deployment.

### 10.1 Backend Deployment (FastAPI Serverless)
1. Go to [Vercel Dashboard](https://vercel.com/dashboard) and click **Add New... -> Project**.
2. Select your repository `Renukaprasad-dev/SunSync-AI`.
3. In **Project Settings**:
   - **Project Name:** `sunsync-backend` (or similar).
   - **Framework Preset:** Select **Other**.
   - **Root Directory:** Edit and select `backend`.
4. In **Environment Variables**, configure:
   - `STORAGE_MODE`: `supabase`
   - `SUPABASE_URL`: `https://<your-project>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY`: `<your-supabase-service-role-key>`
   - `ALLOWED_ORIGINS`: `https://<your-frontend-domain>` (include local origins only where needed)
   - `SESSION_SIGNING_SECRET`: a randomly generated backend-only value of at least 32 bytes
   - `SOLVER_TIME_LIMIT_SECONDS`: `8.0`
5. Click **Deploy**.
6. Verify deployment by visiting `https://<sunsync-backend>.vercel.app/health`. Confirm `storage_mode: "supabase"` and `durable: true`.

### 10.2 Frontend Deployment (Next.js)
1. In Vercel, click **Add New... -> Project** and select `Renukaprasad-dev/SunSync-AI`.
2. In **Project Settings**:
   - **Project Name:** `sunsync-frontend` (or `sunsync-ai`).
   - **Framework Preset:** **Next.js** (auto-detected).
   - **Root Directory:** Edit and select `frontend`.
3. In **Environment Variables**, add:
   - `NEXT_PUBLIC_API_BASE_URL`: `https://<sunsync-backend>.vercel.app`
4. Click **Deploy**.
5. Once deployed, copy your frontend domain (e.g. `https://sunsync-frontend.vercel.app`).

### 10.3 Link Backend CORS
1. In the `sunsync-backend` Vercel project -> **Settings -> Environment Variables**.
2. Update `ALLOWED_ORIGINS` to:
   ```
   https://<your-exact-frontend-domain>
   ```
   Add local origins only in local development. The backend uses bearer headers, disables cookie credentials, and rejects wildcard production CORS.
3. Redeploy the backend.
4. Run live smoke verification:
   ```bash
   python scripts/smoke_live.py --backend https://<sunsync-backend>.vercel.app --frontend https://<sunsync-frontend>.vercel.app
   ```

---

## 11. Assumptions & Limitations

1. **Simulated Inputs & Baseline:** Demo machines, solar generation curves, and factory base load are synthesized to reflect realistic small-scale engineering workshops (e.g. Peenya, Bengaluru). Figures are illustrative decision-support projections and must be checked against real utility bills using the `/bill-check` tool.
2. **Tariff Placeholders:** Time-of-Day (ToD) tariffs and demand charges are modeled on representative industrial HT/LT tariffs. Real deployments must configure the utility's official published tariff order via the Tariff Editor (`/setup`).
3. **Hardware & Sensors:** Version 1.0 is an intelligent decision-support software platform. It does not directly actuate hardware smart-plugs or PLC relays; plant managers receive the optimized dispatch schedule and plain-language justifications to execute or integrate via API.
4. **Serverless Solver Limits:** Solver search time is bounded at 8 seconds to guarantee responsive operation within serverless function execution windows, returning the globally optimal or best verified feasible solution.
