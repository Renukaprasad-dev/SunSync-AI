"use client";

import React, { useMemo } from "react";
import { Plus, Trash2, CheckCircle2, AlertCircle, Clock, Zap, DollarSign } from "lucide-react";
import { Tariff } from "@/lib/types";

export interface TariffSlab {
  id: string;
  name: string;
  startTime: string; // "00:00" to "24:00"
  endTime: string;   // "00:00" to "24:00"
  rate: number;      // Rs / kWh
}

export function timeToInterval(timeStr: string): number {
  const [hStr, mStr] = timeStr.split(":");
  const h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr, 10) || 0;
  return Math.min(96, Math.max(0, h * 4 + Math.floor(m / 15)));
}

export function intervalToTime(slot: number): string {
  const clamped = Math.min(96, Math.max(0, slot));
  const totalMinutes = clamped * 15;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function ratesToSlabs(rates: number[]): TariffSlab[] {
  if (!rates || rates.length !== 96) {
    return [
      { id: "1", name: "Night Off-Peak", startTime: "00:00", endTime: "06:00", rate: 4.5 },
      { id: "2", name: "Morning Normal", startTime: "06:00", endTime: "08:00", rate: 7.0 },
      { id: "3", name: "Morning Peak", startTime: "08:00", endTime: "10:00", rate: 9.0 },
      { id: "4", name: "Day Normal", startTime: "10:00", endTime: "18:00", rate: 7.0 },
      { id: "5", name: "Evening Peak", startTime: "18:00", endTime: "22:00", rate: 9.5 },
      { id: "6", name: "Night Off-Peak", startTime: "22:00", endTime: "24:00", rate: 4.5 },
    ];
  }

  const slabs: TariffSlab[] = [];
  let currentStart = 0;
  let currentRate = rates[0];

  for (let i = 1; i < 96; i++) {
    if (rates[i] !== currentRate) {
      const startTime = intervalToTime(currentStart);
      const endTime = intervalToTime(i);
      const name = currentRate >= 8.5 ? "Peak Surcharge" : currentRate <= 5.5 ? "Off-Peak Night" : "Normal Day";
      slabs.push({
        id: `slab-${currentStart}-${i}`,
        name,
        startTime,
        endTime,
        rate: currentRate,
      });
      currentStart = i;
      currentRate = rates[i];
    }
  }

  // Final slab to 96 (24:00)
  slabs.push({
    id: `slab-${currentStart}-96`,
    name: currentRate >= 8.5 ? "Peak Surcharge" : currentRate <= 5.5 ? "Off-Peak Night" : "Normal Day",
    startTime: intervalToTime(currentStart),
    endTime: "24:00",
    rate: currentRate,
  });

  return slabs;
}

export function validateAndBuildRates(slabs: TariffSlab[]): { rates: number[]; error: string | null } {
  if (!slabs || slabs.length === 0) {
    return { rates: [], error: "At least one Time-of-Day slab is required." };
  }

  // Parse and sort by start interval
  const parsed = slabs.map((s) => ({
    ...s,
    startSlot: timeToInterval(s.startTime),
    endSlot: timeToInterval(s.endTime),
  }));

  parsed.sort((a, b) => a.startSlot - b.startSlot);

  // 1. Must start at 00:00 (slot 0)
  if (parsed[0].startSlot !== 0) {
    return {
      rates: [],
      error: `Coverage must begin at 00:00. First slab starts at ${parsed[0].startTime}.`,
    };
  }

  // 2. Check each slab validity and contiguous sequence
  for (let i = 0; i < parsed.length; i++) {
    const cur = parsed[i];
    if (cur.startSlot >= cur.endSlot) {
      return {
        rates: [],
        error: `Slab '${cur.name}': Start time (${cur.startTime}) must be strictly earlier than end time (${cur.endTime}).`,
      };
    }
    if (!Number.isFinite(cur.rate) || cur.rate < 0) {
      return {
        rates: [],
        error: `Slab '${cur.name}': Energy rate must be a non-negative number (received ₹${cur.rate}).`,
      };
    }

    if (i > 0) {
      const prev = parsed[i - 1];
      if (cur.startSlot < prev.endSlot) {
        return {
          rates: [],
          error: `Overlap detected: '${prev.name}' ends at ${prev.endTime}, but '${cur.name}' begins earlier at ${cur.startTime}.`,
        };
      }
      if (cur.startSlot > prev.endSlot) {
        return {
          rates: [],
          error: `Gap detected: Gap in coverage between ${prev.endTime} and ${cur.startTime}. Slabs must continuously cover 24 hours.`,
        };
      }
    }
  }

  // 3. Must end at 24:00 (slot 96)
  const last = parsed[parsed.length - 1];
  if (last.endSlot !== 96) {
    return {
      rates: [],
      error: `Coverage must end at 24:00. Final slab ends at ${last.endTime}.`,
    };
  }

  // 4. Construct 96-element rates array
  const rates = new Array(96).fill(0);
  for (const s of parsed) {
    for (let slot = s.startSlot; slot < s.endSlot; slot++) {
      rates[slot] = s.rate;
    }
  }

  return { rates, error: null };
}

interface TariffEditorProps {
  tariff: Tariff;
  onChange: (updatedTariff: Tariff, isValid: boolean) => void;
}

export function TariffEditor({ tariff, onChange }: TariffEditorProps) {
  // Convert current 96 rates to editable slabs
  const [slabs, setSlabs] = React.useState<TariffSlab[]>(() => ratesToSlabs(tariff?.rates || []));
  const [demandCharge, setDemandCharge] = React.useState<number>(tariff?.demand_charge_rate_per_kw || 20.0);

  // Validate slabs whenever they change
  const { rates: computedRates, error: validationError } = useMemo(() => {
    return validateAndBuildRates(slabs);
  }, [slabs]);

  // Sync to parent when slabs or demand charge changes
  const updateParent = (newSlabs: TariffSlab[], newDemand: number) => {
    const { rates, error } = validateAndBuildRates(newSlabs);
    const updated: Tariff = {
      rates: error ? tariff.rates : rates,
      demand_charge_rate_per_kw: newDemand,
      currency: tariff.currency || "INR",
      notes: tariff.notes,
    };
    onChange(updated, error === null);
  };

  const handleSlabChange = (index: number, field: keyof TariffSlab, value: any) => {
    const next = [...slabs];
    next[index] = { ...next[index], [field]: value };
    setSlabs(next);
    updateParent(next, demandCharge);
  };

  const handleAddSlab = () => {
    const last = slabs[slabs.length - 1];
    const newStart = last ? last.endTime : "00:00";
    const newSlab: TariffSlab = {
      id: `slab-${Date.now()}`,
      name: "Custom Slab",
      startTime: newStart,
      endTime: "24:00",
      rate: 7.5,
    };
    const next = [...slabs, newSlab];
    setSlabs(next);
    updateParent(next, demandCharge);
  };

  const handleDeleteSlab = (index: number) => {
    const next = slabs.filter((_, i) => i !== index);
    setSlabs(next);
    updateParent(next, demandCharge);
  };

  const handleDemandChargeChange = (val: number) => {
    const clean = Number.isFinite(val) ? Math.max(0, val) : 0;
    setDemandCharge(clean);
    updateParent(slabs, clean);
  };

  // Preview chart data (96 bars or stepped series)
  const previewRates = computedRates.length === 96 ? computedRates : tariff?.rates || [];
  const maxRate = Math.max(...previewRates, 12);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            Time-of-Day (ToD) Tariff Slabs & Demand Charge
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Define industrial time slots (e.g. BESCOM HT/LT tariff) and peak demand penalty.
          </p>
        </div>

        <button
          type="button"
          onClick={handleAddSlab}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors w-fit"
        >
          <Plus className="w-3.5 h-3.5 text-blue-400" />
          Add Slab
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* Validation Status Indicator */}
        {validationError ? (
          <div className="bg-rose-950/30 border border-rose-800/50 rounded-lg p-3 text-rose-300 text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{validationError}</span>
          </div>
        ) : (
          <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-lg p-3 text-emerald-300 text-xs flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Full 24-hour continuous coverage verified (96 intervals, 0 overlaps, 0 gaps).</span>
          </div>
        )}

        {/* 96-Interval Preview Chart */}
        <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 text-xs">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              96-Interval Tariff Profile Preview (₹ / kWh)
            </span>
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block"></span> Off-Peak (&le; ₹6)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block"></span> Normal (₹6 - ₹8.5)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block"></span> Peak (&gt; ₹8.5)
              </span>
            </div>
          </div>

          <div className="h-32 w-full flex items-end gap-[1px] pt-4 pb-1 border-b border-slate-800">
            {previewRates.map((rate, idx) => {
              const heightPct = Math.min(100, Math.max(10, (rate / maxRate) * 100));
              const color = rate > 8.5 ? "bg-amber-500 hover:bg-amber-400" : rate <= 6.0 ? "bg-emerald-500 hover:bg-emerald-400" : "bg-blue-500 hover:bg-blue-400";
              const timeLabel = intervalToTime(idx);

              return (
                <div
                  key={idx}
                  className={`flex-1 ${color} rounded-t-[1px] transition-all cursor-pointer relative group`}
                  style={{ height: `${heightPct}%` }}
                >
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
                    <div className="bg-slate-900 border border-slate-700 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap shadow-lg">
                      {timeLabel}: ₹{rate.toFixed(2)}/kWh
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Time axis ticks */}
          <div className="flex justify-between text-[10px] text-slate-500 pt-1 font-mono">
            <span>00:00</span>
            <span>04:00</span>
            <span>08:00</span>
            <span>12:00</span>
            <span>16:00</span>
            <span>20:00</span>
            <span>24:00</span>
          </div>
        </div>

        {/* Editable Slabs Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase font-semibold text-[11px]">
                <th className="py-2.5 px-3">Period / Label</th>
                <th className="py-2.5 px-3">Start Time (HH:MM)</th>
                <th className="py-2.5 px-3">End Time (HH:MM)</th>
                <th className="py-2.5 px-3">Energy Rate (₹/kWh)</th>
                <th className="py-2.5 px-3 text-center">Color Category</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {slabs.map((slab, idx) => {
                const colorBadge =
                  slab.rate > 8.5
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    : slab.rate <= 6.0
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-blue-500/10 text-blue-400 border-blue-500/20";

                const categoryLabel =
                  slab.rate > 8.5 ? "Peak Surcharge" : slab.rate <= 6.0 ? "Off-Peak Night" : "Normal Day";

                return (
                  <tr key={slab.id} className="hover:bg-slate-800/20 transition-colors">
                    <td className="py-2.5 px-3">
                      <input
                        type="text"
                        value={slab.name}
                        onChange={(e) => handleSlabChange(idx, "name", e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-white w-full max-w-[180px] focus:outline-none focus:border-blue-500"
                        placeholder="Period label"
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        type="text"
                        value={slab.startTime}
                        onChange={(e) => handleSlabChange(idx, "startTime", e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-white w-24 focus:outline-none focus:border-blue-500"
                        placeholder="HH:MM"
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        type="text"
                        value={slab.endTime}
                        onChange={(e) => handleSlabChange(idx, "endTime", e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-white w-24 focus:outline-none focus:border-blue-500"
                        placeholder="HH:MM"
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400">₹</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={slab.rate}
                          onChange={(e) => handleSlabChange(idx, "rate", parseFloat(e.target.value) || 0)}
                          className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs font-semibold text-white w-24 focus:outline-none focus:border-blue-500"
                        />
                        <span className="text-slate-400 text-[11px]">/kWh</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${colorBadge}`}>
                        {categoryLabel}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteSlab(idx)}
                        disabled={slabs.length <= 1}
                        className="p-1 text-slate-500 hover:text-rose-400 transition-colors disabled:opacity-30 disabled:hover:text-slate-500"
                        title="Delete slab"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Demand Charge Input */}
        <div className="pt-4 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
          <div>
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-amber-400" />
              Peak Demand Charge Rate
            </label>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Monthly utility contract demand penalty per kW of peak recorded grid power.
            </p>
          </div>

          <div className="flex items-center gap-2 sm:justify-end">
            <span className="text-xs text-slate-400">₹</span>
            <input
              type="number"
              step="1"
              min="0"
              value={demandCharge}
              onChange={(e) => handleDemandChargeChange(parseFloat(e.target.value) || 0)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-semibold text-white w-28 focus:outline-none focus:border-blue-500"
            />
            <span className="text-xs text-slate-400">/ kW</span>
          </div>
        </div>
      </div>
    </div>
  );
}
