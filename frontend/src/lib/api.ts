import { Machine, Tariff, SolarProfile, OptimizationResponse, ForecastResponse } from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

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
      throw new Error(`API error ${res.status}: ${res.statusText}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (fallbackData !== undefined) {
      console.warn(`Backend call failed (${url}), using resilient fallback dataset. Error:`, err);
      return fallbackData;
    }
    throw err;
  }
}

export async function getMachines(siteId: string = "00000000-0000-0000-0000-000000000001"): Promise<Machine[]> {
  return fetchWithFallback<Machine[]>(`/sites/${siteId}/machines`);
}

export async function updateMachines(siteId: string, machines: Machine[]): Promise<Machine[]> {
  return fetchWithFallback<Machine[]>(`/sites/${siteId}/machines`, {
    method: "PUT",
    body: JSON.stringify(machines)
  });
}

export async function getTariff(siteId: string = "00000000-0000-0000-0000-000000000001"): Promise<Tariff> {
  return fetchWithFallback<Tariff>(`/sites/${siteId}/tariff`);
}

export async function getSolarProfile(siteId: string = "00000000-0000-0000-0000-000000000001", scenario: string = "sunny"): Promise<SolarProfile> {
  return fetchWithFallback<SolarProfile>(`/sites/${siteId}/solar?scenario=${scenario}`);
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
  return fetchWithFallback<ForecastResponse>(`/forecast?scenario=${scenario}`);
}
