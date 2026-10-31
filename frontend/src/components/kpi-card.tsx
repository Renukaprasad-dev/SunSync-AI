import React from "react";
import { ArrowDownRight, ArrowUpRight, CheckCircle2, AlertTriangle } from "lucide-react";

interface KPICardProps {
  label: string;
  value: string | number;
  unit?: string;
  baseValue?: string | number;
  deltaText?: string;
  isPositiveBenefit?: boolean; // e.g. lower cost is positive, higher solar is positive
  subtext?: string;
  badge?: string;
}

export function KPICard({
  label,
  value,
  unit,
  baseValue,
  deltaText,
  isPositiveBenefit = true,
  subtext,
  badge
}: KPICardProps) {
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition-colors shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
        {badge && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
            {badge}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1.5 my-1">
        <span className="text-2xl font-bold text-white tracking-tight">{value}</span>
        {unit && <span className="text-xs text-slate-400 font-medium">{unit}</span>}
      </div>

      <div className="pt-2 border-t border-slate-800/80 mt-2 flex items-center justify-between text-xs">
        {deltaText ? (
          <span
            className={`inline-flex items-center gap-1 font-semibold ${
              isPositiveBenefit ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {isPositiveBenefit ? <ArrowDownRight className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
            {deltaText}
          </span>
        ) : (
          <span className="text-slate-500">Ref Baseline</span>
        )}

        {baseValue !== undefined && (
          <span className="text-slate-400 text-[11px]">
            Base: <span className="text-slate-300 font-medium">{baseValue}</span>
          </span>
        )}

        {subtext && <span className="text-slate-400 text-[11px]">{subtext}</span>}
      </div>
    </div>
  );
}

export function DeadlineViolationsCard({ count }: { count: number }) {
  const isZero = count === 0;
  return (
    <div
      className={`border rounded-xl p-4 flex flex-col justify-between shadow-sm transition-colors ${
        isZero
          ? "bg-slate-900/90 border-emerald-500/30"
          : "bg-rose-950/20 border-rose-500/50"
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Deadline Compliance</span>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            isZero ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/20 text-rose-300"
          }`}
        >
          {isZero ? "VERIFIED STRICT" : "VIOLATION DETECTED"}
        </span>
      </div>

      <div className="flex items-center gap-2 my-1">
        {isZero ? (
          <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
        ) : (
          <AlertTriangle className="w-6 h-6 text-rose-400 shrink-0" />
        )}
        <span className="text-xl font-bold text-white tracking-tight">
          {isZero ? "0 Violations" : `${count} Deadline Misses`}
        </span>
      </div>

      <div className="pt-2 border-t border-slate-800/80 mt-2 text-[11px] text-slate-400">
        {isZero ? "100% orders finish on time" : "Check constraint bounds in Setup"}
      </div>
    </div>
  );
}
