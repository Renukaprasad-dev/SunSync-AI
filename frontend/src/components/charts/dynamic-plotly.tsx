"use client";

import dynamic from "next/dynamic";
import React from "react";

// Dynamically import react-plotly.js with ssr: false to prevent Next.js server-side rendering errors
const PlotComponent = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-80 flex items-center justify-center bg-slate-900/40 rounded-lg border border-slate-800 text-slate-500 text-sm">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
        <span>Rendering Interactive Plotly Chart...</span>
      </div>
    </div>
  )
});

export default function DynamicPlot(props: any) {
  return <PlotComponent {...props} />;
}
