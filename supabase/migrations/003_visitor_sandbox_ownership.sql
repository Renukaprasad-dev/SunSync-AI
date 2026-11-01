-- Supabase Migration: 003_visitor_sandbox_ownership.sql
-- Additive migration for visitor sandbox scoping, session ownership, and TTL cleanup.

-- 1. Add owner_session_id column to sites
ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS owner_session_id VARCHAR(64) DEFAULT NULL;

-- 2. Create index on owner_session_id for efficient visitor-scoped lookups
CREATE INDEX IF NOT EXISTS idx_sites_owner_session_id
    ON public.sites (owner_session_id);

-- 3. Procedure to prune expired visitor sandboxes older than TTL (default 24 hours)
-- CRITICAL SAFETY: Never prunes demo site (id = '00000000-0000-0000-0000-000000000001' or owner_session_id IS NULL).
CREATE OR REPLACE FUNCTION public.cleanup_expired_visitor_sandboxes(
    p_max_age_interval INTERVAL DEFAULT INTERVAL '24 hours'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_purged INTEGER;
BEGIN
    DELETE FROM public.sites
     WHERE owner_session_id IS NOT NULL
       AND id <> '00000000-0000-0000-0000-000000000001'::UUID
       AND updated_at < (NOW() - p_max_age_interval);

    GET DIAGNOSTICS v_purged = ROW_COUNT;
    RETURN v_purged;
END;
$$;

-- Restrict RPC execution to the backend service role
REVOKE ALL ON FUNCTION
    public.cleanup_expired_visitor_sandboxes(INTERVAL)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.cleanup_expired_visitor_sandboxes(INTERVAL)
    TO service_role;
