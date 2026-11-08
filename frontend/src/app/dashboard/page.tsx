"use client";

import React, { useEffect, useState } from "react";
import { 
  Download, 
  RotateCw, 
  Zap, 
  Sun, 
  Coins, 
  CheckCircle2, 
  Flame, 
  Calendar,
  Layers,
  ArrowRight,
  History,
  Printer
} from "lucide-react";

import { runOptimization, getOptimizationRun, getSiteConfig, getSolarProfile, getBaseLoad } from "@/lib/api";
import { OptimizationResponse, StrategySchedule } from "@/lib/types";
import { KPICard, DeadlineViolationsCard } from "@/components/kpi-card";
import { LoadDispatchChart } from "@/components/charts/load-dispatch-chart";
import { GanttScheduleChart } from "@/components/charts/gantt-chart";
import { ReasonPanel } from "@/components/reason-card";
import { SimulationDisclaimer } from "@/components/disclaimer";
import { PrintableReport } from "@/components/printable-report";
import { formatRs } from "@/lib/utils";

export default function DashboardPage() {
  const [data, setData] = useState<OptimizationResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<"cost_optimized" | "solar_aware" | "baseline">("cost_optimized");
  const [isReopened, setIsReopened] = useState<boolean>(false);
  const [reopenedMeta, setReopenedMeta] = useState<{ id?: string; created_at?: string; scenario?: string; solver_name?: string } | null>(null);
  const [resultSource, setResultSource] = useState<"live" | "cache" | "history">("live");
  const [siteLabel, setSiteLabel] = useState("Configured site");
  const [replayRunId, setReplayRunId] = useState<string | null>(null);

  // Initialize and persist strategy tab selection across reloads via localStorage
  useEffect(() => {
    try {
      const savedStrategy = window.localStorage.getItem("sunsync_dashboard_strategy");
      if (savedStrategy === "cost_optimized" || savedStrategy === "solar_aware" || savedStrategy === "baseline") setSelectedStrategy(savedStrategy);
    } catch { /* Browser storage is optional. */ }
  }, []);

  const handleStrategyChange = (strat: "cost_optimized" | "solar_aware" | "baseline") => {
    setSelectedStrategy(strat);
    try { window.localStorage.setItem("sunsync_dashboard_strategy", strat); } catch { /* Browser storage is optional. */ }
  };

  const stableSerialize = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
  };

  const isOptimizationResponse = (value: unknown): value is OptimizationResponse => {
    if (!value || typeof value !== "object") return false;
    const response = value as OptimizationResponse;
    if (!response.strategies || typeof response.strategies !== "object") return false;

    const strategyEntries = Object.entries(response.strategies);
    if (strategyEntries.length === 0) return false;

    const supportedStrategies = new Set(["baseline", "solar_aware", "cost_optimized"]);

    return strategyEntries.every(([name, strategy]) => {
      if (!supportedStrategies.has(name) || !strategy || typeof strategy !== "object") return false;

      // KPIs validation
      if (!strategy.kpis || typeof strategy.kpis !== "object") return false;
      const kpisValid = Object.values(strategy.kpis).every((n) => n === undefined || Number.isFinite(n));
      if (!kpisValid) return false;

      // Machine schedules validation
      if (!Array.isArray(strategy.machine_schedules)) return false;

      // 96-interval profile validations
      const profiles = [
        strategy.load_profile,
        strategy.grid_profile,
        strategy.solar_profile,
        strategy.solar_used_profile
      ];
      return profiles.every((profile) =>
        Array.isArray(profile) &&
        profile.length === 96 &&
        profile.every((n) => Number.isFinite(n))
      );
    });
  };

  // Cache values are scoped to the resolved site and a canonical snapshot of every solver input.
  const fetchOptimization = async (forceRefresh: boolean = false) => {
    setLoading(true);
    setError(null);
    let cacheKey: string | null = null;
    let fingerprint: string | null = null;
    try {
      try {
        const [config, solar, baseLoad] = await Promise.all([getSiteConfig(), getSolarProfile(undefined, "sunny"), getBaseLoad()]);
        const site = config.site;
        setSiteLabel(`${site.name}${site.location ? ` · ${site.location}` : ""}`);
        cacheKey = `sunsync_opt_v3_${encodeURIComponent(site.id)}_sunny`;
        const siteInputs = {
          id: site.id,
          p_max_grid_kw: site.p_max_grid_kw,
          solar_capacity_kw: site.solar_capacity_kw,
          grid_emission_factor_kg_per_kwh: site.grid_emission_factor_kg_per_kwh
        };
        fingerprint = stableSerialize({ site: siteInputs, siteVersion: config.version, machines: config.machines, tariff: config.tariff, solar, baseLoad, scenario: "sunny", strategies: ["baseline", "solar_aware", "cost_optimized"] });
        if (!forceRefresh && typeof window !== "undefined") {
          try {
            const stored = sessionStorage.getItem(cacheKey);
            const cached = stored ? JSON.parse(stored) : null;
            if (cached?.fingerprint === fingerprint && isOptimizationResponse(cached?.result)) {
              setData(cached.result);
              setResultSource("cache");
              setLoading(false);
              return;
            }
          } catch {
            // Storage may be unavailable or contain stale or malformed data; fetch fresh.
          }
        }
      } catch {
        // Still attempt the live optimization; an input snapshot is only needed for caching.
      }
      const resp = await runOptimization({
        scenario: "sunny",
        strategies: ["baseline", "solar_aware", "cost_optimized"]
      });
      if (!isOptimizationResponse(resp)) throw new Error("Backend returned an invalid optimization result.");
      setData(resp);
      setResultSource("live");
      if (cacheKey && fingerprint && typeof window !== "undefined") {
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({ fingerprint, result: resp }));
        } catch {
          // Storage is an optional performance optimization.
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load optimization schedule.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const runId = params.get("runId");
      const reopened = params.get("reopened");

      if (reopened && runId) {
        setReplayRunId(runId);
        setLoading(true);
        setError(null);
        getOptimizationRun(runId)
          .then((res) => {
            if (!isOptimizationResponse(res.results)) throw new Error("Saved run contains an invalid optimization result.");
            setData(res.results);
            setIsReopened(true);
            setResultSource("history");
            const availableKeys = Object.keys(res.results.strategies || {});
            if (!res.results.strategies[selectedStrategy] && availableKeys.length > 0) {
              const preferred = (availableKeys.includes("cost_optimized")
                ? "cost_optimized"
                : availableKeys[0]) as "cost_optimized" | "solar_aware" | "baseline";
              setSelectedStrategy(preferred);
            }
            setReopenedMeta({
              id: res.id,
              created_at: res.created_at,
              scenario: res.scenario,
              solver_name: res.solver_name
            });
          })
          .catch((err) => {
            setError(err?.message || "Could not load the saved optimization run.");
          })
          .finally(() => {
            setLoading(false);
          });
        return;
      }
    }
    fetchOptimization();
  }, []);

  const downloadCSV = () => {
    if (!data) return;
    const strat = data.strategies[selectedStrategy] || data.strategies.cost_optimized || Object.values(data.strategies)[0];
    if (!strat) return;
    const emissionFactor = strat.kpis.grid_emission_factor_kg_per_kwh || 0.82;
    const avoidedCo2 = strat.kpis.avoided_co2_kg ?? Number((strat.kpis.solar_energy_used_kwh * emissionFactor).toFixed(2));
    const rows = [
      ["# SunSync AI Industrial Schedule Export"],
      ["# Strategy", strat.display_title],
      ["# Daily Electricity Cost (INR)", strat.kpis.daily_cost_rs.toString()],
      ["# Peak Grid Demand (kW)", strat.kpis.peak_grid_demand_kw.toString()],
      ["# Solar Energy Consumed (kWh)", strat.kpis.solar_energy_used_kwh.toString()],
      ["# Net Grid Energy Imported (kWh)", strat.kpis.grid_energy_imported_kwh.toString()],
      ["# Estimated CO2 Avoided (kg)", avoidedCo2.toString()],
      ["# Grid Emission Factor (kg CO2/kWh)", emissionFactor.toString()],
      ["# Environmental Disclaimer", `Estimated CO2 avoided based on ${emissionFactor} kg/kWh grid factor`],
      [],
      ["Machine ID", "Machine Name", "Power (kW)", "Start Time", "End Time", "Duration (Hours)", "Energy (kWh)", "Flexible", "Reason"]
    ];

    strat.machine_schedules.forEach((m) => {
      rows.push([
        m.machine_id,
        m.machine_name,
        m.power_kw.toString(),
        m.start_time_str,
        m.end_time_str,
        m.duration_hours.toString(),
        m.energy_kwh.toString(),
        m.flexible ? "Yes" : "No",
        `"${(m.reason || "").replace(/"/g, '""')}"`
      ]);
    });

    const csvString = rows.map((e) => e.join(",")).join("\n");
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", blobUrl);
    link.setAttribute("download", `SunSync_${selectedStrategy}_schedule.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  };

  const retryFailedLoad = async () => {
    if (!replayRunId) return fetchOptimization(true);
    setLoading(true);
    setError(null);
    try {
      const res = await getOptimizationRun(replayRunId);
      if (!isOptimizationResponse(res.results)) throw new Error("Saved run contains an invalid optimization result.");
      setData(res.results);
      setIsReopened(true);
      setResultSource("history");
      const availableKeys = Object.keys(res.results.strategies || {});
      if (!res.results.strategies[selectedStrategy] && availableKeys.length > 0) {
        const preferred = (availableKeys.includes("cost_optimized")
          ? "cost_optimized"
          : availableKeys[0]) as "cost_optimized" | "solar_aware" | "baseline";
        setSelectedStrategy(preferred);
      }
      setReopenedMeta({ id: res.id, created_at: res.created_at, scenario: res.scenario, solver_name: res.solver_name });
    } catch (err: any) {
      setError(err?.message || "Could not load the saved optimization run.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 py-2 animate-pulse">
        {/* Skeleton Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-800">
          <div className="space-y-2">
            <div className="h-7 w-72 bg-slate-800 rounded-lg"></div>
            <div className="h-4 w-96 bg-slate-800/60 rounded"></div>
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-24 bg-slate-800 rounded-lg"></div>
            <div className="h-8 w-44 bg-slate-800 rounded-lg"></div>
          </div>
        </div>

        {/* Skeleton Delta Banner */}
        <div className="h-20 bg-slate-900/60 border border-slate-800 rounded-xl p-4"></div>

        {/* Skeleton Strategy Tabs */}
        <div className="h-12 bg-slate-900 border border-slate-800 rounded-xl"></div>

        {/* Skeleton KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="h-3 w-20 bg-slate-800 rounded"></div>
              <div className="h-6 w-24 bg-slate-700 rounded"></div>
              <div className="h-3 w-16 bg-slate-800/60 rounded"></div>
            </div>
          ))}
        </div>

        {/* Skeleton Dispatch Chart */}
        <div className="h-80 bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="h-5 w-48 bg-slate-800 rounded"></div>
          <div className="h-56 bg-slate-950/40 rounded-lg"></div>
        </div>

        {/* Skeleton Gantt Chart */}
        <div className="h-64 bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="h-5 w-48 bg-slate-800 rounded"></div>
          <div className="h-44 bg-slate-950/40 rounded-lg"></div>
        </div>
      </div>
    );
  }

  const availableStrategies = data?.strategies ? Object.keys(data.strategies) : [];
  if (error || !data || availableStrategies.length === 0) {
    return (
      <div className="py-16 text-center space-y-4 bg-slate-900/40 rounded-xl border border-slate-800 p-8">
        <p className="text-rose-400 text-sm font-semibold">Error loading optimization: {error || "No valid strategy data found in optimization run."}</p>
        <button
          onClick={retryFailedLoad}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-xs font-semibold hover:bg-blue-500"
        >
          {replayRunId ? "Retry Historical Replay" : "Retry Optimization"}
        </button>
      </div>
    );
  }

  const baseStrat = (data.strategies.baseline || data.strategies[selectedStrategy] || data.strategies[availableStrategies[0]])!;
  const currentStrat = data.strategies[selectedStrategy] || data.strategies.cost_optimized || baseStrat;
  const baseKpi = baseStrat.kpis;
  const currKpi = currentStrat.kpis;

  const hasBaselineComparison = Boolean(data.strategies.baseline?.kpis && currentStrat !== data.strategies.baseline);

  // Compute live deltas vs baseline if baseline exists
  const costDelta = (currKpi.daily_cost_rs ?? 0) - (baseKpi.daily_cost_rs ?? 0);
  const costDeltaPct = (baseKpi.daily_cost_rs ?? 0) > 0 ? ((costDelta / (baseKpi.daily_cost_rs ?? 0)) * 100).toFixed(1) : "0.0";

  const peakDelta = (currKpi.peak_grid_demand_kw ?? 0) - (baseKpi.peak_grid_demand_kw ?? 0);
  const peakDeltaPct = (baseKpi.peak_grid_demand_kw ?? 0) > 0 ? ((peakDelta / (baseKpi.peak_grid_demand_kw ?? 0)) * 100).toFixed(1) : "0.0";

  const solarDelta = (currKpi.solar_energy_used_kwh ?? 0) - (baseKpi.solar_energy_used_kwh ?? 0);
  const solarDeltaPct = (baseKpi.solar_energy_used_kwh ?? 0) > 0
    ? ((solarDelta / (baseKpi.solar_energy_used_kwh ?? 0)) * 100).toFixed(1)
    : "+0.0";

  return (
    <div className="space-y-6 py-2">
      <SimulationDisclaimer />

      {isReopened && (
        <div className="bg-amber-950/40 border border-amber-600/40 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 text-amber-400 rounded-lg shrink-0">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-amber-400">Viewing Historical Replay</div>
              <div className="text-sm text-slate-200">
                Showing saved solver run <span className="font-mono text-amber-300 font-semibold">#{reopenedMeta?.id ? reopenedMeta.id.slice(0, 8) : "Archived"}</span>
                {reopenedMeta?.created_at && ` logged at ${new Date(reopenedMeta.created_at).toLocaleString()}`}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              if (typeof window !== "undefined") {
                try {
                  sessionStorage.removeItem("sunsync_reopened_run");
                  sessionStorage.removeItem("sunsync_reopened_meta");
                } catch { /* Browser storage is optional. */ }
                const url = new URL(window.location.href);
                url.searchParams.delete("reopened");
                url.searchParams.delete("runId");
                window.history.replaceState({}, "", url.pathname);
              }
              setIsReopened(false);
              setReopenedMeta(null);
              setReplayRunId(null);
              fetchOptimization();
            }}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors shrink-0"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Exit Replay & Run Live Optimization
          </button>
        </div>
      )}

      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Industrial Scheduling Dashboard</h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
              {resultSource === "history" ? "Historical Result" : resultSource === "cache" ? "Cached Simulation" : "Optimization Completed"}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Site: <strong className="text-slate-300">{siteLabel}</strong> • 96 intervals (15-min grid)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => fetchOptimization(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Re-solve
          </button>

          <button
            onClick={downloadCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            Download Schedule (CSV)
          </button>

          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold transition-colors shadow-sm"
            title="Export PDF / Print Executive Summary"
            aria-label="Export PDF / Print Report"
          >
            <Printer className="w-3.5 h-3.5 text-amber-400" />
            Export PDF / Print Report
          </button>
        </div>
      </div>

      {/* Prominent Delta Header: Executive Savings & Shift Summary */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900/95 to-blue-950/30 border border-slate-800 rounded-xl p-4 shadow-md">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5 mb-0.5">
              <Coins className="w-3.5 h-3.5" /> Strategy Optimization Delta
            </div>
            <div className="text-sm text-slate-300">
              Active: <span className="font-semibold text-white">{currentStrat?.display_title || "Selected Strategy"}</span>
              {hasBaselineComparison && (
                <> vs <span className="text-slate-400">Baseline (Earliest Start)</span></>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 w-full sm:w-auto">
            <div className="bg-slate-950/70 border border-slate-800 px-3 py-2 rounded-lg text-center">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Cost Savings</div>
              <div className={`text-sm font-extrabold ${costDelta <= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {costDelta <= 0 ? `-${Math.abs(Number(costDeltaPct))}% (${formatRs(Math.abs(costDelta))})` : `+${costDeltaPct}%`}
              </div>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 px-3 py-2 rounded-lg text-center">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Peak Demand Reduction</div>
              <div className={`text-sm font-extrabold ${peakDelta <= 0 ? "text-cyan-400" : "text-amber-400"}`}>
                {peakDelta <= 0 ? `${Math.abs(peakDelta).toFixed(1)} kW (${Math.abs(Number(peakDeltaPct))}%)` : `+${peakDelta.toFixed(1)} kW`}
              </div>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 px-3 py-2 rounded-lg text-center">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Solar Utilized</div>
              <div className="text-sm font-extrabold text-amber-400">
                {currKpi.solar_self_consumption_pct ?? 0}%
                <span className="text-[11px] font-normal text-slate-400 ml-1">({currKpi.solar_energy_used_kwh ?? 0} kWh)</span>
              </div>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 px-3 py-2 rounded-lg text-center">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Avoided CO2</div>
              <div className="text-sm font-extrabold text-emerald-400">
                {currKpi.avoided_co2_kg ?? ((currKpi.solar_energy_used_kwh ?? 0) * (currKpi.grid_emission_factor_kg_per_kwh || 0.82)).toFixed(1)} kg
              </div>
              <div className="text-[9px] text-slate-400 font-normal leading-tight mt-0.5">
                Estimated CO2 avoided based on {currKpi.grid_emission_factor_kg_per_kwh || 0.82} kg/kWh grid factor
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Strategy Toggle Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1 bg-slate-900 border border-slate-800 rounded-xl">
        {Boolean(data.strategies.cost_optimized) && (
          <button
            onClick={() => handleStrategyChange("cost_optimized")}
            className={`flex-1 py-2 px-4 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              selectedStrategy === "cost_optimized"
                ? "bg-blue-600 text-white shadow-md"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Coins className="w-3.5 h-3.5" />
            <span>Cost-Optimized Strategy</span>
            <span className="hidden sm:inline text-[10px] px-1.5 py-0.2 rounded bg-blue-700/80 text-blue-100">ToD + Peak Arbitrage</span>
          </button>
        )}

        {Boolean(data.strategies.solar_aware) && (
          <button
            onClick={() => handleStrategyChange("solar_aware")}
            className={`flex-1 py-2 px-4 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              selectedStrategy === "solar_aware"
                ? "bg-amber-500 text-slate-950 shadow-md font-extrabold"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
            <span>Solar-Aware Strategy</span>
            <span className="hidden sm:inline text-[10px] px-1.5 py-0.2 rounded bg-amber-600/30 text-amber-300">Max Self-Consumption</span>
          </button>
        )}

        {Boolean(data.strategies.baseline) && (
          <button
            onClick={() => handleStrategyChange("baseline")}
            className={`flex-1 py-2 px-4 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              selectedStrategy === "baseline"
                ? "bg-slate-700 text-white shadow-md"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Baseline (Earliest Start)</span>
            <span className="hidden sm:inline text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">Unoptimized Reference</span>
          </button>
        )}
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        <KPICard
          label="Daily Electricity Cost"
          value={formatRs(currKpi.daily_cost_rs ?? 0)}
          baseValue={hasBaselineComparison && baseKpi ? formatRs(baseKpi.daily_cost_rs ?? 0) : undefined}
          deltaText={hasBaselineComparison ? `${costDeltaPct}% (${formatRs(Math.abs(costDelta))})` : undefined}
          isPositiveBenefit={costDelta <= 0}
          badge="Computed"
        />

        <KPICard
          label="Peak Grid Demand"
          value={`${currKpi.peak_grid_demand_kw ?? 0}`}
          unit="kW"
          baseValue={hasBaselineComparison && baseKpi ? `${baseKpi.peak_grid_demand_kw ?? 0} kW` : undefined}
          deltaText={hasBaselineComparison ? `${peakDeltaPct}% (${peakDelta.toFixed(1)} kW)` : undefined}
          isPositiveBenefit={peakDelta <= 0}
          badge="Max Slot"
        />

        <KPICard
          label="Solar Consumed On-Site"
          value={`${currKpi.solar_energy_used_kwh ?? 0}`}
          unit="kWh"
          baseValue={hasBaselineComparison && baseKpi ? `${baseKpi.solar_energy_used_kwh ?? 0} kWh` : undefined}
          deltaText={hasBaselineComparison ? `+${solarDelta.toFixed(1)} kWh (${solarDeltaPct}%)` : undefined}
          isPositiveBenefit={solarDelta >= 0}
          badge={`${currKpi.solar_self_consumption_pct ?? 0}% Total Solar`}
        />

        <KPICard
          label="Net Grid Imported"
          value={`${currKpi.grid_energy_imported_kwh ?? 0}`}
          unit="kWh"
          baseValue={hasBaselineComparison && baseKpi ? `${baseKpi.grid_energy_imported_kwh ?? 0} kWh` : undefined}
          deltaText={hasBaselineComparison && baseKpi ? `${((currKpi.grid_energy_imported_kwh ?? 0) - (baseKpi.grid_energy_imported_kwh ?? 0)).toFixed(1)} kWh` : undefined}
          isPositiveBenefit={baseKpi ? (currKpi.grid_energy_imported_kwh ?? 0) <= (baseKpi.grid_energy_imported_kwh ?? 0) : true}
          subtext={`Avoided: ${currKpi.avoided_co2_kg ?? ((currKpi.solar_energy_used_kwh ?? 0) * (currKpi.grid_emission_factor_kg_per_kwh || 0.82)).toFixed(1)} kg CO2 | Grid: ${currKpi.estimated_co2_kg ?? 0} kg`}
        />

        <div className="col-span-2 md:col-span-1">
          <DeadlineViolationsCard count={currKpi.deadline_violations ?? 0} />
        </div>
      </div>

      {/* Dispatch Curves Chart */}
      <LoadDispatchChart
        strategyName={currentStrat.display_title}
        loadProfile={currentStrat.load_profile}
        gridProfile={currentStrat.grid_profile}
        solarProfile={currentStrat.solar_profile}
        solarUsedProfile={currentStrat.solar_used_profile}
        peakKw={currKpi.peak_grid_demand_kw ?? 0}
      />

      {/* Gantt Production Schedule Chart */}
      <GanttScheduleChart
        baselineSchedules={baseStrat.machine_schedules}
        optimizedSchedules={currentStrat.machine_schedules}
        title={hasBaselineComparison ? `Gantt Dispatch: Baseline vs ${currentStrat.display_title}` : `Gantt Dispatch: ${currentStrat.display_title}`}
      />

      {/* Plain Language Reasons Panel */}
      <ReasonPanel
        baselineSchedules={baseStrat.machine_schedules}
        optimizedSchedules={currentStrat.machine_schedules}
        machineReasons={data.machine_reasons ?? {}}
      />

      {/* Printable Executive Summary Report */}
      <PrintableReport
        siteName={siteLabel.split(" · ")[0]}
        siteLocation={siteLabel.split(" · ").slice(1).join(" · ") || "Not provided"}
        baseline={baseStrat}
        optimized={currentStrat}
        disclaimer={data.disclaimer || ""}
      />
    </div>
  );
}
