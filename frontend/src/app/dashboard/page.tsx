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

import { runOptimization, getOptimizationRun, getSiteConfig } from "@/lib/api";
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

  // Initialize and persist strategy tab selection across reloads via localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedStrategy = localStorage.getItem("sunsync_dashboard_strategy");
      if (savedStrategy === "cost_optimized" || savedStrategy === "solar_aware" || savedStrategy === "baseline") {
        setSelectedStrategy(savedStrategy);
      }
    }
  }, []);

  const handleStrategyChange = (strat: "cost_optimized" | "solar_aware" | "baseline") => {
    setSelectedStrategy(strat);
    if (typeof window !== "undefined") {
      localStorage.setItem("sunsync_dashboard_strategy", strat);
    }
  };

  // Cache optimize results keyed by (site_version, scenario, tariff_hash) in sessionStorage.
  // Editing the config bumps site.version → new cache key → stale result is never served.
  const buildCacheKey = (version: number, scenario: string, tariffHash: string) =>
    `sunsync_opt_v2_${version}_${scenario}_${tariffHash}`;

  const quickTariffHash = (rates: number[]): string => {
    // XOR-fold the 96 rate values into a short numeric fingerprint.
    const h = rates.reduce((acc, r, i) => acc ^ ((Math.round(r * 100) + i * 31) & 0xffff), 0);
    return h.toString(16).padStart(4, "0");
  };

  const fetchOptimization = async (forceRefresh: boolean = false) => {
    // Step 1: fetch current site config to build a version-aware cache key.
    let cacheKey = "sunsync_opt_v2_unknown";
    try {
      const cfg = await getSiteConfig();
      const version = cfg.version ?? 1;
      const tariffRates: number[] = cfg.tariff?.rates ?? [];
      const tariffHash = tariffRates.length === 96 ? quickTariffHash(tariffRates) : "notariff";
      cacheKey = buildCacheKey(version, "sunny", tariffHash);
    } catch {
      // Cannot reach backend; let the main fetch surface the error.
    }

    if (!forceRefresh && typeof window !== "undefined") {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          setData(JSON.parse(cached));
          setLoading(false);
          return;
        } catch {
          // fallback to fetch
        }
      }
    }

    setLoading(true);
    setError(null);
    try {
      const resp = await runOptimization({
        scenario: "sunny",
        strategies: ["baseline", "solar_aware", "cost_optimized"]
      });
      setData(resp);
      if (typeof window !== "undefined") {
        // Store under the versioned key and clean up any previous keys for this tab.
        const prefix = "sunsync_opt_v2_";
        Object.keys(sessionStorage)
          .filter((k) => k.startsWith(prefix) && k !== cacheKey)
          .forEach((k) => sessionStorage.removeItem(k));
        sessionStorage.setItem(cacheKey, JSON.stringify(resp));
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
        const cached = sessionStorage.getItem("sunsync_reopened_run");
        const cachedMeta = sessionStorage.getItem("sunsync_reopened_meta");
        if (cached) {
          try {
            setData(JSON.parse(cached));
            setIsReopened(true);
            if (cachedMeta) setReopenedMeta(JSON.parse(cachedMeta));
            setLoading(false);
            return;
          } catch {
            // fallback to fetch
          }
        }
        getOptimizationRun(runId)
          .then((res) => {
            setData(res.results);
            setIsReopened(true);
            setReopenedMeta({
              id: res.id,
              created_at: res.created_at,
              scenario: res.scenario,
              solver_name: res.solver_name
            });
          })
          .catch(() => {
            fetchOptimization();
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
    if (!data || !data.strategies[selectedStrategy]) return;
    const strat = data.strategies[selectedStrategy]!;
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

  if (error || !data) {
    return (
      <div className="py-16 text-center space-y-4 bg-slate-900/40 rounded-xl border border-slate-800 p-8">
        <p className="text-rose-400 text-sm font-semibold">Error loading optimization: {error}</p>
        <button
          onClick={() => fetchOptimization(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-xs font-semibold hover:bg-blue-500"
        >
          Retry Optimization
        </button>
      </div>
    );
  }

  const baseStrat = data.strategies.baseline!;
  const currentStrat = data.strategies[selectedStrategy] || baseStrat;
  const baseKpi = baseStrat.kpis;
  const currKpi = currentStrat.kpis;

  // Compute live deltas vs baseline
  const costDelta = currKpi.daily_cost_rs - baseKpi.daily_cost_rs;
  const costDeltaPct = ((costDelta / baseKpi.daily_cost_rs) * 100).toFixed(1);

  const peakDelta = currKpi.peak_grid_demand_kw - baseKpi.peak_grid_demand_kw;
  const peakDeltaPct = ((peakDelta / baseKpi.peak_grid_demand_kw) * 100).toFixed(1);

  const solarDelta = currKpi.solar_energy_used_kwh - baseKpi.solar_energy_used_kwh;
  const solarDeltaPct = baseKpi.solar_energy_used_kwh > 0 
    ? ((solarDelta / baseKpi.solar_energy_used_kwh) * 100).toFixed(1) 
    : "+100";

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
                sessionStorage.removeItem("sunsync_reopened_run");
                sessionStorage.removeItem("sunsync_reopened_meta");
                const url = new URL(window.location.href);
                url.searchParams.delete("reopened");
                url.searchParams.delete("runId");
                window.history.replaceState({}, "", url.pathname);
              }
              setIsReopened(false);
              setReopenedMeta(null);
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
              Live MILP Optimal
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Site: <strong className="text-slate-300">Peenya Precision Engineering (Demo Unit)</strong> • 96 intervals (15-min grid)
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
              Active: <span className="font-semibold text-white">{currentStrat.display_title}</span> vs <span className="text-slate-400">Baseline (Earliest Start)</span>
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
                {currKpi.solar_self_consumption_pct}%
                <span className="text-[11px] font-normal text-slate-400 ml-1">({currKpi.solar_energy_used_kwh} kWh)</span>
              </div>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 px-3 py-2 rounded-lg text-center">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Avoided CO2</div>
              <div className="text-sm font-extrabold text-emerald-400">
                {currKpi.avoided_co2_kg ?? (currKpi.solar_energy_used_kwh * 0.82).toFixed(1)} kg
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
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        <KPICard
          label="Daily Electricity Cost"
          value={formatRs(currKpi.daily_cost_rs)}
          baseValue={formatRs(baseKpi.daily_cost_rs)}
          deltaText={selectedStrategy !== "baseline" ? `${costDeltaPct}% (${formatRs(Math.abs(costDelta))})` : undefined}
          isPositiveBenefit={costDelta <= 0}
          badge="Computed"
        />

        <KPICard
          label="Peak Grid Demand"
          value={`${currKpi.peak_grid_demand_kw}`}
          unit="kW"
          baseValue={`${baseKpi.peak_grid_demand_kw} kW`}
          deltaText={selectedStrategy !== "baseline" ? `${peakDeltaPct}% (${peakDelta.toFixed(1)} kW)` : undefined}
          isPositiveBenefit={peakDelta <= 0}
          badge="Max Slot"
        />

        <KPICard
          label="Solar Consumed On-Site"
          value={`${currKpi.solar_energy_used_kwh}`}
          unit="kWh"
          baseValue={`${baseKpi.solar_energy_used_kwh} kWh`}
          deltaText={selectedStrategy !== "baseline" ? `+${solarDelta.toFixed(1)} kWh (${solarDeltaPct}%)` : undefined}
          isPositiveBenefit={solarDelta >= 0}
          badge={`${currKpi.solar_self_consumption_pct}% Total Solar`}
        />

        <KPICard
          label="Net Grid Imported"
          value={`${currKpi.grid_energy_imported_kwh}`}
          unit="kWh"
          baseValue={`${baseKpi.grid_energy_imported_kwh} kWh`}
          deltaText={selectedStrategy !== "baseline" ? `${(currKpi.grid_energy_imported_kwh - baseKpi.grid_energy_imported_kwh).toFixed(1)} kWh` : undefined}
          isPositiveBenefit={currKpi.grid_energy_imported_kwh <= baseKpi.grid_energy_imported_kwh}
          subtext={`Avoided: ${currKpi.avoided_co2_kg ?? (currKpi.solar_energy_used_kwh * 0.82).toFixed(1)} kg CO2 | Grid: ${currKpi.estimated_co2_kg} kg`}
        />

        <div className="col-span-2 md:col-span-1">
          <DeadlineViolationsCard count={currKpi.deadline_violations} />
        </div>
      </div>

      {/* Dispatch Curves Chart */}
      <LoadDispatchChart
        strategyName={currentStrat.display_title}
        loadProfile={currentStrat.load_profile}
        gridProfile={currentStrat.grid_profile}
        solarProfile={currentStrat.solar_profile}
        solarUsedProfile={currentStrat.solar_used_profile}
        peakKw={currKpi.peak_grid_demand_kw}
      />

      {/* Gantt Production Schedule Chart */}
      <GanttScheduleChart
        baselineSchedules={baseStrat.machine_schedules}
        optimizedSchedules={currentStrat.machine_schedules}
        title={`Gantt Dispatch: Baseline vs ${currentStrat.display_title}`}
      />

      {/* Plain Language Reasons Panel */}
      <ReasonPanel
        baselineSchedules={baseStrat.machine_schedules}
        optimizedSchedules={currentStrat.machine_schedules}
        machineReasons={data.machine_reasons}
      />

      {/* Printable Executive Summary Report */}
      <PrintableReport
        siteName="Peenya Precision Engineering (Demo Unit)"
        siteLocation="Peenya Industrial Area, Bengaluru, Karnataka, India"
        baseline={baseStrat}
        optimized={currentStrat}
        disclaimer={data.disclaimer}
      />
    </div>
  );
}
