import Link from "react";
import { Sun, Zap, TrendingDown, Clock, ShieldCheck, ArrowRight, BarChart3, Sliders, CheckCircle } from "lucide-react";
import { SimulationDisclaimer } from "@/components/disclaimer";

export default function LandingPage() {
  return (
    <div className="space-y-12 py-4">
      <SimulationDisclaimer />

      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 via-slate-900/60 to-slate-950 p-8 md:p-12 shadow-2xl">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 rounded-full bg-amber-500/10 blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -mb-12 -ml-12 w-96 h-96 rounded-full bg-blue-500/10 blur-3xl pointer-events-none"></div>

        <div className="relative z-10 max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs font-semibold">
            <Sun className="w-3.5 h-3.5" />
            <span>Industrial Energy Optimization • IDEATHON2026</span>
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-tight">
            AI-Powered, Solar-Aware <br />
            <span className="bg-gradient-to-r from-amber-400 via-amber-200 to-blue-400 bg-clip-text text-transparent">
              Machine Scheduling
            </span>
          </h1>

          <p className="text-slate-300 text-base md:text-lg leading-relaxed">
            Small industrial workshops pay punitive demand spike penalties and let rooftop solar sit underutilized.
            SunSync AI employs production-aware <strong>MILP mathematical optimization</strong> to safely shift flexible machines
            into peak solar hours and out of peak tariff slots—guaranteeing every production deadline is strictly met.
          </p>

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <a
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-to-r from-amber-500 to-amber-400 text-slate-950 font-bold text-sm hover:from-amber-400 hover:to-amber-300 transition-all shadow-lg shadow-amber-500/20"
            >
              Try Live Demo
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="/simulator"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-slate-700 bg-slate-800/80 text-white font-medium text-sm hover:bg-slate-700 transition-colors"
            >
              <Sliders className="w-4 h-4 text-slate-400" />
              What-If Simulator
            </a>
          </div>
        </div>

        {/* Feature Highlights Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-10 border-t border-slate-800/80 mt-10">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm">
              <TrendingDown className="w-4 h-4" />
              <span>Slashes Peak Grid Spikes</span>
            </div>
            <p className="text-xs text-slate-400">
              Staggers heavy motors and furnaces to eliminate concurrent startup demand charges.
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
              <Sun className="w-4 h-4" />
              <span>Maximizes Solar Self-Use</span>
            </div>
            <p className="text-xs text-slate-400">
              Absorbs midday solar generation on-site, minimizing low-value grid export.
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
              <ShieldCheck className="w-4 h-4" />
              <span>Zero Deadline Violations</span>
            </div>
            <p className="text-xs text-slate-400">
              MILP mathematical bounds guarantee non-stop runs and 100% on-time delivery.
            </p>
          </div>
        </div>
      </section>

      {/* The 3 Core Strategies Compared */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">The Three Scheduling Strategies</h2>
          <p className="text-sm text-slate-400 mt-1">
            SunSync AI solves and benchmarks three distinct operational policies simultaneously:
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Baseline */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 space-y-4 hover:border-slate-700 transition-colors">
            <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 font-bold text-sm">
              01
            </div>
            <h3 className="text-lg font-bold text-white">Baseline Schedule</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Every machine starts at its earliest available slot. Leads to severe morning demand peaks (8–10 AM)
              before rooftop solar ramps up, incurring punitive peak tariff and max demand charges.
            </p>
            <div className="text-xs text-slate-400 bg-slate-950 p-2.5 rounded border border-slate-800">
              <strong>Outcome:</strong> Unoptimized high grid demand spike, solar underutilized.
            </div>
          </div>

          {/* Solar Aware */}
          <div className="bg-slate-900/80 border border-amber-500/30 rounded-xl p-6 space-y-4 hover:border-amber-500/50 transition-colors">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-sm">
              02
            </div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              Solar-Aware
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
                GREEN
              </span>
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              MILP objective strictly maximizes solar self-consumption, moving flexible loads directly into the 11:00–14:30
              solar bell curve while honoring machine availability windows and deadlines.
            </p>
            <div className="text-xs text-amber-300/90 bg-amber-950/20 p-2.5 rounded border border-amber-500/20">
              <strong>Outcome:</strong> Maximum renewable on-site utilization, reduced grid import.
            </div>
          </div>

          {/* Cost Optimized */}
          <div className="bg-slate-900/80 border border-blue-500/30 rounded-xl p-6 space-y-4 hover:border-blue-500/50 transition-colors">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm">
              03
            </div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              Cost-Optimized
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold">
                RECOMMENDED
              </span>
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Joint optimization combining rooftop solar, time-of-day (ToD) electricity tariffs, and peak grid demand charges.
              Achieves the lowest total bill even on cloudy/overcast days through tariff arbitrage.
            </p>
            <div className="text-xs text-blue-300/90 bg-blue-950/20 p-2.5 rounded border border-blue-500/20">
              <strong>Outcome:</strong> Lowest total electricity bill + lowest peak demand kW.
            </div>
          </div>
        </div>
      </section>

      {/* Differentiators */}
      <section className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 md:p-8 space-y-4">
        <h3 className="text-lg font-bold text-white tracking-tight">Key Technological Differentiators</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
          <div className="flex gap-3 items-start">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white">MILP Non-Preemption Formulation:</strong> Machines once started run for their full continuous duration without preemption or mid-shift stops.
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white">Dual Verification Check:</strong> Every computed schedule is independently re-simulated from scratch, verifying zero deadline misses.
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white">Plain-Language Decision Justifications:</strong> Explains exactly why each machine was moved or retained with real numeric benefits.
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white">Overcast Tariff Arbitrage:</strong> Automatically shifts loads away from expensive evening/morning tariff spikes even with zero solar.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
