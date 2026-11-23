---
name: football-data-integrity
description: Enforces strict football roster accuracy, position-aware player-to-slot mapping, and zero cross-league/hallucinated player profiles in EGY-SCOUT. Activate whenever editing rosters, formation blueprints, scouting profiles, or match player data.
---

# Football Data Integrity & Anti-Hallucination Skill

## Iron Laws
1. **Verify Real Squads Before Hardcoding:** Always verify current club rosters, jersey numbers, and natural positions via web search (Transfermarkt / LiveScore) before editing `DEFAULT_MATCH_ROSTERS` or club profiles. Never guess transfers or invent jersey numbers.
2. **Position-Aware Slot Assignment (NEVER Blind Array Indexing):**
   - Never assign `roster[idx]` blindly to `formation_nodes[idx]`.
   - Always score `(player.position, target_slot)` compatibility (`GK↔GK=100`, `CB↔CB=100`, `LB↔LB/LWB=100`, `RB↔RB/RWB=100`, `CDM/DM↔DM=100`, `CM↔CM=90`, `CAM/AM↔CAM/AM=100`, `LW/LM↔LW/LM=95`, `RW/RM↔RW/RM=95`, `ST/CF↔ST=100`) and perform greedy/Hungarian unique matching so a Left-Back is NEVER placed at `CB` and a Midfielder is NEVER placed at `ST` unless no natural player exists.
3. **Never Mix Unrelated Competitions Into Match Scouting by Default:**
   - Do not show World Cup / foreign benchmark players (e.g., Morocco WC 2022) as if they belong to an Egyptian Premier League match's Head-to-Head pool.
   - Default Head-to-Head & Scouting views strictly to the **active match's actual club players** (with benchmark reference players isolated in an explicit opt-in "External Reference Benchmark" toggle).
4. **Honest Physical & Statistical Sample Gates:**
   - Never fabricate `/90` ratings for <15-minute clips. Show real in-frame measurements + explicit sample-size confidence badges.
   - Apply One-Euro physical smoothing (`min_cutoff=1.2, beta=0.04`) before velocity calculation so speed spikes never exceed human limits (`36 km/h`).
