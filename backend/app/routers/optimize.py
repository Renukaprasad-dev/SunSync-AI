from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.models.domain import (
    OptimizationRequest,
    OptimizationResponse,
    Machine,
    Tariff,
    SolarProfile
)
from app.core.db import repo
from app.scheduler.service import SchedulerService

router = APIRouter(prefix="", tags=["Optimization"])
scheduler_service = SchedulerService()

class OptimizeEndpointPayload(BaseModel):
    site_id: str = "00000000-0000-0000-0000-000000000001"
    scenario: str = "sunny"
    strategies: List[str] = Field(default=["baseline", "solar_aware", "cost_optimized"])
    machines: Optional[List[Machine]] = None
    tariff: Optional[Tariff] = None
    solar_profile: Optional[SolarProfile] = None
    p_max_grid_kw: Optional[float] = None
    base_load: Optional[List[float]] = None

@router.post("/optimize", response_model=OptimizationResponse)
def run_optimization(payload: OptimizeEndpointPayload):
    site_id = payload.site_id
    site = repo.get_site(site_id)
    if not site:
        site_id = "00000000-0000-0000-0000-000000000001"
        site = repo.get_site(site_id)

    # Use supplied objects or retrieve site defaults
    machines = payload.machines or repo.get_machines(site_id)
    tariff = payload.tariff or repo.get_tariff(site_id)
    solar_profile = payload.solar_profile or repo.get_solar_profile(site_id, payload.scenario)
    base_load = payload.base_load or repo.get_base_load(site_id)
    p_max = payload.p_max_grid_kw if payload.p_max_grid_kw is not None else float(site.get("p_max_grid_kw", 25.0))

    req = OptimizationRequest(
        site_id=site_id,
        scenario=payload.scenario,
        machines=machines,
        tariff=tariff,
        solar_profile=solar_profile,
        base_load=base_load,
        p_max_grid_kw=p_max,
        strategies=payload.strategies
    )

    try:
        response = scheduler_service.run_optimization(req)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Optimization failed: {str(e)}")
