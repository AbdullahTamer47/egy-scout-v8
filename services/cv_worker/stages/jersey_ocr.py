"""Pose/Torso Legibility Gate + PARSeq Jersey Number Recognizer + Track Voting (Wave 1, Section 9.4)."""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Optional

import cv2
import numpy as np

JERSEY_RE = re.compile(r"\b([1-9][0-9]?)\b")


@dataclass
class LegibilityResult:
    is_legible: bool
    score: float
    reason: str


def check_jersey_legibility(
    crop_bgr: Optional[np.ndarray],
    min_height_px: int = 28,
    min_width_px: int = 16,
    min_sharpness: float = 35.0,
) -> LegibilityResult:
    """Fast Legibility Gate: rejects tiny, side-view, or motion-blurred crops before PARSeq."""
    if crop_bgr is None or crop_bgr.size == 0:
        return LegibilityResult(False, 0.0, "empty_crop")
    h, w = crop_bgr.shape[:2]
    if h < min_height_px or w < min_width_px:
        return LegibilityResult(False, 0.1, "too_small")
    aspect = h / max(1.0, float(w))
    if aspect < 0.65 or aspect > 3.2:
        return LegibilityResult(False, 0.2, "bad_aspect_ratio")

    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    contrast = float(gray.std())
    if sharpness < min_sharpness or contrast < 16.0:
        return LegibilityResult(False, min(0.45, sharpness / max(1.0, min_sharpness)), "blurry_or_low_contrast")

    score = float(np.clip(0.5 * min(1.0, sharpness / 180.0) + 0.5 * min(1.0, h / 80.0), 0.5, 1.0))
    return LegibilityResult(True, round(score, 3), "ok")


class ParseqJerseyRecognizer:
    """Wrapper around PARSeq (torch.hub 'baudm/parseq') with graceful fallback & track voting."""

    def __init__(self, device: str = "cpu", min_read_conf: float = 0.70):
        self.device = device
        self.min_read_conf = min_read_conf
        self._model: Any = None
        self._transform: Any = None

    def _load_parseq(self) -> bool:
        if self._model is not None:
            return True
        try:
            import torch
            from torchvision import transforms as T

            self._model = torch.hub.load("baudm/parseq", "parseq", pretrained=True).eval().to(self.device)
            self._transform = T.Compose(
                [
                    T.Resize(self._model.hparams.img_size, T.InterpolationMode.BICUBIC),
                    T.ToTensor(),
                    T.Normalize(0.5, 0.5),
                ]
            )
            return True
        except Exception:
            return False

    def read_single(self, crop_bgr: np.ndarray) -> tuple[Optional[int], float]:
        """Read jersey number (1..99) from a single legible crop via PARSeq."""
        leg = check_jersey_legibility(crop_bgr)
        if not leg.is_legible:
            return None, 0.0
        if not self._load_parseq():
            return None, 0.0

        import torch
        from PIL import Image

        pil = Image.fromarray(cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB))
        img_t = self._transform(pil).unsqueeze(0).to(self.device)
        with torch.no_grad():
            logits = self._model(img_t)
            probs = logits.softmax(-1)
            labels, confs = self._model.tokenizer.decode(probs)
        text = str(labels[0]).strip()
        m = JERSEY_RE.search(text)
        if not m:
            return None, 0.0
        conf = float(confs[0].mean().item()) if hasattr(confs[0], "mean") else float(confs[0])
        num = int(m.group(1))
        if 1 <= num <= 99 and conf >= self.min_read_conf:
            return num, round(conf * leg.score, 4)
        return None, 0.0


def vote_track_jersey_number(
    observations: list[tuple[int, float]],
    official_roster_numbers: Optional[set[int]] = None,
    min_total_weight: float = 1.4,
) -> tuple[Optional[int], float]:
    """Aggregate weighted jersey reads across a track & validate against official roster."""
    if not observations:
        return None, 0.0
    scores: dict[int, float] = defaultdict(float)
    total_w = 0.0
    for num, conf in observations:
        if not (1 <= int(num) <= 99) or conf <= 0:
            continue
        # Boost numbers that actually exist on the match's official scoresheet
        roster_mult = 1.25 if (official_roster_numbers and int(num) in official_roster_numbers) else 0.85
        w = float(conf) * roster_mult
        scores[int(num)] += w
        total_w += w
    if not scores:
        return None, 0.0
    best_num, best_w = max(scores.items(), key=lambda kv: kv[1])
    if best_w < min_total_weight:
        return None, 0.0
    purity = best_w / max(total_w, 1e-6)
    return best_num, round(min(0.99, purity * min(1.0, best_w / 2.5)), 4)
