-- Supabase Migration: 001_initial_schema.sql
-- SunSync AI: Industrial Energy & Solar-Aware Machine Scheduling
-- Grid: 96 intervals per day (15-min intervals)

-- Enable UUID extension if available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Sites Table
CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL,
    p_max_grid_kw NUMERIC(10, 2) NOT NULL DEFAULT 25.0,
    solar_capacity_kw NUMERIC(10, 2) NOT NULL DEFAULT 5.0,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    grid_emission_factor_kg_per_kwh NUMERIC(6, 4) NOT NULL DEFAULT 0.8200, -- Central Electricity Authority India avg
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Machines Table
CREATE TABLE IF NOT EXISTS machines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    power_kw NUMERIC(10, 2) NOT NULL CHECK (power_kw >= 0),
    duration_intervals INTEGER NOT NULL CHECK (duration_intervals > 0 AND duration_intervals <= 96),
    earliest_start INTEGER NOT NULL CHECK (earliest_start >= 0 AND earliest_start < 96),
    latest_start INTEGER NOT NULL CHECK (latest_start >= 0 AND latest_start < 96),
    deadline_interval INTEGER NOT NULL CHECK (deadline_interval > 0 AND deadline_interval <= 96),
    flexible BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_earliest_le_latest CHECK (earliest_start <= latest_start),
    CONSTRAINT chk_run_fits_deadline CHECK (earliest_start + duration_intervals <= deadline_interval)
);

-- 3. Tariffs Table
CREATE TABLE IF NOT EXISTS tariffs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    demand_charge_rate_per_kw NUMERIC(10, 2) NOT NULL DEFAULT 15.0, -- Rs / kW peak
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    rates_json JSONB NOT NULL, -- 96 values for 15-minute intervals (Rs/kWh)
    notes TEXT DEFAULT 'Modeled on Karnataka industrial ToD tariff placeholder. Real values must come from official utility tariff order.',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Solar Profiles Table
CREATE TABLE IF NOT EXISTS solar_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    scenario VARCHAR(50) NOT NULL CHECK (scenario IN ('sunny', 'partly_cloudy', 'overcast')),
    peak_kw NUMERIC(10, 2) NOT NULL DEFAULT 5.0,
    generation_json JSONB NOT NULL, -- 96 values of solar kW
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(site_id, scenario)
);

-- 5. Base Load Table
CREATE TABLE IF NOT EXISTS base_loads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL DEFAULT 'Factory Base Load',
    load_json JSONB NOT NULL, -- 96 values of unshiftable base load kW
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Optimization Runs Table
CREATE TABLE IF NOT EXISTS optimization_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    scenario VARCHAR(50) NOT NULL,
    solver_name VARCHAR(100) NOT NULL,
    inputs JSONB NOT NULL,
    results JSONB NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'SUCCESS', 'INFEASIBLE', 'TIMEOUT'
    solver_duration_ms INTEGER NOT NULL,
    verifier_passed BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Scenarios Table
CREATE TABLE IF NOT EXISTS scenarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    config JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes on foreign keys
CREATE INDEX IF NOT EXISTS idx_machines_site_id ON machines(site_id);
CREATE INDEX IF NOT EXISTS idx_tariffs_site_id ON tariffs(site_id);
CREATE INDEX IF NOT EXISTS idx_solar_profiles_site_id ON solar_profiles(site_id);
CREATE INDEX IF NOT EXISTS idx_base_loads_site_id ON base_loads(site_id);
CREATE INDEX IF NOT EXISTS idx_optimization_runs_site_id ON optimization_runs(site_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_site_id ON scenarios(site_id);

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE base_loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE optimization_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;

-- Simple RLS Policies: Service role has full access; anon key cannot modify or access sensitive data.
-- Read policy for anon role on public demo site
CREATE POLICY "Allow anon read demo sites" ON sites FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read demo machines" ON machines FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read demo tariffs" ON tariffs FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read demo solar" ON solar_profiles FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read demo base_loads" ON base_loads FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read demo scenarios" ON scenarios FOR SELECT TO anon USING (true);

-- Disallow write/update/delete for anon
-- Service role key bypasses RLS by default in Supabase/PostgreSQL.
