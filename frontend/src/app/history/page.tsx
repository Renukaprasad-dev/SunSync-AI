"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  History, 
  RotateCw, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight, 
  Sun, 
  CloudSun, 
  Cloud,
  Layers,
  Percent,
  Zap,
  TrendingDown,
  ShieldCheck
} from "lucide-react";

import { getOptimizationRuns, getOptimizationRun } from "@/lib/api";
import { OptimizationRunSummary } from "@/lib/types";
import { SimulationDisclaimer } from "@/components/disclaimer";
import { formatRs } from "@/lib/utils";

export default function HistoryPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<OptimizationRunSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const fetchRuns = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getOptimizationRuns();
      setRuns(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load optimization run history.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  const handleReopen = async (runId: string) => {
    setOpeningId(runId);
    try {
      const fullRun = await getOptimizationRun(runId);
      router.push(`/dashboard?reopened=true&runId=${encodeURIComponent(runId)}`);
    } catch (err: any) {
      alert(`Could not load run details: ${err?.message || "Network error"}`);
      setOpeningId(null);
    }
  };

  // Aggregated KPI Stats
  const totalRuns = runs.length;
  const verifiedRuns = runs.filter((r) => r.verifier_passed).length;
  const avgSavings = totalRuns > 0
    ? (runs.reduce((acc, r) => acc + (r.summary?.savings_pct || 0), 0) / totalRuns).toFixed(1)
    : "0.0";

  return (
    <div className="space-y-6">
      {/* Top Banner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <History className="w-4 h-4" />
            Audit Log & Decision History
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Optimization Run History
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Audit log of past MILP solver dispatches, mathematical verifier outcomes, and load shifting savings. Reopen any run to inspect its schedule in the dashboard.
          </p>
        </div>

        <button
          onClick={fetchRuns}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors w-fit disabled:opacity-50"
        >
          <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh History
        </button>
      </div>

      {/* KPI Stats Ribbon */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-lg border border-blue-500/20">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400">Total Recorded Runs</div>
            <div className="text-xl font-bold text-white mt-0.5">{totalRuns}</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/20">
            <TrendingDown className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400">Average Cost Reduction</div>
            <div className="text-xl font-bold text-emerald-400 mt-0.5">{avgSavings}%</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400">Mathematical Verifier</div>
            <div className="text-xl font-bold text-white mt-0.5">
              {verifiedRuns}/{totalRuns} <span className="text-xs text-slate-400 font-normal">Passed</span>
            </div>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-rose-950/30 border border-rose-800/50 rounded-xl p-4 text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
          <button
            onClick={fetchRuns}
            className="px-3 py-1 bg-rose-900/60 hover:bg-rose-900 text-xs rounded-md text-white font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {/* Runs Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Logged Solver Runs</h2>
          <span className="text-xs text-slate-400">{runs.length} runs found</span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
            <RotateCw className="w-6 h-6 animate-spin text-blue-400" />
            <p className="text-sm">Loading historical optimization records...</p>
          </div>
        ) : runs.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <History className="w-8 h-8 mx-auto text-slate-600 mb-2" />
            <p className="text-sm text-slate-300 font-medium">No past optimization runs recorded yet.</p>
            <p className="text-xs text-slate-500 mt-1">Run an optimization from the Dashboard or What-If Simulator to record a run.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950/60 border-b border-slate-800 text-slate-400 font-medium uppercase tracking-wider">
                  <th className="py-3 px-4">Run ID & Timestamp</th>
                  <th className="py-3 px-4">Scenario</th>
                  <th className="py-3 px-4">Solver Engine</th>
                  <th className="py-3 px-4 text-right">Baseline Cost</th>
                  <th className="py-3 px-4 text-right">Optimized Cost</th>
                  <th className="py-3 px-4 text-right">Savings</th>
                  <th className="py-3 px-4 text-right">Peak Demand</th>
                  <th className="py-3 px-4 text-center">Verifier</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {runs.map((run) => {
                  const createdAt = run.created_at ? new Date(run.created_at).toLocaleString("en-IN", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                  }) : "Recent";

                  const isSunny = run.scenario === "sunny";
                  const isOvercast = run.scenario === "overcast";

                  return (
                    <tr key={run.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-mono text-xs text-slate-200">
                          #{run.id.slice(0, 8)}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {createdAt}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border ${
                          isSunny 
                            ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                            : isOvercast
                            ? "bg-slate-500/10 text-slate-300 border-slate-500/20"
                            : "bg-blue-500/10 text-blue-300 border-blue-500/20"
                        }`}>
                          {isSunny ? <Sun className="w-3 h-3 text-amber-400" /> : isOvercast ? <Cloud className="w-3 h-3 text-slate-400" /> : <CloudSun className="w-3 h-3 text-blue-400" />}
                          {run.scenario}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">
                        {run.solver_name || "HiGHS / SciPy"}
                      </td>

                      <td className="py-3.5 px-4 text-right font-medium text-slate-400">
                        {formatRs(run.summary?.baseline_cost || 0)}
                      </td>

                      <td className="py-3.5 px-4 text-right font-bold text-white">
                        {formatRs(run.summary?.optimized_cost || 0)}
                      </td>

                      <td className="py-3.5 px-4 text-right font-semibold text-emerald-400">
                        -{run.summary?.savings_pct || 0}%
                      </td>

                      <td className="py-3.5 px-4 text-right font-mono text-slate-300">
                        {run.summary?.optimized_peak_kw || 0} kW
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        {run.verifier_passed ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium text-[11px]">
                            <CheckCircle2 className="w-3 h-3" /> PASS
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-medium text-[11px]">
                            <AlertCircle className="w-3 h-3" /> INFEASIBLE
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => handleReopen(run.id)}
                          disabled={openingId === run.id}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 text-[11px] font-medium transition-colors disabled:opacity-50"
                        >
                          {openingId === run.id ? (
                            <RotateCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <ArrowRight className="w-3 h-3" />
                          )}
                          Reopen
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SimulationDisclaimer />
    </div>
  );
}
