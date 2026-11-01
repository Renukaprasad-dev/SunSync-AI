"use client";

import React, { useState, useEffect } from "react";
import { CloudSun, BarChart2, ShieldCheck, Thermometer, Cloud, Activity, RefreshCw, AlertCircle } from "lucide-react";
import { getForecast } from "@/lib/api";
import { ForecastResponse } from "@/lib/types";
import DynamicPlot from "@/components/charts/dynamic-plotly";
import { SimulationDisclaimer } from "@/components/disclaimer";
import { slotToTime } from "@/lib/utils";

export default function ForecastPage() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [scenario, setScenario] = useState<string>("sunny");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchForecastData = async (scen: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await getForecast(scen);
      setData(resp);
    } catch (e: any) {
      setError(e?.message || "Failed to fetch XGBoost forecast.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchForecastData(scenario);
  }, [scenario]);

  const xLabels = Array.from({ length: 96 }, (_, i) => slotToTime(i));

  const traces: any[] = data
    ? [
        {
          x: xLabels,
          y: data.solar_forecast,
          name: "XGBoost Solar Forecast",
          type: "scatter",
          mode: "lines",
          line: { color: "#f59e0b", width: 2.5 },
          fill: "tozeroy",
          fillcolor: "rgba(245, 158, 11, 0.15)",
          hovertemplate: "%{x}<br>Forecast Solar: %{y:.2f} kW<extra></extra>"
        },
        {
          x: xLabels,
          y: data.load_forecast,
          name: "XGBoost Factory Load Forecast",
          type: "scatter",
          mode: "lines",
          line: { color: "#38bdf8", width: 2, dash: "dot" },
          hovertemplate: "%{x}<br>Forecast Load: %{y:.2f} kW<extra></extra>"
        }
      ]
    : [];

  const weatherTraces: any[] = data && data.weather
    ? [
        {
          x: xLabels,
          y: data.weather.cloud_cover,
          name: "Cloud Cover (%)",
          type: "scatter",
          mode: "lines",
          line: { color: "#94a3b8", width: 2 },
          yaxis: "y",
          hovertemplate: "%{x}<br>Cloud Cover: %{y:.1f}%<extra></extra>"
        },
        {
          x: xLabels,
          y: data.weather.temperature_c,
          name: "Temperature (°C)",
          type: "scatter",
          mode: "lines",
          line: { color: "#f43f5e", width: 2 },
          yaxis: "y2",
          hovertemplate: "%{x}<br>Temp: %{y:.1f}°C<extra></extra>"
        }
      ]
    : [];

  const mainLayout: any = {
    title: {
      text: "96-Interval XGBoost Industrial Solar & Load Forecast",
      font: { color: "#f1f5f9", size: 14 }
    },
    paper_bgcolor: "transparent",
    plot_bgcolor: "rgba(15, 23, 42, 0.6)",
    margin: { l: 48, r: 24, t: 36, b: 40 },
    height: 330,
    autosize: true,
    showlegend: true,
    legend: {
      orientation: "h",
      y: -0.22,
      font: { color: "#94a3b8", size: 11 },
      x: 0.1
    },
    xaxis: {
      gridcolor: "#334155",
      color: "#94a3b8",
      tickfont: { size: 9 },
      nticks: 12
    },
    yaxis: {
      title: "Power (kW)",
      titlefont: { size: 10, color: "#94a3b8" },
      gridcolor: "#334155",
      color: "#94a3b8",
      tickfont: { size: 9 }
    }
  };

  const weatherLayout: any = {
    title: {
      text: "Exogenous Open-Meteo Weather Parameters (Solar & Temperature Drivers)",
      font: { color: "#f1f5f9", size: 14 }
    },
    paper_bgcolor: "transparent",
    plot_bgcolor: "rgba(15, 23, 42, 0.6)",
    margin: { l: 48, r: 48, t: 36, b: 40 },
    height: 250,
    autosize: true,
    showlegend: true,
    legend: {
      orientation: "h",
      y: -0.25,
      font: { color: "#94a3b8", size: 11 },
      x: 0.25
    },
    xaxis: {
      gridcolor: "#334155",
      color: "#94a3b8",
      tickfont: { size: 9 },
      nticks: 12
    },
    yaxis: {
      title: "Cloud Cover (%)",
      titlefont: { size: 10, color: "#94a3b8" },
      gridcolor: "#334155",
      color: "#94a3b8",
      tickfont: { size: 9 },
      range: [0, 105]
    },
    yaxis2: {
      title: "Temp (°C)",
      titlefont: { size: 10, color: "#f43f5e" },
      color: "#f43f5e",
      overlaying: "y",
      side: "right",
      range: [15, 45],
      tickfont: { size: 9 }
    }
  };

  return (
    <div className="space-y-6 py-2">
      <SimulationDisclaimer />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <CloudSun className="w-6 h-6 text-amber-400" />
            XGBoost Solar & Factory Load Forecaster
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Machine learning regression models trained on historical irradiance and industrial shifting patterns with Open-Meteo weather inputs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-xs font-semibold text-white rounded-lg px-3 py-1.5 focus:border-amber-500"
          >
            <option value="sunny">Sunny Scenario</option>
            <option value="partly_cloudy">Partly Cloudy Scenario</option>
            <option value="overcast">Overcast Scenario</option>
          </select>

          <button
            onClick={() => fetchForecastData(scenario)}
            className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
            title="Refresh forecast"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loading && !data && (
        <div className="py-24 text-center space-y-3">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-xs text-slate-400">Loading XGBoost forecast models...</p>
        </div>
      )}

      {error && (
        <div className="p-6 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 space-y-3 text-center sm:text-left sm:flex sm:items-center sm:justify-between sm:space-y-0">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-white">Forecast Unavailable</p>
              <p className="text-xs text-rose-300 mt-0.5">{error}</p>
            </div>
          </div>
          <button
            onClick={() => fetchForecastData(scenario)}
            className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold shadow-md inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      {/* Honest Error Metrics Grid */}
      {data && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-slate-300">Model Performance Metrics</span>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20">
              Computed on 20% held-out simulated test split (960 intervals)
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Solar MAE</span>
              <div className="flex items-baseline gap-1 text-2xl font-bold text-amber-400">
                {data.metrics.solar_mae_kw}
                <span className="text-xs text-slate-400 font-normal">kW</span>
              </div>
              <span className="text-[10px] text-slate-500 block">Mean Absolute Error (held-out test)</span>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Solar RMSE</span>
              <div className="flex items-baseline gap-1 text-2xl font-bold text-amber-400">
                {data.metrics.solar_rmse_kw}
                <span className="text-xs text-slate-400 font-normal">kW</span>
              </div>
              <span className="text-[10px] text-slate-500 block">Root Mean Square Error (held-out test)</span>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Load MAE</span>
              <div className="flex items-baseline gap-1 text-2xl font-bold text-blue-400">
                {data.metrics.load_mae_kw}
                <span className="text-xs text-slate-400 font-normal">kW</span>
              </div>
              <span className="text-[10px] text-slate-500 block">Factory Load Error (held-out test)</span>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Load RMSE</span>
              <div className="flex items-baseline gap-1 text-2xl font-bold text-blue-400">
                {data.metrics.load_rmse_kw}
                <span className="text-xs text-slate-400 font-normal">kW</span>
              </div>
              <span className="text-[10px] text-slate-500 block">Root Mean Square Error (held-out test)</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Forecast Chart - only rendered when data is loaded */}
      {data && (
        <div className="w-full bg-slate-900/80 rounded-xl p-3 border border-slate-800 shadow-lg">
          <DynamicPlot
            data={traces}
            layout={mainLayout}
            useResizeHandler={true}
            className="w-full"
            config={{ displayModeBar: false, responsive: true }}
          />
        </div>
      )}

      {/* Weather Features Chart - only rendered when data is loaded */}
      {data?.weather && (
        <div className="w-full bg-slate-900/80 rounded-xl p-3 border border-slate-800 shadow-lg">
          <DynamicPlot
            data={weatherTraces}
            layout={weatherLayout}
            useResizeHandler={true}
            className="w-full"
            config={{ displayModeBar: false, responsive: true }}
          />
        </div>
      )}
    </div>
  );
}
