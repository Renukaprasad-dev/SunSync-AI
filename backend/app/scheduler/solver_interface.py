from abc import ABC, abstractmethod
from typing import List, Dict, Any, Tuple
from app.models.domain import Machine

class BaseSchedulerSolver(ABC):
    """Abstract interface for MILP machine scheduler solvers.
    Allows OR-Tools CP-SAT, SciPy HiGHS, or mock solvers to be interchanged smoothly.
    """

    @abstractmethod
    def solve(
        self,
        machines: List[Machine],
        solar: List[float],
        tariff: List[float],
        demand_charge_rate: float,
        base_load: List[float],
        p_max_kw: float,
        strategy: str,
        time_limit_sec: float = 8.0
    ) -> Dict[str, Any]:
        """
        Solves the machine scheduling problem for a given strategy.
        Strategies:
          - 'baseline': Earliest feasible start (no optimization)
          - 'solar_aware': Maximize solar self-consumption (minimize grid import)
          - 'cost_optimized': Minimize total energy cost + peak demand charge
        Returns:
          Dict containing:
            - status: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'TIMEOUT'
            - schedule: Dict[machine_id, start_slot]
            - solver_duration_ms: float
            - solver_name: str
            - diagnosis: Optional[str] if infeasible
        """
        pass
