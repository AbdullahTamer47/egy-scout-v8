"""EGY-SCOUT V8 Tactical Decision Engine (Diagnostic Playbook, Counterfactual What-If, Matchup Optimizer)."""

from .counterfactual import (
    compute_dynamic_pitch_control,
    compute_shot_xg,
    find_optimal_ghost_move,
    simulate_ghost_move,
)
from .matchup_optimizer import recommend_matchup_plan
from .playbook import (
    TacticalDiagnosis,
    diagnose_frame_tactics,
    get_playbook_catalog,
)

__all__ = [
    "TacticalDiagnosis",
    "diagnose_frame_tactics",
    "get_playbook_catalog",
    "compute_dynamic_pitch_control",
    "compute_shot_xg",
    "simulate_ghost_move",
    "find_optimal_ghost_move",
    "recommend_matchup_plan",
]
