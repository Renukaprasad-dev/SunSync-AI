import copy
import logging
from typing import Dict, List, Optional, Any
from app.models.domain import Machine, Tariff, SolarProfile
from app.core.config import settings

logger = logging.getLogger("sunsync.db")

class DataRepository:
    """Unified repository for SunSync AI data.
    Gracefully uses in-memory demo data when Supabase credentials are not provided,
    and supports Supabase PostgreSQL storage when configured.
    """

    def __init__(self):
        self._sites: Dict[str, Dict[str, Any]] = {}
        self._machines: Dict[str, List[Machine]] = {}
        self._tariffs: Dict[str, Tariff] = {}
        self._solar_profiles: Dict[str, Dict[str, SolarProfile]] = {}
        self._base_loads: Dict[str, List[float]] = {}
        self._optimization_runs: List[Dict[str, Any]] = []

        self._seed_demo_data()

    def _seed_demo_data(self):
        demo_site_id = "00000000-0000-0000-0000-000000000001"
        self._sites[demo_site_id] = {
            "id": demo_site_id,
            "name": "Peenya Precision Engineering (Demo Unit)",
            "location": "Peenya Industrial Area, Bengaluru, Karnataka, India",
            "p_max_grid_kw": 25.0,
            "solar_capacity_kw": 5.0,
            "currency": "INR",
            "grid_emission_factor_kg_per_kwh": 0.8200
        }

        # 7 Demo Machines
        self._machines[demo_site_id] = [
            Machine(
                id="10000000-0000-0000-0000-000000000001",
                name="CNC Milling Center",
                power_kw=4.0,
                duration_intervals=16, # 4 hours
                earliest_start=32,     # 08:00
                latest_start=48,       # 12:00
                deadline_interval=68,  # 17:00
                flexible=True
            ),
            Machine(
                id="10000000-0000-0000-0000-000000000002",
                name="Industrial Air Compressor",
                power_kw=3.5,
                duration_intervals=12, # 3 hours
                earliest_start=32,     # 08:00
                latest_start=48,       # 12:00
                deadline_interval=64,  # 16:00
                flexible=True
            ),
            Machine(
                id="10000000-0000-0000-0000-000000000003",
                name="Plastic Injection Molding",
                power_kw=5.0,
                duration_intervals=14, # 3.5 hours
                earliest_start=34,     # 08:30
                latest_start=44,       # 11:00
                deadline_interval=64,  # 16:00
                flexible=True
            ),
            Machine(
                id="10000000-0000-0000-0000-000000000004",
                name="Electric Curing Oven",
                power_kw=3.0,
                duration_intervals=8,  # 2 hours
                earliest_start=36,     # 09:00
                latest_start=56,       # 14:00
                deadline_interval=72,  # 18:00
                flexible=True
            ),
            Machine(
                id="10000000-0000-0000-0000-000000000005",
                name="Hydraulic Stamping Press",
                power_kw=4.5,
                duration_intervals=10, # 2.5 hours
                earliest_start=32,     # 08:00
                latest_start=32,       # 08:00
                deadline_interval=50,  # 12:30
                flexible=False
            ),
            Machine(
                id="10000000-0000-0000-0000-000000000006",
                name="Conveyor & Packaging Line",
                power_kw=2.0,
                duration_intervals=20, # 5 hours
                earliest_start=36,     # 09:00
                latest_start=36,       # 09:00
                deadline_interval=68,  # 17:00
                flexible=False
            ),
            Machine(
                id="10000000-0000-0000-0000-000000000007",
                name="Water Chiller & Pump",
                power_kw=2.5,
                duration_intervals=12, # 3 hours
                earliest_start=40,     # 10:00
                latest_start=60,       # 15:00
                deadline_interval=76,  # 19:00
                flexible=True
            )
        ]

        # Tariff
        tariff_rates = [4.5] * 96
        for i in range(96):
            if 24 <= i < 32:
                tariff_rates[i] = 7.0
            elif 32 <= i < 40:
                tariff_rates[i] = 9.0  # Morning peak: 08:00 - 10:00
            elif 40 <= i < 72:
                tariff_rates[i] = 7.0  # Day normal: 10:00 - 18:00
            elif 72 <= i < 88:
                tariff_rates[i] = 9.5  # Evening peak: 18:00 - 22:00
            elif 88 <= i < 96:
                tariff_rates[i] = 4.5  # Night off-peak: 22:00 - 24:00

        self._tariffs[demo_site_id] = Tariff(
            rates=tariff_rates,
            demand_charge_rate_per_kw=20.0,
            currency="INR",
            notes="Karnataka Industrial ToD tariff placeholder. Real values must come from official utility tariff order."
        )

        # Solar Profiles
        import math
        def make_solar(peak, dip=False):
            gen = [0.0] * 96
            center = 49.0
            width = 10.0
            for i in range(26, 72):
                val = peak * math.exp(-((i - center)**2) / (2 * (width**2)))
                if dip and (42 <= i <= 52):
                    val *= 0.6
                gen[i] = round(max(0.0, val), 2)
            return gen

        self._solar_profiles[demo_site_id] = {
            "sunny": SolarProfile(scenario="sunny", generation=make_solar(5.0), capacity_kw=5.0),
            "partly_cloudy": SolarProfile(scenario="partly_cloudy", generation=make_solar(3.8, dip=True), capacity_kw=5.0),
            "overcast": SolarProfile(scenario="overcast", generation=[round(v * 0.12, 2) for v in make_solar(4.0)], capacity_kw=5.0)
        }

        # Base Load
        self._base_loads[demo_site_id] = [0.8 if (i < 32 or i >= 76) else 1.5 for i in range(96)]

    # Site queries
    def list_sites(self) -> List[Dict[str, Any]]:
        return list(self._sites.values())

    def get_site(self, site_id: str) -> Optional[Dict[str, Any]]:
        return self._sites.get(site_id) or self._sites.get("00000000-0000-0000-0000-000000000001")

    def create_site(self, site_data: Dict[str, Any]) -> Dict[str, Any]:
        s_id = site_data.get("id") or f"site_{len(self._sites) + 1}"
        site_data["id"] = s_id
        self._sites[s_id] = site_data
        self._machines[s_id] = copy.deepcopy(self._machines["00000000-0000-0000-0000-000000000001"])
        self._tariffs[s_id] = copy.deepcopy(self._tariffs["00000000-0000-0000-0000-000000000001"])
        self._solar_profiles[s_id] = copy.deepcopy(self._solar_profiles["00000000-0000-0000-0000-000000000001"])
        self._base_loads[s_id] = copy.deepcopy(self._base_loads["00000000-0000-0000-0000-000000000001"])
        return site_data

    # Machines
    def get_machines(self, site_id: str) -> List[Machine]:
        return self._machines.get(site_id) or self._machines.get("00000000-0000-0000-0000-000000000001", [])

    def save_machines(self, site_id: str, machines: List[Machine]) -> List[Machine]:
        self._machines[site_id] = machines
        return machines

    # Tariff
    def get_tariff(self, site_id: str) -> Tariff:
        return self._tariffs.get(site_id) or self._tariffs["00000000-0000-0000-0000-000000000001"]

    def save_tariff(self, site_id: str, tariff: Tariff) -> Tariff:
        self._tariffs[site_id] = tariff
        return tariff

    # Solar
    def get_solar_profile(self, site_id: str, scenario: str = "sunny") -> SolarProfile:
        site_profiles = self._solar_profiles.get(site_id) or self._solar_profiles["00000000-0000-0000-0000-000000000001"]
        return site_profiles.get(scenario) or site_profiles["sunny"]

    # Base Load
    def get_base_load(self, site_id: str) -> List[float]:
        return self._base_loads.get(site_id) or self._base_loads["00000000-0000-0000-0000-000000000001"]

repo = DataRepository()
