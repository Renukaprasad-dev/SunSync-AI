import React from "react";
import { ArrowRight, Clock, ShieldCheck, Sparkles, CheckCircle2 } from "lucide-react";
import { MachineScheduleResult } from "@/lib/types";

interface ReasonPanelProps {
  baselineSchedules: MachineScheduleResult[];
  optimizedSchedules: MachineScheduleResult[];
  machineReasons: Record<string, string>;
}

export function ReasonPanel({
  baselineSchedules,
  optimizedSchedules,
  machineReasons
}: ReasonPanelProps) {
  const baseMap = new Map(baselineSchedules.map((m) => [m.machine_id, m]));

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Why This Change? — Schedule Rationale</h3>
            <p className="text-xs text-slate-400">MILP-derived mathematical explanations with quantified energy and tariff justification.</p>
          </div>
        </div>
        <span className="text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 font-medium">
          {optimizedSchedules.filter((m) => m.flexible).length} Flexible Loads Analyzed
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        {optimizedSchedules.map((opt) => {
          const base = baseMap.get(opt.machine_id);
          const wasMoved = base && base.start_slot !== opt.start_slot;
          const reasonText = opt.reason || machineReasons[opt.machine_id] || "Schedule maintained within limits.";

          return (
            <div
              key={opt.machine_id}
              className={`p-3.5 rounded-lg border transition-all ${
                wasMoved
                  ? "bg-slate-950/60 border-blue-500/30 hover:border-blue-400/50"
                  : "bg-slate-950/30 border-slate-800/80"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm text-slate-200">{opt.machine_name}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                    opt.flexible
                      ? wasMoved
                        ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                        : "bg-slate-800 text-slate-400"
                      : "bg-purple-500/15 text-purple-300 border border-purple-500/20"
                  }`}
                >
                  {opt.flexible ? (wasMoved ? "RE-TIMED" : "UNMOVED") : "FIXED PROCESS"}
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-400 mb-2 font-mono">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span>Base: {base?.start_time_str || "08:00"}</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-600" />
                <span className={wasMoved ? "text-amber-400 font-bold" : "text-slate-300"}>
                  Opt: {opt.start_time_str} → {opt.end_time_str}
                </span>
                <span className="text-slate-500 ml-auto font-sans text-[11px]">({opt.power_kw} kW)</span>
              </div>

              <p className="text-xs text-slate-300/90 leading-relaxed bg-slate-900/60 p-2 rounded border border-slate-800/60">
                {reasonText}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
