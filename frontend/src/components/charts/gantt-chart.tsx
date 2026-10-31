"use client";

import React from "react";
import DynamicPlot from "./dynamic-plotly";
import { MachineScheduleResult } from "@/lib/types";
import { slotToTime } from "@/lib/utils";

interface GanttChartProps {
  baselineSchedules: MachineScheduleResult[];
  optimizedSchedules: MachineScheduleResult[];
  title?: string;
}

export function GanttScheduleChart({
  baselineSchedules,
  optimizedSchedules,
  title = "Machine Production Dispatch (Baseline vs Optimized)"
}: GanttChartProps) {
  const machineNames = baselineSchedules.map((m) => m.machine_name);

  // Traces for Baseline (ghost/outline bar)
  const baseStarts = baselineSchedules.map((m) => m.start_slot * 0.25);
  const baseDurations = baselineSchedules.map((m) => (m.end_slot - m.start_slot) * 0.25);

  // Traces for Optimized
  const optStarts = optimizedSchedules.map((m) => m.start_slot * 0.25);
  const optDurations = optimizedSchedules.map((m) => (m.end_slot - m.start_slot) * 0.25);

  const traces: any[] = [
    // Baseline ghost bar
    {
      y: machineNames,
      x: baseDurations,
      base: baseStarts,
      name: "Baseline (Earliest Start)",
      type: "bar",
      orientation: "h",
      marker: {
        color: "rgba(148, 163, 184, 0.2)",
        line: { color: "rgba(148, 163, 184, 0.7)", width: 1.5, dash: "dot" }
      },
      hoverinfo: "text",
      hovertext: baselineSchedules.map(
        (m) => `Baseline: ${m.machine_name}<br>Start: ${m.start_time_str} → End: ${m.end_time_str} (${m.power_kw} kW)`
      )
    },
    // Optimized schedule bar
    {
      y: machineNames,
      x: optDurations,
      base: optStarts,
      name: "SunSync Optimized",
      type: "bar",
      orientation: "h",
      marker: {
        color: optimizedSchedules.map((m) => (m.flexible ? "#38bdf8" : "#818cf8")),
        line: { color: "#ffffff", width: 1 }
      },
      hoverinfo: "text",
      hovertext: optimizedSchedules.map(
        (m) =>
          `Optimized: ${m.machine_name} (${m.flexible ? "Flexible" : "Fixed"})<br>` +
          `Active: ${m.start_time_str} → ${m.end_time_str}<br>` +
          `Power: ${m.power_kw} kW | Energy: ${m.energy_kwh} kWh<br>` +
          (m.reason ? `<i>Reason: ${m.reason}</i>` : "")
      )
    }
  ];

  const layout: any = {
    title: {
      text: title,
      font: { color: "#f1f5f9", size: 14 }
    },
    barmode: "overlay",
    paper_bgcolor: "transparent",
    plot_bgcolor: "rgba(15, 23, 42, 0.6)",
    margin: { l: 180, r: 24, t: 40, b: 40 },
    height: 320,
    autosize: true,
    showlegend: true,
    legend: {
      orientation: "h",
      y: -0.22,
      font: { color: "#94a3b8", size: 11 },
      bgcolor: "transparent"
    },
    xaxis: {
      title: "Time of Day (Hours)",
      titlefont: { size: 11, color: "#94a3b8" },
      color: "#94a3b8",
      gridcolor: "rgba(51, 65, 85, 0.4)",
      range: [0, 24],
      tickvals: [0, 4, 8, 12, 16, 20, 24],
      ticktext: ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"],
      tickfont: { size: 10 }
    },
    yaxis: {
      color: "#f1f5f9",
      autorange: "reversed",
      tickfont: { size: 11 }
    }
  };

  return (
    <div className="w-full bg-slate-900/80 rounded-xl p-3 border border-slate-800 shadow-lg">
      <DynamicPlot
        data={traces}
        layout={layout}
        useResizeHandler={true}
        className="w-full"
        config={{ displayModeBar: false, responsive: true }}
      />
    </div>
  );
}
