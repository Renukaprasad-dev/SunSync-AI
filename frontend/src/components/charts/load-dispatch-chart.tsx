"use client";

import React from "react";
import DynamicPlot from "./dynamic-plotly";
import { slotToTime } from "@/lib/utils";

interface LoadDispatchChartProps {
  strategyName: string;
  loadProfile: number[];
  gridProfile: number[];
  solarProfile: number[];
  solarUsedProfile: number[];
  peakKw: number;
}

export function LoadDispatchChart({
  strategyName,
  loadProfile,
  gridProfile,
  solarProfile,
  solarUsedProfile,
  peakKw
}: LoadDispatchChartProps) {
  // Generate x-axis labels for 96 15-minute slots
  const xLabels = Array.from({ length: 96 }, (_, i) => slotToTime(i));

  // Find peak index for annotation
  const peakSlot = gridProfile.indexOf(peakKw);

  const traces: any[] = [
    {
      x: xLabels,
      y: solarProfile,
      name: "Rooftop Solar Available",
      type: "scatter",
      mode: "lines",
      line: { color: "#f59e0b", width: 2, dash: "dot" },
      fill: "tozeroy",
      fillcolor: "rgba(245, 158, 11, 0.08)",
      hovertemplate: "%{x}<br>Solar Available: %{y:.2f} kW<extra></extra>",
    },
    {
      x: xLabels,
      y: loadProfile,
      name: "Total Factory Demand",
      type: "scatter",
      mode: "lines",
      line: { color: "#60a5fa", width: 2.5 },
      hovertemplate: "%{x}<br>Total Factory Load: %{y:.2f} kW<extra></extra>",
    },
    {
      x: xLabels,
      y: gridProfile,
      name: "Net Grid Import",
      type: "scatter",
      mode: "lines",
      line: { color: "#f43f5e", width: 2.5 },
      fill: "tozeroy",
      fillcolor: "rgba(244, 63, 94, 0.12)",
      hovertemplate: "%{x}<br>Net Grid Import: %{y:.2f} kW<extra></extra>",
    },
    {
      x: xLabels,
      y: solarUsedProfile,
      name: "Solar Consumed On-Site",
      type: "scatter",
      mode: "lines",
      line: { color: "#10b981", width: 2 },
      fill: "tozeroy",
      fillcolor: "rgba(16, 185, 129, 0.15)",
      hovertemplate: "%{x}<br>Solar Self-Used: %{y:.2f} kW<extra></extra>",
    }
  ];

  const layout: any = {
    title: {
      text: `${strategyName} — 24-Hour Dispatch Profile`,
      font: { color: "#f1f5f9", size: 14 }
    },
    paper_bgcolor: "transparent",
    plot_bgcolor: "rgba(15, 23, 42, 0.6)",
    margin: { l: 48, r: 24, t: 36, b: 40 },
    height: 340,
    autosize: true,
    showlegend: true,
    legend: {
      orientation: "h",
      y: -0.22,
      font: { color: "#94a3b8", size: 11 },
      bgcolor: "transparent"
    },
    xaxis: {
      color: "#94a3b8",
      gridcolor: "rgba(51, 65, 85, 0.4)",
      tickvals: [0, 16, 32, 48, 64, 80, 95].map((s) => slotToTime(s)),
      tickfont: { size: 10 }
    },
    yaxis: {
      title: "Power (kW)",
      titlefont: { size: 11, color: "#94a3b8" },
      color: "#94a3b8",
      gridcolor: "rgba(51, 65, 85, 0.4)",
      rangemode: "tozero",
      tickfont: { size: 10 }
    },
    annotations: peakKw > 0 && peakSlot >= 0 ? [
      {
        x: slotToTime(peakSlot),
        y: peakKw,
        xref: "x",
        yref: "y",
        text: `Peak: ${peakKw.toFixed(1)} kW`,
        showarrow: true,
        arrowhead: 2,
        arrowcolor: "#f43f5e",
        arrowsize: 1,
        arrowwidth: 1.5,
        ax: 0,
        ay: -28,
        bgcolor: "#1e1b4b",
        bordercolor: "#f43f5e",
        borderwidth: 1,
        font: { color: "#fecdd3", size: 10, weight: "bold" },
        opacity: 0.95
      }
    ] : []
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
