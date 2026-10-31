import React from "react";
import { AlertCircle, ShieldAlert } from "lucide-react";

export function SimulationDisclaimer({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs md:text-sm font-medium ${className || ""}`}>
      <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
      <span>
        <strong>Simulated Decision Support:</strong> Projections and savings are computed from mathematical optimization models. 
        Validate against official utility tariff orders and actual bills before operational reliance.
      </span>
    </div>
  );
}
