"""Regenerate remaining match parquets with V10.8 YOLO recovery, Shield rescue & live Groq Cloud Vision OCR."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

env_p = ROOT / ".env"
if env_p.is_file():
    for line in env_p.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#") or "=" not in clean:
            continue
        k, v = clean.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k and v and not os.environ.get(k):
            os.environ[k] = v

os.environ.setdefault("EGY_SCOUT_DATA_DIR", r"D:\egy-scout-data")

from apps.api.main import service


def main() -> None:
    match_ids = [
        ("m2_ahly_enppi", False),  # already rebuilt at full 1280px just before
        ("m1_ahly_sekka", True),
        ("m3_enppi_mokawloon", True),
        ("custom_1795438320857", True),
        ("custom_1795439012452", True),
    ]
    print("GROQ_API_KEY configured:", bool(os.environ.get("GROQ_API_KEY", "").startswith("gsk_")), flush=True)
    for mid, should_run in match_ids:
        tl_before = service.get_match_timeline(mid, tenant_id="club_demo_egypt")
        b_cnts = [len(fr["players"]) for fr in tl_before["frames"]]
        b_avg = sum(b_cnts) / max(1, len(b_cnts))

        if should_run:
            res = service.reanalyze_match_online("club_demo_egypt", mid)
            j_det = res["jerseys_detected"]
        else:
            j_det = {}

        tl_after = service.get_match_timeline(mid, tenant_id="club_demo_egypt")
        a_cnts = [len(fr["players"]) for fr in tl_after["frames"]]
        a_avg = sum(a_cnts) / max(1, len(a_cnts))

        cards = service.list_player_cards("club_demo_egypt", mid)
        ocr_cards = [
            (p["jersey_number"], p["display_label_en"], p["identity_source"])
            for p in cards["players"]
            if p["identity_source"] != "unverified"
        ]
        print(
            f"[{mid}] avg_tl_players: {b_avg:.1f} -> {a_avg:.1f} | min/max={min(a_cnts) if a_cnts else 0}/{max(a_cnts) if a_cnts else 0} | "
            f"groq_jerseys={j_det} | verified_cards={ocr_cards}",
            flush=True,
        )


if __name__ == "__main__":
    main()
