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
  History
} from "lucide-react";

import { runOptimization, getOptimizationRun } from "@/lib/api";
import { OptimizationResponse, StrategySchedule } from "@/lib/types";
import { KPICard, DeadlineViolationsCard } from "@/components/kpi-card";
import { LoadDispatchChart } from "@/components/charts/load-dispatch-chart";
import { GanttScheduleChart } from "@/components/charts/gantt-chart";
import { ReasonPanel } from "@/components/reason-card";
import { SimulationDisclaimer } from "@/components/disclaimer";
import { formatRs } from "@/lib/utils";

export default function DashboardPage() {
  const [data, setData] = useState<OptimizationResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<"cost_optimized" | "solar_aware" | "baseline">("cost_optimized");
  const [isReopened, setIsReopened] = useState<boolean>(false);
  const [reopenedMeta, setReopenedMeta] = useState<{ id?: string; created_at?: string; scenario?: string; solver_name?: string } | null>(null);

  const fetchOptimization = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await runOptimization({
        scenario: "sunny",
        strategies: ["baseline", "solar_aware", "cost_optimized"]
      });
      setData(resp);
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
    const rows = [
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

    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `SunSync_${selectedStrategy}_schedule.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="py-24 text-center space-y-4">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="text-slate-400 text-sm font-medium">Running OR-Tools MILP Solver for 3 Strategies...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="py-16 text-center space-y-4 bg-slate-900/40 rounded-xl border border-slate-800 p-8">
        <p className="text-rose-400 text-sm font-semibold">Error loading optimization: {error}</p>
        <button
          onClick={fetchOptimization}
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
            onClick={fetchOptimization}
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
        </div>
      </div>

      {/* Strategy Toggle Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1 bg-slate-900 border border-slate-800 rounded-xl">
        <button
          onClick={() => setSelectedStrategy("cost_optimized")}
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
          onClick={() => setSelectedStrategy("solar_aware")}
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
          onClick={() => setSelectedStrategy("baseline")}
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
          subtext={`CO2: ${currKpi.estimated_co2_kg} kg`}
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
    </div>
  );
}
