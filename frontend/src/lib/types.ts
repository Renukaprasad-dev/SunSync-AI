export interface Site {
  id: string;
  name: string;
  location?: string;
  p_max_grid_kw: number;
  solar_capacity_kw?: number;
  currency?: string;
  grid_emission_factor_kg_per_kwh?: number;
  storage_mode?: string;
  durable?: boolean;
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  intervals_per_day: number;
  interval_minutes: number;
  storage_mode: string;
  durable: boolean;
  supabase_configured: boolean;
}

export interface SiteUpdate {
  name?: string;
  location?: string;
  p_max_grid_kw?: number;
  solar_capacity_kw?: number;
  currency?: string;
  grid_emission_factor_kg_per_kwh?: number;
}

export interface Machine {
  id: string;
  name: string;
  power_kw: number;
  duration_intervals: number;
  earliest_start: number;
  latest_start: number;
  deadline_interval: number;
  flexible: boolean;
}

export interface Tariff {
  rates: number[];
  demand_charge_rate_per_kw: number;
  currency: string;
  notes?: string;
}

export interface SolarProfile {
  scenario: string;
  generation: number[];
  capacity_kw: number;
}

export interface MachineScheduleResult {
  machine_id: string;
  machine_name: string;
  start_slot: number;
  end_slot: number;
  start_time_str: string;
  end_time_str: string;
  power_kw: number;
  duration_hours: number;
  energy_kwh: number;
  flexible: boolean;
  reason?: string;
}

export interface StrategyKPIs {
  daily_cost_rs: number;
  peak_grid_demand_kw: number;
  solar_energy_used_kwh: number;
  grid_energy_imported_kwh: number;
  total_factory_energy_kwh: number;
  solar_self_consumption_pct: number;
  solar_coverage_pct: number;
  deadline_violations: number;
  estimated_co2_kg: number;
}

export interface StrategySchedule {
  strategy_name: string;
  display_title: string;
  status: string;
  solver_duration_ms: number;
  machine_schedules: MachineScheduleResult[];
  load_profile: number[];
  grid_profile: number[];
  solar_profile: number[];
  solar_used_profile: number[];
  kpis: StrategyKPIs;
  reasons: string[];
  verifier_passed: boolean;
  verifier_notes?: string;
}

export interface OptimizationResponse {
  site_id?: string;
  scenario: string;
  timestamp: string;
  disclaimer: string;
  strategies: {
    baseline?: StrategySchedule;
    solar_aware?: StrategySchedule;
    cost_optimized?: StrategySchedule;
    [key: string]: StrategySchedule | undefined;
  };
  machine_reasons: Record<string, string>;
  infeasibility_diagnosis?: string;
}

export interface ForecastResponse {
  scenario: string;
  solar_forecast: number[];
  load_forecast: number[];
  weather?: {
    cloud_cover: number[];
    temperature_c: number[];
  };
  metrics: {
    solar_mae_kw: number;
    solar_rmse_kw: number;
    load_mae_kw: number;
    load_rmse_kw: number;
  };
}
