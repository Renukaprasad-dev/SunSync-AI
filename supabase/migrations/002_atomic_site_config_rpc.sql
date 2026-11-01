-- Supabase Migration: 002_atomic_site_config_rpc.sql
-- Additive & Idempotent migration for atomic site configuration save with optimistic concurrency control.

-- 1. Add version column to sites table if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sites' AND column_name = 'version'
    ) THEN
        ALTER TABLE sites ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
    END IF;
END $$;

-- 2. Transactional RPC for atomic multi-entity site configuration save
CREATE OR REPLACE FUNCTION save_site_configuration(
    p_site_id UUID,
    p_site_data JSONB,
    p_machines JSONB,
    p_tariff JSONB,
    p_expected_version INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_version INTEGER;
    v_new_version INTEGER;
    v_machine JSONB;
    v_incoming_machine_ids UUID[] := ARRAY[]::UUID[];
BEGIN
    -- 1. Lock the site row and check version for optimistic concurrency
    SELECT version INTO v_current_version 
    FROM sites 
    WHERE id = p_site_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Site % not found', p_site_id USING ERRCODE = 'P0002';
    END IF;

    IF p_expected_version IS NOT NULL AND v_current_version != p_expected_version THEN
        RAISE EXCEPTION 'version_conflict: current version is %, expected %', v_current_version, p_expected_version
            USING ERRCODE = 'P0001';
    END IF;

    v_new_version := v_current_version + 1;

    -- 2. Update site parameters
    UPDATE sites
    SET p_max_grid_kw = COALESCE((p_site_data->>'p_max_grid_kw')::NUMERIC, p_max_grid_kw),
        name = COALESCE(p_site_data->>'name', name),
        location = COALESCE(p_site_data->>'location', location),
        version = v_new_version,
        updated_at = NOW()
    WHERE id = p_site_id;

    -- 3. Update tariff
    IF p_tariff IS NOT NULL THEN
        UPDATE tariffs
        SET demand_charge_rate_per_kw = COALESCE((p_tariff->>'demand_charge_rate_per_kw')::NUMERIC, demand_charge_rate_per_kw),
            rates_json = COALESCE(p_tariff->'rates', rates_json),
            notes = COALESCE(p_tariff->>'notes', notes),
            updated_at = NOW()
        WHERE site_id = p_site_id;
    END IF;

    -- 4. Sync machines: delete removed machines and upsert incoming machines
    FOR v_machine IN SELECT * FROM jsonb_array_elements(p_machines)
    LOOP
        v_incoming_machine_ids := array_append(v_incoming_machine_ids, (v_machine->>'id')::UUID);

        INSERT INTO machines (
            id, site_id, name, power_kw, duration_intervals, earliest_start, 
            latest_start, deadline_interval, flexible, updated_at
        ) VALUES (
            (v_machine->>'id')::UUID,
            p_site_id,
            v_machine->>'name',
            (v_machine->>'power_kw')::NUMERIC,
            (v_machine->>'duration_intervals')::INTEGER,
            (v_machine->>'earliest_start')::INTEGER,
            (v_machine->>'latest_start')::INTEGER,
            (v_machine->>'deadline_interval')::INTEGER,
            COALESCE((v_machine->>'flexible')::BOOLEAN, true),
            NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            power_kw = EXCLUDED.power_kw,
            duration_intervals = EXCLUDED.duration_intervals,
            earliest_start = EXCLUDED.earliest_start,
            latest_start = EXCLUDED.latest_start,
            deadline_interval = EXCLUDED.deadline_interval,
            flexible = EXCLUDED.flexible,
            updated_at = NOW();
    END LOOP;

    -- Delete any machines for this site not in the incoming list
    DELETE FROM machines
    WHERE site_id = p_site_id
      AND id != ALL(v_incoming_machine_ids);

    RETURN jsonb_build_object(
        'status', 'success',
        'site_id', p_site_id,
        'version', v_new_version
    );
END;
$$;
