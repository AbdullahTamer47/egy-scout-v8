"""EGY-SCOUT V8 Fair Scouting Engine (3-Mode Gate, VAEP/xT, PAdj, Archetypes, Evidence-First)."""

from .fair_engine import (
    XT_GRID_12X8,
    EvidenceClip,
    PlayerScoutingProfile,
    build_profiles_from_match_parquet,
    compare_players,
    compute_xt_value,
    import_external_scouting_csv,
)
from .input_gate import InputModeAssessment, assess_video_input_mode

__all__ = [
    "XT_GRID_12X8",
    "EvidenceClip",
    "PlayerScoutingProfile",
    "compute_xt_value",
    "build_profiles_from_match_parquet",
    "import_external_scouting_csv",
    "compare_players",
    "InputModeAssessment",
    "assess_video_input_mode",
]
