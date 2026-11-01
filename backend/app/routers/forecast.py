from typing import Optional, Dict, Any
from fastapi import APIRouter, Query
from app.forecast.forecaster import forecaster

router = APIRouter(prefix="/forecast", tags=["Weather & Forecasting"])

@router.get("", response_model=Dict[str, Any])
def get_day_forecast(
    scenario: str = Query("sunny", pattern="^(sunny|partly_cloudy|overcast)$"),
    source: str = Query("simulated", pattern="^(simulated|live)$"),
    lat: float = Query(12.9716, ge=-90.0, le=90.0),
    lon: float = Query(77.5946, ge=-180.0, le=180.0),
):
    """Returns 96-interval solar and factory load forecasts generated with XGBoost."""
    return forecaster.predict_day(scenario=scenario, source=source, lat=lat, lon=lon)
