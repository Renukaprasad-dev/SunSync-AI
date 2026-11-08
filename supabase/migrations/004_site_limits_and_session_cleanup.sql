-- Atomic per-session site creation and cleanup retention aligned with the
-- maximum supported signed-session lifetime (30 days) plus a one-day grace.

CREATE OR REPLACE FUNCTION public.create_owned_site_with_limit(
    p_site_data JSONB,
    p_owner_session_id VARCHAR,
    p_max_sites INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_site_count BIGINT;
    v_created_site public.sites%ROWTYPE;
    v_site_data JSONB;
BEGIN
    IF p_owner_session_id IS NULL OR length(p_owner_session_id) = 0 OR p_max_sites < 1 THEN
        RAISE EXCEPTION 'Invalid site creation parameters' USING ERRCODE = '22023';
    END IF;

    IF p_site_data->>'owner_session_id' IS DISTINCT FROM p_owner_session_id THEN
        RAISE EXCEPTION 'Site owner does not match request owner' USING ERRCODE = '42501';
    END IF;
    IF p_site_data->>'id' IS NULL THEN
        RAISE EXCEPTION 'Site ID is required' USING ERRCODE = '22023';
    END IF;

    -- jsonb_populate_record supplies NULL for omitted columns, so explicitly
    -- preserve site defaults and replace caller timestamps with database time.
    v_site_data := p_site_data || jsonb_build_object(
        'p_max_grid_kw', COALESCE(p_site_data->'p_max_grid_kw', '25'::JSONB),
        'solar_capacity_kw', COALESCE(p_site_data->'solar_capacity_kw', '5'::JSONB),
        'currency', COALESCE(p_site_data->'currency', '"INR"'::JSONB),
        'grid_emission_factor_kg_per_kwh', COALESCE(p_site_data->'grid_emission_factor_kg_per_kwh', '0.8200'::JSONB),
        'created_at', to_jsonb(NOW()),
        'updated_at', to_jsonb(NOW()),
        'version', COALESCE(p_site_data->'version', '1'::JSONB),
        'site_version', COALESCE(p_site_data->'site_version', '1'::JSONB)
    );

    -- Serialize count-and-insert for this session across all backend instances.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_session_id, 0));

    SELECT COUNT(*)
      INTO v_site_count
      FROM public.sites
     WHERE owner_session_id = p_owner_session_id;

    IF v_site_count >= p_max_sites THEN
        RETURN jsonb_build_object('limit_reached', true);
    END IF;

    INSERT INTO public.sites
    SELECT (jsonb_populate_record(NULL::public.sites, v_site_data)).*
    RETURNING * INTO v_created_site;

    RETURN jsonb_build_object(
        'limit_reached', false,
        'site', to_jsonb(v_created_site)
    );
END;
$$;

REVOKE ALL ON FUNCTION
    public.create_owned_site_with_limit(JSONB, VARCHAR, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.create_owned_site_with_limit(JSONB, VARCHAR, INTEGER)
    TO service_role;

-- SQL cannot inspect signed bearer tokens. Retain sites for at least the
-- maximum token lifetime plus one day, and let successful session renewal
-- refresh updated_at. Callers may request a longer retention interval.
CREATE OR REPLACE FUNCTION public.cleanup_expired_visitor_sandboxes(
    p_max_age_interval INTERVAL DEFAULT INTERVAL '31 days'
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
       AND updated_at < (NOW() - GREATEST(p_max_age_interval, INTERVAL '31 days'));

    GET DIAGNOSTICS v_purged = ROW_COUNT;
    RETURN v_purged;
END;
$$;

REVOKE ALL ON FUNCTION
    public.cleanup_expired_visitor_sandboxes(INTERVAL)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.cleanup_expired_visitor_sandboxes(INTERVAL)
    TO service_role;
