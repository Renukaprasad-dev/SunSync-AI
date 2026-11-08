# SunSync AI — Backend Service Architecture & Runtime Modes

FastAPI-based industrial solar-aware machine scheduling decision support engine.

## Storage & Runtime Modes

SunSync AI supports three operational storage modes configured via the `STORAGE_MODE` environment variable:

| Mode | Target Environment | Persistence Guarantee | Multi-Instance Concurrency |
| :--- | :--- | :--- | :--- |
| `supabase` | Production / Deployed Demo | Full ACID PostgreSQL | Safe via row-level locks & atomic RPC (`save_site_configuration`) |
| `local_file` | Local Development | File-backed (`backend/local_store.json`) | Single-machine developer workstation |
| `memory` | Transient Testing / Preview | Ephemeral in-memory dicts | **Per-Instance Only** (resets on serverless recycle) |

### Honest Serverless Limitations (Vercel / AWS Lambda)

1. **Memory Mode (`STORAGE_MODE=memory`):**
   - In serverless environments like Vercel, each request may execute on a separate, isolated container or microVM instance.
   - Any state saved in memory (such as modified machine constraints or tariffs) can disappear or reset on subsequent requests even within the same user session.
   - **/health** and the frontend notification banner explicitly signal: `"changes may reset at any time"`.
   - **Recommendation:** Memory mode is strictly suitable for ephemeral test runs or single-request demonstrations. Any public production deployment MUST use Supabase.

2. **In-Memory Rate Limiter (`RateLimiter`):**
   - The token-bucket rate limiter (`RateLimiter`) in `backend/app/core/security.py` operates in process memory.
   - On serverless architectures, rate limits are enforced per-container rather than globally across the entire serverless fleet.
   - For global DDoS protection, rely on edge infrastructure (e.g. Cloudflare or Vercel Edge Firewall).

3. **Supabase Mode (`STORAGE_MODE=supabase`):**
   - Fully persistent and safe across multiple concurrent serverless instances.
   - Concurrency is managed via optimistic locking (`version` column with atomic RPC `save_site_configuration`).
   - HTTP routes use signed, expiring bearer sessions and authorize private site data against the verified subject and `owner_session_id`. The shared demo can be read publicly but cannot be changed through the API. Existing rows with ownership that cannot be proven are inaccessible to newly issued sessions.

## CORS Policy

- **Development:** Dynamically resolves loopback origins (`http://localhost:3000`, `http://127.0.0.1:3000`, `http://[::1]:3000`).
- **Production:** Configured strictly via `ALLOWED_ORIGINS` (comma-separated origins).
- Vercel requires an explicit non-wildcard `ALLOWED_ORIGINS` value. Bearer authentication uses the `Authorization` header; cookie credentials are disabled.
- Configure `SESSION_SIGNING_SECRET` as a backend-only secret containing at least 32 random bytes (e.g. generate via `python -c "import secrets; print(secrets.token_hex(32))"` or `openssl rand -hex 32`). Missing or weak signing configuration disables session issuance and protected session use with HTTP 503.
- `SITE_CREATION_LIMIT_PER_SESSION` defaults to `3` owned sites, including the initial visitor workspace. Set it to an integer from `1` to `100`. Creating beyond the limit returns HTTP `429`; existing sites remain usable. Supabase requires migration `004_site_limits_and_session_cleanup.sql`, whose transaction-scoped advisory lock serializes each session's site count and insert across instances. Local memory/file modes serialize within one repository process only; sharing a local JSON store across processes is not concurrency-safe.
- Cleanup cannot validate bearer tokens because token claims are not stored in SQL. Migration `004_site_limits_and_session_cleanup.sql` therefore enforces a minimum 31-day age (the maximum supported token TTL plus one day), even when a shorter interval is passed. Successful session renewal refreshes `updated_at`; configure token TTL no higher than the 30-day validation limit. No cleanup schedule is installed by this change.
- **Outermost Middleware:** `CORSMiddleware` is configured as the outermost Starlette middleware to guarantee that all error responses (404, 413, 422, 429, 500) always carry valid `Access-Control-Allow-Origin` headers for allowed origins.
