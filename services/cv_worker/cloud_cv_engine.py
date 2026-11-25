"""Cloud-First Computer Vision Offload Engine for EGY-SCOUT Pro Studio.

Supports three online acceleration tiers so end-users never run heavy PyTorch workloads on local CPUs:
  1. Cloud GPU Worker (`EGY_SCOUT_CLOUD_WORKER_URL`, e.g., Modal NVIDIA L4 / Colab / Cloud Run GPU)
  2. Roboflow Serverless GPU API (`ROBOFLOW_API_KEY` -> football-players-detection + 32-KP pitch model)
  3. Groq Cloud Vision (`GROQ_API_KEY` -> `qwen/qwen3.8-27b` batched jersey contact-sheet OCR & scoreboard OCR)
"""
from __future__ import annotations

import base64
import ipaddress
import json
import os
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np

GROQ_VISION_MODEL = "qwen/qwen3.8-27b"
DEFAULT_RF_PLAYER_MODEL = "football-players-detection-3zvbc/11"
DEFAULT_RF_FIELD_MODEL = "football-field-detection-f07vi/14"


def _validate_cloud_endpoint_url(url: str) -> str:
    clean = (url or "").strip()
    parsed = urllib.parse.urlparse(clean)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Cloud Worker URL must start with http:// or https:// and include a hostname.")
    host = parsed.hostname.lower()
    if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1") or host.endswith(".local"):
        raise ValueError("Localhost/internal Cloud Worker URLs are blocked for SSRF protection.")
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError as exc:
        raise ValueError(f"Could not resolve host '{host}': {exc}") from exc
    for info in infos:
        ip_obj = ipaddress.ip_address(info[4][0])
        if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_reserved or ip_obj.is_multicast:
            raise ValueError(f"Private/reserved target IP '{ip_obj}' is blocked.")
    return clean


def _load_groq_key(api_key: Optional[str] = None) -> str:
    k = (api_key or os.environ.get("GROQ_API_KEY", "")).strip()
    if k.startswith("gsk_"):
        return k
    return ""


def build_jersey_contact_sheet(
    crops_by_tid: dict[int, np.ndarray],
    max_tiles: int = 16,
    tile_w: int = 144,
    tile_h: int = 180,
) -> tuple[Optional[np.ndarray], list[int]]:
    """Build a crisp 4-column CLAHE-enhanced labeled contact sheet mapping slot #1..N -> track_id."""
    valid_items: list[tuple[int, np.ndarray]] = []
    for tid, crop in crops_by_tid.items():
        if crop is not None and crop.size > 0:
            valid_items.append((int(tid), crop))
    if not valid_items:
        return None, []

    valid_items = valid_items[:max_tiles]
    tids_order = [tid for tid, _ in valid_items]
    n = len(valid_items)
    cols = min(4, n)
    rows = int(np.ceil(n / cols))
    sheet = np.full((rows * tile_h, cols * tile_w, 3), 18, dtype=np.uint8)
    clahe = cv2.createCLAHE(clipLimit=2.4, tileGridSize=(4, 4))

    for idx, (_, crop) in enumerate(valid_items):
        r_idx = idx // cols
        c_idx = idx % cols
        x0 = c_idx * tile_w
        y0 = r_idx * tile_h

        inner_w = tile_w - 16
        inner_h = tile_h - 36
        resized = cv2.resize(crop, (inner_w, inner_h), interpolation=cv2.INTER_CUBIC)
        lab = cv2.cvtColor(resized, cv2.COLOR_BGR2LAB)
        l_ch, a_ch, b_ch = cv2.split(lab)
        enh = cv2.cvtColor(cv2.merge([clahe.apply(l_ch), a_ch, b_ch]), cv2.COLOR_LAB2BGR)
        blur = cv2.GaussianBlur(enh, (0, 0), 1.0)
        enh = cv2.addWeighted(enh, 1.35, blur, -0.35, 0)

        sheet[y0 + 28 : y0 + 28 + inner_h, x0 + 8 : x0 + 8 + inner_w] = enh
        cv2.rectangle(sheet, (x0 + 2, y0 + 2), (x0 + tile_w - 3, y0 + tile_h - 3), (65, 85, 110), 1)
        cv2.rectangle(sheet, (x0 + 4, y0 + 4), (x0 + 58, y0 + 24), (16, 185, 129), -1)
        cv2.putText(
            sheet,
            f"#{idx + 1}",
            (x0 + 10, y0 + 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (9, 13, 22),
            2,
        )

    return sheet, tids_order


def _call_groq_vision_json(
    image_bgr: np.ndarray,
    prompt_text: str,
    api_key: str,
    max_tokens: int = 350,
    timeout_s: int = 12,
) -> Optional[dict[str, Any]]:
    ok, buf = cv2.imencode(".jpg", image_bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        return None
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    payload = {
        "model": GROQ_VISION_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_text},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ],
            }
        ],
        "temperature": 0.05,
        "max_tokens": max_tokens,
    }
    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "EGY-SCOUT-CloudVision/10.5",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        content = str(raw["choices"][0]["message"]["content"]).strip()
        try:
            return json.loads(content)
        except Exception:
            m = re.search(r"\{[\s\S]*\}", content)
            if m:
                return json.loads(m.group(0))
    except Exception:
        return None
    return None


def groq_vision_read_jerseys(
    crops_by_tid: dict[int, np.ndarray],
    api_key: Optional[str] = None,
) -> dict[int, tuple[int, float]]:
    """Read clearly visible jersey numbers across <=16 player crops in one fast Groq Cloud Vision call."""
    key = _load_groq_key(api_key)
    if not key or not crops_by_tid:
        return {}
    sheet, tids_order = build_jersey_contact_sheet(crops_by_tid, max_tiles=16)
    if sheet is None or not tids_order:
        return {}

    prompt = (
        f"You are inspecting {len(tids_order)} numbered football player jersey torso crops labeled #1 through #{len(tids_order)}. "
        "ONLY report a jersey number (1-99) if digits are clearly readable on the shirt; do NOT guess blurry crops. "
        'Return ONLY JSON matching {"jerseys": {"1": 22, "3": null}} using keys "1".."N".'
    )
    parsed = _call_groq_vision_json(sheet, prompt, api_key=key, max_tokens=280)
    if not isinstance(parsed, dict):
        return {}
    jmap = parsed.get("jerseys") if isinstance(parsed.get("jerseys"), dict) else parsed
    out: dict[int, tuple[int, float]] = {}
    for idx, tid in enumerate(tids_order, start=1):
        val = jmap.get(str(idx)) if isinstance(jmap, dict) else None
        if isinstance(val, dict):
            val = val.get("number")
        if val is None:
            continue
        try:
            num = int(val)
        except (TypeError, ValueError):
            continue
        if 1 <= num <= 99:
            out[int(tid)] = (num, 0.86)
    return out


def groq_vision_read_scoreboard(
    samples: list[tuple[float, np.ndarray]],
    api_key: Optional[str] = None,
) -> dict[str, Any]:
    """Read TV broadcast scoreboard scoreline from start/mid/end top-strip crops via Groq Cloud Vision."""
    key = _load_groq_key(api_key)
    if not key or not samples:
        return {"scoreboard_scanned": False, "samples": 0, "latest_score": None, "verified_goals": []}

    picked = [samples[0], samples[len(samples) // 2], samples[-1]] if len(samples) >= 3 else samples
    strips: list[np.ndarray] = []
    for ts, frame in picked:
        h, w = frame.shape[:2]
        roi = frame[0 : max(48, int(h * 0.16)), 0 : max(200, int(w * 0.65))]
        roi_r = cv2.resize(roi, (480, 96), interpolation=cv2.INTER_CUBIC)
        cv2.putText(roi_r, f"{ts:.1f}s", (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (16, 185, 129), 2)
        strips.append(roi_r)
    canvas = np.vstack(strips)
    prompt = (
        "Inspect these broadcast scoreboard strips (top corners of football frames). "
        'If a clear match score like "1 - 0" is visible, return ONLY JSON {"found": true, "home": int, "away": int}; '
        'otherwise return {"found": false, "home": null, "away": null}.'
    )
    parsed = _call_groq_vision_json(canvas, prompt, api_key=key, max_tokens=120)
    latest_score = None
    verified_goals: list[dict[str, Any]] = []
    if isinstance(parsed, dict) and parsed.get("found") and parsed.get("home") is not None and parsed.get("away") is not None:
        try:
            h_sc, a_sc = int(parsed["home"]), int(parsed["away"])
            if 0 <= h_sc <= 15 and 0 <= a_sc <= 15:
                latest_score = [h_sc, a_sc]
        except (TypeError, ValueError):
            pass
    return {
        "scoreboard_scanned": True,
        "samples": len(picked),
        "latest_score": latest_score,
        "verified_goals": verified_goals,
        "provider": "groq_cloud_vision",
    }


def _post_roboflow_serverless(model_path: str, jpg_bytes: bytes, api_key: str, timeout_s: int = 12) -> dict[str, Any]:
    url = f"https://serverless.roboflow.com/{model_path}?api_key={urllib.parse.quote(api_key)}"
    b64 = base64.b64encode(jpg_bytes).decode("ascii")
    req = urllib.request.Request(
        url,
        data=b64.encode("ascii"),
        headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "EGY-SCOUT/10.5"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8"))


def roboflow_detect_frame(
    frame_bgr: np.ndarray,
    api_key: str,
    player_model: str = DEFAULT_RF_PLAYER_MODEL,
    field_model: str = DEFAULT_RF_FIELD_MODEL,
) -> dict[str, Any]:
    """Run Roboflow Serverless Cloud inference for players/ball + 32-keypoint field landmarks."""
    ok, buf = cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 86])
    if not ok:
        return {"players": [], "keypoints": []}
    raw_bytes = buf.tobytes()
    p_res = _post_roboflow_serverless(player_model, raw_bytes, api_key)
    f_res = _post_roboflow_serverless(field_model, raw_bytes, api_key)
    return {
        "players": p_res.get("predictions", []) if isinstance(p_res, dict) else [],
        "keypoints": f_res.get("predictions", []) if isinstance(f_res, dict) else [],
    }


def offload_clip_to_cloud_worker(
    video_path: str | Path,
    worker_url: str,
    meta: dict[str, Any],
    timeout_s: int = 180,
) -> Optional[dict[str, Any]]:
    """Send clip to external GPU Cloud Worker (Modal L4 / Colab / Cloud Run) via HTTPS multipart upload."""
    clean_url = _validate_cloud_endpoint_url(worker_url)
    vpath = Path(video_path)
    if not vpath.is_file():
        return None
    boundary = "----EGYSCOUTCLOUDWORKERBOUNDARY"
    meta_bytes = json.dumps(meta, ensure_ascii=False).encode("utf-8")
    vid_bytes = vpath.read_bytes()
    body = b"".join(
        [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"meta\"\r\nContent-Type: application/json\r\n\r\n".encode("utf-8"),
            meta_bytes,
            f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{vpath.name}\"\r\nContent-Type: video/mp4\r\n\r\n".encode("utf-8"),
            vid_bytes,
            f"\r\n--{boundary}--\r\n".encode("utf-8"),
        ]
    )
    req = urllib.request.Request(
        clean_url,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "EGY-SCOUT-CloudClient/10.5",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if isinstance(data, dict) and isinstance(data.get("v8_rows"), list):
            return data
    except Exception:
        return None
    return None
