"use client";

import React, { useState } from "react";
import { 
  FileCheck, 
  RotateCw, 
  AlertTriangle, 
  CheckCircle2, 
  AlertCircle, 
  Zap, 
  Calendar, 
  TrendingUp, 
  TrendingDown, 
  Info, 
  DollarSign, 
  Building2,
  Sparkles
} from "lucide-react";

import { checkBillReality } from "@/lib/api";
import { BillRealityCheckResponse } from "@/lib/types";
import { SimulationDisclaimer } from "@/components/disclaimer";
import { formatRs } from "@/lib/utils";

export default function BillRealityCheckPage() {
  const [operatingDays, setOperatingDays] = useState<number>(26);
  const [realEnergyKwh, setRealEnergyKwh] = useState<number>(2500);
  const [realEnergyChargeRs, setRealEnergyChargeRs] = useState<number>(18500);
  const [realDemandKw, setRealDemandKw] = useState<number>(19.5);
  const [realDemandChargeRs, setRealDemandChargeRs] = useState<number>(390);

  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<BillRealityCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunCheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await checkBillReality({
        operating_days: operatingDays,
        real_energy_kwh: realEnergyKwh,
        real_energy_charge_rs: realEnergyChargeRs,
        real_demand_kw: realDemandKw,
        real_demand_charge_rs: realDemandChargeRs
      });
      setResult(resp);
    } catch (err: any) {
      setError(err?.message || "Failed to calculate bill reality comparison.");
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSample = () => {
    setOperatingDays(26);
    setRealEnergyKwh(2480);
    setRealEnergyChargeRs(18200);
    setRealDemandKw(20.5);
    setRealDemandChargeRs(410);
    setError(null);
  };

  // Initial calculation on mount
  React.useEffect(() => {
    handleRunCheck();
  }, []);

  return (
    <div className="space-y-6">
      {/* Top Banner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <FileCheck className="w-4 h-4" />
            Decision Support Sanity Check
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Utility Bill Reality Check
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Compare your actual monthly electricity bill against SunSync AI's scaled baseline model to detect unmodeled auxiliary loads, motor inrushes, or shift variations.
          </p>
        </div>

        <button
          onClick={handleLoadSample}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-semibold border border-amber-500/30 transition-colors w-fit"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Load Sample BESCOM Bill
        </button>
      </div>

      {/* Prominent Sanity Check Disclaimer Banner */}
      <div className="bg-amber-950/30 border border-amber-600/40 rounded-xl p-4 flex items-start gap-3.5 text-amber-200">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <span className="font-bold uppercase tracking-wider text-amber-400 block">
            Sanity Check Disclaimer — Not Formal Validation
          </span>
          <p className="text-slate-300 leading-relaxed">
            This tool performs an order-of-magnitude <strong>sanity check</strong> against an actual monthly utility electricity bill to calibrate machine model assumptions. It is <strong>not formal regulatory billing validation</strong> or revenue-grade tariff audit. Utility meters record 15-minute integration blocks with power factor penalties (kVAh vs kWh billing) and dynamic fuel adjustment surcharges.
          </p>
        </div>
      </div>

      {/* Interactive Bill Input Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-400" />
            Enter Actual Utility Bill Figures (1 Month)
          </h2>
          <span className="text-xs text-slate-400">Site: Peenya Precision Engineering</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1">
              Operating Days / Month
            </label>
            <input
              type="number"
              min="1"
              max="31"
              value={operatingDays}
              onChange={(e) => setOperatingDays(parseInt(e.target.value) || 26)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-semibold text-white focus:outline-none focus:border-blue-500"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">Production working days</span>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1">
              Billed Energy (kWh)
            </label>
            <input
              type="number"
              min="1"
              value={realEnergyKwh}
              onChange={(e) => setRealEnergyKwh(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-semibold text-white focus:outline-none focus:border-blue-500"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">Metered active energy</span>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1">
              Energy Charge (₹)
            </label>
            <input
              type="number"
              min="0"
              value={realEnergyChargeRs}
              onChange={(e) => setRealEnergyChargeRs(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-semibold text-white focus:outline-none focus:border-blue-500"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">ToD energy charges billed</span>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1">
              Recorded Peak Demand (kW/kVA)
            </label>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={realDemandKw}
              onChange={(e) => setRealDemandKw(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-semibold text-white focus:outline-none focus:border-blue-500"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">Peak 15-min demand</span>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1">
              Demand Penalty / Charge (₹)
            </label>
            <input
              type="number"
              min="0"
              value={realDemandChargeRs}
              onChange={(e) => setRealDemandChargeRs(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-semibold text-white focus:outline-none focus:border-blue-500"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">Fixed contract demand fee</span>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={handleRunCheck}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Run Reality Sanity Check
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-rose-950/30 border border-rose-800/50 rounded-xl p-4 text-rose-300 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={handleRunCheck} className="underline hover:text-white">Retry</button>
        </div>
      )}

      {/* Results Comparison View */}
      {result && (
        <div className="space-y-5">
          {/* Status Header Pill */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div>
              <span className="text-xs text-slate-400">Model Alignment Assessment:</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border ${
                  result.sanity_status === "EXCELLENT_ALIGNMENT"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : result.sanity_status === "REASONABLE_ALIGNMENT"
                    ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                    : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                }`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {result.sanity_status.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-slate-400">
                  Total Bill Variance: <strong className={result.total_bill_gap_rs > 0 ? "text-amber-400" : "text-emerald-400"}>
                    {result.total_bill_gap_rs > 0 ? "+" : ""}{formatRs(result.total_bill_gap_rs)} ({result.total_bill_gap_pct > 0 ? "+" : ""}{result.total_bill_gap_pct}%)
                  </strong>
                </span>
              </div>
            </div>

            <div className="text-xs text-slate-400 sm:text-right">
              <div>Scaled over <strong>{result.operating_days} operating days</strong></div>
              <div className="text-[11px] text-slate-500">Includes factory baseline load + solar offset</div>
            </div>
          </div>

          {/* KPI Variance Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {/* Total Monthly Bill */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-400 font-medium">Total Monthly Bill</div>
              <div className="text-xl font-bold text-white mt-1">
                {formatRs(result.real_total_bill_rs)}
              </div>
              <div className="text-xs text-slate-400 mt-2 flex items-center justify-between border-t border-slate-800 pt-2">
                <span>Model Baseline:</span>
                <span className="font-semibold text-slate-200">{formatRs(result.model_baseline_total_bill_rs)}</span>
              </div>
              <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                <span>Variance:</span>
                <span className={`font-bold ${result.total_bill_gap_rs > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                  {result.total_bill_gap_rs > 0 ? "+" : ""}{formatRs(result.total_bill_gap_rs)}
                </span>
              </div>
            </div>

            {/* Monthly Energy Import */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-400 font-medium">Billed Grid Energy</div>
              <div className="text-xl font-bold text-white mt-1">
                {result.metrics.energy_kwh.real.toLocaleString()} kWh
              </div>
              <div className="text-xs text-slate-400 mt-2 flex items-center justify-between border-t border-slate-800 pt-2">
                <span>Model Baseline:</span>
                <span className="font-semibold text-slate-200">{result.metrics.energy_kwh.model_baseline.toLocaleString()} kWh</span>
              </div>
              <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                <span>Variance:</span>
                <span className={`font-bold ${result.metrics.energy_kwh.gap > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                  {result.metrics.energy_kwh.gap > 0 ? "+" : ""}{result.metrics.energy_kwh.gap} kWh ({result.metrics.energy_kwh.gap_pct}%)
                </span>
              </div>
            </div>

            {/* Peak Grid Demand */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-400 font-medium">Peak Recorded Demand</div>
              <div className="text-xl font-bold text-white mt-1">
                {result.metrics.peak_demand_kw.real} kW
              </div>
              <div className="text-xs text-slate-400 mt-2 flex items-center justify-between border-t border-slate-800 pt-2">
                <span>Model Baseline:</span>
                <span className="font-semibold text-slate-200">{result.metrics.peak_demand_kw.model_baseline} kW</span>
              </div>
              <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                <span>Variance:</span>
                <span className={`font-bold ${result.metrics.peak_demand_kw.gap > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                  {result.metrics.peak_demand_kw.gap > 0 ? "+" : ""}{result.metrics.peak_demand_kw.gap} kW ({result.metrics.peak_demand_kw.gap_pct}%)
                </span>
              </div>
            </div>

            {/* Demand Charge */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-400 font-medium">Demand Charge Penalty</div>
              <div className="text-xl font-bold text-white mt-1">
                {formatRs(result.metrics.demand_charge_rs.real)}
              </div>
              <div className="text-xs text-slate-400 mt-2 flex items-center justify-between border-t border-slate-800 pt-2">
                <span>Model Baseline:</span>
                <span className="font-semibold text-slate-200">{formatRs(result.metrics.demand_charge_rs.model_baseline)}</span>
              </div>
              <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                <span>Variance:</span>
                <span className={`font-bold ${result.metrics.demand_charge_rs.gap > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                  {result.metrics.demand_charge_rs.gap > 0 ? "+" : ""}{formatRs(result.metrics.demand_charge_rs.gap)}
                </span>
              </div>
            </div>
          </div>

          {/* Qualitative Likely Causes Diagnosis */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-400" />
              Observed Gaps & Probable Causes
            </h3>

            <div className="space-y-2.5">
              {result.likely_causes.map((cause, idx) => (
                <div key={idx} className="flex items-start gap-3 bg-slate-950/60 border border-slate-800/80 rounded-lg p-3 text-xs text-slate-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 mt-1.5" />
                  <span className="leading-relaxed">{cause}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <SimulationDisclaimer />
    </div>
  );
}
