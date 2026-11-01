-- Supabase Migration: 002_atomic_config_rpc.sql
-- Atomic site configuration save with optimistic concurrency control.
-- Canonical names (post phase-3 cleanup):
--   Column:   sites.version     (single source of truth; site_version alias removed)
--   Function: save_site_configuration  (single canonical name; aliases removed)

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Drop the redundant alias column if it was previously added
ALTER TABLE public.sites
    DROP COLUMN IF EXISTS site_version;

CREATE OR REPLACE FUNCTION public.save_site_configuration(
    p_site_id UUID,
    p_site_data JSONB,
    p_machines JSONB,
    p_tariff JSONB,
    p_expected_version INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_current_version INTEGER;
    v_new_version INTEGER;
    v_machine JSONB;
    v_machine_id UUID;
    v_tariff_id UUID;
    v_tariff_count INTEGER;
    v_affected_rows INTEGER;
    v_incoming_machine_ids UUID[] := ARRAY[]::UUID[];
BEGIN
    -- Validate top-level inputs.
    IF p_site_id IS NULL THEN
        RAISE EXCEPTION 'p_site_id is required'
            USING ERRCODE = '22023';
    END IF;

    IF p_site_data IS NULL
       OR jsonb_typeof(p_site_data) <> 'object' THEN
        RAISE EXCEPTION 'p_site_data must be a JSON object'
            USING ERRCODE = '22023';
    END IF;

    IF p_machines IS NULL
       OR jsonb_typeof(p_machines) <> 'array' THEN
        RAISE EXCEPTION 'p_machines must be a JSON array'
            USING ERRCODE = '22023';
    END IF;

    IF p_tariff IS NOT NULL
       AND jsonb_typeof(p_tariff) <> 'object' THEN
        RAISE EXCEPTION 'p_tariff must be a JSON object or null'
            USING ERRCODE = '22023';
    END IF;

    -- Lock the site row to serialize saves and protect version checks.
    SELECT s.version
      INTO v_current_version
      FROM public.sites AS s
     WHERE s.id = p_site_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Site % not found', p_site_id
            USING ERRCODE = 'P0002';
    END IF;

    IF p_expected_version IS NOT NULL
       AND v_current_version <> p_expected_version THEN
        RAISE EXCEPTION
            'version_conflict: current version is %, expected %',
            v_current_version, p_expected_version
            USING ERRCODE = 'P0001';
    END IF;

    v_new_version := v_current_version + 1;

    -- Update all supported site configuration fields.
    UPDATE public.sites
       SET p_max_grid_kw = COALESCE(
               (p_site_data->>'p_max_grid_kw')::NUMERIC,
               p_max_grid_kw
           ),
           solar_capacity_kw = COALESCE(
               (p_site_data->>'solar_capacity_kw')::NUMERIC,
               solar_capacity_kw
           ),
           currency = COALESCE(
               p_site_data->>'currency',
               currency
           ),
           grid_emission_factor_kg_per_kwh = COALESCE(
               (p_site_data->>'grid_emission_factor_kg_per_kwh')::NUMERIC,
               grid_emission_factor_kg_per_kwh
           ),
           name = COALESCE(p_site_data->>'name', name),
           location = COALESCE(p_site_data->>'location', location),
           version = v_new_version,
           updated_at = NOW()
     WHERE id = p_site_id;

    -- Create or update the site's tariff.
    IF p_tariff IS NOT NULL THEN
        IF NOT (p_tariff ? 'rates')
           OR jsonb_typeof(p_tariff->'rates') <> 'array' THEN
            RAISE EXCEPTION 'Tariff rates must be a JSON array'
                USING ERRCODE = '22023';
        END IF;

        IF jsonb_array_length(p_tariff->'rates') <> 96 THEN
            RAISE EXCEPTION 'Tariff rates must contain exactly 96 entries'
                USING ERRCODE = '22023';
        END IF;

        SELECT COUNT(*), (ARRAY_AGG(t.id))[1]
          INTO v_tariff_count, v_tariff_id
          FROM public.tariffs AS t
         WHERE t.site_id = p_site_id;

        IF v_tariff_count > 1 THEN
            RAISE EXCEPTION
                'Multiple tariff records exist for site %; resolve them before saving',
                p_site_id
                USING ERRCODE = '21000';
        END IF;

        IF v_tariff_count = 1 THEN
            UPDATE public.tariffs
               SET demand_charge_rate_per_kw = COALESCE(
                       (p_tariff->>'demand_charge_rate_per_kw')::NUMERIC,
                       demand_charge_rate_per_kw
                   ),
                   currency = COALESCE(
                       p_tariff->>'currency',
                       currency
                   ),
                   rates_json = p_tariff->'rates',
                   notes = CASE
                       WHEN p_tariff ? 'notes'
                           THEN p_tariff->>'notes'
                       ELSE notes
                   END,
                   updated_at = NOW()
             WHERE id = v_tariff_id;
        ELSE
            INSERT INTO public.tariffs (
                 site_id,
                 name,
                 demand_charge_rate_per_kw,
                 currency,
                 rates_json,
                 notes,
                 updated_at
            )
            VALUES (
                p_site_id,
                'Configured Industrial Tariff',
                COALESCE(
                    (p_tariff->>'demand_charge_rate_per_kw')::NUMERIC,
                    15.0
                ),
                COALESCE(p_tariff->>'currency', 'INR'),
                p_tariff->'rates',
                p_tariff->>'notes',
                NOW()
            );
        END IF;
    END IF;

    -- Validate and upsert the submitted machines.
    FOR v_machine IN
        SELECT value
          FROM jsonb_array_elements(p_machines)
    LOOP
        IF NOT (v_machine ? 'id')
           OR NULLIF(v_machine->>'id', '') IS NULL THEN
            RAISE EXCEPTION 'Every machine must have an id'
                USING ERRCODE = '22023';
        END IF;

        BEGIN
            v_machine_id := (v_machine->>'id')::UUID;
        EXCEPTION
            WHEN invalid_text_representation THEN
                RAISE EXCEPTION 'Invalid machine UUID: %',
                    v_machine->>'id'
                    USING ERRCODE = '22023';
        END;

        IF v_machine_id = ANY(v_incoming_machine_ids) THEN
            RAISE EXCEPTION 'Duplicate machine id % in request',
                v_machine_id
                USING ERRCODE = '22023';
        END IF;

        v_incoming_machine_ids := ARRAY_APPEND(
            v_incoming_machine_ids,
            v_machine_id
        );

        -- Do not permit a machine owned by another site to be modified.
        IF EXISTS (
            SELECT 1
              FROM public.machines AS m
             WHERE m.id = v_machine_id
               AND m.site_id <> p_site_id
        ) THEN
            RAISE EXCEPTION 'Machine % belongs to another site',
                v_machine_id
                USING ERRCODE = '42501';
        END IF;

        INSERT INTO public.machines (
            id,
            site_id,
            name,
            power_kw,
            duration_intervals,
            earliest_start,
            latest_start,
            deadline_interval,
            flexible,
            updated_at
        )
        VALUES (
            v_machine_id,
            p_site_id,
            v_machine->>'name',
            (v_machine->>'power_kw')::NUMERIC,
            (v_machine->>'duration_intervals')::INTEGER,
            (v_machine->>'earliest_start')::INTEGER,
            (v_machine->>'latest_start')::INTEGER,
            (v_machine->>'deadline_interval')::INTEGER,
            COALESCE((v_machine->>'flexible')::BOOLEAN, TRUE),
            NOW()
        )
        ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               power_kw = EXCLUDED.power_kw,
               duration_intervals = EXCLUDED.duration_intervals,
               earliest_start = EXCLUDED.earliest_start,
               latest_start = EXCLUDED.latest_start,
               deadline_interval = EXCLUDED.deadline_interval,
               flexible = EXCLUDED.flexible,
               updated_at = NOW()
         WHERE public.machines.site_id = p_site_id;

        GET DIAGNOSTICS v_affected_rows = ROW_COUNT;

        IF v_affected_rows = 0 THEN
            RAISE EXCEPTION
                'Machine % could not be saved for site %',
                v_machine_id, p_site_id
                USING ERRCODE = '42501';
        END IF;
    END LOOP;

    -- Remove machines omitted from the submitted configuration.
    DELETE FROM public.machines AS m
     WHERE m.site_id = p_site_id
       AND NOT (m.id = ANY(v_incoming_machine_ids));

    RETURN jsonb_build_object(
        'status', 'success',
        'site_id', p_site_id,
        'version', v_new_version
    );
END;
$$;

-- Restrict RPC execution to the backend service role only.
REVOKE ALL ON FUNCTION
    public.save_site_configuration(UUID, JSONB, JSONB, JSONB, INTEGER)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.save_site_configuration(UUID, JSONB, JSONB, JSONB, INTEGER)
    TO service_role;

-- Drop the previously created aliases (no longer needed; nothing is deployed).
DROP FUNCTION IF EXISTS public.save_site_configuration_atomic(UUID, JSONB, JSONB, JSONB, INTEGER);
DROP FUNCTION IF EXISTS public.save_site_config_atomic(UUID, JSONB, JSONB, JSONB, INTEGER);
