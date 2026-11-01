"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sun, Zap, Sliders, LineChart, Cpu, CloudSun, History, FileCheck } from "lucide-react";

export function Navbar() {
  const pathname = usePathname();

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

        <nav className="hidden md:flex items-center gap-1.5">
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
