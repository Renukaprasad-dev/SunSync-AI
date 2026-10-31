from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, model_validator
from app.core.config import slot_to_time_str

class Machine(BaseModel):
    id: str = Field(..., description="Unique machine identifier")
    name: str = Field(..., description="Machine display name")
    power_kw: float = Field(..., ge=0, description="Rated continuous power draw in kW")
    duration_intervals: int = Field(..., gt=0, le=96, description="Run duration in 15-minute intervals")
    earliest_start: int = Field(..., ge=0, le=95, description="Earliest allowable start slot (0-95)")
    latest_start: int = Field(..., ge=0, le=95, description="Latest allowable start slot (0-95)")
    deadline_interval: int = Field(..., gt=0, le=96, description="Completion deadline slot (1-96)")
    flexible: bool = Field(True, description="Whether machine start time can be adjusted by scheduler")

    @model_validator(mode="after")
    def validate_machine_bounds(self):
        if self.earliest_start > self.latest_start:
            raise ValueError(f"Machine '{self.name}': earliest_start ({self.earliest_start}) must be <= latest_start ({self.latest_start})")
        if self.earliest_start + self.duration_intervals > self.deadline_interval:
            raise ValueError(
                f"Machine '{self.name}': earliest completion ({self.earliest_start + self.duration_intervals}) "
                f"exceeds deadline ({self.deadline_interval})"
            )
        if not self.flexible and self.earliest_start != self.latest_start:
            # Fixed machine: clamp latest_start to earliest_start
            self.latest_start = self.earliest_start
        return self

class Tariff(BaseModel):
    rates: List[float] = Field(..., description="96 rates in Rs/kWh for 15-minute intervals")
    demand_charge_rate_per_kw: float = Field(20.0, ge=0, description="Demand charge rate in Rs/kW of peak grid demand")
    currency: str = Field("INR", description="Currency symbol/code")
    notes: Optional[str] = Field(None, description="Tariff origin notes / utility disclaimer")

    @model_validator(mode="after")
    def validate_rates_len(self):
        if len(self.rates) != 96:
            raise ValueError(f"Tariff rates must contain exactly 96 intervals, received {len(self.rates)}")
        return self

class SolarProfile(BaseModel):
    scenario: str = Field(..., description="Scenario identifier: sunny, partly_cloudy, overcast, or custom")
    generation: List[float] = Field(..., description="96 solar generation values in kW")
    capacity_kw: float = Field(5.0, ge=0, description="Rooftop solar DC capacity in kW")

    @model_validator(mode="after")
    def validate_generation_len(self):
        if len(self.generation) != 96:
            raise ValueError(f"Solar profile generation must contain exactly 96 intervals, received {len(self.generation)}")
        return self

class MachineScheduleResult(BaseModel):
    machine_id: str
    machine_name: str
    start_slot: int
    end_slot: int
    start_time_str: str
    end_time_str: str
    power_kw: float
    duration_hours: float
    energy_kwh: float
    flexible: bool
    reason: Optional[str] = None

class StrategyKPIs(BaseModel):
    daily_cost_rs: float
    peak_grid_demand_kw: float
    solar_energy_used_kwh: float
    grid_energy_imported_kwh: float
    total_factory_energy_kwh: float
    solar_self_consumption_pct: float
    solar_coverage_pct: float
    deadline_violations: int = 0
    estimated_co2_kg: float = 0.0

class StrategySchedule(BaseModel):
    strategy_name: str # "baseline", "solar_aware", "cost_optimized"
    display_title: str
    status: str # "OPTIMAL", "FEASIBLE", "INFEASIBLE"
    solver_duration_ms: float
    machine_schedules: List[MachineScheduleResult]
    load_profile: List[float] # total factory load (kW) per slot
    grid_profile: List[float] # grid import (kW) per slot
    solar_profile: List[float] # solar available (kW) per slot
    solar_used_profile: List[float] # solar consumed on-site (kW) per slot
    kpis: StrategyKPIs
    reasons: List[str] = []
    verifier_passed: bool = True
    verifier_notes: Optional[str] = None

class OptimizationRequest(BaseModel):
    site_id: Optional[str] = "demo-site"
    scenario: str = "sunny"
    machines: List[Machine]
    tariff: Tariff
    solar_profile: SolarProfile
    base_load: Optional[List[float]] = None
    p_max_grid_kw: float = 25.0
    strategies: List[str] = ["baseline", "solar_aware", "cost_optimized"]

class OptimizationResponse(BaseModel):
    site_id: Optional[str]
    scenario: str
    timestamp: str
    disclaimer: str = (
        "Based on simulated data and mathematical optimization models. "
        "Validate against official utility tariff orders and real utility bills before operational reliance."
    )
    strategies: Dict[str, StrategySchedule]
    machine_reasons: Dict[str, str] = {}
    infeasibility_diagnosis: Optional[str] = None
