"use client";

import React, { useState, useEffect } from "react";
import { CloudSun, Sun, CloudRain, RotateCw, CheckCircle2, TrendingDown, Zap, Coins } from "lucide-react";
import { runSimulation } from "@/lib/api";
import { OptimizationResponse } from "@/lib/types";
import { LoadDispatchChart } from "@/components/charts/load-dispatch-chart";
import { GanttScheduleChart } from "@/components/charts/gantt-chart";
import { KPICard, DeadlineViolationsCard } from "@/components/kpi-card";
import { ReasonPanel } from "@/components/reason-card";
import { SimulationDisclaimer } from "@/components/disclaimer";
import { formatRs } from "@/lib/utils";

export default function SimulatorPage() {
  const [scenario, setScenario] = useState<"sunny" | "partly_cloudy" | "overcast">("overcast");
  const [data, setData] = useState<OptimizationResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const executeSimulation = async (targetScenario: "sunny" | "partly_cloudy" | "overcast") => {
    setLoading(true);
    setError(null);
    try {
      const resp = await runSimulation({
        scenario: targetScenario
      });
      setData(resp);
    } catch (e: any) {
      setError(e?.message || "Simulation failed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    executeSimulation(scenario);
  }, [scenario]);

  const baseStrat = data?.strategies.baseline;
  const optStrat = data?.strategies.cost_optimized;

  return (
    <div className="space-y-6 py-2">
      <SimulationDisclaimer />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <CloudSun className="w-6 h-6 text-amber-400" />
            What-If Scenario Simulator
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Test system behavior across different weather regimes: Sunny, Partly Cloudy, and Overcast Tariff Arbitrage.
          </p>
        </div>

        <button
          onClick={() => executeSimulation(scenario)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white"
        >
          <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Recalculate
        </button>
      </div>

      {/* Scenario Presets Selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          onClick={() => setScenario("sunny")}
          className={`p-4 rounded-xl border text-left transition-all ${
            scenario === "sunny"
              ? "bg-amber-500/10 border-amber-500 text-white shadow-lg shadow-amber-500/5 ring-1 ring-amber-500"
              : "bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
              <Sun className="w-5 h-5" />
            </div>
            {scenario === "sunny" && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30">
                ACTIVE
              </span>
            )}
          </div>
          <h3 className="font-bold text-sm text-slate-100">1. Clear Sunny Day</h3>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Standard bell curve peaking at ~5.0 kW. Optimizer packs flexible loads into 10:30–14:30.
          </p>
        </button>

        <button
          onClick={() => setScenario("partly_cloudy")}
          className={`p-4 rounded-xl border text-left transition-all ${
            scenario === "partly_cloudy"
              ? "bg-blue-500/10 border-blue-500 text-white shadow-lg shadow-blue-500/5 ring-1 ring-blue-500"
              : "bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
              <CloudSun className="w-5 h-5" />
            </div>
            {scenario === "partly_cloudy" && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/30">
                ACTIVE
              </span>
            )}
          </div>
          <h3 className="font-bold text-sm text-slate-100">2. Partly Cloudy Day</h3>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Variable solar peaking at ~3.8 kW with afternoon cloud dips. Re-balances peak demand with solar.
          </p>
        </button>

        <button
          onClick={() => setScenario("overcast")}
          className={`p-4 rounded-xl border text-left transition-all ${
            scenario === "overcast"
              ? "bg-purple-500/15 border-purple-500 text-white shadow-lg shadow-purple-500/5 ring-1 ring-purple-500"
              : "bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400">
              <CloudRain className="w-5 h-5" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/30 text-purple-200 font-bold border border-purple-500/40">
                TARIFF ARBITRAGE
              </span>
              {scenario === "overcast" && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-semibold">
                  ACTIVE
                </span>
              )}
            </div>
          </div>
          <h3 className="font-bold text-sm text-slate-100">3. Overcast / Monsoon Day</h3>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Solar near zero (&lt;0.5 kW). Savings generated strictly by shifting loads out of morning & evening tariff spikes!
          </p>
        </button>
      </div>

      {scenario === "overcast" && (
        <div className="bg-purple-950/20 border border-purple-500/30 rounded-xl p-4 flex items-start gap-3">
          <Coins className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
          <div className="text-xs text-purple-200 space-y-1">
            <strong>Overcast Tariff Arbitrage Active:</strong> With solar generation near zero, SunSync AI automatically shifts flexible machines (such as the CNC Center and Air Compressor) away from the morning 08:00–10:00 peak tariff (₹9.00/kWh) and evening peak (₹9.50/kWh) into normal day slots (₹7.00/kWh) and off-peak slots.
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center space-y-3">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-xs text-slate-400 font-medium">Re-computing MILP optimal schedule for {scenario} scenario...</p>
        </div>
      ) : data && baseStrat && optStrat ? (
        <div className="space-y-6">
          {/* KPI Summary for this scenario */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
            <KPICard
              label="Daily Electricity Cost"
              value={formatRs(optStrat.kpis.daily_cost_rs)}
              baseValue={formatRs(baseStrat.kpis.daily_cost_rs)}
              deltaText={`${(((optStrat.kpis.daily_cost_rs - baseStrat.kpis.daily_cost_rs) / baseStrat.kpis.daily_cost_rs) * 100).toFixed(1)}% (${formatRs(Math.abs(optStrat.kpis.daily_cost_rs - baseStrat.kpis.daily_cost_rs))})`}
              isPositiveBenefit={optStrat.kpis.daily_cost_rs <= baseStrat.kpis.daily_cost_rs}
            />

            <KPICard
              label="Peak Grid Demand"
              value={`${optStrat.kpis.peak_grid_demand_kw}`}
              unit="kW"
              baseValue={`${baseStrat.kpis.peak_grid_demand_kw} kW`}
              deltaText={`${(((optStrat.kpis.peak_grid_demand_kw - baseStrat.kpis.peak_grid_demand_kw) / baseStrat.kpis.peak_grid_demand_kw) * 100).toFixed(1)}%`}
              isPositiveBenefit={optStrat.kpis.peak_grid_demand_kw <= baseStrat.kpis.peak_grid_demand_kw}
            />

            <KPICard
              label="Solar Energy Used"
              value={`${optStrat.kpis.solar_energy_used_kwh}`}
              unit="kWh"
              baseValue={`${baseStrat.kpis.solar_energy_used_kwh} kWh`}
              subtext={scenario === "overcast" ? "Diffuse Solar" : "Self-consumed"}
            />

            <KPICard
              label="Net Grid Energy"
              value={`${optStrat.kpis.grid_energy_imported_kwh}`}
              unit="kWh"
              baseValue={`${baseStrat.kpis.grid_energy_imported_kwh} kWh`}
              subtext={`CO2: ${optStrat.kpis.estimated_co2_kg} kg`}
            />

            <div className="col-span-2 md:col-span-1">
              <DeadlineViolationsCard count={optStrat.kpis.deadline_violations} />
            </div>
          </div>

          <LoadDispatchChart
            strategyName={`Cost-Optimized (${scenario.toUpperCase()})`}
            loadProfile={optStrat.load_profile}
            gridProfile={optStrat.grid_profile}
            solarProfile={optStrat.solar_profile}
            solarUsedProfile={optStrat.solar_used_profile}
            peakKw={optStrat.kpis.peak_grid_demand_kw}
          />

          <GanttScheduleChart
            baselineSchedules={baseStrat.machine_schedules}
            optimizedSchedules={optStrat.machine_schedules}
            title={`Gantt Schedule: Baseline vs Cost-Optimized (${scenario})`}
          />

          <ReasonPanel
            baselineSchedules={baseStrat.machine_schedules}
            optimizedSchedules={optStrat.machine_schedules}
            machineReasons={data.machine_reasons}
          />
        </div>
      ) : null}
    </div>
  );
}
