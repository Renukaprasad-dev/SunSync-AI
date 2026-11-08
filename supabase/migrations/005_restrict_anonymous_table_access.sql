-- Supabase Migration: 005_restrict_anonymous_table_access.sql
-- Description: Restrict direct database table access for 'anon' and 'PUBLIC' roles (Option A: Least Privilege).
--
-- Security Rationale:
-- In migration 001_initial_schema.sql, six SELECT policies were created for the 'anon' role with USING (true):
--   "Allow anon read demo sites", "Allow anon read demo machines", "Allow anon read demo tariffs",
--   "Allow anon read demo solar", "Allow anon read demo base_loads", "Allow anon read demo scenarios".
-- Because the predicate was unconditionally true, any caller using the public Supabase anon key over PostgREST
-- could read not only demo records but ALL visitor sandbox sites, machine constraints, custom tariffs,
-- and owner_session_id session identifiers.
--
-- Architecture alignment:
-- SunSync AI is a three-tier application (Browser -> FastAPI -> Supabase).
-- The frontend never interacts with Supabase directly. All database operations are performed
-- exclusively by the FastAPI backend using SUPABASE_SERVICE_ROLE_KEY ('service_role' role),
-- which enforces visitor session ownership, quota limits, and optimistic concurrency at the application layer.
-- Therefore, granting direct table access to 'anon' and 'PUBLIC' over PostgREST is unnecessary and violates
-- the principle of least privilege.
--
-- This migration:
-- 1. Validates that the expected application tables exist.
-- 2. Ensures Row Level Security (RLS) is enabled on all seven application tables.
-- 3. Drops the six overly permissive 'anon' SELECT policies.
-- 4. Revokes all table-level privileges from 'anon' and 'PUBLIC' on all seven application tables.
--    (In PostgreSQL, revoking from 'anon' alone does not prevent access if privileges are inherited via 'PUBLIC').
-- 5. Grants the narrowed, minimum backend-required table privileges (SELECT, INSERT, UPDATE, DELETE)
--    to 'service_role' rather than broad ALL privileges.
-- 6. Revokes sequence privileges from 'anon' and 'PUBLIC'. Application sequence grants must be
--    added explicitly if sequences are introduced by future migrations.
-- 7. Preserves existing security-definer RPC grants (save_site_configuration, cleanup_expired_visitor_sandboxes,
--    create_owned_site_with_limit) to 'service_role'.
-- 8. Leaves 'authenticated' unchanged.

-- 1. Pre-execution schema assertion: Verify all seven expected application tables exist.
DO $$
DECLARE
    v_missing_tables TEXT[];
BEGIN
    SELECT array_agg(tbl) INTO v_missing_tables
    FROM (
        SELECT unnest(ARRAY[
            'sites', 'machines', 'tariffs', 'solar_profiles',
            'base_loads', 'optimization_runs', 'scenarios'
        ]) AS tbl
    ) t
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = t.tbl
    );

    IF v_missing_tables IS NOT NULL AND array_length(v_missing_tables, 1) > 0 THEN
        RAISE EXCEPTION 'Schema assertion failed: expected application tables missing: %', v_missing_tables
            USING ERRCODE = 'P0002';
    END IF;
END $$;

-- 2. Ensure Row Level Security (RLS) remains enabled on all application tables.
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.base_loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.optimization_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;

-- 3. Drop the six overly permissive anonymous SELECT policies.
DROP POLICY IF EXISTS "Allow anon read demo sites" ON public.sites;
DROP POLICY IF EXISTS "Allow anon read demo machines" ON public.machines;
DROP POLICY IF EXISTS "Allow anon read demo tariffs" ON public.tariffs;
DROP POLICY IF EXISTS "Allow anon read demo solar" ON public.solar_profiles;
DROP POLICY IF EXISTS "Allow anon read demo base_loads" ON public.base_loads;
DROP POLICY IF EXISTS "Allow anon read demo scenarios" ON public.scenarios;

-- 4. Revoke unnecessary direct table privileges from 'anon' and 'PUBLIC'.
-- Revoking from both 'anon' and pseudo-role 'PUBLIC' guarantees that anon cannot
-- inherit default or ambient table privileges.
REVOKE ALL ON TABLE public.sites FROM anon, public;
REVOKE ALL ON TABLE public.machines FROM anon, public;
REVOKE ALL ON TABLE public.tariffs FROM anon, public;
REVOKE ALL ON TABLE public.solar_profiles FROM anon, public;
REVOKE ALL ON TABLE public.base_loads FROM anon, public;
REVOKE ALL ON TABLE public.optimization_runs FROM anon, public;
REVOKE ALL ON TABLE public.scenarios FROM anon, public;

-- 5. Clear all existing table privileges from 'service_role' before granting the minimum required set.
REVOKE ALL ON TABLE public.sites FROM service_role;
REVOKE ALL ON TABLE public.machines FROM service_role;
REVOKE ALL ON TABLE public.tariffs FROM service_role;
REVOKE ALL ON TABLE public.solar_profiles FROM service_role;
REVOKE ALL ON TABLE public.base_loads FROM service_role;
REVOKE ALL ON TABLE public.optimization_runs FROM service_role;
REVOKE ALL ON TABLE public.scenarios FROM service_role;

-- 6. Grant minimum backend-required table privileges to 'service_role' (Least Privilege).
-- The backend uses SUPABASE_SERVICE_ROLE_KEY to perform SELECT, INSERT, UPDATE, DELETE on these tables.
-- Administrative table privileges (TRUNCATE, REFERENCES, TRIGGER) are omitted.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sites TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.machines TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tariffs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.solar_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.base_loads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.optimization_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scenarios TO service_role;

-- 7. Sequence privileges: Revoke from anon/public. No application sequences currently exist.
-- Add explicit grants for any application-owned sequences introduced by future migrations.
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, public;
