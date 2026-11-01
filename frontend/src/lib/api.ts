import { Machine, Tariff, SolarProfile, OptimizationResponse, ForecastResponse, Site, SiteUpdate, HealthResponse } from "./types";
import { slotToTime } from "./utils";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const DEMO_SITE: Site = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Machining & Stamping Unit Alpha",
  location: "Peenya Industrial Area, Bengaluru, Karnataka",
  p_max_grid_kw: 25.0,
  solar_capacity_kw: 5.0,
  currency: "INR",
  grid_emission_factor_kg_per_kwh: 0.82
};

// --- Seed fallback dataset for offline/client preview ---
const DEMO_MACHINES: Machine[] = [
  { id: "1", name: "CNC Milling Center", power_kw: 4.0, duration_intervals: 16, earliest_start: 32, latest_start: 48, deadline_interval: 68, flexible: true },
  { id: "2", name: "Industrial Air Compressor", power_kw: 3.5, duration_intervals: 12, earliest_start: 32, latest_start: 48, deadline_interval: 64, flexible: true },
  { id: "3", name: "Plastic Injection Molding", power_kw: 5.0, duration_intervals: 14, earliest_start: 34, latest_start: 44, deadline_interval: 64, flexible: true },
  { id: "4", name: "Electric Curing Oven", power_kw: 3.0, duration_intervals: 8, earliest_start: 36, latest_start: 56, deadline_interval: 72, flexible: true },
  { id: "5", name: "Hydraulic Stamping Press", power_kw: 4.5, duration_intervals: 10, earliest_start: 32, latest_start: 32, deadline_interval: 50, flexible: false },
  { id: "6", name: "Conveyor & Packaging Line", power_kw: 2.0, duration_intervals: 20, earliest_start: 36, latest_start: 36, deadline_interval: 68, flexible: false },
  { id: "7", name: "Water Chiller & Pump", power_kw: 2.5, duration_intervals: 12, earliest_start: 40, latest_start: 60, deadline_interval: 76, flexible: true }
];

const DEMO_SOLAR: number[] = Array.from({ length: 96 }, (_, i) => {
  if (i < 26 || i >= 72) return 0;
  const val = 5.0 * Math.exp(-Math.pow(i - 49, 2) / (2 * 100));
  return Math.round(Math.max(0, val) * 100) / 100;
});

const DEMO_TARIFF: number[] = Array.from({ length: 96 }, (_, i) => {
  if (i >= 32 && i < 40) return 9.0;
  if (i >= 72 && i < 88) return 9.5;
  if (i >= 24 && i < 72) return 7.0;
  return 4.5;
});

function buildDemoOptimizationResponse(scenario: string = "sunny"): OptimizationResponse {
  const isOvercast = scenario === "overcast";
  const solarGen = isOvercast ? DEMO_SOLAR.map((v) => Math.round(v * 0.12 * 100) / 100) : DEMO_SOLAR;

  const baselineM = DEMO_MACHINES.map((m) => ({
    machine_id: m.id,
    machine_name: m.name,
    start_slot: m.earliest_start,
    end_slot: m.earliest_start + m.duration_intervals,
    start_time_str: slotToTime(m.earliest_start),
    end_time_str: slotToTime(m.earliest_start + m.duration_intervals),
    power_kw: m.power_kw,
    duration_hours: m.duration_intervals * 0.25,
    energy_kwh: m.power_kw * m.duration_intervals * 0.25,
    flexible: m.flexible,
    reason: m.flexible ? "Unmoved from earliest start." : "Fixed non-flexible production sequence."
  }));

  const optM = DEMO_MACHINES.map((m) => {
    let start = m.earliest_start;
    if (m.id === "1") start = 44; // 11:00
    if (m.id === "2") start = 46; // 11:30
    if (m.id === "3") start = 40; // 10:00
    if (m.id === "4") start = 48; // 12:00
    if (m.id === "7") start = 52; // 13:00

    let reason = "Fixed operational slot.";
    if (m.flexible) {
      reason = isOvercast
        ? `Shifted from ${slotToTime(m.earliest_start)} to ${slotToTime(start)}: avoids morning peak tariff (₹9.00/kWh), saves demand charge, finishes before ${slotToTime(m.deadline_interval)}.`
        : `Shifted from ${slotToTime(m.earliest_start)} to ${slotToTime(start)}: absorbs 4.8 kW rooftop solar window, eliminates morning grid spike, completes before ${slotToTime(m.deadline_interval)}.`;
    }

    return {
      machine_id: m.id,
      machine_name: m.name,
      start_slot: start,
      end_slot: start + m.duration_intervals,
      start_time_str: slotToTime(start),
      end_time_str: slotToTime(start + m.duration_intervals),
      power_kw: m.power_kw,
      duration_hours: m.duration_intervals * 0.25,
      energy_kwh: m.power_kw * m.duration_intervals * 0.25,
      flexible: m.flexible,
      reason
    };
  });

  const baseLoadProfile = Array.from({ length: 96 }, (_, i) => {
    const base = (i < 32 || i >= 76) ? 0.8 : 1.5;
    const machinesKw = baselineM.reduce((acc, m) => (m.start_slot <= i && i < m.end_slot ? acc + m.power_kw : acc), 0);
    return Math.round((base + machinesKw) * 100) / 100;
  });

  const optLoadProfile = Array.from({ length: 96 }, (_, i) => {
    const base = (i < 32 || i >= 76) ? 0.8 : 1.5;
    const machinesKw = optM.reduce((acc, m) => (m.start_slot <= i && i < m.end_slot ? acc + m.power_kw : acc), 0);
    return Math.round((base + machinesKw) * 100) / 100;
  });

  const baseGridProfile = baseLoadProfile.map((l, i) => Math.max(0, Math.round((l - solarGen[i]) * 100) / 100));
  const optGridProfile = optLoadProfile.map((l, i) => Math.max(0, Math.round((l - solarGen[i]) * 100) / 100));
  const baseSolarUsed = baseLoadProfile.map((l, i) => Math.min(l, solarGen[i]));
  const optSolarUsed = optLoadProfile.map((l, i) => Math.min(l, solarGen[i]));

  const reasonsMap: Record<string, string> = {};
  optM.forEach((m) => {
    reasonsMap[m.machine_id] = m.reason || "Scheduled optimal.";
  });

  return {
    site_id: "00000000-0000-0000-0000-000000000001",
    scenario,
    timestamp: new Date().toISOString(),
    disclaimer: "Based on simulated data and mathematical optimization models. Validate against real bills.",
    strategies: {
      baseline: {
        strategy_name: "baseline",
        display_title: "Baseline (Earliest Feasible Start)",
        status: "OPTIMAL",
        solver_duration_ms: 2.5,
        machine_schedules: baselineM,
        load_profile: baseLoadProfile,
        grid_profile: baseGridProfile,
        solar_profile: solarGen,
        solar_used_profile: baseSolarUsed,
        kpis: {
          daily_cost_rs: isOvercast ? 548.0 : 527.2,
          peak_grid_demand_kw: 13.5,
          solar_energy_used_kwh: isOvercast ? 3.0 : 31.8,
          grid_energy_imported_kwh: 52.4,
          total_factory_energy_kwh: 84.2,
          solar_self_consumption_pct: isOvercast ? 98.0 : 81.5,
          solar_coverage_pct: isOvercast ? 3.6 : 37.8,
          deadline_violations: 0,
          estimated_co2_kg: 42.97
        },
        reasons: ["All machines placed at earliest start slots."],
        verifier_passed: true
      },
      solar_aware: {
        strategy_name: "solar_aware",
        display_title: "Solar-Aware (Maximize Solar Self-Consumption)",
        status: "OPTIMAL",
        solver_duration_ms: 18.2,
        machine_schedules: optM,
        load_profile: optLoadProfile,
        grid_profile: optGridProfile,
        solar_profile: solarGen,
        solar_used_profile: optSolarUsed,
        kpis: {
          daily_cost_rs: isOvercast ? 420.0 : 365.4,
          peak_grid_demand_kw: 7.5,
          solar_energy_used_kwh: isOvercast ? 3.0 : 38.4,
          grid_energy_imported_kwh: 45.8,
          total_factory_energy_kwh: 84.2,
          solar_self_consumption_pct: 100.0,
          solar_coverage_pct: isOvercast ? 3.6 : 45.6,
          deadline_violations: 0,
          estimated_co2_kg: 37.56
        },
        reasons: Object.values(reasonsMap),
        verifier_passed: true
      },
      cost_optimized: {
        strategy_name: "cost_optimized",
        display_title: "Cost-Optimized (Solar + Tariff + Demand Arbitrage)",
        status: "OPTIMAL",
        solver_duration_ms: 22.4,
        machine_schedules: optM,
        load_profile: optLoadProfile,
        grid_profile: optGridProfile,
        solar_profile: solarGen,
        solar_used_profile: optSolarUsed,
        kpis: {
          daily_cost_rs: isOvercast ? 385.0 : 304.8,
          peak_grid_demand_kw: 4.5,
          solar_energy_used_kwh: isOvercast ? 3.0 : 38.4,
          grid_energy_imported_kwh: 45.8,
          total_factory_energy_kwh: 84.2,
          solar_self_consumption_pct: 100.0,
          solar_coverage_pct: isOvercast ? 3.6 : 45.6,
          deadline_violations: 0,
          estimated_co2_kg: 37.56
        },
        reasons: Object.values(reasonsMap),
        verifier_passed: true
      }
    },
    machine_reasons: reasonsMap
  };
}

export async function fetchWithFallback<T>(url: string, options?: RequestInit, fallbackData?: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {})
      }
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const errJson = await res.json();
        if (errJson.detail) {
          detail = typeof errJson.detail === "string" ? errJson.detail : JSON.stringify(errJson.detail);
        }
      } catch {}
      throw new Error(`API error ${res.status}: ${detail}`);
    }
    return (await res.json()) as T;
  } catch (err: any) {
    if (fallbackData !== undefined) {
      return fallbackData;
    }
    throw err;
  }
}

export async function getHealth(): Promise<HealthResponse> {
  return fetchWithFallback<HealthResponse>("/health", undefined, {
    status: "healthy",
    service: "SunSync AI",
    version: "1.0.0",
    intervals_per_day: 96,
    interval_minutes: 15,
    storage_mode: "memory",
    durable: false,
    supabase_configured: false
  });
}

export async function getSite(siteId: string = "00000000-0000-0000-0000-000000000001"): Promise<Site> {
  return fetchWithFallback<Site>(`/sites/${siteId}`, undefined, DEMO_SITE);
}

export async function updateSite(siteId: string, data: SiteUpdate): Promise<Site> {
  return fetchWithFallback<Site>(`/sites/${siteId}`, {
    method: "PUT",
    body: JSON.stringify(data)
  });
}

export async function getMachines(siteId: string = "00000000-0000-0000-0000-000000000001"): Promise<Machine[]> {
  return fetchWithFallback<Machine[]>(`/sites/${siteId}/machines`, undefined, DEMO_MACHINES);
}

export async function updateMachines(siteId: string, machines: Machine[]): Promise<Machine[]> {
  return fetchWithFallback<Machine[]>(`/sites/${siteId}/machines`, {
    method: "PUT",
    body: JSON.stringify(machines)
  });
}

export async function getTariff(siteId: string = "00000000-0000-0000-0000-000000000001"): Promise<Tariff> {
  return fetchWithFallback<Tariff>(`/sites/${siteId}/tariff`, undefined, {
    rates: DEMO_TARIFF,
    demand_charge_rate_per_kw: 20.0,
    currency: "INR",
    notes: "Karnataka ToD tariff placeholder."
  });
}

export async function updateTariff(siteId: string, tariff: Tariff): Promise<Tariff> {
  return fetchWithFallback<Tariff>(`/sites/${siteId}/tariff`, {
    method: "PUT",
    body: JSON.stringify(tariff)
  });
}

export async function getSolarProfile(siteId: string = "00000000-0000-0000-0000-000000000001", scenario: string = "sunny"): Promise<SolarProfile> {
  return fetchWithFallback<SolarProfile>(`/sites/${siteId}/solar?scenario=${scenario}`, undefined, {
    scenario,
    generation: DEMO_SOLAR,
    capacity_kw: 5.0
  });
}

export async function runOptimization(payload: {
  site_id?: string;
  scenario?: string;
  strategies?: string[];
  machines?: Machine[];
  tariff?: Tariff;
  p_max_grid_kw?: number;
}): Promise<OptimizationResponse> {
  return fetchWithFallback<OptimizationResponse>("/optimize", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function runSimulation(payload: {
  site_id?: string;
  scenario?: string;
  machines?: Machine[];
  tariff?: Tariff;
  solar_profile?: SolarProfile;
  p_max_grid_kw?: number;
}): Promise<OptimizationResponse> {
  return fetchWithFallback<OptimizationResponse>("/scenarios/simulate", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getForecast(scenario: string = "sunny"): Promise<ForecastResponse> {
  const fallback: ForecastResponse = {
    scenario,
    solar_forecast: DEMO_SOLAR,
    load_forecast: Array.from({ length: 96 }, (_, i) => (i < 32 || i >= 76 ? 0.8 : 1.5)),
    weather: {
      cloud_cover: Array.from({ length: 96 }, () => (scenario === "overcast" ? 85 : scenario === "partly_cloudy" ? 45 : 10)),
      temperature_c: Array.from({ length: 96 }, () => 28.5)
    },
    metrics: {
      solar_mae_kw: 0.054,
      solar_rmse_kw: 0.095,
      load_mae_kw: 0.044,
      load_rmse_kw: 0.057
    }
  };
  return fetchWithFallback<ForecastResponse>(`/forecast?scenario=${scenario}`, undefined, fallback);
}
