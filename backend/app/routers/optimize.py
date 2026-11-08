import time
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.models.domain import (
    OptimizationRequest,
    OptimizationResponse,
    OptimizationRunSummary,
    OptimizationRunDetail,
    Machine,
    Tariff,
    SolarProfile
)
from app.core.db import repo
from app.core.security import rate_limiter
from app.core.auth import AnonymousPrincipal, optional_principal
from app.routers.sites import authorize_site
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
def run_optimization(payload: OptimizeEndpointPayload, request: Request = None):
    principal = optional_principal(request) if request is not None else None
    site_id = payload.site_id
    site = authorize_site(site_id, principal)
    limiter_key = principal.subject if principal else (request.client.host if request and request.client else "public")
    rate_limiter.check(f"opt:{limiter_key}")

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

    start_time = time.time()
    try:
        response = scheduler_service.run_optimization(req)
        duration_ms = max(1, int((time.time() - start_time) * 1000))
        run_id = str(uuid.uuid4())
        response.run_id = run_id

        # Compute summary metrics for history
        baseline = response.strategies.get("baseline")
        cost_opt = response.strategies.get("cost_optimized")
        b_kpi = baseline.kpis if baseline else None
        c_kpi = cost_opt.kpis if cost_opt else None

        b_cost = b_kpi.daily_cost_rs if b_kpi else 0.0
        c_cost = c_kpi.daily_cost_rs if c_kpi else 0.0
        savings_pct = round(((b_cost - c_cost) / b_cost * 100.0), 2) if b_cost > 0 else 0.0

        summary = {
            "baseline_cost": round(b_cost, 2),
            "optimized_cost": round(c_cost, 2),
            "savings_pct": savings_pct,
            "baseline_peak_kw": round(b_kpi.peak_grid_demand_kw, 2) if b_kpi else 0.0,
            "optimized_peak_kw": round(c_kpi.peak_grid_demand_kw, 2) if c_kpi else 0.0,
            "deadline_violations": c_kpi.deadline_violations if c_kpi else 0
        }

        verifier_passed = all(s.verifier_passed for s in response.strategies.values()) if response.strategies else True
        status_str = "SUCCESS" if verifier_passed else "INFEASIBLE"

        visitor_id = principal.subject if principal else None
        run_record = {
            "id": run_id,
            "site_id": site_id,
            "visitor_id": visitor_id,
            "scenario": payload.scenario,
            "solver_name": "HiGHS / SciPy" if "scipy" in str(getattr(scheduler_service, "solver_type", "")).lower() else "OR-Tools CBC/SCIP",
            "status": status_str,
            "solver_duration_ms": duration_ms,
            "verifier_passed": verifier_passed,
            "summary": summary,
            "inputs": {
                "site_id": site_id,
                "scenario": payload.scenario,
                "p_max_grid_kw": p_max,
                "machines": [m.model_dump() for m in machines],
                "tariff": tariff.model_dump()
            },
            "results": response.model_dump(),
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        repo.save_optimization_run(run_record)

        return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Optimization failed: {str(e)}")

@router.get("/runs", response_model=List[OptimizationRunSummary])
@router.get("/optimization/runs", response_model=List[OptimizationRunSummary])
def list_runs(site_id: Optional[str] = None, request: Request = None):
    principal = optional_principal(request) if request is not None else None
    visitor_id = principal.subject if principal else None
    if site_id:
        authorize_site(site_id, principal)
    return repo.list_optimization_runs(site_id=site_id, visitor_id=visitor_id)

@router.get("/runs/{run_id}", response_model=OptimizationRunDetail)
@router.get("/optimization/runs/{run_id}", response_model=OptimizationRunDetail)
def get_run(run_id: str, request: Request = None):
    principal = optional_principal(request) if request is not None else None
    visitor_id = principal.subject if principal else None
    run = repo.get_optimization_run(run_id=run_id, visitor_id=visitor_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Optimization run {run_id} not found.")
    authorize_site(run["site_id"], principal)
    return run
