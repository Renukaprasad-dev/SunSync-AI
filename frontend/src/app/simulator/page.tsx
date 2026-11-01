"use client";

import React, { useState, useEffect, useCallback } from "react";
import { 
  CloudSun, 
  Sun, 
  CloudRain, 
  RotateCw, 
  CheckCircle2, 
  TrendingDown, 
  Zap, 
  Coins, 
  Sliders, 
  Clock, 
  Undo2, 
  AlertCircle, 
  Layers, 
  DollarSign, 
  ShieldCheck 
} from "lucide-react";

import { runSimulation, getSiteConfig } from "@/lib/api";
import { OptimizationResponse, Machine, Tariff } from "@/lib/types";
import { LoadDispatchChart } from "@/components/charts/load-dispatch-chart";
import { GanttScheduleChart } from "@/components/charts/gantt-chart";
import { KPICard, DeadlineViolationsCard } from "@/components/kpi-card";
import { ReasonPanel } from "@/components/reason-card";
import { SimulationDisclaimer } from "@/components/disclaimer";
import { formatRs, slotToTime } from "@/lib/utils";

export default function SimulatorPage() {
  const [scenario, setScenario] = useState<"sunny" | "partly_cloudy" | "overcast">("overcast");
  const [data, setData] = useState<OptimizationResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Transient What-If Sandbox parameters (never persisted automatically to DB)
  const [machines, setMachines] = useState<Machine[]>([]);
  const [tariff, setTariff] = useState<Tariff | null>(null);
  const [pMax, setPMax] = useState<number>(25.0);
  const [rateMultiplier, setRateMultiplier] = useState<number>(1.0);
  const [showSandbox, setShowSandbox] = useState<boolean>(true);
  const [initialDefaults, setInitialDefaults] = useState<{ machines: Machine[]; tariff: Tariff; pMax: number } | null>(null);

  // Load saved baseline configuration on mount
  useEffect(() => {
    getSiteConfig()
      .then((cfg) => {
        setMachines(cfg.machines);
        setTariff(cfg.tariff);
        setPMax(cfg.site.p_max_grid_kw || 25.0);
        setInitialDefaults({
          machines: cfg.machines,
          tariff: cfg.tariff,
          pMax: cfg.site.p_max_grid_kw || 25.0
        });
      })
      .catch((e) => {
        console.warn("Could not load factory site config for simulator:", e);
      });
  }, []);

  const executeSimulation = useCallback(async (
    targetScenario: "sunny" | "partly_cloudy" | "overcast",
    customMachines?: Machine[],
    customTariff?: Tariff | null,
    customPMax?: number,
    multiplier: number = 1.0
  ) => {
    setLoading(true);
    setError(null);
    try {
      const activeTariff = customTariff || tariff;
      let effectiveTariff = activeTariff ? { ...activeTariff } : undefined;
      if (effectiveTariff && multiplier !== 1.0) {
        effectiveTariff.rates = effectiveTariff.rates.map((r) => roundToTwo(r * multiplier));
      }

      const resp = await runSimulation({
        scenario: targetScenario,
        machines: customMachines || (machines.length > 0 ? machines : undefined),
        tariff: effectiveTariff,
        p_max_grid_kw: customPMax !== undefined ? customPMax : pMax
      });
      setData(resp);
    } catch (e: any) {
      setError(e?.message || "What-If simulation run failed.");
    } finally {
      setLoading(false);
    }
  }, [machines, tariff, pMax]);

  useEffect(() => {
    executeSimulation(scenario, undefined, undefined, undefined, rateMultiplier);
  }, [scenario]);

  const handleMachineChange = (idx: number, field: keyof Machine, value: any) => {
    setMachines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const handleResetDefaults = () => {
    if (initialDefaults) {
      setMachines(initialDefaults.machines);
      setTariff(initialDefaults.tariff);
      setPMax(initialDefaults.pMax);
      setRateMultiplier(1.0);
      executeSimulation(scenario, initialDefaults.machines, initialDefaults.tariff, initialDefaults.pMax, 1.0);
    }
  };

  const baseStrat = data?.strategies.baseline;
  const optStrat = data?.strategies.cost_optimized;

  return (
    <div className="space-y-6 py-2">
      <SimulationDisclaimer />

      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <CloudSun className="w-6 h-6 text-amber-400" />
            What-If Scenario Simulator
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Test parameter sensitivity, machine availability windows, and strict grid caps without altering saved factory data.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowSandbox(!showSandbox)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <Sliders className="w-3.5 h-3.5 text-blue-400" />
            {showSandbox ? "Hide Sandbox Controls" : "Edit What-If Constraints"}
          </button>

          <button
            onClick={() => executeSimulation(scenario, machines, tariff, pMax, rateMultiplier)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors disabled:opacity-50"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Run What-If Solver
          </button>
        </div>
      </div>

      {/* Weather Scenario Preset Selector */}
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
            Standard solar bell curve peaking at ~5.0 kW. Optimizer packs flexible loads into 10:30–14:30.
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
            Midday cloud dips (~3.8 kW peak). Optimizer tracks intermittent solar to prevent grid spikes.
          </p>
        </button>

        <button
          onClick={() => setScenario("overcast")}
          className={`p-4 rounded-xl border text-left transition-all ${
            scenario === "overcast"
              ? "bg-purple-500/10 border-purple-500 text-white shadow-lg shadow-purple-500/5 ring-1 ring-purple-500"
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

      {/* Expandable What-If Sandbox Control Deck */}
      {showSandbox && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold text-white">
                  What-If Parameters Sandbox
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Unsaved / Ephemeral
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Simulate stricter grid limits, shift deadline windows, or adjust tariff rates without modifying factory database.
              </p>
            </div>

            <button
              onClick={handleResetDefaults}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors w-fit"
            >
              <Undo2 className="w-3.5 h-3.5" />
              Reset to Saved Factory Config
            </button>
          </div>

          {/* Quick Grid Limit & Tariff Adjusters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">
                Factory Grid Import Limit (P_max)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.5"
                  min="5"
                  max="50"
                  value={pMax}
                  onChange={(e) => setPMax(parseFloat(e.target.value) || 25.0)}
                  className="bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs font-semibold text-white w-28 focus:outline-none focus:border-blue-500"
                />
                <span className="text-xs text-slate-400">kW</span>
              </div>
              <span className="text-[11px] text-slate-500 mt-1 block">Try lowering to 15 kW to test staggering.</span>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">
                Tariff Energy Rate Scenario
              </label>
              <select
                value={rateMultiplier}
                onChange={(e) => setRateMultiplier(parseFloat(e.target.value) || 1.0)}
                className="bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs font-semibold text-white w-full focus:outline-none focus:border-blue-500"
              >
                <option value={1.0}>Standard BESCOM ToD Tariff (1.0x)</option>
                <option value={1.25}>+25% Energy Price Hike (1.25x)</option>
                <option value={1.50}>+50% Extreme Peak Crisis (1.50x)</option>
                <option value={0.80}>-20% Off-Peak Rebate Scenario (0.8x)</option>
              </select>
              <span className="text-[11px] text-slate-500 mt-1 block">Scales all 96-interval ToD rates.</span>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">
                Peak Demand Charge Rate
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">₹</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={tariff?.demand_charge_rate_per_kw || 20.0}
                  onChange={(e) => {
                    if (tariff) {
                      setTariff({ ...tariff, demand_charge_rate_per_kw: parseFloat(e.target.value) || 20.0 });
                    }
                  }}
                  className="bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs font-semibold text-white w-28 focus:outline-none focus:border-blue-500"
                />
                <span className="text-xs text-slate-400">/ kW</span>
              </div>
              <span className="text-[11px] text-slate-500 mt-1 block">Monthly peak demand penalty.</span>
            </div>
          </div>

          {/* Machine Windows & Deadlines Table */}
          <div className="pt-2">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              Machine Windows & Deadlines (What-If Edits)
            </h3>
            <div className="overflow-x-auto border border-slate-800/80 rounded-lg">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-950/60 border-b border-slate-800 text-slate-400 uppercase font-semibold text-[11px]">
                    <th className="py-2.5 px-3">Machine Name</th>
                    <th className="py-2.5 px-3 text-right">Power (kW)</th>
                    <th className="py-2.5 px-3 text-right">Duration</th>
                    <th className="py-2.5 px-3">Earliest Start</th>
                    <th className="py-2.5 px-3">Latest Start</th>
                    <th className="py-2.5 px-3">Deadline (T_due)</th>
                    <th className="py-2.5 px-3 text-center">Flexibility</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-200">
                  {machines.map((m, idx) => (
                    <tr key={m.id} className="hover:bg-slate-800/20 transition-colors">
                      <td className="py-2.5 px-3 font-medium text-slate-200">
                        {m.name}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {m.power_kw} kW
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {m.duration_intervals} slots ({(m.duration_intervals * 0.25).toFixed(1)}h)
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            max="95"
                            value={m.earliest_start}
                            onChange={(e) => handleMachineChange(idx, "earliest_start", parseInt(e.target.value) || 0)}
                            className="bg-slate-950 border border-slate-800 rounded px-2 py-0.5 w-16 text-right font-mono text-white"
                          />
                          <span className="text-slate-400 text-[11px]">({slotToTime(m.earliest_start)})</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            max="95"
                            value={m.latest_start}
                            disabled={!m.flexible}
                            onChange={(e) => handleMachineChange(idx, "latest_start", parseInt(e.target.value) || 0)}
                            className={`rounded px-2 py-0.5 w-16 text-right font-mono ${
                              !m.flexible
                                ? "bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed"
                                : "bg-slate-950 border border-slate-800 text-white"
                            }`}
                          />
                          <span className="text-slate-400 text-[11px]">({slotToTime(m.latest_start)})</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="1"
                            max="96"
                            value={m.deadline_interval}
                            onChange={(e) => handleMachineChange(idx, "deadline_interval", parseInt(e.target.value) || 1)}
                            className="bg-slate-950 border border-slate-800 rounded px-2 py-0.5 w-16 text-right font-mono text-white"
                          />
                          <span className="text-slate-400 text-[11px]">({slotToTime(m.deadline_interval)})</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            const newFlex = !m.flexible;
                            handleMachineChange(idx, "flexible", newFlex);
                            if (!newFlex) {
                              handleMachineChange(idx, "latest_start", m.earliest_start);
                            }
                          }}
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                            m.flexible
                              ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                              : "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                          }`}
                        >
                          {m.flexible ? "Flexible" : "Fixed"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="bg-rose-950/30 border border-rose-800/50 rounded-xl p-4 text-rose-300 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => executeSimulation(scenario, machines, tariff, pMax, rateMultiplier)}
            className="underline hover:text-white"
          >
            Retry
          </button>
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

function roundToTwo(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}
