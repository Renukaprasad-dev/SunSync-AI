-- supabase/verify_005.sql
-- Verification script for Migration 005 (Restrict Anonymous Table Access)
--
-- Objective:
-- Verifies that:
--   1. Row Level Security (RLS) is enabled on all seven application tables.
--   2. No anonymous or public policies remain on any application tables.
--   3. The 'anon' role has zero table-level privileges (SELECT, INSERT, UPDATE, DELETE).
--   4. The pseudo-role 'PUBLIC' retains no table privileges on application tables.
--   5. Any sequences in schema public deny 'anon'; service_role sequence grants are not
--      required when no application-owned sequences exist.
--   6. The 'service_role' has exactly the intended table privileges (SELECT, INSERT, UPDATE, DELETE),
--      and lacks TRUNCATE, REFERENCES, TRIGGER, and MAINTAIN.
--   7. The 'service_role' retains EXECUTE privileges on security-definer RPCs
--      (canonical save_site_configuration, compatibility aliases save_site_configuration_atomic
--      and save_site_config_atomic, cleanup_expired_visitor_sandboxes, and
--      create_owned_site_with_limit), while 'anon' is denied EXECUTE (which also validates
--      that PUBLIC retains no inherited EXECUTE privileges).
--
-- Supabase-Specific Limitations of Local Role Impersonation (SET ROLE anon):
--   1. Role Bypass & Table Ownership: When executing SQL in the Supabase SQL Editor or psql,
--      sessions often run as 'postgres' (the database owner / superuser equivalent).
--      Simple 'SET ROLE anon' in an interactive session can behave differently than PostgREST
--      because table owners bypass RLS unless 'FORCE ROW LEVEL SECURITY' is enabled.
--   2. PostgREST Context & JWT Claims: PostgREST initializes transaction-local GUC settings
--      ('request.jwt.claims', 'request.headers', role switching) per HTTP request.
--      A manual SQL connection lacks this environment.
--   3. Pseudo-Role PUBLIC vs Concrete Roles: PUBLIC is a SQL pseudo-role keyword, not a role in
--      pg_roles. System functions such as has_function_privilege('PUBLIC', ...) fail with
--      "role 'PUBLIC' does not exist". Instead, PostgreSQL's has_function_privilege('anon', ..., 'EXECUTE')
--      must be used, which natively checks effective access including privileges inherited via PUBLIC.
--   Therefore, this verification script inspects PostgreSQL catalogs and system privilege functions
--   (has_table_privilege, has_function_privilege, has_sequence_privilege, aclexplode,
--   pg_tables, pg_policies) for objective, non-destructive, and deterministic verification.
--
-- Instructions: Run this script directly in the Supabase SQL Editor.
-- It is strictly read-only and does not modify any database records or schema.

DO $$
DECLARE
    v_app_tables TEXT[] := ARRAY[
        'sites', 'machines', 'tariffs', 'solar_profiles',
        'base_loads', 'optimization_runs', 'scenarios'
    ];
    v_tbl TEXT;
    v_priv TEXT;
    v_privs TEXT[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
    v_forbidden_service_privs TEXT[] := ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
    v_anon_policy_count INTEGER;
    v_public_grant_count INTEGER;
    v_missing_rls TEXT[];
    v_seq RECORD;
    v_service_role_exists BOOLEAN;
    v_anon_role_exists BOOLEAN;
BEGIN
    RAISE NOTICE '=============================================================';
    RAISE NOTICE ' SunSync AI — Migration 005 Security Verification';
    RAISE NOTICE '=============================================================';

    -- 0. Check required database roles exist
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') INTO v_service_role_exists;
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') INTO v_anon_role_exists;

    IF NOT v_service_role_exists THEN
        RAISE EXCEPTION '[FAIL] Required role service_role does not exist in pg_roles.';
    END IF;
    IF NOT v_anon_role_exists THEN
        RAISE EXCEPTION '[FAIL] Required role anon does not exist in pg_roles.';
    END IF;
    RAISE NOTICE '[PASS] Required Supabase roles (service_role, anon) exist.';

    -- 1. Check Row Level Security (RLS) is enabled on all application tables
    SELECT array_agg(tbl) INTO v_missing_rls
    FROM unnest(v_app_tables) AS tbl
    JOIN pg_tables t ON t.schemaname = 'public' AND t.tablename = tbl
    WHERE t.rowsecurity = false;

    IF v_missing_rls IS NOT NULL AND array_length(v_missing_rls, 1) > 0 THEN
        RAISE EXCEPTION '[FAIL] Row Level Security is DISABLED on tables: %', v_missing_rls;
    END IF;
    RAISE NOTICE '[PASS] Row Level Security is enabled on all 7 application tables.';

    -- 2. Check no anonymous or public policies remain on application tables
    -- Inspects pg_policies.roles: checks for both 'anon' and 'public' (since anon inherits public)
    SELECT COUNT(*) INTO v_anon_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(v_app_tables)
      AND ('anon' = ANY(roles) OR 'public' = ANY(roles));

    IF v_anon_policy_count > 0 THEN
        RAISE EXCEPTION '[FAIL] Found % anonymous/public policy/policies on application tables. Expected 0.', v_anon_policy_count;
    END IF;
    RAISE NOTICE '[PASS] Zero anonymous or public RLS policies exist on application tables.';

    -- 3. Check 'anon' has NO effective table privileges (SELECT, INSERT, UPDATE, DELETE)
    -- In PostgreSQL, has_table_privilege('anon', ...) tests effective privileges,
    -- which automatically includes any privileges inherited through the pseudo-role PUBLIC.
    FOREACH v_tbl IN ARRAY v_app_tables LOOP
        FOREACH v_priv IN ARRAY v_privs LOOP
            IF has_table_privilege('anon', 'public.' || v_tbl, v_priv) THEN
                RAISE EXCEPTION '[FAIL] Role anon retains effective % privilege on public.%', v_priv, v_tbl;
            END IF;
        END LOOP;
    END LOOP;
    RAISE NOTICE '[PASS] Role anon has zero direct or PUBLIC-inherited table privileges (SELECT, INSERT, UPDATE, DELETE) on all 7 tables.';

    -- 4. Check 'PUBLIC' retains NO table privileges on application tables
    -- Inspects PostgreSQL core catalog pg_class.relacl using aclexplode (grantee = 0 represents PUBLIC)
    -- as a reliable, direct catalog check independent of information_schema session-user filtering.
    SELECT COUNT(*) INTO v_public_grant_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
    WHERE n.nspname = 'public'
      AND c.relname = ANY(v_app_tables)
      AND a.grantee = 0
      AND a.privilege_type = ANY(v_privs);

    IF v_public_grant_count > 0 THEN
        RAISE EXCEPTION '[FAIL] Pseudo-role PUBLIC retains % table privilege grant(s) in catalog ACL on application tables.', v_public_grant_count;
    END IF;
    RAISE NOTICE '[PASS] Pseudo-role PUBLIC retains zero table privileges in catalog ACL on application tables.';

    -- 5. Check that anon is denied on any sequences in public. Application sequence grants
    --    are verified explicitly if application-owned sequences are introduced in future migrations.
    FOR v_seq IN (
        SELECT sequence_schema || '.' || sequence_name AS full_seq
        FROM information_schema.sequences
        WHERE sequence_schema = 'public'
    ) LOOP
        IF has_sequence_privilege('anon', v_seq.full_seq, 'USAGE') THEN
            RAISE EXCEPTION '[FAIL] Role anon retains USAGE on sequence %', v_seq.full_seq;
        END IF;
    END LOOP;
    RAISE NOTICE '[PASS] Role anon is denied USAGE on all existing public sequences.';

    -- 6. Check 'service_role' has exactly the intended table privileges.
    FOREACH v_tbl IN ARRAY v_app_tables LOOP
        FOREACH v_priv IN ARRAY v_privs LOOP
            IF NOT has_table_privilege('service_role', 'public.' || v_tbl, v_priv) THEN
                RAISE EXCEPTION '[FAIL] Role service_role is MISSING % privilege on public.%', v_priv, v_tbl;
            END IF;
        END LOOP;
        FOREACH v_priv IN ARRAY v_forbidden_service_privs LOOP
            IF has_table_privilege('service_role', 'public.' || v_tbl, v_priv) THEN
                RAISE EXCEPTION '[FAIL] Role service_role retains forbidden % privilege on public.%', v_priv, v_tbl;
            END IF;
        END LOOP;
    END LOOP;
    RAISE NOTICE '[PASS] Role service_role has exactly the intended table privileges (SELECT, INSERT, UPDATE, DELETE) on all 7 tables.';

    -- 7. Check RPC execute permissions (service_role permitted, anon/PUBLIC denied)
    -- In PostgreSQL, has_function_privilege('anon', ..., 'EXECUTE') tests effective execution access,
    -- which automatically includes any EXECUTE privileges granted to or inherited through PUBLIC.
    -- (Calling has_function_privilege('PUBLIC', ...) is invalid because PUBLIC is a pseudo-role, not a pg_roles entry).
    -- 7a. Check canonical save_site_configuration
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'save_site_configuration') THEN
        IF NOT has_function_privilege('service_role', 'public.save_site_configuration(uuid, jsonb, jsonb, jsonb, integer)', 'EXECUTE') THEN
            RAISE EXCEPTION '[FAIL] service_role cannot execute save_site_configuration';
        END IF;
        IF has_function_privilege('anon', 'public.save_site_configuration(uuid, jsonb, jsonb, jsonb, integer)', 'EXECUTE') THEN
            RAISE EXCEPTION '[FAIL] anon retains effective EXECUTE on save_site_configuration (directly or via PUBLIC)';
        END IF;
        RAISE NOTICE '[PASS] RPC save_site_configuration grants verified (service_role only).';
    END IF;

    -- 7b. Check compatibility alias save_site_configuration_atomic
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'save_site_configuration_atomic') THEN
        IF NOT has_function_privilege('service_role', 'public.save_site_configuration_atomic(uuid, jsonb, jsonb, jsonb, integer)', 'EXECUTE') THEN
            RAISE EXCEPTION '[FAIL] service_role cannot execute save_site_configuration_atomic';
        END IF;
        IF has_function_privilege('anon', 'public.save_site_configuration_atomic(uuid, jsonb, jsonb, jsonb, integer)', 'EXECUTE') THEN
            RAISE EXCEPTION '[FAIL] anon retains effective EXECUTE on save_site_configuration_atomic (directly or via PUBLIC)';
        END IF;
        RAISE NOTICE '[PASS] RPC save_site_configuration_atomic grants verified (service_role only).';
    END IF;

    -- 7c. Check compatibility alias save_site_config_atomic
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'save_site_config_atomic') THEN
        IF NOT has_function_privilege('service_role', 'public.save_site_config_atomic(uuid, jsonb, jsonb, jsonb, integer)', 'EXECUTE') THEN
            RAISE EXCEPTION '[FAIL] service_role cannot execute save_site_config_atomic';
        END IF;
        IF has_function_privilege('anon', 'public.save_site_config_atomic(uuid, jsonb, jsonb, jsonb, integer)', 'EXECUTE') THEN
            RAISE EXCEPTION '[FAIL] anon retains effective EXECUTE on save_site_config_atomic (directly or via PUBLIC)';
        END IF;
        RAISE NOTICE '[PASS] RPC save_site_config_atomic grants verified (service_role only).';
    END IF;

    -- 7d. Check cleanup_expired_visitor_sandboxes
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cleanup_expired_visitor_sandboxes') THEN
        IF NOT has_function_privilege('service_role', 'public.cleanup_expired_visitor_sandboxes(interval)', 'EXECUTE') THEN
            RAISE EXCEPTION '[FAIL] service_role cannot execute cleanup_expired_visitor_sandboxes';
        END IF;
        IF has_function_privilege('anon', 'public.cleanup_expired_visitor_sandboxes(interval)', 'EXECUTE') THEN
            RAISE EXCEPTION '[FAIL] anon retains effective EXECUTE on cleanup_expired_visitor_sandboxes (directly or via PUBLIC)';
        END IF;
        RAISE NOTICE '[PASS] RPC cleanup_expired_visitor_sandboxes grants verified (service_role only).';
    END IF;

    -- 7e. Check create_owned_site_with_limit (from migration 004 if present)
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_owned_site_with_limit') THEN
        IF NOT has_function_privilege('service_role', 'public.create_owned_site_with_limit(jsonb, varchar, integer)', 'EXECUTE') THEN
            RAISE EXCEPTION '[FAIL] service_role cannot execute create_owned_site_with_limit';
        END IF;
        IF has_function_privilege('anon', 'public.create_owned_site_with_limit(jsonb, varchar, integer)', 'EXECUTE') THEN
            RAISE EXCEPTION '[FAIL] anon retains effective EXECUTE on create_owned_site_with_limit (directly or via PUBLIC)';
        END IF;
        RAISE NOTICE '[PASS] RPC create_owned_site_with_limit grants verified (service_role only).';
    END IF;

    RAISE NOTICE '=============================================================';
    RAISE NOTICE ' ALL MIGRATION 005 SECURITY VERIFICATION CHECKS PASSED';
    RAISE NOTICE '=============================================================';
END $$;
