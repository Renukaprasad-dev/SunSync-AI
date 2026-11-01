from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.models.domain import Machine, Tariff, SolarProfile, OptimizationResponse
from app.routers.optimize import OptimizeEndpointPayload, run_optimization

router = APIRouter(prefix="/scenarios", tags=["Scenario Simulation"])

class ScenarioSimulateRequest(BaseModel):
    site_id: str = "00000000-0000-0000-0000-000000000001"
    scenario: str = "sunny"
    machines: Optional[List[Machine]] = None
    tariff: Optional[Tariff] = None
    solar_profile: Optional[SolarProfile] = None
    p_max_grid_kw: Optional[float] = None
    strategies: List[str] = Field(default=["baseline", "cost_optimized"])

@router.post("/simulate", response_model=OptimizationResponse)
def simulate_scenario(payload: ScenarioSimulateRequest):
    """Interactive What-If Simulator: allows quick parameter sensitivity tests."""
    optimize_payload = OptimizeEndpointPayload(
        site_id=payload.site_id,
        scenario=payload.scenario,
        strategies=payload.strategies,
        machines=payload.machines,
        tariff=payload.tariff,
        solar_profile=payload.solar_profile,
        p_max_grid_kw=payload.p_max_grid_kw
    )
    return run_optimization(optimize_payload)
