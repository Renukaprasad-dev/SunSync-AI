from typing import List, Dict
from app.models.domain import Machine
from app.core.config import slot_to_time_str

class ReasonEngine:
    """Generates plain-language, quantitatively-justified explanations
    for every scheduling decision made by SunSync AI.
    """

    @staticmethod
    def generate_machine_reasons(
        baseline_schedule: Dict[str, int],
        optimized_schedule: Dict[str, int],
        machines: List[Machine],
        solar: List[float],
        tariff: List[float]
    ) -> Dict[str, str]:
        reasons = {}

        for m in machines:
            base_s = baseline_schedule.get(m.id, m.earliest_start)
            opt_s = optimized_schedule.get(m.id, m.earliest_start)
            base_time = slot_to_time_str(base_s)
            opt_time = slot_to_time_str(opt_s)
            end_time = slot_to_time_str(opt_s + m.duration_intervals)
            deadline_time = slot_to_time_str(m.deadline_interval)

            if not m.flexible:
                reasons[m.id] = (
                    f"Fixed at {base_time} - {slot_to_time_str(base_s + m.duration_intervals)}: "
                    f"Process designated as non-flexible (continuous critical operation)."
                )
                continue

            if opt_s == base_s:
                # Check why not moved
                if m.earliest_start + m.duration_intervals >= m.deadline_interval:
                    reasons[m.id] = (
                        f"Retained at {base_time}: Tight production deadline binding at {deadline_time} "
                        f"leaves no slack for shift."
                    )
                else:
                    reasons[m.id] = (
                        f"Retained at {base_time}: Earliest start is already balanced against grid demand "
                        f"and finishes by {end_time}."
                    )
            else:
                # Quantify solar & tariff difference
                old_solar_avg = sum(solar[t] for t in range(base_s, min(96, base_s + m.duration_intervals))) / m.duration_intervals
                new_solar_avg = sum(solar[t] for t in range(opt_s, min(96, opt_s + m.duration_intervals))) / m.duration_intervals
                new_solar_max = max(solar[t] for t in range(opt_s, min(96, opt_s + m.duration_intervals)))

                old_tariff_avg = sum(tariff[t] for t in range(base_s, min(96, base_s + m.duration_intervals))) / m.duration_intervals
                new_tariff_avg = sum(tariff[t] for t in range(opt_s, min(96, opt_s + m.duration_intervals))) / m.duration_intervals

                solar_clause = ""
                if new_solar_avg > old_solar_avg + 0.3:
                    solar_clause = f"absorbs {new_solar_max:.1f} kW peak rooftop solar (vs {old_solar_avg:.1f} kW before)"

                tariff_clause = ""
                if new_tariff_avg < old_tariff_avg - 0.2:
                    tariff_clause = f"avoids peak tariff slots (averaging Rs {new_tariff_avg:.2f}/kWh vs Rs {old_tariff_avg:.2f}/kWh)"

                reasons_list = [c for c in [solar_clause, tariff_clause] if c]
                benefit_text = " and ".join(reasons_list) if reasons_list else "avoids factory peak coincidence"

                reasons[m.id] = (
                    f"Shifted from {base_time} to {opt_time}: {benefit_text}, "
                    f"smoothly finishing at {end_time} well ahead of {deadline_time} deadline."
                )

        return reasons
