from typing import Optional, Dict, Any
from fastapi import APIRouter, Query
from app.forecast.forecaster import forecaster

router = APIRouter(prefix="/forecast", tags=["Weather & Forecasting"])

@router.get("", response_model=Dict[str, Any])
def get_day_forecast(
    scenario: str = Query("sunny", pattern="^(sunny|partly_cloudy|overcast)$")
):
    """Returns 96-interval solar and factory load forecasts generated with XGBoost."""
    return forecaster.predict_day(scenario=scenario)
