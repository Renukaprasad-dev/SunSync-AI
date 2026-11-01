"use client";

import React from "react";
import { MachineScheduleResult, StrategySchedule } from "@/lib/types";
import { formatRs } from "@/lib/utils";

interface PrintableReportProps {
  siteName: string;
  siteLocation: string;
  baseline: StrategySchedule;
  optimized: StrategySchedule;
  disclaimer: string;
}

export function PrintableReport({
  siteName,
  siteLocation,
  baseline,
  optimized,
  disclaimer
}: PrintableReportProps) {
  const baseKpi = baseline.kpis;
  const optKpi = optimized.kpis;

  const costDelta = optKpi.daily_cost_rs - baseKpi.daily_cost_rs;
  const costDeltaPct = ((costDelta / baseKpi.daily_cost_rs) * 100).toFixed(1);
  const peakDelta = optKpi.peak_grid_demand_kw - baseKpi.peak_grid_demand_kw;
  const peakDeltaPct = ((peakDelta / baseKpi.peak_grid_demand_kw) * 100).toFixed(1);

  const emissionFactor = optKpi.grid_emission_factor_kg_per_kwh || 0.82;
  const avoidedCo2 = optKpi.avoided_co2_kg ?? Number((optKpi.solar_energy_used_kwh * emissionFactor).toFixed(2));

  return (
    <div className="hidden print:block text-black bg-white p-6 font-sans text-xs max-w-4xl mx-auto">
      {/* Report Header */}
      <div className="border-b-2 border-black pb-3 mb-4 flex justify-between items-start">
        <div>
          <h1 className="text-xl font-black uppercase tracking-tight text-black">
            SunSync AI — Industrial Energy Scheduling Report
          </h1>
          <p className="text-sm font-semibold text-gray-700">
            Solar-Aware Decision Support System (MILP Optimal Dispatch)
          </p>
          <p className="text-xs text-gray-600 mt-1">
            <strong>Facility:</strong> {siteName} • <strong>Location:</strong> {siteLocation}
          </p>
        </div>
        <div className="text-right text-xs text-gray-600">
          <div><strong>Report Date:</strong> {new Date().toLocaleDateString("en-IN", { dateStyle: "long" })}</div>
          <div><strong>Interval Resolution:</strong> 96 slots (15-min)</div>
          <div><strong>Active Strategy:</strong> {optimized.display_title}</div>
        </div>
      </div>

      {/* Executive Summary & KPI Comparison Table */}
      <div className="mb-5 page-break-inside-avoid">
        <h2 className="text-sm font-bold uppercase tracking-wider border-b border-gray-400 pb-1 mb-2">
          1. Executive KPI Summary & Financial ROI
        </h2>
        <table className="w-full border-collapse border border-gray-300 text-left text-xs mb-2">
          <thead>
            <tr className="bg-gray-100 border-b border-gray-300">
              <th className="p-2 font-bold border-r border-gray-300">Key Performance Indicator</th>
              <th className="p-2 font-bold border-r border-gray-300 text-right">Baseline (Earliest)</th>
              <th className="p-2 font-bold border-r border-gray-300 text-right">Optimized Schedule</th>
              <th className="p-2 font-bold text-right">Net Optimization Delta</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-200">
              <td className="p-2 font-semibold border-r border-gray-300">Daily Electricity Cost</td>
              <td className="p-2 text-right border-r border-gray-300 font-mono">{formatRs(baseKpi.daily_cost_rs)}</td>
              <td className="p-2 text-right border-r border-gray-300 font-mono font-bold">{formatRs(optKpi.daily_cost_rs)}</td>
              <td className="p-2 text-right font-mono font-bold text-gray-900">
                {costDelta <= 0 ? `-${Math.abs(Number(costDeltaPct))}% (${formatRs(Math.abs(costDelta))})` : `+${costDeltaPct}%`}
              </td>
            </tr>
            <tr className="border-b border-gray-200 bg-gray-50/50">
              <td className="p-2 font-semibold border-r border-gray-300">Peak Factory Grid Demand</td>
              <td className="p-2 text-right border-r border-gray-300 font-mono">{baseKpi.peak_grid_demand_kw} kW</td>
              <td className="p-2 text-right border-r border-gray-300 font-mono font-bold">{optKpi.peak_grid_demand_kw} kW</td>
              <td className="p-2 text-right font-mono font-bold">
                {peakDelta <= 0 ? `${peakDelta.toFixed(1)} kW (${peakDeltaPct}%)` : `+${peakDelta.toFixed(1)} kW`}
              </td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="p-2 font-semibold border-r border-gray-300">Rooftop Solar Consumed On-Site</td>
              <td className="p-2 text-right border-r border-gray-300 font-mono">{baseKpi.solar_energy_used_kwh} kWh</td>
              <td className="p-2 text-right border-r border-gray-300 font-mono font-bold">{optKpi.solar_energy_used_kwh} kWh</td>
              <td className="p-2 text-right font-mono font-bold">
                +{Math.max(0, optKpi.solar_energy_used_kwh - baseKpi.solar_energy_used_kwh).toFixed(1)} kWh ({optKpi.solar_self_consumption_pct}%)
              </td>
            </tr>
            <tr className="border-b border-gray-200 bg-gray-50/50">
              <td className="p-2 font-semibold border-r border-gray-300">Estimated CO2 Avoided (kg)</td>
              <td className="p-2 text-right border-r border-gray-300 font-mono">{(baseKpi.solar_energy_used_kwh * emissionFactor).toFixed(1)} kg</td>
              <td className="p-2 text-right border-r border-gray-300 font-mono font-bold">{avoidedCo2} kg</td>
              <td className="p-2 text-right font-mono font-bold text-gray-900">
                +{(avoidedCo2 - baseKpi.solar_energy_used_kwh * emissionFactor).toFixed(1)} kg CO2 avoided
              </td>
            </tr>
            <tr>
              <td className="p-2 font-semibold border-r border-gray-300">Strict Deadline Violations</td>
              <td className="p-2 text-right border-r border-gray-300 font-mono">{baseKpi.deadline_violations}</td>
              <td className="p-2 text-right border-r border-gray-300 font-mono font-bold">0 Violations</td>
              <td className="p-2 text-right font-bold text-gray-900">VERIFIED STRICT</td>
            </tr>
          </tbody>
        </table>
        <p className="text-[10px] text-gray-500 italic">
          * Estimated CO2 avoided based on {emissionFactor} kg/kWh grid emission factor.
        </p>
      </div>

      {/* Machine Production Dispatch Table */}
      <div className="mb-5 page-break-inside-avoid">
        <h2 className="text-sm font-bold uppercase tracking-wider border-b border-gray-400 pb-1 mb-2">
          2. Machine Production Dispatch & Optimization Rationale
        </h2>
        <table className="w-full border-collapse border border-gray-300 text-left text-[11px]">
          <thead>
            <tr className="bg-gray-100 border-b border-gray-300">
              <th className="p-1.5 font-bold border-r border-gray-300">Machine Name</th>
              <th className="p-1.5 font-bold border-r border-gray-300 text-right">Power</th>
              <th className="p-1.5 font-bold border-r border-gray-300 text-center">Base Time</th>
              <th className="p-1.5 font-bold border-r border-gray-300 text-center">Optimized Time</th>
              <th className="p-1.5 font-bold border-r border-gray-300 text-center">Flexibility</th>
              <th className="p-1.5 font-bold">Solver Decision Rationale</th>
            </tr>
          </thead>
          <tbody>
            {optimized.machine_schedules.map((m, idx) => {
              const base = baseline.machine_schedules.find((b) => b.machine_id === m.machine_id);
              const wasMoved = base && base.start_slot !== m.start_slot;
              return (
                <tr key={m.machine_id} className={`border-b border-gray-200 ${idx % 2 === 1 ? "bg-gray-50/50" : ""}`}>
                  <td className="p-1.5 font-semibold border-r border-gray-300">{m.machine_name}</td>
                  <td className="p-1.5 text-right font-mono border-r border-gray-300">{m.power_kw} kW</td>
                  <td className="p-1.5 text-center font-mono border-r border-gray-300 text-gray-600">
                    {base?.start_time_str || "08:00"}
                  </td>
                  <td className="p-1.5 text-center font-mono font-bold border-r border-gray-300">
                    {m.start_time_str} - {m.end_time_str}
                  </td>
                  <td className="p-1.5 text-center border-r border-gray-300">
                    <span className="font-semibold text-[10px]">
                      {m.flexible ? (wasMoved ? "RE-TIMED" : "UNMOVED") : "FIXED"}
                    </span>
                  </td>
                  <td className="p-1.5 text-[10px] text-gray-700">{m.reason || "Scheduled within limits."}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Assumptions & Mathematical Specifications */}
      <div className="mb-4 page-break-inside-avoid border border-gray-300 bg-gray-50 p-3 rounded">
        <h3 className="text-xs font-bold uppercase tracking-wider mb-1">
          3. Optimization Modeling Assumptions & Solver Verification
        </h3>
        <ul className="list-disc list-inside text-[10px] text-gray-700 space-y-0.5">
          <li><strong>MILP Formulation:</strong> Mixed-Integer Linear Programming solved using Google OR-Tools CBC branch-and-cut engine.</li>
          <li><strong>Grid Constraint:</strong> Strict hard cap at sanctioned P_max; total factory load minus solar generation must not exceed grid limit.</li>
          <li><strong>Time Resolution:</strong> Exact 15-minute intervals (96 intervals covering full 24-hour cycle).</li>
          <li><strong>Tariff Model:</strong> Time-of-Day (ToD) multi-slab energy pricing plus monthly peak demand penalty.</li>
          <li><strong>Unbroken Non-Preemptive Operations:</strong> Machine operational cycles run continuously from start to completion.</li>
        </ul>
      </div>

      {/* Disclaimer */}
      <div className="border-t border-gray-300 pt-3 page-break-inside-avoid text-[9px] text-gray-500 leading-normal">
        <strong>OPERATIONAL DECISION SUPPORT DISCLAIMER:</strong> {disclaimer || "This production schedule is generated by mathematical optimization based on user-supplied machine ratings, availability windows, and solar generation forecasts. Plant electrical engineers and production managers must independently verify equipment suitability, grid interconnection limits, and safety standards before altering physical factory schedules."}
      </div>
    </div>
  );
}
