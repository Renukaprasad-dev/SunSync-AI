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

export interface SiteConfigPayload {
  site: SiteUpdate;
  machines: Machine[];
  tariff: Tariff;
  expected_version?: number;
}

export interface SiteConfigResponse {
  site: Site;
  machines: Machine[];
  tariff: Tariff;
  version: number;
  storage_mode: string;
  durable: boolean;
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
  run_id?: string;
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

export interface OptimizationRunSummary {
  id: string;
  site_id: string;
  scenario: string;
  solver_name: string;
  status: string;
  solver_duration_ms: number;
  verifier_passed: boolean;
  created_at: string;
  summary: {
    baseline_cost: number;
    optimized_cost: number;
    savings_pct: number;
    baseline_peak_kw: number;
    optimized_peak_kw: number;
    deadline_violations: number;
  };
}

export interface OptimizationRunDetail extends OptimizationRunSummary {
  inputs: Record<string, any>;
  results: OptimizationResponse;
}

export interface BillComparisonMetric {
  real: number;
  model_baseline: number;
  gap: number;
  gap_pct: number;
}

export interface BillRealityCheckRequest {
  site_id?: string;
  operating_days: number;
  real_energy_kwh: number;
  real_energy_charge_rs: number;
  real_demand_kw: number;
  real_demand_charge_rs: number;
}

export interface BillRealityCheckResponse {
  operating_days: number;
  real_total_bill_rs: number;
  model_baseline_total_bill_rs: number;
  total_bill_gap_rs: number;
  total_bill_gap_pct: number;
  metrics: Record<string, BillComparisonMetric>;
  likely_causes: string[];
  sanity_status: string;
  disclaimer: string;
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
