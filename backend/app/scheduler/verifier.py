from typing import List, Dict, Tuple
from app.models.domain import Machine, StrategyKPIs, MachineScheduleResult
from app.core.config import slot_to_time_str

class ScheduleVerifier:
    """Independent verification engine that simulates machine dispatch from scratch
    without relying on solver internal state, guaranteeing truth-in-numbers.
    """

    @staticmethod
    def verify_and_compute_kpis(
        schedule: Dict[str, int],
        machines: List[Machine],
        solar: List[float],
        tariff: List[float],
        demand_charge_rate: float,
        base_load: List[float],
        p_max_kw: float,
        emission_factor_kg_per_kwh: float = 0.8200
    ) -> Tuple[StrategyKPIs, List[float], List[float], List[float], List[MachineScheduleResult], List[str]]:
        """
        Recomputes load, grid import, solar usage, costs, and checks constraints.
        Returns:
          (kpis, load_profile, grid_profile, solar_used_profile, machine_results, notes)
        """
        dt = 0.25 # hours per 15-min interval
        notes = []
        violations = 0

        machine_map = {m.id: m for m in machines}
        machine_results: List[MachineScheduleResult] = []

        # 1. Verify machine constraints
        for m in machines:
            start_slot = schedule.get(m.id, m.earliest_start)
            end_slot = start_slot + m.duration_intervals
            duration_hours = m.duration_intervals * dt
            energy_kwh = m.power_kw * duration_hours

            # Constraints check
            if start_slot < m.earliest_start:
                violations += 1
                notes.append(f"Constraint Violation: Machine '{m.name}' starts at slot {start_slot} before earliest {m.earliest_start}.")
            if start_slot > m.latest_start:
                violations += 1
                notes.append(f"Constraint Violation: Machine '{m.name}' starts at slot {start_slot} after latest {m.latest_start}.")
            if end_slot > m.deadline_interval:
                violations += 1
                notes.append(f"Deadline Violation: Machine '{m.name}' finishes at slot {end_slot} after deadline {m.deadline_interval}.")

            machine_results.append(
                MachineScheduleResult(
                    machine_id=m.id,
                    machine_name=m.name,
                    start_slot=start_slot,
                    end_slot=end_slot,
                    start_time_str=slot_to_time_str(start_slot),
                    end_time_str=slot_to_time_str(end_slot),
                    power_kw=m.power_kw,
                    duration_hours=round(duration_hours, 2),
                    energy_kwh=round(energy_kwh, 2),
                    flexible=m.flexible
                )
            )

        # 2. Simulate 96-interval dispatch
        load_profile = [0.0] * 96
        grid_profile = [0.0] * 96
        solar_used_profile = [0.0] * 96

        for t in range(96):
            # Sum active machines at slot t
            active_kw = 0.0
            for m in machines:
                s = schedule.get(m.id, m.earliest_start)
                if s <= t < s + m.duration_intervals:
                    active_kw += m.power_kw

            total_t = base_load[t] + active_kw
            load_profile[t] = round(total_t, 3)

            # Solar self-consumption & grid import
            solar_t = solar[t]
            solar_used = min(total_t, solar_t)
            grid_import = max(0.0, total_t - solar_t)

            solar_used_profile[t] = round(solar_used, 3)
            grid_profile[t] = round(grid_import, 3)

            # Peak grid limit check
            if grid_import > p_max_kw + 1e-3:
                notes.append(f"P_max Exceeded: Grid import {grid_import:.2f} kW at slot {t} exceeds P_max {p_max_kw:.2f} kW.")

        # 3. Compute accurate KPIs
        peak_grid_kw = max(grid_profile)
        total_energy_cost = sum(grid_profile[t] * tariff[t] * dt for t in range(96))
        demand_charge_cost = demand_charge_rate * peak_grid_kw
        total_daily_cost = total_energy_cost + demand_charge_cost

        solar_used_kwh = sum(solar_used_profile) * dt
        grid_imported_kwh = sum(grid_profile) * dt
        total_factory_kwh = sum(load_profile) * dt
        total_solar_generated_kwh = sum(solar) * dt

        self_consumption_pct = (solar_used_kwh / total_solar_generated_kwh * 100.0) if total_solar_generated_kwh > 0 else 0.0
        solar_coverage_pct = (solar_used_kwh / total_factory_kwh * 100.0) if total_factory_kwh > 0 else 0.0
        estimated_co2 = grid_imported_kwh * emission_factor_kg_per_kwh

        kpis = StrategyKPIs(
            daily_cost_rs=round(total_daily_cost, 2),
            peak_grid_demand_kw=round(peak_grid_kw, 2),
            solar_energy_used_kwh=round(solar_used_kwh, 2),
            grid_energy_imported_kwh=round(grid_imported_kwh, 2),
            total_factory_energy_kwh=round(total_factory_kwh, 2),
            solar_self_consumption_pct=round(self_consumption_pct, 1),
            solar_coverage_pct=round(solar_coverage_pct, 1),
            deadline_violations=violations,
            estimated_co2_kg=round(estimated_co2, 2)
        )

        return kpis, load_profile, grid_profile, solar_used_profile, machine_results, notes
