# SunSync AI Local Production Readiness Audit

Audit date: 2026-11-02 (Asia/Calcutta)

Scope: local repository inspection and local verification only. No production Supabase connection, migration execution, Vercel deployment, commit, or push was performed.

## Verified

- Current branch at audit start: `phase-3`. The working tree already contained changes from a prior user/agent pass, including removal of the cleanup route and cron declaration, edits to migration 002, deletions of two backend tests, and dashboard/history/API changes. Those changes were inspected and preserved.
- Historical backend run (before the signed-session follow-up): **112 passed**, one Starlette deprecation warning. The latest reported backend run in the follow-up section is **125 passed**.
- `frontend/npx.cmd tsc --noEmit`: passed after the final build generated `.next/types` (an earlier parallel invocation raced against `next build` deleting/recreating generated types and failed with TS6053; rerun passed).
- `frontend/npm.cmd run build`: passed. Next.js generated static pages for all routes.
- Historical Playwright run: **27 passing test results** printed, but the process was interrupted during web-server teardown and exited with code 1, so that run did not verify a clean process exit. The latest reported follow-up run is **28 passed** with external local servers and a clean exit (see below). An earlier cache invalidation failure exposed the missing top-level `config.version` fingerprint field; that field was added before the subsequent passing runs.
- `backend/app/core/db.py` calls `save_site_configuration`; reads `sites.version` from `get_site_config`; passes the expected version to the RPC. The current RPC locks the `sites` row, checks the expected version, writes `version`, and the local current migration edit also synchronizes `site_version`.
- Migration 001 creates `public.sites` and `updated_at`. Migration 002 adds the version fields and RPC. Migration 003 adds `owner_session_id` and defines cleanup for non-null-owned rows older than the age threshold, excluding the demo site ID. Thus 002 can follow 001 and 003 relies on 001 plus its own owner column; no migration was applied.
- Migration 002's current working-tree edit is additive: it retains `site_version`, syncs the greatest known version to both columns, retains the backend's canonical RPC, and defines wrappers for the two older RPC names. The backend uses `version` and `save_site_configuration`. The verification SQL checks the canonical function and one alias, then attempts transaction-scoped save/conflict checks; it has not been executed against any database.
- Both model JSON files exist at `backend/app/forecast/models/solar_model.json` and `load_model.json`. The forecaster loads those paths with its own compact tree evaluator. `backend/vercel.json` includes `app/**` and the model directory. Production requirements include SciPy, NumPy, HTTPX, and Requests; OR-Tools, XGBoost, Pandas, and pytest appear in `requirements-dev.txt`. The scheduler falls back to SciPy when OR-Tools is unavailable; the forecaster's JSON evaluator does not import XGBoost or Pandas.
- `/optimize` and `/forecast` were exercised by the backend/browser suites, but those suites used the existing development virtual environment. A clean environment containing only `requirements.txt` was not created, so runtime operation with the exact production-only dependency set is not empirically verified.
- Repository documentation describes two Vercel projects rooted at `backend` and `frontend`; the frontend config selects Next.js, and backend config uses legacy `builds`/`routes`. There is no root `vercel.json`. The checked-in project roots do not prove actual Vercel dashboard settings.
- Official Vercel references consulted: [Python runtime](https://vercel.com/docs/functions/runtimes/python), [Function limits](https://vercel.com/docs/functions/limitations), [vercel.json configuration](https://vercel.com/docs/project-configuration/vercel-json), [Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing), and [Cron management/security](https://vercel.com/docs/cron-jobs/manage-cron-jobs). The current docs list a 500 MB uncompressed Python function bundle limit; function duration and memory depend on plan and Fluid Compute. Hobby cron permits no more than one run per day, so the former six-hour schedule was not suitable for Hobby.
- A marker-only `rg -l "SUPABASE_SERVICE_ROLE_KEY|service_role|CRON_SECRET" .next` search returned no matching filenames. No secret values were searched for or printed.

## Implemented Locally

- Dashboard optimization caching now uses a stable serialized fingerprint including resolved site details and version, machines, tariff, solar profile, base load, scenario, and strategies. It validates result structure before caching/rendering, catches inaccessible or malformed session storage, and distinguishes live results, cached simulations, and historical results.
- Added a read-only base-load endpoint and client helper so base load, a solver input previously absent from the cache fingerprint, participates in cache invalidation.
- Failed historical replay and its retry now stay on `getOptimizationRun`; they do not start a new optimization. Configured site name/location replace hardcoded demo identity in the dashboard and printable report.
- Added browser regressions for cache shape and invalidation (site version, base load, and machine, tariff, and solar-profile input changes while the configuration version remains fixed), storage failures, fresh retry behavior, and historical replay failure/retry.
- Migration 002 now reconciles existing `version`/`site_version` values without dropping either field and keeps compatibility RPC wrappers. This remains unverified against a real Postgres instance and must be reviewed before manual application.
- Updated README/deployment notes to describe migration order, canonical DB fields/RPC, actual local deployment structure, absent cleanup endpoint/schedule, and checked-in HTTP ownership enforcement. Production/database enforcement remains unverified.

## Coverage Map

| Requirement | Existing test or verification | Result | Gap | Recommended action |
|---|---|---|---|---|
| Optimizer, verifier, KPI recomputation, forecast/model loading, CSV validation, API errors | Backend suite and Playwright flows | Historical backend runs reported 112/113 passed; latest reported backend follow-up: 125 passed | Tests used the development venv, not a clean install of production requirements; no production latency or Vercel packaging evidence | Run smoke requests in a clean production-requirements environment and verify a staging function bundle |
| Atomic config persistence and optimistic conflict | Backend config tests; Playwright 409 and save flows; SQL verification script inspected only | Local checks passed | No live/local Postgres RPC execution; migration state unknown | Manually compare migration history/schema, review SQL, then apply in a controlled window and run verification |
| Public site writes protected by visitor ownership | `test_anonymous_session_security.py` exercises signed ownership at HTTP routes | Checked-in route authorization is covered locally; latest reported backend suite: 125 passed | Production settings, deployed behavior, Supabase policies/grants, and direct database access remain unverified | Verify deployment configuration and database access controls before production use |
| Shared demo preservation / visitor cleanup | Repository cleanup unit test; migrations 003/004 inspected only | In-memory cleanup and demo preservation are covered; SQL behavior was not run | Cleanup remains unscheduled; SQL cannot validate bearer tokens and retains rows for at least 31 days | Keep cleanup unscheduled until the target schema and cleanup behavior are reviewed and verified |
| Dashboard cache identity/provenance/storage | Playwright cache and invalidation regressions | Historical run printed 27 results but exited 1 during teardown; separate signed-session follow-up run: 28 passed with external servers; later targeted run: 3 input-specific invalidation cases passed | Historical results lack site details beyond returned payload when current config cannot be loaded | Consider storing immutable site metadata with runs |
| Retry and replay failure behavior | Playwright failed-replay/retry regression | Passed in latest reported results | None identified in the exercised flow | Retain regression |
| Vercel runtime duration, memory, bundle, file inclusion | JSON/config/source inspection and official docs | Locally declared values and model paths confirmed | No Vercel project access; legacy builder option interpretation, plan, Fluid Compute, package result, and env are unknown | Verify project roots/settings and inspect a staging deployment bundle before production |
| Secret exposure in frontend output | Marker-only search of built `.next` output | No matching filenames | Search only checks known markers, not unknown secret formats or deployment output | Repeat against each deployment artifact without printing bundle contents |
| Rate limiting | `test_security_access.py` exercises local token bucket | Unit behavior covered | In-memory per-worker limiter; anonymous users can obtain a new session and a new per-session site quota; no global enforcement | Use external edge/distributed controls for public production |

## Findings and Root Causes

1. **Checked-in HTTP site ownership enforcement is implemented.** Signed-session principals scope private site, machine, tariff, optimization, scenario, billing, and run-history routes; the shared demo is public-read and write-protected. Local HTTP regression coverage exists. Production settings, deployed behavior, effective Supabase policies/grants, and direct database access have not been verified.
2. **The previous cleanup design was not suitable for the Hobby plan.** The current working tree has removed `/internal/cleanup` and the six-hour Vercel cron. Official Vercel docs limit Hobby schedules to once daily. Cleanup is currently an unscheduled SQL function only; no public maintenance endpoint exists.
3. **The old dashboard cache key omitted solver inputs and was unsafe.** The working tree had replaced the prior configuration-aware key with a constant key. Cache now uses the complete available input snapshot, including separately fetched base load. A regression caught that `config.version` is a top-level response field, and the fingerprint now includes it.
4. **Vercel build configuration is not externally verified.** Legacy `builds` configuration coexists with fields whose accepted behavior depends on the runtime/builder and plan. Checked-in `maxDuration: 15`, `memory: 1024`, and `includeFiles` are repository declarations only. No deploy was made to prove effect.

## Remaining Production Recommendations

- Verify production environment variables, deployed HTTP behavior, Supabase policies/grants, and direct database access before enabling public production writes.
- Keep cleanup unscheduled. Migration 004 defines a 31-day minimum retention policy, but it has not been applied or tested against the target database. Review its row selection and the target Supabase project before any authorized cleanup operation.
- Verify Vercel roots, plan, Fluid Compute, effective function duration/memory, environment variable names, Python package bundle size, and both model files in a staging deployment.
- The historical Windows Playwright teardown issue was worked around in the latest reported run by starting local servers externally; retain that workflow if automatic child-process teardown remains unreliable.
- Repeat the marker-only frontend bundle search against actual deployment artifacts.

## Migration Sequence and External Actions

For a new database, repository documentation describes: `001_initial_schema.sql` -> `seed.sql` -> `002_atomic_config_rpc.sql` -> `003_visitor_sandbox_ownership.sql` -> `004_site_limits_and_session_cleanup.sql` -> `005_restrict_anonymous_table_access.sql` -> manually reviewed `verify_002.sql` and `verify_005.sql`. The audit applied **no migration**. For an existing database, first inspect `supabase_migrations.schema_migrations`, current `public.sites` columns and values, and all function signatures/privileges; deployment state is unknown, so do not run or edit deployed schema destructively based on this local checkout.

## Git and Delivery

Branch at start: `phase-3`. Initial Git status contained uncommitted changes and deletions; preserve them. No commit, push, deployment, or live database operation occurred. Final Git status and diff checks are recorded in the task completion message.

## Follow-up: Signed Anonymous Sessions (2026-11-02)

The HTTP ownership gap identified above has been addressed in the current working tree. The backend now issues and verifies HS256 bearer sessions using a backend-only secret, and the site, machine, tariff, optimization, scenario, billing, and run-history HTTP paths enforce the verified subject. The shared demo remains public-read and write-protected. Regression coverage exercises the FastAPI boundary with isolated repositories and deterministic test secrets.

Verification results from this follow-up were separate local runs: backend suite `125 passed`; frontend `tsc --noEmit` passed; frontend production build succeeded; and Playwright `28 passed` with local backend and frontend processes started externally. A later focused backend run reported `39 passed`, and a separate targeted Playwright run reported `3 passed` for machine, tariff, and solar-profile invalidation with the configuration version held constant. These focused results do not represent a rerun of the 125-test backend suite or the 28-test Playwright suite. On this Windows runner, Playwright's automatic `webServer` process teardown leaves descendant server processes running after the test cases finish. The 28-test suite was run with `PLAYWRIGHT_EXTERNAL_SERVERS=1` against explicitly started local test services to obtain a clean exit. This is a local test-runner lifecycle limitation, not evidence of a production deployment issue.

No migration was applied. Existing private rows are accessible only when their `owner_session_id` matches the newly verified server-issued subject; ownership created from unsigned legacy IDs cannot be recovered by the new session. Production environment variables, deployed behavior, effective Supabase policies/grants, and direct database access remain unverified. The deployed frontend origin and signing-secret configuration were not confirmed from repository files.

## Follow-up: Local Cleanup and Storage Regression (2026-11-03)

Focused backend verification was run separately from the full backend suite and the Playwright runs above:

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests/test_visitor_sandbox.py tests/test_storage_modes.py
```

Result: **15 passed**, exit code **0**. This focused run covered cleanup and storage-mode regressions only; it was not a rerun of the 125-test backend suite. No migration or production database verification was performed.

## Follow-up: Supabase Anonymous Table Access Remediation (2026-11-05)

### Vulnerability Identified
In `001_initial_schema.sql`, six Row Level Security policies were defined for the `anon` role with `USING (true)` on `sites`, `machines`, `tariffs`, `solar_profiles`, `base_loads`, and `scenarios`. Because the condition was unconditionally true, any external caller with the public Supabase `anon` API key could directly query PostgREST and read all visitor sandboxes, machine constraints, custom tariffs, and `owner_session_id` session identifiers across sessions.

### Architecture Alignment & Least Privilege Fix
SunSync AI is a three-tier architecture: the frontend browser never communicates directly with Supabase. All database operations are mediated through the FastAPI backend using `SUPABASE_SERVICE_ROLE_KEY` (`service_role`), which enforces visitor session authentication, quota limits, and optimistic concurrency. Direct `anon` access over PostgREST serves no application purpose.

Migration `005_restrict_anonymous_table_access.sql` implements Option A (Least Privilege) with hardened controls:
1. Asserts all 7 application tables exist.
2. Ensures Row Level Security (RLS) is enabled on all tables.
3. Drops all six permissive anonymous SELECT policies.
4. Revokes all table-level privileges from `anon` and `PUBLIC` on all 7 application tables (`sites`, `machines`, `tariffs`, `solar_profiles`, `base_loads`, `optimization_runs`, `scenarios`). Revoking from `PUBLIC` ensures `anon` cannot inherit ambient or default table privileges.
5. Grants narrowed, minimum backend-required table privileges (`SELECT, INSERT, UPDATE, DELETE`) to `service_role` rather than broad `ALL` privileges, omitting administrative capabilities (`TRUNCATE`, `REFERENCES`, `TRIGGER`).
6. Revokes all sequence privileges from `anon` and `PUBLIC` and preserves them for `service_role`.
7. Preserves existing security-definer RPC grants (`save_site_configuration`, `cleanup_expired_visitor_sandboxes`, `create_owned_site_with_limit`) to `service_role`.

### Verification Script (`supabase/verify_005.sql`)
A non-destructive, read-only catalog verification script was added and hardened. It inspects:
- RLS enabled on all 7 application tables (`pg_tables.rowsecurity`).
- Absence of anonymous AND public policies on application tables (`pg_policies` inspecting `roles` for both `'anon'` and `'public'`).
- Absence of table privileges for `anon` (`has_table_privilege('anon', ...)` is `false`).
- Absence of table privileges for `PUBLIC` (`information_schema.role_table_grants`).
- Absence of sequence privileges for `anon` and presence for `service_role` (`has_sequence_privilege`).
- Presence of required table privileges (`SELECT, INSERT, UPDATE, DELETE`) for `service_role` (`has_table_privilege('service_role', ...)` is `true`).
- Execution grants on security-definer RPCs for `service_role`, with execution rejected for `anon` and `PUBLIC`, across canonical functions and compatibility aliases (`save_site_configuration`, `save_site_configuration_atomic`, `save_site_config_atomic`, `cleanup_expired_visitor_sandboxes`, `create_owned_site_with_limit`).

To run verification in Supabase:
Execute `supabase/verify_005.sql` directly in the Supabase SQL Editor. It generates notices reporting pass/fail for each check and raises an exception if any assertion fails. It is read-only and does not modify database data.

### Local Source-Level Regression Coverage & Staging Execution
Focused tests were added in `backend/tests/test_migration_005_security.py`:
- `test_migration_005_drops_all_permissive_anon_policies`: PASSED
- `test_migration_005_revokes_anon_and_public_table_privileges`: PASSED
- `test_migration_005_narrows_service_role_table_and_sequence_privileges`: PASSED
- `test_migration_005_does_not_modify_historical_migrations`: PASSED
- `test_verify_005_script_structure_and_coverage`: PASSED

Result: **5 passed** (exit code **0**).

**Limitations of Static Validation:**
The local tests statically validate SQL structure, regex patterns, and string definitions. Because the local environment does not run an active PostgreSQL database engine or Docker daemon, static tests alone cannot establish live PostgreSQL parser acceptance, PL/pgSQL block execution correctness, or dynamic role catalog resolution.

**Staging Execution Procedure:**
1. In the Supabase dashboard SQL Editor for the target project (or via a staging CI runner with database access), execute `supabase/migrations/005_restrict_anonymous_table_access.sql`.
2. Execute `supabase/verify_005.sql`. Confirm that all sections report `[PASS]` and that the transaction ends cleanly.
3. Perform a negative REST probe: `curl -H "apikey: <ANON_KEY>" https://<project>.supabase.co/rest/v1/sites?select=*` to empirically verify that access is denied or returns an empty set.
4. Execute backend integration smoke tests to verify `service_role` operations continue unhindered.

### Pending External Actions
Migration 005 has not been applied to any live database. Execution against the live Supabase project and effective privilege verification via `verify_005.sql` remain pending until explicitly authorized.
