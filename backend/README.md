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
   - Visitor sessions write to private sandbox clones; sandboxes older than 24 hours can be pruned via `cleanup_expired_visitor_sandboxes()`, preserving the shared demo site (`00000000-0000-0000-0000-000000000001`).

## CORS Policy

- **Development:** Dynamically resolves loopback origins (`http://localhost:3000`, `http://127.0.0.1:3000`, `http://[::1]:3000`).
- **Production:** Configured strictly via `ALLOWED_ORIGINS` (comma-separated origins).
- **Outermost Middleware:** `CORSMiddleware` is configured as the outermost Starlette middleware to guarantee that all error responses (404, 413, 422, 429, 500) always carry valid `Access-Control-Allow-Origin` headers for allowed origins.
