-- supabase/verify_002.sql
-- Safe verification script for Migration 002 (save_site_configuration RPC)
-- Canonical names verified: column sites.version, function save_site_configuration.
-- Instructions: Run this script directly in the Supabase SQL Editor.
-- It executes within an explicit transaction that ALWAYS rolls back at the end.

BEGIN;

DO $$
DECLARE
    v_site_id UUID;
    v_rpc_result JSONB;
    v_test_machines JSONB;
    v_test_tariff JSONB;
    v_current_version INTEGER;
BEGIN
    RAISE NOTICE '=== 1. Checking schema: sites.version column (canonical; site_version alias removed) ===';
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sites' AND column_name = 'version'
    ) THEN
        RAISE EXCEPTION 'Verification Failed: sites.version column does not exist.';
    END IF;
    RAISE NOTICE 'SUCCESS: sites.version column exists.';

    -- Confirm the redundant alias column was dropped
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sites' AND column_name = 'site_version'
    ) THEN
        RAISE WARNING 'WARN: sites.site_version alias column still exists. Re-run migration 002 to drop it.';
    ELSE
        RAISE NOTICE 'SUCCESS: sites.site_version alias column is absent (clean schema).';
    END IF;

    RAISE NOTICE '=== 2. Checking RPC: save_site_configuration (canonical; aliases removed) ===';
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'save_site_configuration'
    ) THEN
        RAISE EXCEPTION 'Verification Failed: save_site_configuration RPC function does not exist.';
    END IF;
    RAISE NOTICE 'SUCCESS: save_site_configuration RPC function is registered.';

    -- Confirm the old aliases were dropped
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'save_site_configuration_atomic') THEN
        RAISE WARNING 'WARN: save_site_configuration_atomic alias still exists. Re-run migration 002 to drop it.';
    ELSE
        RAISE NOTICE 'SUCCESS: save_site_configuration_atomic alias is absent (clean schema).';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'save_site_config_atomic') THEN
        RAISE WARNING 'WARN: save_site_config_atomic alias still exists. Re-run migration 002 to drop it.';
    ELSE
        RAISE NOTICE 'SUCCESS: save_site_config_atomic alias is absent (clean schema).';
    END IF;

    RAISE NOTICE '=== 3. Testing transactional save execution ===';
    SELECT id, version INTO v_site_id, v_current_version FROM sites LIMIT 1;
    IF v_site_id IS NULL THEN
        INSERT INTO sites (name, location, p_max_grid_kw, solar_capacity_kw)
        VALUES ('Test Verification Factory', 'Peenya, Bengaluru', 25.0, 5.0)
        RETURNING id, version INTO v_site_id, v_current_version;
    END IF;

    v_test_machines := jsonb_build_array(
        jsonb_build_object(
            'id', gen_random_uuid(),
            'name', 'Verification CNC Machine',
            'power_kw', 4.5,
            'duration_intervals', 12,
            'earliest_start', 32,
            'latest_start', 48,
            'deadline_interval', 64,
            'flexible', true
        )
    );

    v_test_tariff := jsonb_build_object(
        'demand_charge_rate_per_kw', 22.5,
        'rates', (SELECT jsonb_agg(7.0) FROM generate_series(1, 96)),
        'notes', 'Test verification tariff'
    );

    v_rpc_result := save_site_configuration(
        v_site_id,
        jsonb_build_object('p_max_grid_kw', 24.0, 'name', 'Updated Verification Factory'),
        v_test_machines,
        v_test_tariff,
        v_current_version
    );

    IF (v_rpc_result->>'status') != 'success' THEN
        RAISE EXCEPTION 'Verification Failed: RPC returned non-success result %', v_rpc_result;
    END IF;
    RAISE NOTICE 'SUCCESS: save_site_configuration executed successfully. Result: %', v_rpc_result;

    RAISE NOTICE '=== 4. Testing optimistic concurrency conflict detection ===';
    BEGIN
        PERFORM save_site_configuration(
            v_site_id,
            jsonb_build_object('p_max_grid_kw', 20.0),
            v_test_machines,
            v_test_tariff,
            v_current_version  -- Stale version!
        );
        RAISE EXCEPTION 'Verification Failed: Stale version was accepted without conflict!';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%version_conflict%' THEN
            RAISE NOTICE 'SUCCESS: Version conflict was caught properly: %', SQLERRM;
        ELSE
            RAISE EXCEPTION 'Verification Failed: Unexpected error: %', SQLERRM;
        END IF;
    END;

    RAISE NOTICE '=== ALL VERIFICATION CHECKS PASSED SUCCESSFULLY ===';
END $$;

-- ALWAYS ROLL BACK so no temporary test changes are written to the database!
ROLLBACK;
