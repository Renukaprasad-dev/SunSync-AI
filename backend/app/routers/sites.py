import math
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Query, Request
from app.models.domain import Site, SiteUpdate, Machine, Tariff, SolarProfile, SiteConfigPayload, SiteConfigResponse
from app.core.db import repo
from app.core.security import rate_limiter, get_visitor_session_id

router = APIRouter(prefix="/sites", tags=["Sites & Configuration"])

def validate_full_config(payload: SiteConfigPayload) -> List[Dict[str, str]]:
    errors = []
    # 1. Site validation
    if payload.site.p_max_grid_kw is not None:
        p_max = payload.site.p_max_grid_kw
        if not math.isfinite(p_max) or p_max < 0.1 or p_max > 1000.0:
            errors.append({"field": "site.p_max_grid_kw", "message": "Factory grid limit P_max must be a positive finite number between 0.1 kW and 1000 kW."})
    if payload.site.solar_capacity_kw is not None:
        solar_cap = payload.site.solar_capacity_kw
        if not math.isfinite(solar_cap) or solar_cap < 0.0 or solar_cap > 1000.0:
            errors.append({"field": "site.solar_capacity_kw", "message": "Solar capacity must be a non-negative finite number between 0 and 1000 kW."})

    # 2. Tariff validation
    t = payload.tariff
    if not math.isfinite(t.demand_charge_rate_per_kw) or t.demand_charge_rate_per_kw < 0:
        errors.append({"field": "tariff.demand_charge_rate_per_kw", "message": "Peak demand charge rate must be a non-negative finite number."})
    if len(t.rates) != 96:
        errors.append({"field": "tariff.rates", "message": f"Tariff must cover exactly 96 intervals per day, received {len(t.rates)}."})
    else:
        for idx, rate in enumerate(t.rates):
            if not math.isfinite(rate) or rate < 0:
                errors.append({"field": f"tariff.rates[{idx}]", "message": f"Rate at interval {idx} must be a non-negative finite number."})
                break

    # 3. Machines validation
    for idx, m in enumerate(payload.machines):
        if not m.name.strip():
            errors.append({"field": f"machines[{idx}].name", "message": f"Machine #{idx + 1} name cannot be empty."})
        if not math.isfinite(m.power_kw) or m.power_kw < 0:
            errors.append({"field": f"machines[{idx}].power_kw", "message": f"Machine '{m.name}' power must be a non-negative finite number."})
        if m.duration_intervals <= 0 or m.duration_intervals > 96:
            errors.append({"field": f"machines[{idx}].duration_intervals", "message": f"Machine '{m.name}' duration must be between 1 and 96 intervals."})
        if m.earliest_start < 0 or m.earliest_start > 95:
            errors.append({"field": f"machines[{idx}].earliest_start", "message": f"Machine '{m.name}' earliest start must be between 0 and 95."})
        if m.latest_start < 0 or m.latest_start > 95:
            errors.append({"field": f"machines[{idx}].latest_start", "message": f"Machine '{m.name}' latest start must be between 0 and 95."})
        if m.deadline_interval <= 0 or m.deadline_interval > 96:
            errors.append({"field": f"machines[{idx}].deadline_interval", "message": f"Machine '{m.name}' deadline must be between 1 and 96."})
        if m.earliest_start > m.latest_start:
            errors.append({"field": f"machines[{idx}].earliest_start", "message": f"Machine '{m.name}' earliest start slot ({m.earliest_start}) exceeds latest start slot ({m.latest_start})."})
        if m.earliest_start + m.duration_intervals > m.deadline_interval:
            errors.append({"field": f"machines[{idx}].deadline_interval", "message": f"Machine '{m.name}' duration ({m.duration_intervals} slots) from earliest start finishes after deadline ({m.deadline_interval})."})

    return errors

@router.get("", response_model=List[Dict[str, Any]])
def list_sites():
    return repo.list_sites()

@router.post("", response_model=Dict[str, Any])
def create_site(site: Dict[str, Any]):
    return repo.create_site(site)

@router.get("/{site_id}", response_model=Dict[str, Any])
def get_site(site_id: str):
    site = repo.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail=f"Site {site_id} not found")
    result = dict(site)
    result["storage_mode"] = repo.storage_mode
    result["durable"] = repo.is_durable
    return result

@router.put("/{site_id}", response_model=Dict[str, Any])
def update_site(site_id: str, update_data: SiteUpdate):
    data = {k: v for k, v in update_data.model_dump().items() if v is not None}
    updated = repo.update_site(site_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Site {site_id} not found")
    result = dict(updated)
    result["storage_mode"] = repo.storage_mode
    result["durable"] = repo.is_durable
    return result

@router.get("/{site_id}/machines", response_model=List[Machine])
def get_machines(site_id: str):
    return repo.get_machines(site_id)

@router.put("/{site_id}/machines", response_model=List[Machine])
def update_machines(site_id: str, machines: List[Machine]):
    return repo.save_machines(site_id, machines)

@router.get("/{site_id}/tariff", response_model=Tariff)
def get_tariff(site_id: str):
    return repo.get_tariff(site_id)

@router.put("/{site_id}/tariff", response_model=Tariff)
def update_tariff(site_id: str, tariff: Tariff):
    return repo.save_tariff(site_id, tariff)

@router.get("/{site_id}/config", response_model=Dict[str, Any])
def get_site_config_endpoint(site_id: str):
    config = repo.get_site_config(site_id)
    if not config:
        raise HTTPException(status_code=404, detail=f"Site {site_id} not found")
    return config

@router.put("/{site_id}/config", response_model=Dict[str, Any])
def update_site_config_endpoint(site_id: str, payload: SiteConfigPayload, request: Optional[Request] = None):
    if request:
        rate_limiter.check(f"write:{get_visitor_session_id(request)}")
    errors = validate_full_config(payload)
    if errors:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Configuration validation failed.",
                "errors": errors
            }
        )
    site_dict = {k: v for k, v in payload.site.model_dump().items() if v is not None}
    return repo.save_site_config(
        site_id=site_id,
        site_data=site_dict,
        machines=payload.machines,
        tariff=payload.tariff,
        expected_version=payload.expected_version
    )

@router.get("/{site_id}/solar", response_model=SolarProfile)
def get_solar_profile(site_id: str, scenario: str = Query("sunny", pattern="^(sunny|partly_cloudy|overcast)$")):
    return repo.get_solar_profile(site_id, scenario)
