"use client";

import React, { useState } from "react";
import { ArrowRight, Clock, ShieldCheck, Sparkles, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { MachineScheduleResult } from "@/lib/types";

interface ReasonPanelProps {
  baselineSchedules: MachineScheduleResult[];
  optimizedSchedules: MachineScheduleResult[];
  machineReasons?: Record<string, string> | null;
}

export function ReasonPanel({
  baselineSchedules = [],
  optimizedSchedules = [],
  machineReasons = {}
}: ReasonPanelProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const safeReasons = machineReasons ?? {};
  const baseMap = new Map((baselineSchedules || []).map((m) => [m.machine_id, m]));

  const shiftedCount = (optimizedSchedules || []).filter((opt) => {
    const base = baseMap.get(opt.machine_id);
    return base && base.start_slot !== opt.start_slot;
  }).length;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg transition-all">
      <div 
        className="flex items-center justify-between cursor-pointer select-none pb-2"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
        aria-expanded={isExpanded}
        aria-label="Toggle Reason Engine Explanations"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <span>Why This Change? — Solver Decision Rationale</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-normal">
                {shiftedCount} Loads Shifted
              </span>
            </h3>
            <p className="text-xs text-slate-400">MILP-derived mathematical explanations with quantified energy and tariff justification.</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 font-medium hidden sm:inline">
            {optimizedSchedules.filter((m) => m.flexible).length} Flexible Loads Analyzed
          </span>
          <button 
            type="button"
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            aria-label={isExpanded ? "Collapse reasons" : "Expand reasons"}
          >
            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-800">
          {optimizedSchedules.map((opt) => {
            const base = baseMap.get(opt.machine_id);
            const wasMoved = base && base.start_slot !== opt.start_slot;
            const reasonText = opt.reason || safeReasons[opt.machine_id] || machineReasons?.[opt.machine_id] || "Schedule maintained within limits.";

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
      )}
    </div>
  );
}
