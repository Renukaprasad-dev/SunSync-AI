from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, model_validator
from app.core.config import slot_to_time_str

class Site(BaseModel):
    id: str = Field(..., description="Unique site UUID")
    name: str = Field(..., description="Site name")
    location: str = Field(..., description="Site location")
    p_max_grid_kw: float = Field(25.0, ge=0.1, le=1000.0, description="Factory peak grid demand limit in kW")
    solar_capacity_kw: float = Field(5.0, ge=0.0, le=1000.0, description="Rooftop solar capacity in kW")
    currency: str = Field("INR", description="Currency symbol/code")
    grid_emission_factor_kg_per_kwh: float = Field(0.8200, ge=0.0, description="Grid emission factor in kg CO2/kWh")

class SiteUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    p_max_grid_kw: Optional[float] = Field(None, ge=0.1, le=1000.0)
    solar_capacity_kw: Optional[float] = Field(None, ge=0.0, le=1000.0)
    currency: Optional[str] = None
    grid_emission_factor_kg_per_kwh: Optional[float] = Field(None, ge=0.0)

class SiteConfigPayload(BaseModel):
    site: SiteUpdate
    machines: List["Machine"]
    tariff: "Tariff"
    expected_version: Optional[int] = None

class SiteConfigResponse(BaseModel):
    site: Dict[str, Any]
    machines: List["Machine"]
    tariff: "Tariff"
    version: int
    storage_mode: str
    durable: bool

class Machine(BaseModel):
    id: str = Field(..., description="Unique machine identifier")
    name: str = Field(..., description="Machine display name")
    power_kw: float = Field(..., gt=0, description="Rated continuous power draw in kW")
    duration_intervals: int = Field(..., gt=0, le=96, description="Run duration in 15-minute intervals")
    earliest_start: int = Field(..., ge=0, le=95, description="Earliest allowable start slot (0-95)")
    latest_start: int = Field(..., ge=0, le=95, description="Latest allowable start slot (0-95)")
    deadline_interval: int = Field(..., gt=0, le=96, description="Completion deadline slot (1-96)")
    flexible: bool = Field(True, description="Whether machine start time can be adjusted by scheduler")

    @model_validator(mode="after")
    def validate_machine_bounds(self):
        import math
        if not math.isfinite(self.power_kw) or self.power_kw <= 0:
            raise ValueError(f"Machine '{self.name}': power_kw must be a positive finite number (> 0)")
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
    avoided_co2_kg: float = 0.0
    grid_emission_factor_kg_per_kwh: float = 0.82

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
    run_id: Optional[str] = None
    disclaimer: str = (
        "Based on simulated data and mathematical optimization models. "
        "Validate against official utility tariff orders and real utility bills before operational reliance."
    )
    strategies: Dict[str, StrategySchedule]
    machine_reasons: Dict[str, str] = {}
    infeasibility_diagnosis: Optional[str] = None

class OptimizationRunSummary(BaseModel):
    id: str
    site_id: str
    scenario: str
    solver_name: str
    status: str
    solver_duration_ms: int
    verifier_passed: bool
    created_at: str
    summary: Dict[str, Any]

class OptimizationRunDetail(BaseModel):
    id: str
    site_id: str
    scenario: str
    solver_name: str
    status: str
    solver_duration_ms: int
    verifier_passed: bool
    created_at: str
    inputs: Dict[str, Any]
    results: Dict[str, Any]
    summary: Dict[str, Any]

class BillRealityCheckRequest(BaseModel):
    site_id: str = "00000000-0000-0000-0000-000000000001"
    operating_days: int = Field(26, ge=1, le=31, description="Operating days in billing month")
    real_energy_kwh: float = Field(..., gt=0, description="Total metered energy in kWh from real bill")
    real_energy_charge_rs: float = Field(..., ge=0, description="Energy charge in Rs from real bill")
    real_demand_kw: float = Field(..., gt=0, description="Peak recorded maximum demand in kW or kVA")
    real_demand_charge_rs: float = Field(..., ge=0, description="Demand charge / fixed penalty in Rs from real bill")

class BillComparisonMetric(BaseModel):
    real: float
    model_baseline: float
    gap: float
    gap_pct: float

class BillRealityCheckResponse(BaseModel):
    operating_days: int
    real_total_bill_rs: float
    model_baseline_total_bill_rs: float
    total_bill_gap_rs: float
    total_bill_gap_pct: float
    metrics: Dict[str, BillComparisonMetric]
    likely_causes: List[str]
    sanity_status: str
    disclaimer: str = (
        "Order-of-magnitude sanity check for decision support only. "
        "Not formal utility validation or billing audit. "
        "Validate against official utility tariff orders and actual bills before operational reliance."
    )
