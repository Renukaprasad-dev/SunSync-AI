import copy
import json
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Any
import httpx
from fastapi import HTTPException

from app.models.domain import Machine, Tariff, SolarProfile
from app.core.config import settings

logger = logging.getLogger("sunsync.db")

LOCAL_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_env_store = os.environ.get("LOCAL_STORE_PATH")
LOCAL_STORE_PATH = Path(_env_store).resolve() if _env_store else LOCAL_DATA_DIR / "local_store.json"

def ensure_uuid(val: str) -> str:
    """Ensures string is a valid UUID; converts non-UUID strings deterministically."""
    try:
        uuid.UUID(str(val))
        return str(val)
    except (ValueError, TypeError):
        return str(uuid.uuid5(uuid.NAMESPACE_DNS, str(val)))

class DataRepository:
    """Unified repository for SunSync AI data.
    Directly persists to Supabase (PostgreSQL REST API) when SUPABASE_URL and
    SUPABASE_SERVICE_ROLE_KEY are configured; falls back to atomic local JSON
    store when running locally; runs in non-durable memory mode on serverless (Vercel)
    when Supabase credentials are not supplied.
    """

    def __init__(self, storage_mode: Optional[str] = None):
        self._lock = threading.RLock()
        self._explicit_mode = storage_mode
        self._sites: Dict[str, Dict[str, Any]] = {}
        self._machines: Dict[str, List[Machine]] = {}
        self._tariffs: Dict[str, Tariff] = {}
        self._solar_profiles: Dict[str, Dict[str, SolarProfile]] = {}
        self._base_loads: Dict[str, List[float]] = {}
        self._optimization_runs: List[Dict[str, Any]] = []

        self._seed_demo_data()
        if self.storage_mode == "local_file":
            self._load_local_store()

    @property
    def is_supabase_enabled(self) -> bool:
        return self.storage_mode == "supabase" and bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY)

    @property
    def storage_mode(self) -> str:
        if self._explicit_mode:
            return self._explicit_mode
        if settings.STORAGE_MODE:
            return settings.STORAGE_MODE
        if bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY):
            return "supabase"
        # Serverless runtimes have ephemeral / read-only filesystems
        if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
            return "memory"
        return "local_file"

    @property
    def is_durable(self) -> bool:
        return self.storage_mode in ("supabase", "local_file")

    def _get_supabase_headers(self) -> Dict[str, str]:
        return {
            "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }

    def _seed_demo_data(self):
        demo_site_id = "00000000-0000-0000-0000-000000000001"
        self._sites[demo_site_id] = {
            "id": demo_site_id,
            "name": "Peenya Precision Engineering (Demo Unit)",
            "location": "Peenya Industrial Area, Bengaluru, Karnataka, India",
            "p_max_grid_kw": 25.0,
            "solar_capacity_kw": 5.0,
            "currency": "INR",
            "grid_emission_factor_kg_per_kwh": 0.8200,
            "version": 1
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

        # Initial Demo Optimization Runs
        self._optimization_runs = [
            {
                "id": "20000000-0000-0000-0000-000000000001",
                "site_id": demo_site_id,
                "visitor_id": "demo",
                "scenario": "sunny",
                "solver_name": "HiGHS / SciPy MILP",
                "status": "SUCCESS",
                "solver_duration_ms": 115,
                "verifier_passed": True,
                "created_at": "2026-11-01T09:30:00Z",
                "summary": {
                    "baseline_cost": 593.42,
                    "optimized_cost": 481.18,
                    "savings_pct": 18.91,
                    "baseline_peak_kw": 18.5,
                    "optimized_peak_kw": 14.0,
                    "deadline_violations": 0
                },
                "inputs": {"site_id": demo_site_id, "scenario": "sunny"},
                "results": {
                    "site_id": demo_site_id,
                    "scenario": "sunny",
                    "timestamp": "2026-11-01T09:30:00Z",
                    "strategies": {},
                    "disclaimer": "Based on simulated data and mathematical optimization models. Validate against official utility tariff orders and real utility bills before operational reliance."
                }
            }
        ]

    def _load_local_store(self):
        """Loads locally persisted store if available."""
        if LOCAL_STORE_PATH.exists():
            try:
                with open(LOCAL_STORE_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if "sites" in data:
                    self._sites.update(data["sites"])
                if "machines" in data:
                    for s_id, m_list in data["machines"].items():
                        self._machines[s_id] = [Machine(**m) for m in m_list]
                if "tariffs" in data:
                    for s_id, t_dict in data["tariffs"].items():
                        self._tariffs[s_id] = Tariff(**t_dict)
                if "optimization_runs" in data:
                    self._optimization_runs = data["optimization_runs"]
                logger.info(f"Loaded locally persisted configuration from {LOCAL_STORE_PATH}")
            except Exception as e:
                logger.warning(f"Failed to read local store ({e}); using initial demo seed.")

    def _save_local_store(self):
        """Saves current state to local JSON store atomically under a process lock.
        No-op in non-durable memory mode.
        """
        if self.storage_mode != "local_file":
            return
        with self._lock:
            try:
                LOCAL_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
                serializable = {
                    "sites": self._sites,
                    "machines": {s_id: [m.model_dump() for m in m_list] for s_id, m_list in self._machines.items()},
                    "tariffs": {s_id: t.model_dump() for s_id, t in self._tariffs.items()},
                    "optimization_runs": self._optimization_runs[:100]
                }
                tmp_path = LOCAL_STORE_PATH.with_suffix(".tmp")
                with open(tmp_path, "w", encoding="utf-8") as f:
                    json.dump(serializable, f, indent=2)
                # Atomic replace on both POSIX and Windows
                tmp_path.replace(LOCAL_STORE_PATH)
            except OSError as e:
                logger.warning(f"Failed to write local store ({e}); filesystem may be read-only.")
            except Exception as e:
                logger.warning(f"Unexpected error writing local store ({e})")

    # 1. Sites
    def list_sites(self) -> List[Dict[str, Any]]:
        if self.is_supabase_enabled:
            try:
                url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/sites?select=*"
                resp = httpx.get(url, headers=self._get_supabase_headers(), timeout=3.0)
                if resp.status_code == 200:
                    data = resp.json()
                    if data:
                        return data
            except Exception as e:
                logger.warning(f"Supabase list_sites failed ({e}); falling back to local store.")
        return list(self._sites.values())

    def get_site(self, site_id: str) -> Optional[Dict[str, Any]]:
        if self.is_supabase_enabled:
            try:
                url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/sites?id=eq.{site_id}&select=*"
                resp = httpx.get(url, headers=self._get_supabase_headers(), timeout=3.0)
                if resp.status_code == 200:
                    data = resp.json()
                    if data:
                        return data[0]
            except Exception as e:
                logger.warning(f"Supabase get_site failed ({e}); falling back to local store.")
        return self._sites.get(site_id) or self._sites.get("00000000-0000-0000-0000-000000000001")

    def create_site(self, site_data: Dict[str, Any]) -> Dict[str, Any]:
        s_id = site_data.get("id") or str(uuid.uuid4())
        site_data["id"] = s_id

        if self.is_supabase_enabled:
            try:
                url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/sites"
                resp = httpx.post(url, headers=self._get_supabase_headers(), json=site_data, timeout=3.0)
                if resp.status_code in (200, 201):
                    site_data = resp.json()[0]
            except Exception as e:
                logger.warning(f"Supabase create_site failed ({e}); saving to local store.")

        self._sites[s_id] = site_data
        self._machines[s_id] = copy.deepcopy(self._machines.get("00000000-0000-0000-0000-000000000001", []))
        self._tariffs[s_id] = copy.deepcopy(self._tariffs.get("00000000-0000-0000-0000-000000000001", None))
        self._solar_profiles[s_id] = copy.deepcopy(self._solar_profiles.get("00000000-0000-0000-0000-000000000001", {}))
        self._base_loads[s_id] = copy.deepcopy(self._base_loads.get("00000000-0000-0000-0000-000000000001", []))
        self._save_local_store()
        return site_data

    def update_site(self, site_id: str, site_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        current = self.get_site(site_id)
        if not current:
            current = {"id": site_id, "name": "Site", "location": "Unknown"}

        current.update(site_data)
        self._sites[site_id] = current

        if self.is_supabase_enabled:
            try:
                url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/sites?id=eq.{site_id}"
                headers = self._get_supabase_headers()
                resp = httpx.patch(url, headers=headers, json=site_data, timeout=3.0)
                if resp.status_code in (200, 204):
                    if resp.content:
                        data = resp.json()
                        if data:
                            current = data[0]
                            self._sites[site_id] = current
                else:
                    raise RuntimeError(f"Supabase update_site failed ({resp.status_code}): {resp.text}")
            except Exception as e:
                logger.error(f"Supabase update_site failed: {e}")
                raise

        self._save_local_store()
        return current

    def get_site_config(self, site_id: str) -> Optional[Dict[str, Any]]:
        site = self.get_site(site_id)
        if not site:
            return None
        machines = self.get_machines(site_id)
        tariff = self.get_tariff(site_id)
        version = site.get("version", 1)
        return {
            "site": site,
            "machines": machines,
            "tariff": tariff,
            "version": version,
            "storage_mode": self.storage_mode,
            "durable": self.is_durable
        }

    def save_site_config(
        self,
        site_id: str,
        site_data: Dict[str, Any],
        machines: List[Machine],
        tariff: Tariff,
        expected_version: Optional[int] = None
    ) -> Dict[str, Any]:
        """Atomically saves site parameters, machines, and tariff with version conflict detection."""
        clean_machines: List[Machine] = []
        for m in machines:
            m_dict = m.model_dump()
            m_dict["id"] = ensure_uuid(m.id)
            clean_machines.append(Machine(**m_dict))

        if self.is_supabase_enabled:
            try:
                headers = self._get_supabase_headers()
                rpc_url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/rpc/save_site_configuration"
                rpc_payload = {
                    "p_site_id": site_id,
                    "p_site_data": site_data,
                    "p_machines": [m.model_dump() for m in clean_machines],
                    "p_tariff": tariff.model_dump(),
                    "p_expected_version": expected_version
                }
                resp = httpx.post(rpc_url, headers=headers, json=rpc_payload, timeout=5.0)
                if resp.status_code == 409 or "version_conflict" in resp.text:
                    raise HTTPException(
                        status_code=409,
                        detail="Conflict: Configuration has been modified by another session. Please reload latest."
                    )
                if resp.status_code not in (200, 201):
                    raise RuntimeError(f"Supabase RPC save_site_configuration failed ({resp.status_code}): {resp.text}")

                site = self.get_site(site_id)
                self._machines[site_id] = clean_machines
                self._tariffs[site_id] = tariff
                return {
                    "site": site,
                    "machines": clean_machines,
                    "tariff": tariff,
                    "version": site.get("version", (expected_version or 1) + 1),
                    "storage_mode": self.storage_mode,
                    "durable": self.is_durable
                }
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Supabase atomic save failed: {e}")
                raise

        with self._lock:
            current_site = self._sites.get(site_id)
            if not current_site:
                current_site = {"id": site_id, "name": "Site", "location": "Unknown", "version": 1}
                self._sites[site_id] = current_site

            current_version = current_site.get("version", 1)
            if expected_version is not None and expected_version != current_version:
                raise HTTPException(
                    status_code=409,
                    detail=f"Conflict: Configuration has been modified by another session (current version {current_version}, expected {expected_version}). Please reload latest."
                )

            current_site.update(site_data)
            new_version = current_version + 1
            current_site["version"] = new_version
            current_site["storage_mode"] = self.storage_mode
            current_site["durable"] = self.is_durable

            self._machines[site_id] = clean_machines
            self._tariffs[site_id] = tariff

            self._save_local_store()

            return {
                "site": current_site,
                "machines": clean_machines,
                "tariff": tariff,
                "version": new_version,
                "storage_mode": self.storage_mode,
                "durable": self.is_durable
            }

    # 2. Machines
    def get_machines(self, site_id: str) -> List[Machine]:
        if self.is_supabase_enabled:
            try:
                url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/machines?site_id=eq.{site_id}&select=*"
                resp = httpx.get(url, headers=self._get_supabase_headers(), timeout=3.0)
                if resp.status_code == 200:
                    records = resp.json()
                    if records:
                        return [Machine(**r) for r in records]
            except Exception as e:
                logger.warning(f"Supabase get_machines failed ({e}); falling back to local store.")
        return self._machines.get(site_id) or self._machines.get("00000000-0000-0000-0000-000000000001", [])

    def save_machines(self, site_id: str, machines: List[Machine]) -> List[Machine]:
        # Validate/ensure valid UUIDs for all machines
        clean_machines: List[Machine] = []
        for m in machines:
            m_dict = m.model_dump()
            m_dict["id"] = ensure_uuid(m.id)
            clean_machines.append(Machine(**m_dict))

        self._machines[site_id] = clean_machines
        self._save_local_store()

        if self.is_supabase_enabled:
            try:
                headers = self._get_supabase_headers()
                # 1. Fetch current remote machine IDs for this site to detect deletions
                check_url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/machines?site_id=eq.{site_id}&select=id"
                existing_resp = httpx.get(check_url, headers=headers, timeout=3.0)
                if existing_resp.status_code == 200:
                    existing_ids = {r["id"] for r in existing_resp.json()}
                    incoming_ids = {m.id for m in clean_machines}
                    deleted_ids = existing_ids - incoming_ids

                    if deleted_ids:
                        for d_id in deleted_ids:
                            del_url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/machines?site_id=eq.{site_id}&id=eq.{d_id}"
                            httpx.delete(del_url, headers=headers, timeout=3.0)

                # 2. Upsert incoming machines
                url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/machines"
                payload = [
                    {
                        "id": m.id,
                        "site_id": site_id,
                        "name": m.name,
                        "power_kw": m.power_kw,
                        "duration_intervals": m.duration_intervals,
                        "earliest_start": m.earliest_start,
                        "latest_start": m.latest_start,
                        "deadline_interval": m.deadline_interval,
                        "flexible": m.flexible
                    }
                    for m in clean_machines
                ]
                upsert_headers = self._get_supabase_headers()
                upsert_headers["Prefer"] = "resolution=merge-duplicates"
                post_resp = httpx.post(url, headers=upsert_headers, json=payload, timeout=3.0)
                if post_resp.status_code not in (200, 201, 204):
                    raise RuntimeError(f"Supabase save_machines failed ({post_resp.status_code}): {post_resp.text}")
            except Exception as e:
                logger.error(f"Supabase save_machines failed: {e}")
                raise

        return clean_machines

    # 3. Tariff
    def get_tariff(self, site_id: str) -> Tariff:
        if self.is_supabase_enabled:
            try:
                url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/tariffs?site_id=eq.{site_id}&select=*"
                resp = httpx.get(url, headers=self._get_supabase_headers(), timeout=3.0)
                if resp.status_code == 200:
                    data = resp.json()
                    if data:
                        t = data[0]
                        return Tariff(
                            rates=t["rates_json"],
                            demand_charge_rate_per_kw=float(t["demand_charge_rate_per_kw"]),
                            currency=t.get("currency", "INR"),
                            notes=t.get("notes")
                        )
            except Exception as e:
                logger.warning(f"Supabase get_tariff failed ({e}); falling back to local store.")
        return self._tariffs.get(site_id) or self._tariffs["00000000-0000-0000-0000-000000000001"]

    def save_tariff(self, site_id: str, tariff: Tariff) -> Tariff:
        self._tariffs[site_id] = tariff
        self._save_local_store()

        if self.is_supabase_enabled:
            try:
                headers = self._get_supabase_headers()
                check_url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/tariffs?site_id=eq.{site_id}&select=id"
                existing_resp = httpx.get(check_url, headers=headers, timeout=3.0)

                payload = {
                    "site_id": site_id,
                    "name": "Configured Industrial Tariff",
                    "demand_charge_rate_per_kw": tariff.demand_charge_rate_per_kw,
                    "currency": tariff.currency,
                    "rates_json": tariff.rates,
                    "notes": tariff.notes
                }

                if existing_resp.status_code == 200 and existing_resp.json():
                    t_id = existing_resp.json()[0]["id"]
                    url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/tariffs?id=eq.{t_id}"
                    patch_resp = httpx.patch(url, headers=headers, json=payload, timeout=3.0)
                    if patch_resp.status_code not in (200, 204):
                        raise RuntimeError(f"Supabase save_tariff failed ({patch_resp.status_code}): {patch_resp.text}")
                else:
                    url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/tariffs"
                    post_resp = httpx.post(url, headers=headers, json=payload, timeout=3.0)
                    if post_resp.status_code not in (200, 201, 204):
                        raise RuntimeError(f"Supabase save_tariff failed ({post_resp.status_code}): {post_resp.text}")
            except Exception as e:
                logger.error(f"Supabase save_tariff failed: {e}")
                raise

        return tariff

    # 4. Solar Profile
    def get_solar_profile(self, site_id: str, scenario: str = "sunny") -> SolarProfile:
        if self.is_supabase_enabled:
            try:
                url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/solar_profiles?site_id=eq.{site_id}&scenario=eq.{scenario}&select=*"
                resp = httpx.get(url, headers=self._get_supabase_headers(), timeout=3.0)
                if resp.status_code == 200:
                    data = resp.json()
                    if data:
                        s = data[0]
                        return SolarProfile(
                            scenario=s["scenario"],
                            generation=s["generation_json"],
                            capacity_kw=float(s.get("peak_kw", 5.0))
                        )
            except Exception as e:
                logger.warning(f"Supabase get_solar_profile failed ({e}); falling back to local store.")
        site_profiles = self._solar_profiles.get(site_id) or self._solar_profiles["00000000-0000-0000-0000-000000000001"]
        return site_profiles.get(scenario) or site_profiles["sunny"]

    # 5. Base Load
    def get_base_load(self, site_id: str) -> List[float]:
        if self.is_supabase_enabled:
            try:
                url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/base_loads?site_id=eq.{site_id}&select=*"
                resp = httpx.get(url, headers=self._get_supabase_headers(), timeout=3.0)
                if resp.status_code == 200:
                    data = resp.json()
                    if data:
                        return data[0]["load_json"]
            except Exception as e:
                logger.warning(f"Supabase get_base_load failed ({e}); falling back to local store.")
        return self._base_loads.get(site_id) or self._base_loads["00000000-0000-0000-0000-000000000001"]

    # 5. Optimization Runs (History & Sandbox Scoping)
    def save_optimization_run(self, run_record: Dict[str, Any]) -> Dict[str, Any]:
        """Saves an optimization run to in-memory/local store and Supabase if configured."""
        with self._lock:
            # Prepend so newest runs appear first
            self._optimization_runs.insert(0, run_record)
            if len(self._optimization_runs) > 200:
                self._optimization_runs = self._optimization_runs[:200]
            self._save_local_store()

        if self.is_supabase_enabled:
            try:
                headers = self._get_supabase_headers()
                url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/optimization_runs"
                payload = {
                    "id": run_record["id"],
                    "site_id": run_record["site_id"],
                    "scenario": run_record["scenario"],
                    "solver_name": run_record.get("solver_name", "HiGHS / SciPy"),
                    "inputs": run_record.get("inputs", {}),
                    "results": run_record.get("results", {}),
                    "status": run_record.get("status", "SUCCESS"),
                    "solver_duration_ms": int(run_record.get("solver_duration_ms", 100)),
                    "verifier_passed": bool(run_record.get("verifier_passed", True)),
                    "created_at": run_record.get("created_at")
                }
                resp = httpx.post(url, headers=headers, json=payload, timeout=3.0)
                if resp.status_code not in (200, 201):
                    logger.warning(f"Supabase save optimization_run returned {resp.status_code}: {resp.text}")
            except Exception as e:
                logger.warning(f"Supabase save optimization_run failed: {e}")

        return run_record

    def list_optimization_runs(
        self,
        site_id: Optional[str] = None,
        visitor_id: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Lists past optimization runs.
        Enforces visitor sandbox scoping:
        - Visitors can view runs on the shared demo site.
        - Visitors can view their own sandbox runs.
        - Visitors CANNOT view runs of another visitor's private sandbox site.
        """
        filtered = []
        with self._lock:
            runs_copy = list(self._optimization_runs)

        for run in runs_copy:
            run_site_id = run.get("site_id")
            run_visitor_id = run.get("visitor_id")

            # Check if this run belongs to another visitor's private sandbox site
            site = self.get_site(run_site_id) if run_site_id else None
            site_owner = site.get("owner_session_id") if site else None

            if site_owner and visitor_id and site_owner != visitor_id:
                # Private to another visitor -> skip
                continue

            if site_id and run_site_id != site_id:
                continue

            if visitor_id and run_visitor_id and run_visitor_id != visitor_id and run_site_id != self.DEMO_SITE_ID:
                continue

            # Produce summary item
            summary = run.get("summary") or {}
            filtered.append({
                "id": run.get("id"),
                "site_id": run_site_id,
                "scenario": run.get("scenario", "sunny"),
                "solver_name": run.get("solver_name", "HiGHS / SciPy"),
                "status": run.get("status", "SUCCESS"),
                "solver_duration_ms": run.get("solver_duration_ms", 0),
                "verifier_passed": run.get("verifier_passed", True),
                "created_at": run.get("created_at", ""),
                "summary": summary
            })
            if len(filtered) >= limit:
                break

        return filtered

    def get_optimization_run(self, run_id: str, visitor_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Retrieves a specific run by ID with full inputs and results.
        Enforces visitor sandbox scoping (403 Forbidden on cross-visitor sandbox runs).
        """
        with self._lock:
            run = next((r for r in self._optimization_runs if r.get("id") == run_id), None)

        if not run and self.is_supabase_enabled:
            try:
                headers = self._get_supabase_headers()
                url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/optimization_runs?id=eq.{run_id}&select=*"
                resp = httpx.get(url, headers=headers, timeout=3.0)
                if resp.status_code == 200 and resp.json():
                    row = resp.json()[0]
                    run = {
                        "id": row["id"],
                        "site_id": row["site_id"],
                        "scenario": row["scenario"],
                        "solver_name": row["solver_name"],
                        "status": row["status"],
                        "solver_duration_ms": row["solver_duration_ms"],
                        "verifier_passed": row["verifier_passed"],
                        "created_at": row["created_at"],
                        "inputs": row.get("inputs", {}),
                        "results": row.get("results", {}),
                        "summary": row.get("inputs", {}).get("summary", {})
                    }
            except Exception as e:
                logger.warning(f"Supabase fetch optimization_run {run_id} failed: {e}")

        if not run:
            return None

        # Check access security
        run_site_id = run.get("site_id")
        site = self.get_site(run_site_id) if run_site_id else None
        site_owner = site.get("owner_session_id") if site else None
        if site_owner and visitor_id and site_owner != visitor_id:
            raise HTTPException(
                status_code=403,
                detail="Forbidden: Cannot access optimization runs from another visitor's sandbox."
            )

        return run

    # 6. Visitor Sandbox Scoping & Lifecycle
    DEMO_SITE_ID = "00000000-0000-0000-0000-000000000001"

    def _validate_visitor_id(self, visitor_id: Optional[str]) -> str:
        if not visitor_id:
            raise HTTPException(status_code=400, detail="Visitor session ID is required.")
        cleaned = visitor_id.replace("-", "").strip()
        if len(cleaned) < 32:
            raise HTTPException(
                status_code=400,
                detail="Invalid visitor session ID: must be at least 32 characters to prevent spoofing."
            )
        return visitor_id

    def get_site_for_visitor(self, site_id: str, visitor_id: str) -> Dict[str, Any]:
        """Returns site with visitor scoping:
        - Demo site (DEMO_SITE_ID) is publicly readable by all visitors.
        - Visitor sandbox sites can only be read by their creator/owner.
        """
        self._validate_visitor_id(visitor_id)
        site = self.get_site(site_id)
        if not site:
            raise HTTPException(status_code=404, detail=f"Site {site_id} not found.")

        owner = site.get("owner_session_id")
        if site_id != self.DEMO_SITE_ID and owner and owner != visitor_id:
            raise HTTPException(
                status_code=403,
                detail=f"Forbidden: Visitor {visitor_id} cannot access sandbox site {site_id} owned by another session."
            )
        return site

    def clone_demo_site_for_visitor(self, visitor_id: str) -> str:
        """Clones the shared demo site into a visitor-scoped sandbox site."""
        self._validate_visitor_id(visitor_id)
        new_site_id = str(uuid.uuid4())
        demo_site = self.get_site(self.DEMO_SITE_ID) or {
            "name": "Peenya Precision Engineering (Demo Unit)",
            "location": "Peenya Industrial Area, Bengaluru, Karnataka, India",
            "p_max_grid_kw": 25.0,
            "solar_capacity_kw": 5.0,
            "currency": "INR",
            "grid_emission_factor_kg_per_kwh": 0.82
        }
        demo_machines = self.get_machines(self.DEMO_SITE_ID)
        demo_tariff = self.get_tariff(self.DEMO_SITE_ID)

        # Deep clone site entity
        new_site = copy.deepcopy(demo_site)
        new_site["id"] = new_site_id
        new_site["name"] = f"{demo_site.get('name', 'Demo Factory')} (Visitor Sandbox)"
        new_site["owner_session_id"] = visitor_id
        new_site["version"] = 1
        new_site["created_at"] = time.time()

        # Clone machines with newly assigned UUIDs
        new_machines = []
        for m in demo_machines:
            m_copy = m.model_copy()
            m_copy.id = str(uuid.uuid4())
            new_machines.append(m_copy)

        new_tariff = demo_tariff.model_copy()

        if self.is_supabase_enabled:
            headers = self._get_supabase_headers()
            site_url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/sites"
            site_payload = {
                "id": new_site_id,
                "name": new_site["name"],
                "location": new_site.get("location", "Bengaluru"),
                "p_max_grid_kw": new_site.get("p_max_grid_kw", 25.0),
                "solar_capacity_kw": new_site.get("solar_capacity_kw", 5.0),
                "currency": new_site.get("currency", "INR"),
                "grid_emission_factor_kg_per_kwh": new_site.get("grid_emission_factor_kg_per_kwh", 0.82),
                "owner_session_id": visitor_id,
                "version": 1
            }
            resp = httpx.post(site_url, headers=headers, json=site_payload, timeout=3.0)
            if resp.status_code not in (200, 201):
                raise RuntimeError(f"Supabase clone site failed ({resp.status_code}): {resp.text}")

        with self._lock:
            self._sites[new_site_id] = new_site
            self._machines[new_site_id] = new_machines
            self._tariffs[new_site_id] = new_tariff
            self._save_local_store()

        return new_site_id

    def save_site_config_for_visitor(
        self,
        site_id: str,
        site_data: Dict[str, Any],
        machines: List[Machine],
        tariff: Tariff,
        expected_version: Optional[int],
        visitor_id: str
    ) -> Dict[str, Any]:
        """Saves site config enforcing:
        1. Direct mutation of the shared seeded demo site is rejected (403 Forbidden).
        2. Visitor A cannot modify visitor B's sandbox site (403 Forbidden).
        """
        self._validate_visitor_id(visitor_id)
        if site_id == self.DEMO_SITE_ID:
            raise HTTPException(
                status_code=403,
                detail="Forbidden: Direct mutation of the shared demo site is rejected. Clone to a visitor sandbox site first."
            )

        site = self.get_site(site_id)
        if not site:
            raise HTTPException(status_code=404, detail=f"Site {site_id} not found.")

        owner = site.get("owner_session_id")
        if owner and owner != visitor_id:
            raise HTTPException(
                status_code=403,
                detail=f"Forbidden: Visitor {visitor_id} cannot modify sandbox site {site_id} owned by another session."
            )

        return self.save_site_config(site_id, site_data, machines, tariff, expected_version)

    def cleanup_expired_sandboxes(self, max_age_seconds: int = 86400) -> int:
        """Purges visitor sandbox sites older than TTL.
        CRITICAL: NEVER deletes the shared seeded demo site (DEMO_SITE_ID).
        """
        now = time.time()
        purged = 0
        with self._lock:
            to_delete = []
            for s_id, s_data in list(self._sites.items()):
                if s_id == self.DEMO_SITE_ID:
                    continue  # NEVER delete shared demo site!
                owner = s_data.get("owner_session_id")
                created_at = s_data.get("created_at", 0)
                if owner and (now - created_at > max_age_seconds):
                    to_delete.append(s_id)

            for s_id in to_delete:
                del self._sites[s_id]
                self._machines.pop(s_id, None)
                self._tariffs.pop(s_id, None)
                purged += 1

            if self.is_supabase_enabled and to_delete:
                headers = self._get_supabase_headers()
                for s_id in to_delete:
                    try:
                        del_url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/sites?id=eq.{s_id}&owner_session_id=not.is.null"
                        httpx.delete(del_url, headers=headers, timeout=3.0)
                    except Exception as e:
                        logger.warning(f"Failed to delete expired sandbox {s_id} from Supabase: {e}")

            if purged > 0:
                self._save_local_store()

        return purged

repo = DataRepository()
