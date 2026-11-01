import { Machine, Tariff, SolarProfile, OptimizationResponse, ForecastResponse, Site, SiteUpdate, HealthResponse, SiteConfigPayload, SiteConfigResponse, OptimizationRunSummary, OptimizationRunDetail, BillRealityCheckRequest, BillRealityCheckResponse } from "./types";
import { slotToTime } from "./utils";

const RAW_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
export const API_BASE_URL = RAW_API_BASE_URL.replace(/\/+$/, "");

export const DEMO_SITE: Site = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Machining & Stamping Unit Alpha",
  location: "Peenya Industrial Area, Bengaluru, Karnataka",
  p_max_grid_kw: 25.0,
  solar_capacity_kw: 5.0,
  currency: "INR",
  grid_emission_factor_kg_per_kwh: 0.82
};

// --- Seed fallback dataset for preview/offline exploration ---
export const DEMO_MACHINES: Machine[] = [
  { id: "1", name: "CNC Milling Center", power_kw: 4.0, duration_intervals: 16, earliest_start: 32, latest_start: 48, deadline_interval: 68, flexible: true },
  { id: "2", name: "Industrial Air Compressor", power_kw: 3.5, duration_intervals: 12, earliest_start: 32, latest_start: 48, deadline_interval: 64, flexible: true },
  { id: "3", name: "Plastic Injection Molding", power_kw: 5.0, duration_intervals: 14, earliest_start: 34, latest_start: 44, deadline_interval: 64, flexible: true },
  { id: "4", name: "Electric Curing Oven", power_kw: 3.0, duration_intervals: 8, earliest_start: 36, latest_start: 56, deadline_interval: 72, flexible: true },
  { id: "5", name: "Hydraulic Stamping Press", power_kw: 4.5, duration_intervals: 10, earliest_start: 32, latest_start: 32, deadline_interval: 50, flexible: false },
  { id: "6", name: "Conveyor & Packaging Line", power_kw: 2.0, duration_intervals: 20, earliest_start: 36, latest_start: 36, deadline_interval: 68, flexible: false },
  { id: "7", name: "Water Chiller & Pump", power_kw: 2.5, duration_intervals: 12, earliest_start: 40, latest_start: 60, deadline_interval: 76, flexible: true }
];

export const DEMO_SOLAR: number[] = Array.from({ length: 96 }, (_, i) => {
  if (i < 26 || i >= 72) return 0;
  const val = 5.0 * Math.exp(-Math.pow(i - 49, 2) / (2 * 100));
  return Math.round(Math.max(0, val) * 100) / 100;
});

export const DEMO_TARIFF: number[] = Array.from({ length: 96 }, (_, i) => {
  if (i >= 32 && i < 40) return 9.0;
  if (i >= 72 && i < 88) return 9.5;
  if (i >= 24 && i < 72) return 7.0;
  return 4.5;
});

function getClientSessionId(): string {
  if (typeof window === "undefined") {
    return "server-render-session";
  }
  try {
    let sId = localStorage.getItem("sunsync_session_id");
    if (!sId) {
      sId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "10000000-0000-4000-8000-000000000000";
      localStorage.setItem("sunsync_session_id", sId);
    }
    return sId;
  } catch {
    return "fallback-client-session";
  }
}

export async function fetchWithFallback<T>(url: string, options?: RequestInit): Promise<T> {
  const method = (options?.method || "GET").toUpperCase();
  const isGet = method === "GET";
  const maxAttempts = isGet ? 2 : 1;
  const isDev = process.env.NODE_ENV !== "production";

  let lastError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const primaryUrl = `${API_BASE_URL}${url}`;
      let res: Response;

      try {
        res = await fetch(primaryUrl, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            "X-Visitor-Session-Id": getClientSessionId(),
            ...(options?.headers || {})
          }
        });
      } catch (networkErr: any) {
        // Restrict localhost -> 127.0.0.1 client retry:
        // 1. Only in development builds (never production)
        // 2. Only if the connection was genuinely refused before receiving any HTTP response
        if (isDev && API_BASE_URL.includes("localhost:8000")) {
          try {
            const fallbackHostUrl = primaryUrl.replace("localhost:8000", "127.0.0.1:8000");
            res = await fetch(fallbackHostUrl, {
              ...options,
              headers: {
                "Content-Type": "application/json",
                "X-Visitor-Session-Id": getClientSessionId(),
                ...(options?.headers || {})
              }
            });
          } catch {
            throw networkErr;
          }
        } else {
          throw networkErr;
        }
      }

      if (!res.ok) {
        let detail = res.statusText;
        try {
          const errJson = await res.json();
          if (errJson.detail) {
            detail = typeof errJson.detail === "string" ? errJson.detail : JSON.stringify(errJson.detail);
          }
        } catch {}

        if (res.status === 500) {
          throw new Error(`Server error (500): ${detail}`);
        } else if (res.status === 429) {
          throw new Error(`Rate limit exceeded (429): ${detail}`);
        } else if (res.status === 413) {
          throw new Error(`Payload too large (413): ${detail}`);
        } else if (res.status === 409) {
          throw new Error(`Configuration conflict (409): ${detail}`);
        } else if (res.status === 422) {
          throw new Error(`Validation error (422): ${detail}`);
        } else {
          throw new Error(`Rejected (${res.status}): ${detail}`);
        }
      }

      return (await res.json()) as T;
    } catch (err: any) {
      lastError = err;
      if (err.name === "TypeError" && (err.message === "Failed to fetch" || err.message.includes("fetch"))) {
        lastError = new Error(
          `Cannot reach the backend at ${API_BASE_URL} (is the FastAPI backend running on port 8000? CORS blocked?)`
        );
      }

      // If GET request, wait briefly and retry
      if (isGet && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      break;
    }
  }

  // Production code must never return mock data on failure
  throw lastError;
}

export async function getHealth(): Promise<HealthResponse> {
  return fetchWithFallback<HealthResponse>("/health");
}

export async function getSiteConfig(siteId: string = "00000000-0000-0000-0000-000000000001"): Promise<SiteConfigResponse> {
  return fetchWithFallback<SiteConfigResponse>(`/sites/${siteId}/config`);
}

export async function updateSiteConfig(siteId: string, payload: SiteConfigPayload): Promise<SiteConfigResponse> {
  return fetchWithFallback<SiteConfigResponse>(`/sites/${siteId}/config`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function getSite(siteId: string = "00000000-0000-0000-0000-000000000001"): Promise<Site> {
  return fetchWithFallback<Site>(`/sites/${siteId}`);
}

export async function updateSite(siteId: string, data: SiteUpdate): Promise<Site> {
  return fetchWithFallback<Site>(`/sites/${siteId}`, {
    method: "PUT",
    body: JSON.stringify(data)
  });
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

export async function updateTariff(siteId: string, tariff: Tariff): Promise<Tariff> {
  return fetchWithFallback<Tariff>(`/sites/${siteId}/tariff`, {
    method: "PUT",
    body: JSON.stringify(tariff)
  });
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

export async function getOptimizationRuns(siteId?: string): Promise<OptimizationRunSummary[]> {
  const query = siteId ? `?site_id=${encodeURIComponent(siteId)}` : "";
  return fetchWithFallback<OptimizationRunSummary[]>(`/runs${query}`);
}

export async function getOptimizationRun(runId: string): Promise<OptimizationRunDetail> {
  return fetchWithFallback<OptimizationRunDetail>(`/runs/${runId}`);
}

export async function checkBillReality(payload: BillRealityCheckRequest): Promise<BillRealityCheckResponse> {
  return fetchWithFallback<BillRealityCheckResponse>("/billing/reality-check", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
