from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from app.models.domain import Site, SiteUpdate, Machine, Tariff, SolarProfile
from app.core.db import repo

router = APIRouter(prefix="/sites", tags=["Sites & Configuration"])

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
    return result

@router.put("/{site_id}", response_model=Dict[str, Any])
def update_site(site_id: str, update_data: SiteUpdate):
    data = {k: v for k, v in update_data.model_dump().items() if v is not None}
    updated = repo.update_site(site_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Site {site_id} not found")
    result = dict(updated)
    result["storage_mode"] = repo.storage_mode
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

@router.get("/{site_id}/solar", response_model=SolarProfile)
def get_solar_profile(site_id: str, scenario: str = Query("sunny", pattern="^(sunny|partly_cloudy|overcast)$")):
    return repo.get_solar_profile(site_id, scenario)
