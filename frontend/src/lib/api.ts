import { Machine, Tariff, SolarProfile, OptimizationResponse, ForecastResponse, Site, SiteUpdate, HealthResponse, SiteConfigPayload, SiteConfigResponse, OptimizationRunSummary, OptimizationRunDetail, BillRealityCheckRequest, BillRealityCheckResponse } from "./types";

const RAW_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
export const API_BASE_URL = RAW_API_BASE_URL.replace(/\/+$/, "");

interface AnonymousSession {
  access_token: string;
  token_type: "bearer";
  expires_at: number;
  site_id: string;
}

const SESSION_STORAGE_KEY = "sunsync_anonymous_session";
let activeSession: AnonymousSession | null = null;
let sessionRequest: Promise<AnonymousSession> | null = null;

async function requestAnonymousSession(existingToken?: string): Promise<AnonymousSession> {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (existingToken) (headers as Record<string, string>).Authorization = `Bearer ${existingToken}`;
  const url = `${API_BASE_URL}/auth/session`;
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers });
  } catch (error) {
    if (process.env.NODE_ENV !== "production" && API_BASE_URL.includes("localhost:8000")) {
      response = await fetch(url.replace("localhost:8000", "127.0.0.1:8000"), { method: "POST", headers });
    } else {
      throw error;
    }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail || `Anonymous session request failed (${response.status}).`);
  }
  return response.json() as Promise<AnonymousSession>;
}

async function loadOrRenewSession(): Promise<AnonymousSession> {
  let storedToken: string | null = null;
  try { storedToken = window.sessionStorage.getItem(SESSION_STORAGE_KEY); } catch { /* Use memory for this page only. */ }

  let session: AnonymousSession;
  if (storedToken) {
    try {
      session = await requestAnonymousSession(storedToken);
    } catch (error: any) {
      if (!String(error?.message || "").includes("401") && !String(error?.message || "").toLowerCase().includes("expired")) throw error;
      session = await requestAnonymousSession();
      try { window.dispatchEvent(new CustomEvent("sunsync-session-restarted")); } catch { /* No browser event target. */ }
    }
  } else {
    session = await requestAnonymousSession();
  }
  activeSession = session;
  try { window.sessionStorage.setItem(SESSION_STORAGE_KEY, session.access_token); } catch { /* Token remains in page memory. */ }
  return session;
}

async function getAnonymousSession(): Promise<AnonymousSession> {
  if (activeSession && activeSession.expires_at - Math.floor(Date.now() / 1000) > 180) return activeSession;
  if (!sessionRequest) {
    sessionRequest = loadOrRenewSession().finally(() => { sessionRequest = null; });
  }
  return sessionRequest;
}

async function siteIdOrCurrent(siteId?: string): Promise<string> {
  return siteId || (await getAnonymousSession()).site_id;
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
      const session = await getAnonymousSession();
      const headers = new Headers(options?.headers);
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      headers.set("Authorization", `Bearer ${session.access_token}`);
      let res: Response;

      try {
        res = await fetch(primaryUrl, {
          ...options,
          headers
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
              headers
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
        } else if (res.status === 401 || res.status === 403) {
          throw new Error(`Session authorization failed (${res.status}): ${detail}. Reload the page to start a new anonymous session.`);
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
  const primaryUrl = `${API_BASE_URL}/health`;
  const isDev = process.env.NODE_ENV !== "production";
  let res: Response;

  try {
    res = await fetch(primaryUrl, {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: "no-store",
    });
  } catch (networkErr: any) {
    if (isDev && API_BASE_URL.includes("localhost:8000")) {
      try {
        const fallbackHostUrl = primaryUrl.replace("localhost:8000", "127.0.0.1:8000");
        res = await fetch(fallbackHostUrl, {
          method: "GET",
          headers: { "Accept": "application/json" },
          cache: "no-store",
        });
      } catch {
        throw new Error(
          `Cannot reach the backend at ${API_BASE_URL} (is the FastAPI backend running on port 8000? connection failed)`
        );
      }
    } else {
      throw new Error(
        `Cannot reach the backend at ${API_BASE_URL} (is the FastAPI backend running on port 8000? connection failed)`
      );
    }
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errJson = await res.json();
      if (errJson?.detail) {
        detail = typeof errJson.detail === "string" ? errJson.detail : JSON.stringify(errJson.detail);
      }
    } catch {}
    throw new Error(`Backend HTTP error (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as HealthResponse;
  if (!data || data.status !== "healthy") {
    throw new Error(`Backend unhealthy: service status is '${data?.status || "unknown"}'`);
  }
  return data;
}

export async function getSiteConfig(siteId?: string): Promise<SiteConfigResponse> {
  return fetchWithFallback<SiteConfigResponse>(`/sites/${await siteIdOrCurrent(siteId)}/config`);
}

export async function updateSiteConfig(siteId: string, payload: SiteConfigPayload): Promise<SiteConfigResponse> {
  return fetchWithFallback<SiteConfigResponse>(`/sites/${siteId}/config`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function getSite(siteId?: string): Promise<Site> {
  return fetchWithFallback<Site>(`/sites/${await siteIdOrCurrent(siteId)}`);
}

export async function updateSite(siteId: string, data: SiteUpdate): Promise<Site> {
  return fetchWithFallback<Site>(`/sites/${siteId}`, {
    method: "PUT",
    body: JSON.stringify(data)
  });
}

export async function getMachines(siteId?: string): Promise<Machine[]> {
  return fetchWithFallback<Machine[]>(`/sites/${await siteIdOrCurrent(siteId)}/machines`);
}

export async function updateMachines(siteId: string, machines: Machine[]): Promise<Machine[]> {
  return fetchWithFallback<Machine[]>(`/sites/${siteId}/machines`, {
    method: "PUT",
    body: JSON.stringify(machines)
  });
}

export async function getTariff(siteId?: string): Promise<Tariff> {
  return fetchWithFallback<Tariff>(`/sites/${await siteIdOrCurrent(siteId)}/tariff`);
}

export async function updateTariff(siteId: string, tariff: Tariff): Promise<Tariff> {
  return fetchWithFallback<Tariff>(`/sites/${siteId}/tariff`, {
    method: "PUT",
    body: JSON.stringify(tariff)
  });
}

export async function getSolarProfile(siteId: string | undefined = undefined, scenario: string = "sunny"): Promise<SolarProfile> {
  return fetchWithFallback<SolarProfile>(`/sites/${await siteIdOrCurrent(siteId)}/solar?scenario=${scenario}`);
}

export async function getBaseLoad(siteId?: string): Promise<number[]> {
  return fetchWithFallback<number[]>(`/sites/${await siteIdOrCurrent(siteId)}/base-load`);
}

export async function runOptimization(payload: {
  site_id?: string;
  scenario?: string;
  strategies?: string[];
  machines?: Machine[];
  tariff?: Tariff;
  p_max_grid_kw?: number;
}): Promise<OptimizationResponse> {
  const session = await getAnonymousSession();
  return fetchWithFallback<OptimizationResponse>("/optimize", {
    method: "POST",
    body: JSON.stringify({ ...payload, site_id: payload.site_id || session.site_id })
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
  const session = await getAnonymousSession();
  return fetchWithFallback<OptimizationResponse>("/scenarios/simulate", {
    method: "POST",
    body: JSON.stringify({ ...payload, site_id: payload.site_id || session.site_id })
  });
}

export async function getForecast(
  scenario: string = "sunny",
  source: string = "simulated"
): Promise<ForecastResponse> {
  return fetchWithFallback<ForecastResponse>(`/forecast?scenario=${encodeURIComponent(scenario)}&source=${encodeURIComponent(source)}`);
}

export async function getOptimizationRuns(siteId?: string): Promise<OptimizationRunSummary[]> {
  const query = siteId ? `?site_id=${encodeURIComponent(siteId)}` : "";
  return fetchWithFallback<OptimizationRunSummary[]>(`/runs${query}`);
}

export async function getOptimizationRun(runId: string): Promise<OptimizationRunDetail> {
  return fetchWithFallback<OptimizationRunDetail>(`/runs/${runId}`);
}

export async function checkBillReality(payload: BillRealityCheckRequest): Promise<BillRealityCheckResponse> {
  const session = await getAnonymousSession();
  return fetchWithFallback<BillRealityCheckResponse>("/billing/reality-check", {
    method: "POST",
    body: JSON.stringify({ ...payload, site_id: payload.site_id || session.site_id })
  });
}
