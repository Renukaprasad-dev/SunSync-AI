import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/navbar";

export const metadata: Metadata = {
  title: "SunSync AI — Solar-Aware Industrial Machine Scheduling",
  description: "AI-powered, solar-aware machine scheduling to cut peak demand and electricity cost in small and medium industries.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased selection:bg-amber-500 selection:text-slate-950">
        <Navbar />
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>
        <footer className="border-t border-slate-900 bg-slate-950/90 py-6 text-center text-xs text-slate-500">
          <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-2">
            <div>
              <strong>SunSync AI</strong> — Production-aware MILP scheduling for renewable industrial optimization.
            </div>
            <div className="text-slate-400">
              IDEATHON2026 • Team Techies • Sustainability & Renewable Energy
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
