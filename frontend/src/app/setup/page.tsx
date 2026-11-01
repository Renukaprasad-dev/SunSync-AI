"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Cpu, Plus, Trash2, Save, RefreshCw, Check, AlertCircle, Database, AlertTriangle } from "lucide-react";
import { getHealth, getSiteConfig, updateSiteConfig } from "@/lib/api";
import { Site, Machine, Tariff } from "@/lib/types";
import { slotToTime } from "@/lib/utils";
import { SimulationDisclaimer } from "@/components/disclaimer";
import { TariffEditor } from "@/components/tariff-editor";

export default function SetupPage() {
  const [site, setSite] = useState<Site | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [tariff, setTariff] = useState<Tariff | null>(null);
  const [pMax, setPMax] = useState<number>(25.0);
  const [version, setVersion] = useState<number>(1);
  const [durable, setDurable] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<boolean>(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [initialSnapshot, setInitialSnapshot] = useState<string>("");
  const [isTariffValid, setIsTariffValid] = useState<boolean>(true);

  const isDirty = useMemo(() => {
    if (!initialSnapshot) return false;
    return JSON.stringify({ pMax, machines, tariff }) !== initialSnapshot;
  }, [pMax, machines, tariff, initialSnapshot]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setConflictError(false);
    setValidationError(null);
    setFieldErrors({});
    try {
      const [healthObj, configObj] = await Promise.all([
        getHealth(),
        getSiteConfig()
      ]);
      setDurable(healthObj.durable);
      setSite(configObj.site);
      setPMax(configObj.site.p_max_grid_kw ?? 25.0);
      setMachines(configObj.machines);
      setTariff(configObj.tariff);
      setVersion(configObj.version || 1);
      setInitialSnapshot(JSON.stringify({
        pMax: configObj.site.p_max_grid_kw ?? 25.0,
        machines: configObj.machines,
        tariff: configObj.tariff
      }));
    } catch (err: any) {
      console.error("Error loading setup:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Warn on navigation/closing with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const handleMachineChange = (index: number, field: keyof Machine, val: any) => {
    setSaveSuccess(false);
    setValidationError(null);
    setConflictError(false);
    const updated = [...machines];
    (updated[index] as any)[field] = val;
    setMachines(updated);
  };

  const handleAddMachine = () => {
    const newId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0")}`;
    const newM: Machine = {
      id: newId,
      name: `Machine #${machines.length + 1}`,
      power_kw: 3.0,
      duration_intervals: 12, // 3 hours
      earliest_start: 32,     // 08:00
      latest_start: 48,       // 12:00
      deadline_interval: 68,  // 17:00
      flexible: true
    };
    setMachines([...machines, newM]);
  };

  const handleDeleteMachine = (id: string) => {
    setMachines(machines.filter((m) => m.id !== id));
  };

  const validateInputs = (): string | null => {
    if (!Number.isFinite(pMax) || pMax < 0.1 || pMax > 1000) {
      return "Factory peak grid limit (P_max) must be a positive number between 0.1 kW and 1000 kW.";
    }
    if (!isTariffValid) {
      return "Time-of-Day tariff slabs are invalid. Slabs must continuously cover 00:00 to 24:00 without gaps or overlaps.";
    }
    if (tariff && (!Number.isFinite(tariff.demand_charge_rate_per_kw) || tariff.demand_charge_rate_per_kw < 0)) {
      return "Peak demand charge rate cannot be negative.";
    }
    for (const m of machines) {
      if (!m.name.trim()) return "Machine name cannot be empty.";
      if (!Number.isFinite(m.power_kw) || m.power_kw < 0) return `Machine '${m.name}': power must be a non-negative number.`;
      if (!Number.isInteger(m.duration_intervals) || m.duration_intervals <= 0 || m.duration_intervals > 96) {
        return `Machine '${m.name}': duration must be an integer between 1 and 96 intervals.`;
      }
      if (m.earliest_start < 0 || m.earliest_start > 95) return `Machine '${m.name}': earliest start slot must be 0-95.`;
      if (m.latest_start < 0 || m.latest_start > 95) return `Machine '${m.name}': latest start slot must be 0-95.`;
      if (m.deadline_interval <= 0 || m.deadline_interval > 96) return `Machine '${m.name}': deadline slot must be 1-96.`;
      if (m.earliest_start > m.latest_start) {
        return `Machine '${m.name}': earliest start slot (${m.earliest_start}) exceeds latest start slot (${m.latest_start}).`;
      }
      if (m.earliest_start + m.duration_intervals > m.deadline_interval) {
        return `Machine '${m.name}': run duration (${m.duration_intervals} slots) from earliest start (${m.earliest_start}) finishes after deadline (${m.deadline_interval}).`;
      }
    }
    return null;
  };

  const handleSave = async () => {
    const err = validateInputs();
    if (err) {
      setValidationError(err);
      return;
    }
    setSaving(true);
    setValidationError(null);
    setConflictError(false);
    setFieldErrors({});
    setSaveSuccess(false);
    try {
      const siteId = site?.id || "00000000-0000-0000-0000-000000000001";
      const savedConfig = await updateSiteConfig(siteId, {
        site: { p_max_grid_kw: pMax },
        machines,
        tariff: tariff!,
        expected_version: version
      });

      setSite(savedConfig.site);
      setPMax(savedConfig.site.p_max_grid_kw);
      setMachines(savedConfig.machines);
      setTariff(savedConfig.tariff);
      setVersion(savedConfig.version);
      setInitialSnapshot(JSON.stringify({
        pMax: savedConfig.site.p_max_grid_kw,
        machines: savedConfig.machines,
        tariff: savedConfig.tariff
      }));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: any) {
      if (e?.message?.includes("409") || e?.message?.toLowerCase().includes("conflict")) {
        setConflictError(true);
      } else if (e?.message?.includes("422")) {
        try {
          const jsonStr = e.message.substring(e.message.indexOf("{"));
          const parsed = JSON.parse(jsonStr);
          if (parsed.errors) {
            setFieldErrors(parsed.errors);
            setValidationError(parsed.message || "Configuration validation failed. Check highlighted fields.");
          } else {
            setValidationError(e?.message || "Validation error.");
          }
        } catch {
          setValidationError(e?.message || "Failed to persist configuration changes.");
        }
      } else {
        setValidationError(e?.message || "Failed to persist configuration changes.");
      }
      setSaveSuccess(false);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center">
        <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="text-slate-400 text-xs mt-3">Loading Machine & Tariff Configuration...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">
      <SimulationDisclaimer />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
              <Cpu className="w-6 h-6 text-amber-400" />
              Machine Inventory & Tariff Setup
            </h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 border border-slate-700 text-slate-300">
              <Database className={`w-3 h-3 ${durable ? "text-emerald-400" : "text-amber-400"}`} />
              {site?.storage_mode === "supabase" ? "Supabase PostgreSQL (Durable)" : durable ? "Local File (Durable)" : "In-Memory (Non-durable)"}
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 border border-slate-700 text-slate-400">
              v{version}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Configure machine power ratings, availability start windows, factory grid limit, and strict production deadlines.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleAddMachine}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Machine
          </button>

          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm transition-all ${
              !isDirty ? "bg-slate-700 opacity-60 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {saveSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? "Saving..." : saveSuccess ? (durable ? "Saved Successfully!" : "Saved (temporary, demo mode)") : isDirty ? "Save Changes*" : "Saved"}
          </button>
        </div>
      </div>

      {!durable && (
        <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
          <span>Demo mode (ephemeral memory): changes may reset at any time across serverless instances. Connect Supabase for persistent multi-user storage.</span>
        </div>
      )}

      {conflictError && (
        <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>Conflict: Configuration has been modified by another session. Please reload to avoid overwriting changes.</span>
          </div>
          <button
            onClick={() => loadData()}
            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded font-semibold text-[11px] shrink-0"
          >
            Reload Latest
          </button>
        </div>
      )}

      {validationError && (
        <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* Global Limits Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div>
          <label className="text-xs font-semibold text-slate-400 block mb-1">Max Factory Grid Limit P_max (kW)</label>
          <input
            type="number"
            value={pMax}
            onChange={(e) => setPMax(parseFloat(e.target.value) || 0)}
            className={`w-full bg-slate-950 border rounded-md px-3 py-1.5 text-xs text-white ${
              fieldErrors["p_max_grid_kw"] ? "border-rose-500" : "border-slate-800"
            }`}
          />
          {fieldErrors["p_max_grid_kw"] && (
            <span className="text-[11px] text-rose-400 font-semibold mt-1 block">
              {fieldErrors["p_max_grid_kw"]}
            </span>
          )}
          <span className="text-[11px] text-slate-500 mt-1 block">Sanctioned peak grid import limit.</span>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-400 block mb-1">Peak Demand Charge Rate (₹/kW)</label>
          <input
            type="number"
            value={tariff?.demand_charge_rate_per_kw || 20.0}
            onChange={(e) => {
              if (tariff) setTariff({ ...tariff, demand_charge_rate_per_kw: parseFloat(e.target.value) || 20.0 });
            }}
            className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-white"
          />
          <span className="text-[11px] text-slate-500 mt-1 block">Penalty rate per kW of peak demand.</span>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-400 block mb-1">Rooftop Solar DC Capacity (kW)</label>
          <input
            type="number"
            value={5.0}
            disabled
            className="w-full bg-slate-950/60 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-slate-400 cursor-not-allowed"
          />
          <span className="text-[11px] text-slate-500 mt-1 block">Peak generation at standard test conditions.</span>
        </div>
      </div>

      {/* Machines Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
              <tr>
                <th className="py-3 px-3">Machine Name</th>
                <th className="py-3 px-3">Power (kW)</th>
                <th className="py-3 px-3">Duration</th>
                <th className="py-3 px-3">Earliest Start</th>
                <th className="py-3 px-3">Latest Start</th>
                <th className="py-3 px-3">Deadline (T_due)</th>
                <th className="py-3 px-3">Flexibility</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {machines.map((m, idx) => (
                <tr key={m.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-2.5 px-3 font-sans font-semibold text-white">
                    <input
                      type="text"
                      value={m.name}
                      onChange={(e) => handleMachineChange(idx, "name", e.target.value)}
                      className="bg-transparent border border-transparent hover:border-slate-700 focus:border-blue-500 rounded px-1.5 py-0.5 w-full text-slate-200"
                    />
                  </td>
                  <td className="py-2.5 px-3">
                    <input
                      type="number"
                      step="0.1"
                      value={m.power_kw}
                      onChange={(e) => handleMachineChange(idx, "power_kw", parseFloat(e.target.value) || 0)}
                      className={`bg-slate-950 border rounded px-2 py-0.5 w-20 text-slate-200 text-right ${
                        fieldErrors[`machines[${idx}].power_kw`] ? "border-rose-500" : "border-slate-800"
                      }`}
                    />
                    {fieldErrors[`machines[${idx}].power_kw`] && (
                      <span className="text-[10px] text-rose-400 font-semibold block mt-0.5">
                        {fieldErrors[`machines[${idx}].power_kw`]}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="1"
                        max="96"
                        value={m.duration_intervals}
                        onChange={(e) => handleMachineChange(idx, "duration_intervals", parseInt(e.target.value) || 1)}
                        className="bg-slate-950 border border-slate-800 rounded px-2 py-0.5 w-16 text-slate-200 text-right"
                      />
                      <span className="text-slate-500 text-[10px]">({(m.duration_intervals * 0.25).toFixed(1)}h)</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        max="95"
                        value={m.earliest_start}
                        onChange={(e) => handleMachineChange(idx, "earliest_start", parseInt(e.target.value) || 0)}
                        className="bg-slate-950 border border-slate-800 rounded px-2 py-0.5 w-16 text-slate-200 text-right"
                      />
                      <span className="text-slate-400 text-[11px] font-sans">({slotToTime(m.earliest_start)})</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        max="95"
                        value={m.latest_start}
                        disabled={!m.flexible}
                        onChange={(e) => handleMachineChange(idx, "latest_start", parseInt(e.target.value) || 0)}
                        className={`border rounded px-2 py-0.5 w-16 text-right ${
                          !m.flexible ? "bg-slate-900 border-slate-850 text-slate-600 cursor-not-allowed" : "bg-slate-950 border-slate-800 text-slate-200"
                        }`}
                      />
                      <span className="text-slate-400 text-[11px] font-sans">({slotToTime(m.latest_start)})</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="1"
                        max="96"
                        value={m.deadline_interval}
                        onChange={(e) => handleMachineChange(idx, "deadline_interval", parseInt(e.target.value) || 1)}
                        className="bg-slate-950 border border-slate-800 rounded px-2 py-0.5 w-16 text-slate-200 text-right"
                      />
                      <span className="text-slate-400 text-[11px] font-sans">({slotToTime(m.deadline_interval)})</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 font-sans">
                    <button
                      type="button"
                      onClick={() => {
                        const newFlex = !m.flexible;
                        handleMachineChange(idx, "flexible", newFlex);
                        if (!newFlex) {
                          handleMachineChange(idx, "latest_start", m.earliest_start);
                        }
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                        m.flexible
                          ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                          : "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                      }`}
                    >
                      {m.flexible ? "Flexible (Can Shift)" : "Fixed Schedule"}
                    </button>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleDeleteMachine(m.id)}
                      className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
                      title="Delete machine"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Time-of-Day Tariff Slabs & Demand Charge Editor */}
      {tariff && (
        <TariffEditor
          tariff={tariff}
          onChange={(newTariff, valid) => {
            setTariff(newTariff);
            setIsTariffValid(valid);
          }}
        />
      )}
    </div>
  );
}
