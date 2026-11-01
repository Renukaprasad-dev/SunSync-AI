import math
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Request

from app.models.domain import (
    BillRealityCheckRequest,
    BillRealityCheckResponse,
    BillComparisonMetric
)
from app.core.db import repo
from app.core.security import rate_limiter, get_visitor_session_id

router = APIRouter(prefix="/billing", tags=["Billing Reality Check"])

@router.post("/reality-check", response_model=BillRealityCheckResponse)
def compute_bill_reality_check(payload: BillRealityCheckRequest, request: Request = None):
    if request:
        rate_limiter.check(f"bill:{get_visitor_session_id(request)}")

    # Retrieve site resources
    site_id = payload.site_id
    site = repo.get_site(site_id)
    if not site:
        site_id = repo.DEMO_SITE_ID
        site = repo.get_site(site_id)

    machines = repo.get_machines(site_id)
    tariff = repo.get_tariff(site_id)
    solar_profile = repo.get_solar_profile(site_id, "sunny")
    base_load = repo.get_base_load(site_id)

    # Compute unoptimized baseline 96-interval load
    # Baseline: every machine scheduled at its earliest_start
    total_load = list(base_load)
    for m in machines:
        for t in range(m.earliest_start, min(96, m.earliest_start + m.duration_intervals)):
            total_load[t] += m.power_kw

    # Subtract solar generation to get grid imports
    solar_gen = solar_profile.generation
    grid_profile = [max(0.0, total_load[t] - solar_gen[t]) for t in range(96)]

    # Daily baseline KPIs
    daily_energy_kwh = sum(grid_profile) * 0.25
    daily_energy_cost_rs = sum(grid_profile[t] * 0.25 * tariff.rates[t] for t in range(96))
    daily_peak_kw = max(grid_profile) if grid_profile else 0.0

    # Scale to monthly operating days
    days = payload.operating_days
    monthly_energy_kwh = round(daily_energy_kwh * days, 2)
    monthly_energy_charge_rs = round(daily_energy_cost_rs * days, 2)
    monthly_peak_demand_kw = round(daily_peak_kw, 2)
    monthly_demand_charge_rs = round(monthly_peak_demand_kw * tariff.demand_charge_rate_per_kw, 2)
    model_baseline_total = round(monthly_energy_charge_rs + monthly_demand_charge_rs, 2)

    real_total = round(payload.real_energy_charge_rs + payload.real_demand_charge_rs, 2)
    total_gap_rs = round(real_total - model_baseline_total, 2)
    total_gap_pct = round((total_gap_rs / model_baseline_total * 100.0), 1) if model_baseline_total > 0 else 0.0

    energy_gap_kwh = round(payload.real_energy_kwh - monthly_energy_kwh, 2)
    energy_gap_pct = round((energy_gap_kwh / monthly_energy_kwh * 100.0), 1) if monthly_energy_kwh > 0 else 0.0

    demand_gap_kw = round(payload.real_demand_kw - monthly_peak_demand_kw, 2)
    demand_gap_pct = round((demand_gap_kw / monthly_peak_demand_kw * 100.0), 1) if monthly_peak_demand_kw > 0 else 0.0

    demand_charge_gap_rs = round(payload.real_demand_charge_rs - monthly_demand_charge_rs, 2)
    demand_charge_gap_pct = round((demand_charge_gap_rs / monthly_demand_charge_rs * 100.0), 1) if monthly_demand_charge_rs > 0 else 0.0

    energy_charge_gap_rs = round(payload.real_energy_charge_rs - monthly_energy_charge_rs, 2)
    energy_charge_gap_pct = round((energy_charge_gap_rs / monthly_energy_charge_rs * 100.0), 1) if monthly_energy_charge_rs > 0 else 0.0

    # Qualitative cause diagnosis
    likely_causes = []

    # Demand diagnosis
    if payload.real_demand_kw > monthly_peak_demand_kw * 1.15:
        likely_causes.append(
            f"Peak demand is {demand_gap_kw:+.1f} kW (+{demand_gap_pct:.1f}%) above model schedule. "
            "Likely causes: simultaneous motor inrush currents, auxiliary equipment (HVAC, chiller, air handling), or unscheduled standby machinery."
        )
    elif payload.real_demand_kw < monthly_peak_demand_kw * 0.85:
        likely_causes.append(
            f"Peak demand is {demand_gap_kw:+.1f} kW ({demand_gap_pct:.1f}%) below model schedule. "
            "Likely causes: natural operator load staggering or machines running below rated nameplate power."
        )
    else:
        likely_causes.append(
            f"Peak demand correlates closely with scheduled machine inventory ({monthly_peak_demand_kw:.1f} kW vs {payload.real_demand_kw:.1f} kW billed, within ±15%)."
        )

    # Energy diagnosis
    if payload.real_energy_kwh > monthly_energy_kwh * 1.20:
        likely_causes.append(
            f"Billed monthly energy is {energy_gap_kwh:+.1f} kWh (+{energy_gap_pct:.1f}%) above modeled operations. "
            "Likely causes: overtime shifts, weekend production runs, compressed air line leaks, or phantom standby power draw during idle hours."
        )
    elif payload.real_energy_kwh < monthly_energy_kwh * 0.80:
        likely_causes.append(
            f"Billed monthly energy is {energy_gap_kwh:+.1f} kWh ({energy_gap_pct:.1f}%) below model baseline. "
            "Likely causes: maintenance shutdowns, unrecorded production idle time, or seasonal production slowdown."
        )
    else:
        likely_causes.append(
            f"Monthly energy consumption correlates well with modeled shift hours ({monthly_energy_kwh:.0f} kWh vs {payload.real_energy_kwh:.0f} kWh billed, within ±20%)."
        )

    # Tariff rate check
    real_rate_per_kwh = payload.real_energy_charge_rs / payload.real_energy_kwh if payload.real_energy_kwh > 0 else 0.0
    model_rate_per_kwh = monthly_energy_charge_rs / monthly_energy_kwh if monthly_energy_kwh > 0 else 0.0
    rate_diff = real_rate_per_kwh - model_rate_per_kwh

    if abs(rate_diff) > 0.80:
        likely_causes.append(
            f"Effective energy rate discrepancy: Real bill averages ₹{real_rate_per_kwh:.2f}/kWh vs model ToD average ₹{model_rate_per_kwh:.2f}/kWh. "
            "Likely causes: Fuel adjustment charges (FAC/FPPCA), state electricity duty (e.g. 9%), power factor surcharge (kVAh billing), or meter rent."
        )

    likely_causes.append(
        "Billing Integration Note: Utility meters record rolling 15-minute integration blocks with reactive power (kVAh) penalties. "
        "Use this sanity check to calibrate machine nameplate ratings and base loads before scheduling."
    )

    # Status classification
    abs_gap_pct = abs(total_gap_pct)
    if abs_gap_pct <= 15.0:
        sanity_status = "EXCELLENT_ALIGNMENT"
    elif abs_gap_pct <= 30.0:
        sanity_status = "REASONABLE_ALIGNMENT"
    else:
        sanity_status = "HIGH_DISCREPANCY"

    metrics = {
        "energy_kwh": BillComparisonMetric(
            real=round(payload.real_energy_kwh, 2),
            model_baseline=monthly_energy_kwh,
            gap=energy_gap_kwh,
            gap_pct=energy_gap_pct
        ),
        "energy_charge_rs": BillComparisonMetric(
            real=round(payload.real_energy_charge_rs, 2),
            model_baseline=monthly_energy_charge_rs,
            gap=energy_charge_gap_rs,
            gap_pct=energy_charge_gap_pct
        ),
        "peak_demand_kw": BillComparisonMetric(
            real=round(payload.real_demand_kw, 2),
            model_baseline=monthly_peak_demand_kw,
            gap=demand_gap_kw,
            gap_pct=demand_gap_pct
        ),
        "demand_charge_rs": BillComparisonMetric(
            real=round(payload.real_demand_charge_rs, 2),
            model_baseline=monthly_demand_charge_rs,
            gap=demand_charge_gap_rs,
            gap_pct=demand_charge_gap_pct
        )
    }

    return BillRealityCheckResponse(
        operating_days=days,
        real_total_bill_rs=real_total,
        model_baseline_total_bill_rs=model_baseline_total,
        total_bill_gap_rs=total_gap_rs,
        total_bill_gap_pct=total_gap_pct,
        metrics=metrics,
        likely_causes=likely_causes,
        sanity_status=sanity_status
    )
