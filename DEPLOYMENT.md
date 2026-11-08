# SunSync AI — Production Deployment Guide & Architectural Limits

This guide outlines deployment procedures, environment variable requirements, and runtime trade-offs for Vercel, Supabase, and self-hosted environments.

---

## 1. Storage & Runtime Modes: Honest Limits

### 1.1 Memory Mode (`STORAGE_MODE=memory`)
- **Serverless Reality:** Serverless platforms (such as Vercel Serverless Functions) allocate dynamic microVM containers. Because state is held in process RAM:
  - Different HTTP requests within the same user session can route to different containers with blank memory.
  - State modified by a user (e.g. modified machine windows, customized tariff slabs) **can reset at any time**.
  - **Verdict:** Use `memory` mode strictly for quick single-user smoke demos or offline sandbox tests. Never use for production.

### 1.2 In-Memory Rate Limiting
- The token-bucket rate limiter (`app/core/security.py`) tracks IP and visitor session request counts in RAM.
- On multi-instance serverless deployments, rate-limit buckets are isolated to individual containers.
- A malicious actor distributing requests across multiple serverless containers can bypass the per-instance threshold. Deploy edge rate-limiting (e.g., Vercel Firewall / Cloudflare WAF) for mission-critical endpoints.

### 1.3 Supabase Mode (`STORAGE_MODE=supabase`)
- **Architecture:** The repository uses Supabase PostgreSQL and atomic RPC transactions. Effective production row-level security policies and grants have not been verified.
- **Anonymous ownership:** The checked-in FastAPI routes issue signed, expiring bearer sessions. Site-owned HTTP requests authorize against the verified token subject and `sites.owner_session_id`; private site reads and writes return 404 to other sessions. The shared demo remains readable and read-only through these routes. This describes source code, not deployed behavior.
- **Maintenance:** Migrations 003 and 004 define `cleanup_expired_visitor_sandboxes`; SQL enforces a minimum 31-day age threshold even when a shorter interval is requested. No protected HTTP maintenance endpoint or cron schedule is currently configured. Any manual invocation must be performed by an authorized database operator after verifying the target project and eligible rows. The migrations have not been applied or tested against a production database.

Repository inspection does not verify production security. Before public production use, confirm the actual Vercel environment variables, deployed behavior and CORS origins, Supabase policies and effective grants, and every direct database access path and credential. Application-level bearer authorization does not by itself constrain privileged direct database access.

---

## 2. Environment Variables Checklist

### Backend Environment Variables
| Variable | Required In | Description |
| :--- | :--- | :--- |
| `STORAGE_MODE` | All | `supabase`, `local_file`, or `memory` (default: `memory` on Vercel) |
| `ALLOWED_ORIGINS` | Production | Comma-separated allowed frontend origins (e.g., `https://sunsync-ai.vercel.app`) |
| `SESSION_SIGNING_SECRET` | All protected session endpoints | Backend-only random secret, at least 32 bytes; never expose through `NEXT_PUBLIC_*` |
| `SESSION_TOKEN_TTL_SECONDS` | Optional | Anonymous bearer session lifetime; defaults to 604800 seconds (7 days) |
| `SESSION_ISSUANCE_MAX_REQUESTS` | Optional | Per-instance session issuance limit per IP per minute; defaults to 10 |
| `SUPABASE_URL` | Supabase Mode | Project REST endpoint URL (e.g., `https://xyz.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Mode | Server-side service role key (Never expose to client!) |

### Frontend Environment Variables
| Variable | Required In | Description |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_API_BASE_URL` | Production | Public URL of deployed FastAPI backend (e.g., `https://api.sunsync.example.com`) |

---

## 3. Database Migrations Order

Apply migrations in the Supabase Project SQL Editor in this strict sequence:
1. `supabase/migrations/001_initial_schema.sql` — Base tables, RLS policies, and indexes.
2. `supabase/seed.sql` — Seed default demo factory, 7 machines, and 96-interval ToD tariff.
3. `supabase/migrations/002_atomic_config_rpc.sql` — Optimistic locking (`version` column) and atomic RPC function `save_site_configuration`.
4. `supabase/migrations/003_visitor_sandbox_ownership.sql` — Visitor session sandbox tracking (`owner_session_id`) and TTL pruning function.
5. `supabase/migrations/004_site_limits_and_session_cleanup.sql` — Per-session atomic site creation limit and conservative cleanup retention.
6. `supabase/migrations/005_restrict_anonymous_table_access.sql` — Revoke unnecessary public/anon direct table privileges and drop overly permissive anon SELECT policies (Least Privilege).
7. (Verification 002) Run `supabase/verify_002.sql` — Safe self-rolling-back transactional check for atomic configuration RPC.
8. (Verification 005) Run `supabase/verify_005.sql` — Non-destructive catalog inspection verifying RLS, table privilege revocation from anon/PUBLIC, and service_role grants.

### 3.1 Anonymous Table Access Vulnerability & Remediation (Migration 005)
- **Vulnerability:** In `001_initial_schema.sql`, six `anon` SELECT policies were defined with `USING (true)`. Over Supabase PostgREST, any caller with the public anon key could dump all visitor sandboxes, machine constraints, custom tariffs, and `owner_session_id` tokens across sessions.
- **Architecture Reality:** Frontend requests never query Supabase directly; all data access routes through FastAPI using `SUPABASE_SERVICE_ROLE_KEY` (`service_role`). Direct `anon` access is unnecessary.
- **Remediation & Hardening:**
  - Migration 005 drops all six permissive anonymous policies.
  - Revokes table privileges on all seven application tables from `anon` and `PUBLIC`.
  - Narrows table privileges granted to `service_role` to the minimum backend-required set (`SELECT, INSERT, UPDATE, DELETE`), omitting administrative privileges (`TRUNCATE`, `REFERENCES`, `TRIGGER`).
  - Revokes sequence privileges from `anon` and `PUBLIC` and preserves them for `service_role`.
  - Preserves existing security-definer RPC grants (`save_site_configuration`, `cleanup_expired_visitor_sandboxes`, `create_owned_site_with_limit`) to `service_role`.
- **Verification Script (`verify_005.sql`):**
  - Read-only catalog inspection verifying RLS on all 7 tables.
  - Inspects `pg_policies` for both `anon` and `PUBLIC` role policies.
  - Validates zero table and sequence privileges for `anon` and `PUBLIC`.
  - Validates `SELECT, INSERT, UPDATE, DELETE` table grants for `service_role`.
  - Validates execution grants for `service_role` and rejections for `anon`/`PUBLIC` across canonical RPCs and compatibility aliases (`save_site_configuration_atomic`, `save_site_config_atomic`).
- **Static vs Live Execution Testing:**
  - Local regression tests (`backend/tests/test_migration_005_security.py`) statically inspect SQL definitions and syntax patterns.
  - Static tests alone do not establish live PostgreSQL execution correctness because PL/pgSQL block execution, role resolution, and catalog function evaluation require an active PostgreSQL instance.
- **Staging Execution Procedure:**
  1. In the Supabase project dashboard SQL Editor (or via staging CI with database access), run `supabase/migrations/005_restrict_anonymous_table_access.sql`.
  2. Immediately run `supabase/verify_005.sql`. Confirm output reports `[PASS]` across all 7 checks and terminates with `ALL MIGRATION 005 SECURITY VERIFICATION CHECKS PASSED`.
  3. Perform a negative HTTP probe: `curl -H "apikey: <ANON_KEY>" https://<project>.supabase.co/rest/v1/sites?select=*` and confirm the request is rejected with `401/403` or empty array.
- **Pending Status:** Migration application and live target-project verification remain strictly pending until explicitly authorized.

`sites.version` is the field read by the backend for optimistic concurrency. Migration 002 retains and synchronizes the legacy `sites.site_version` field and keeps two RPC aliases as wrappers for compatibility. Do not remove those legacy objects until the deployed schema and external callers have been verified. The audit has not applied any migration; confirm the live migration history and inspect existing column/function state before manual execution.

## 4. Vercel Project Structure and Runtime Checks

The repository documents separate projects with roots `backend` (FastAPI, `backend/vercel.json`) and `frontend` (Next.js, `frontend/vercel.json`). There is no root `vercel.json`. Confirm both project roots and dashboard overrides in Vercel before deployment; repository files cannot prove the external project settings.

The backend uses legacy `builds`/`routes` configuration and currently declares `maxDuration: 15`, `memory: 1024`, and `includeFiles` patterns for `app/**` and `app/forecast/models/**`. The Python tree evaluator loads `app/forecast/models/solar_model.json` and `load_model.json`; both files exist locally and are covered by the include pattern. Runtime dependencies in `backend/requirements.txt` include SciPy, NumPy, HTTPX, and Requests. OR-Tools, XGBoost, Pandas, and pytest are listed in `requirements-dev.txt`; production optimization falls back to SciPy if OR-Tools is unavailable, and forecasting evaluates the JSON models without XGBoost/Pandas.

These local facts do not prove Vercel accepted the legacy builder options, packaged the same files, or has the required project environment variables. Verify the deployed function bundle and runtime settings in Vercel. Current official limits and configuration vary with plan and Fluid Compute; consult [Function limits](https://vercel.com/docs/functions/limitations), [Python runtime](https://vercel.com/docs/functions/runtimes/python), [vercel.json](https://vercel.com/docs/project-configuration/vercel-json), and [Cron usage](https://vercel.com/docs/cron-jobs/usage-and-pricing). Hobby cron permits at most one execution per day, so the former six-hour schedule is unsuitable for that plan. Cleanup is not scheduled by this repository.

The service requires backend environment variable names `STORAGE_MODE`, `ALLOWED_ORIGINS`, and `SESSION_SIGNING_SECRET`; Supabase variables are additionally required for Supabase mode. The frontend requires `NEXT_PUBLIC_API_BASE_URL`. Vercel backend startup fails closed when `ALLOWED_ORIGINS` is missing or contains `*`. The real deployed frontend origin has not been confirmed in this repository, so production must configure the exact origin before deployment. There is no `CRON_SECRET` requirement because no cleanup HTTP endpoint is currently configured.

## 5. Local Verification

```powershell
cd backend; .\.venv\Scripts\python.exe -m pytest tests -q
cd ..\frontend; npx.cmd tsc --noEmit; npm.cmd run build; npx.cmd playwright test
```

The browser stores the signed bearer token in `sessionStorage`; the backend signing secret remains server-side. Because authorization uses an explicit `Authorization` header rather than ambient cookies, this design does not use cross-site cookies and does not require cookie-based CSRF tokens. CORS allows only configured origins and permits the `Authorization` header. A token is renewed only while valid; after expiry the browser gets a new anonymous workspace, and the previous workspace is not linked. XSS on the frontend origin can still steal a bearer token, so keep frontend dependencies and rendering paths secure. Anonymous sessions are not accounts and do not provide cross-device recovery. Rate limits are per worker and are not fleet-wide production limits.
