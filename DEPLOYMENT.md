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
- **Architecture:** Persistent, multi-instance safe PostgreSQL database with row-level security and atomic RPC transactions.
- **Visitor Isolation:** Unauthenticated visitors receive isolated sandboxes (`owner_session_id`) cloned from the shared demo site (`00000000-0000-0000-0000-000000000001`). Direct mutation of the demo site is strictly rejected with `403 Forbidden`.
- **Maintenance:** Run the migration `003_visitor_sandbox_ownership.sql` and schedule periodic invocation of `cleanup_expired_visitor_sandboxes(INTERVAL '24 hours')` to prune stale sandboxes.

---

## 2. Environment Variables Checklist

### Backend Environment Variables
| Variable | Required In | Description |
| :--- | :--- | :--- |
| `STORAGE_MODE` | All | `supabase`, `local_file`, or `memory` (default: `memory` on Vercel) |
| `ALLOWED_ORIGINS` | Production | Comma-separated allowed frontend origins (e.g., `https://sunsync-ai.vercel.app`) |
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
5. (Verification) Run `supabase/verify_002.sql` — Safe self-rolling-back transactional check.
