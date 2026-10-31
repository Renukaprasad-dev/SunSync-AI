# SunSync AI — Solar-Aware Industrial Machine Scheduling

> **AI-powered, production-aware machine scheduling to cut peak grid demand charges and maximize rooftop solar utilization in small and medium industrial enterprises.**
> Domain: Industrial Energy Optimization • Theme: Sustainability and Renewable Energy • Event: IDEATHON2026, Team Techies.

---

## 1. Executive Summary

Small industrial manufacturing units face high electricity bills due to:
1. **Punitive Peak-Demand Charges:** Machines (furnaces, compressors, pumps, molding units) often turn on simultaneously at the start of shifts, causing severe demand spikes.
2. **Underused Rooftop Solar:** Solar generation peaks around midday (11:00 AM – 2:30 PM), while inflexible schedules run loads outside these golden hours.
3. **No Safe, Automated Tool:** Operators cannot manually calculate the combinatorial impact of shifting machines without risking production deadlines.

**SunSync AI** solves this with production-aware **Mixed-Integer Linear Programming (MILP)** and **XGBoost weather-aware forecasting**. It shifts flexible machines into peak solar hours and away from high-tariff intervals, strictly enforcing availability windows, completion deadlines, and continuous (non-preemptive) execution.

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
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|        OR-Tools MILP Scheduler (96 x 15-min Intervals)       |
|  - Availability Windows: Earliest Start <= s <= Latest Start|
|  - Non-Preemption: Exactly one start, continuous run         |
|  - Deadline Guarantee: s + duration <= T_due                |
|  - Grid Balance: Grid[t] >= Load[t] - Solar[t]              |
|  - Peak Ceiling: Peak >= Grid[t], Grid[t] <= P_max          |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|      Independent Verifier & Plain-Language Reason Engine    |
|  - Re-simulates schedule independently                      |
|  - Asserts 0 deadline violations                            |
|  - Generates quantified, human-readable explanations        |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|          FastAPI REST API & Next.js 14+ Dashboard           |
|  - Stacked Plotly Load vs Solar vs Net Grid curves          |
|  - Interactive Gantt Dispatch (Baseline vs Optimized)       |
|  - Real-time KPI delta tracking & CSV schedule export       |
+-------------------------------------------------------------+
```

---

## 3. The Three Evaluated Strategies

| Strategy | Description | Typical Outcome |
| :--- | :--- | :--- |
| **Baseline** | Every machine runs at its earliest feasible start slot. | Severe morning peak (8–10 AM), solar underused, highest bill. |
| **Solar-Aware** | Minimizes total grid imported energy by maximizing solar self-consumption. | Shifts flexible runs into the 11:00–14:30 solar curve. |
| **Cost-Optimized** | Joint optimization across solar generation, Time-of-Day (ToD) tariff, and peak demand charge. | Lowest daily electricity cost and lowest peak grid demand. |

---

## 4. Edge Case: Overcast Day Tariff Arbitrage

When solar generation drops near zero (e.g. monsoon / heavily overcast day), SunSync AI shifts flexible machines strictly to exploit **Time-of-Day tariff arbitrage**—moving runs out of morning peak (₹9.00/kWh) and evening peak (₹9.50/kWh) into standard day slots (₹7.00/kWh) and off-peak slots (₹4.50/kWh), maintaining savings even without sunlight.

---

## 5. Local Development Setup

### Prerequisites
- Python 3.11+
- Node.js 18+ (or 20+)
- Git

### Backend Setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Run backend unit & integration tests
pytest tests/ -v

# Start FastAPI dev server
uvicorn app.main:app --reload --port 8000
```
Interactive API docs are available at `http://localhost:8000/docs`.

### Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:3000` to interact with the dashboard.

---

## 6. Environment Variables

### Backend (`backend/.env`)
```ini
PROJECT_NAME="SunSync AI"
VERSION="1.0.0"
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
ALLOWED_ORIGINS=http://localhost:3000,https://your-frontend.vercel.app
INTERVALS_PER_DAY=96
INTERVAL_MINUTES=15
SOLVER_TIME_LIMIT_SECONDS=8.0
DEFAULT_P_MAX_GRID_KW=25.0
DEFAULT_GRID_EMISSION_FACTOR_KG_PER_KWH=0.8200
```

### Frontend (`frontend/.env.local`)
```ini
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

---

## 7. Deployment to Vercel

SunSync AI is designed for seamless deployment as two separate Vercel projects from the same repository:

### 1. Deploy Backend (FastAPI Serverless)
1. In Vercel, create a new project and select the `backend` folder as the **Root Directory**.
2. Framework Preset: **Other**.
3. Set Environment Variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ALLOWED_ORIGINS` (your frontend domain)
4. Deploy! Vercel uses `@vercel/python` via `vercel.json` and routes all traffic to `api/index.py`.
5. Verify `https://<your-backend>.vercel.app/health` returns `{"status": "healthy"}`.

### 2. Deploy Frontend (Next.js)
1. Create a second Vercel project and select `frontend` as the **Root Directory**.
2. Framework Preset: **Next.js**.
3. Set Environment Variable:
   - `NEXT_PUBLIC_API_BASE_URL`: `https://<your-backend>.vercel.app`
4. Deploy!
5. Update `ALLOWED_ORIGINS` in your backend Vercel project with the frontend URL.

---

## 8. Assumptions & Limitations

1. **Simulated Inputs & Baseline:** Demo machines, solar generation curves, and factory base load are synthesized to reflect realistic small-scale engineering workshops (e.g. Peenya, Bengaluru). Figures are illustrative decision-support projections and must be checked against real utility bills.
2. **Tariff Placeholders:** Time-of-Day (ToD) tariffs and demand charges are modeled on representative industrial HT/LT tariffs. Real deployments must use the utility's official published tariff order.
3. **Hardware & Sensors:** Version 1.0 is an intelligent decision-support platform (software only). It does not include hardware smart-plugs, PLCs, or automated breaker relays; factory operators receive the dispatch schedule and plain-language justifications to execute manually or integrate via API.
4. **Serverless Execution Limits:** Solver search time is bounded at 8 seconds to remain within serverless function execution windows, returning the globally optimal or best verified feasible solution.
