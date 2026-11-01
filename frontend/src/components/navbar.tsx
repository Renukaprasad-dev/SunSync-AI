"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sun, Zap, Sliders, LineChart, Cpu, CloudSun, History, FileCheck, RefreshCw } from "lucide-react";
import { getHealth, API_BASE_URL } from "@/lib/api";
import { HealthResponse } from "@/lib/types";

export function Navbar() {
  const pathname = usePathname();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthStatus, setHealthStatus] = useState<"checking" | "connected" | "ephemeral" | "offline">("checking");
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const checkHealth = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await getHealth();
      setHealth(data);
      if (data.storage_mode === "memory") {
        setHealthStatus("ephemeral");
      } else {
        setHealthStatus("connected");
      }
    } catch {
      setHealth(null);
      setHealthStatus("offline");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    // Periodically re-check health every 30 seconds
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  const navLinks = [
    { href: "/", label: "Overview", icon: Zap },
    { href: "/dashboard", label: "Dashboard", icon: LineChart },
    { href: "/history", label: "History", icon: History },
    { href: "/bill-check", label: "Bill Check", icon: FileCheck },
    { href: "/simulator", label: "What-If Simulator", icon: Sliders },
    { href: "/setup", label: "Machine Setup", icon: Cpu },
    { href: "/forecast", label: "Solar Forecast", icon: CloudSun },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center text-slate-950 shadow-md shadow-amber-500/20 group-hover:scale-105 transition-transform">
            <Sun className="w-5 h-5 fill-slate-950 stroke-slate-950" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-lg tracking-tight text-white flex items-center gap-1.5">
              SunSync <span className="text-amber-400 font-extrabold text-sm px-1.5 py-0.5 rounded bg-amber-400/10 border border-amber-400/20">AI</span>
            </span>
            <span className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">Industrial Energy MILP</span>
          </div>
        </Link>

        <nav className="hidden lg:flex items-center gap-1.5">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                    : "text-slate-300 hover:text-white hover:bg-slate-800/60"
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? "text-blue-400" : "text-slate-400"}`} />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5">
          {/* Backend Health Status Badge */}
          <button
            onClick={checkHealth}
            title={
              healthStatus === "connected"
                ? `Backend Online (${health?.storage_mode}, durable) at ${API_BASE_URL} - Click to refresh`
                : healthStatus === "ephemeral"
                ? `Backend Online (${health?.storage_mode}, ephemeral memory) at ${API_BASE_URL} - Click to refresh`
                : healthStatus === "offline"
                ? `Cannot reach backend at ${API_BASE_URL} (is port 8000 running?) - Click to retry`
                : `Checking backend health at ${API_BASE_URL}...`
            }
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              healthStatus === "connected"
                ? "bg-emerald-950/60 border-emerald-700/60 text-emerald-400 hover:bg-emerald-900/60"
                : healthStatus === "ephemeral"
                ? "bg-amber-950/60 border-amber-700/60 text-amber-400 hover:bg-amber-900/60"
                : healthStatus === "offline"
                ? "bg-rose-950/60 border-rose-700/60 text-rose-400 hover:bg-rose-900/60"
                : "bg-slate-900 border-slate-700 text-slate-400"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                healthStatus === "connected"
                  ? "bg-emerald-400 animate-pulse"
                  : healthStatus === "ephemeral"
                  ? "bg-amber-400"
                  : healthStatus === "offline"
                  ? "bg-rose-500"
                  : "bg-slate-400 animate-pulse"
              }`}
            />
            <span className="hidden sm:inline">
              {healthStatus === "connected"
                ? `API: ${health?.storage_mode || "online"}`
                : healthStatus === "ephemeral"
                ? "API: memory"
                : healthStatus === "offline"
                ? "API Offline"
                : "Checking..."}
            </span>
            <RefreshCw className={`w-3 h-3 ml-0.5 ${isRefreshing ? "animate-spin" : "opacity-60"}`} />
          </button>

          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center text-xs font-semibold px-3 py-1.5 rounded-md bg-amber-500 text-slate-950 hover:bg-amber-400 transition-colors shadow-sm"
          >
            Launch Live Demo
          </Link>
        </div>
      </div>
    </header>
  );
}
