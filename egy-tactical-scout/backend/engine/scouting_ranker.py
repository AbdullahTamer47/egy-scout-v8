"""Autonomous player scouting ranker across tracked physical, tactical & fluid dimensions."""
from __future__ import annotations

import numpy as np
import pandas as pd

MIN_MINUTES_FOR_RANKING = 0.5
WEIGHTS = {
    "progressive_impact": 0.25,
    "space_creation": 0.25,
    "physical_output": 0.20,
    "pressing_workrate": 0.15,
    "tactical_discipline": 0.15,
}


def _pct(series: pd.Series, higher_is_better: bool = True) -> pd.Series:
    s = pd.to_numeric(series, errors="coerce")
    if s.dropna().empty:
        return pd.Series(50.0, index=series.index)
    if s.nunique(dropna=True) <= 1:
        return pd.Series(60.0, index=series.index)
    ranks = s.rank(pct=True, ascending=higher_is_better) * 100.0
    return ranks.fillna(50.0)


def verdict(score: float) -> str:
    if score >= 78:
        return "مرشح ممتاز للنخبة (تأثير تكتيكي ومساحات عالي)"
    if score >= 62:
        return "لاعب تكتيكي منضبط ومؤثر"
    return "موهبة قيد التطوير / خيار تدوير"


def rank_match_players(stats: pd.DataFrame) -> pd.DataFrame:
    """Rank players per tracked identity, gracefully adapting minimum tracked duration for short clips."""
    df = stats.copy()
    df["scout_score"] = np.nan
    df["score_breakdown"] = None
    df["verdict"] = None

    valid_roles = df[df["role"].isin(["player", "goalkeeper"]) & df["team_cluster"].isin([0, 1])]
    if valid_roles.empty:
        return df

    max_mins = float(valid_roles["minutes_tracked"].max())
    eff_min = min(MIN_MINUTES_FOR_RANKING, max(0.05, max_mins * 0.22)) if max_mins < 1.5 else MIN_MINUTES_FOR_RANKING
    elig = valid_roles[valid_roles["minutes_tracked"] >= eff_min].copy()
    if elig.empty:
        elig = valid_roles.copy()

    mins = elig["minutes_tracked"].clip(lower=max(0.05, eff_min))
    xt = elig["xt_generated"].astype(float)
    prog_raw = elig["line_breaking_passes"] * 4.5 + elig["progressive_carries"] * 3.0 + xt.fillna(0.0) * 25.0

    comp = pd.DataFrame(index=elig.index)
    comp["progressive_impact"] = _pct(prog_raw / mins)

    space_parts = []
    if elig["avg_attacking_space_m2"].notna().any():
        space_parts.append(_pct(elig["avg_attacking_space_m2"]))
    space_parts.append(_pct(elig["offball_runs"] / mins))
    comp["space_creation"] = pd.concat(space_parts, axis=1).mean(axis=1, skipna=True)

    comp["physical_output"] = pd.concat(
        [
            _pct(elig["distance_per_min_m"]),
            _pct(elig["max_speed_kmh"]),
            _pct(elig["sprint_count"] / mins),
        ],
        axis=1,
    ).mean(axis=1)
    comp["pressing_workrate"] = _pct((elig["pressing_actions"] + elig["recoveries"]) / mins)

    if "discipline_score" in elig.columns and elig["discipline_score"].notna().any():
        comp["tactical_discipline"] = elig["discipline_score"].fillna(65.0).clip(0.0, 100.0)
    else:
        comp["tactical_discipline"] = _pct(elig["tactical_deviation_m"], higher_is_better=False)

    for idx in elig.index:
        row = comp.loc[idx]
        avail = {k: float(row[k]) for k in WEIGHTS if pd.notna(row[k])}
        if not avail:
            continue
        wsum = sum(WEIGHTS[k] for k in avail)
        score = sum(WEIGHTS[k] * v for k, v in avail.items()) / wsum
        df.at[idx, "scout_score"] = round(score, 1)
        df.at[idx, "score_breakdown"] = {k: round(v, 1) for k, v in avail.items()}
        df.at[idx, "verdict"] = verdict(score)

    return df.sort_values("scout_score", ascending=False, na_position="last")
