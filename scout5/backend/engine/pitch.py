"""Real FIFA pitch calibration using PnLCalib (Points + Lines optimization) + LK propagation.

Coordinates follow FIFA standard: x along pitch length [0, 105] m, y across width [0, 68] m.
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
import torch
import torchvision.transforms as T
import torchvision.transforms.functional as TF
import yaml
from PIL import Image

PITCH_L = 105.0
PITCH_W = 68.0
_PB_W, _PB_L, _GB_W, _GB_L, _CR = 40.32, 16.5, 18.32, 5.5, 9.15

_DEFAULT_PNL_REPO = Path(r"D:\مدرب\open_source_engines\PnLCalib")
_DEFAULT_WEIGHTS = Path(r"D:\مدرب\scout5\backend\weights")


def pitch_polylines(L: float = PITCH_L, W: float = PITCH_W) -> list[np.ndarray]:
    """Canonical FIFA field markings as metric polylines (for visual verification and overlay drawing)."""
    def rect(x0: float, y0: float, x1: float, y1: float) -> np.ndarray:
        return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], dtype=np.float32)

    t = np.linspace(0, 2 * np.pi, 72)
    circle = np.stack([L / 2 + _CR * np.cos(t), W / 2 + _CR * np.sin(t)], axis=1).astype(np.float32)
    a_l = np.deg2rad(np.linspace(-53, 53, 28))
    arc_l = np.stack([11.0 + _CR * np.cos(a_l), W / 2 + _CR * np.sin(a_l)], axis=1).astype(np.float32)
    a_r = np.deg2rad(np.linspace(127, 233, 28))
    arc_r = np.stack([L - 11.0 + _CR * np.cos(a_r), W / 2 + _CR * np.sin(a_r)], axis=1).astype(np.float32)
    return [
        rect(0, 0, L, W),
        np.array([[L / 2, 0], [L / 2, W]], dtype=np.float32),
        rect(0, (W - _PB_W) / 2, _PB_L, (W + _PB_W) / 2),
        rect(L - _PB_L, (W - _PB_W) / 2, L, (W + _PB_W) / 2),
        rect(0, (W - _GB_W) / 2, _GB_L, (W + _GB_W) / 2),
        rect(L - _GB_L, (W - _GB_W) / 2, L, (W + _GB_W) / 2),
        circle,
        arc_l,
        arc_r,
    ]


def to_metres(H: np.ndarray, uv: np.ndarray) -> np.ndarray:
    if len(uv) == 0:
        return np.empty((0, 2), dtype=np.float32)
    pts = np.asarray(uv, dtype=np.float32).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(pts, np.asarray(H, dtype=np.float64)).reshape(-1, 2)


def to_pixels(H: np.ndarray, xy: np.ndarray) -> np.ndarray | None:
    try:
        Hi = np.linalg.inv(H)
    except np.linalg.LinAlgError:
        return None
    pts = np.asarray(xy, dtype=np.float64).reshape(-1, 2)
    hom = np.c_[pts, np.ones(len(pts))] @ Hi.T
    ok = hom[:, 2] > 1e-6
    out = np.full((len(pts), 2), np.nan)
    out[ok] = hom[ok, :2] / hom[ok, 2:3]
    return out


class PnLPitchCalibrator:
    """Broadcast camera calibration powered by open-source PnLCalib (SV_kp + SV_lines)."""

    def __init__(
        self,
        pnl_repo: Path = _DEFAULT_PNL_REPO,
        weights_dir: Path = _DEFAULT_WEIGHTS,
        device: str = "cpu",
        kp_threshold: float = 0.3434,
        line_threshold: float = 0.7867,
        max_rep_err_px: float = 12.0,
    ) -> None:
        self.pnl_repo = Path(pnl_repo)
        self.weights_dir = Path(weights_dir)
        self.device = device
        self.kp_th = float(kp_threshold)
        self.ln_th = float(line_threshold)
        self.max_rep_err_px = float(max_rep_err_px)
        self._resize = T.Resize((540, 960))
        self._models_loaded = False
        self._model_kp = None
        self._model_ln = None

    def _ensure_loaded(self) -> None:
        if self._models_loaded:
            return
        repo_str = str(self.pnl_repo)
        if repo_str not in sys.path:
            sys.path.insert(0, repo_str)
        from model.cls_hrnet import get_cls_net
        from model.cls_hrnet_l import get_cls_net as get_cls_net_l
        from utils.utils_calib import FramebyFrameCalib
        from utils.utils_heatmap import (
            complete_keypoints,
            coords_to_dict,
            get_keypoints_from_heatmap_batch_maxpool,
            get_keypoints_from_heatmap_batch_maxpool_l,
        )

        self._FramebyFrameCalib = FramebyFrameCalib
        self._complete_keypoints = complete_keypoints
        self._coords_to_dict = coords_to_dict
        self._maxpool_kp = get_keypoints_from_heatmap_batch_maxpool
        self._maxpool_ln = get_keypoints_from_heatmap_batch_maxpool_l

        cfg = yaml.safe_load(open(self.pnl_repo / "config" / "hrnetv2_w48.yaml", "r"))
        cfg_l = yaml.safe_load(open(self.pnl_repo / "config" / "hrnetv2_w48_l.yaml", "r"))

        mkp = get_cls_net(cfg)
        mkp.load_state_dict(torch.load(self.weights_dir / "SV_kp.pth", map_location=self.device))
        mkp.to(self.device).eval()

        mln = get_cls_net_l(cfg_l)
        mln.load_state_dict(torch.load(self.weights_dir / "SV_lines.pth", map_location=self.device))
        mln.to(self.device).eval()

        self._model_kp = mkp
        self._model_ln = mln
        self._models_loaded = True

    @staticmethod
    def _P_to_H_img_to_world(P: np.ndarray) -> np.ndarray | None:
        S = np.array([[1.0, 0.0, -PITCH_L / 2.0], [0.0, 1.0, -PITCH_W / 2.0], [0.0, 0.0, 1.0]], dtype=np.float64)
        Hw2i = P[:, [0, 1, 3]].astype(np.float64) @ S
        try:
            Hi2w = np.linalg.inv(Hw2i)
        except np.linalg.LinAlgError:
            return None
        if abs(Hi2w[2, 2]) < 1e-12:
            return None
        return Hi2w / Hi2w[2, 2]

    @staticmethod
    def _projection_from_cam_params(res: dict) -> np.ndarray:
        cp = res["cam_params"]
        fx, fy = cp["x_focal_length"], cp["y_focal_length"]
        pp = np.array(cp["principal_point"], dtype=np.float64)
        pos = np.array(cp["position_meters"], dtype=np.float64)
        R = np.array(cp["rotation_matrix"], dtype=np.float64)
        It = np.eye(4, dtype=np.float64)[:-1]
        It[:, -1] = -pos
        Q = np.array([[fx, 0.0, pp[0]], [0.0, fy, pp[1]], [0.0, 0.0, 1.0]], dtype=np.float64)
        return Q @ (R @ It)

    @staticmethod
    def is_sane(H: np.ndarray | None, fw: int, fh: int) -> bool:
        if H is None or not np.all(np.isfinite(H)):
            return False
        if abs(float(np.linalg.det(H))) < 1e-12:
            return False
        bc = to_metres(H, np.array([[fw * 0.5, fh * 0.92]]))[0]
        return (-25.0 <= bc[0] <= PITCH_L + 25.0) and (-25.0 <= bc[1] <= PITCH_W + 25.0)

    def solve_frame(self, frame_bgr: np.ndarray) -> dict:
        """Run PnLCalib on one frame and return calibration dict with H (pixel->metres) and metadata."""
        self._ensure_loaded()
        fh, fw = frame_bgr.shape[:2]
        cam = self._FramebyFrameCalib(iwidth=fw, iheight=fh, denormalize=True)

        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        ten = TF.to_tensor(Image.fromarray(rgb)).float().unsqueeze(0)
        if ten.shape[-1] != 960 or ten.shape[-2] != 540:
            ten = self._resize(ten)
        _, _, h, w = ten.shape

        with torch.no_grad():
            hm_kp = self._model_kp(ten.to(self.device))
            hm_ln = self._model_ln(ten.to(self.device))

        kp_coords = self._maxpool_kp(hm_kp[:, :-1, :, :])
        ln_coords = self._maxpool_ln(hm_ln[:, :-1, :, :])
        kp_dict = self._coords_to_dict(kp_coords, threshold=self.kp_th)
        ln_dict = self._coords_to_dict(ln_coords, threshold=self.ln_th)
        kp_d, ln_d = self._complete_keypoints(kp_dict[0], ln_dict[0], w=w, h=h, normalize=True)

        cam.update(kp_d, ln_d)
        res = cam.heuristic_voting(refine_lines=True)
        if res is None:
            return {"H": None, "P": None, "rep_err": float("nan"), "kp_count": len(kp_d), "line_count": len(ln_d)}

        rep_err = float(res.get("rep_err", 999.0))
        P = self._projection_from_cam_params(res)
        H = self._P_to_H_img_to_world(P)
        max_err = self.max_rep_err_px * max(0.6, fw / 960.0)
        if rep_err > max_err or not self.is_sane(H, fw, fh):
            return {"H": None, "P": None, "rep_err": rep_err, "kp_count": len(kp_d), "line_count": len(ln_d)}

        return {"H": H, "P": P, "rep_err": round(rep_err, 3), "kp_count": len(kp_d), "line_count": len(ln_d)}

    def propagate(self, H_prev: np.ndarray | None, H_step_curr_to_prev: np.ndarray | None, fw: int, fh: int) -> np.ndarray | None:
        if H_prev is None or H_step_curr_to_prev is None:
            return None
        H_new = H_prev @ H_step_curr_to_prev
        if abs(H_new[2, 2]) < 1e-12:
            return None
        H_new = H_new / H_new[2, 2]
        return H_new if self.is_sane(H_new, fw, fh) else None


def draw_pitch_overlay(frame: np.ndarray, H: np.ndarray, P: np.ndarray | None = None, color=(255, 160, 0), thickness: int = 2) -> np.ndarray:
    """Draw calibrated FIFA pitch lines (and 3D goalposts if P is supplied) onto a BGR frame."""
    out = frame.copy()
    h, w = frame.shape[:2]
    for pl in pitch_polylines():
        dense = []
        for a, b in zip(pl[:-1], pl[1:]):
            for s in np.linspace(0, 1, 14, endpoint=False):
                dense.append(a + (b - a) * s)
        dense.append(pl[-1])
        px = to_pixels(H, np.array(dense))
        if px is None:
            continue
        for p, q in zip(px[:-1], px[1:]):
            if np.all(np.isfinite(p)) and np.all(np.isfinite(q)):
                if -w < p[0] < 2 * w and -h < p[1] < 2 * h and -w < q[0] < 2 * w and -h < q[1] < 2 * h:
                    cv2.line(out, tuple(np.int32(p)), tuple(np.int32(q)), color, thickness, cv2.LINE_AA)
    if P is not None:
        goal_segs = [
            ((0.0, 30.34, 0.0), (0.0, 30.34, -2.44)),
            ((0.0, 37.66, 0.0), (0.0, 37.66, -2.44)),
            ((0.0, 30.34, -2.44), (0.0, 37.66, -2.44)),
            ((PITCH_L, 30.34, 0.0), (PITCH_L, 30.34, -2.44)),
            ((PITCH_L, 37.66, 0.0), (PITCH_L, 37.66, -2.44)),
            ((PITCH_L, 30.34, -2.44), (PITCH_L, 37.66, -2.44)),
        ]
        for g1, g2 in goal_segs:
            i1 = P @ np.array([g1[0] - PITCH_L / 2, g1[1] - PITCH_W / 2, g1[2], 1.0])
            i2 = P @ np.array([g2[0] - PITCH_L / 2, g2[1] - PITCH_W / 2, g2[2], 1.0])
            if i1[2] > 1e-6 and i2[2] > 1e-6:
                p1, p2 = (int(i1[0] / i1[2]), int(i1[1] / i1[2])), (int(i2[0] / i2[2]), int(i2[1] / i2[2]))
                if -w < p1[0] < 2 * w and -h < p1[1] < 2 * h and -w < p2[0] < 2 * w and -h < p2[1] < 2 * h:
                    cv2.line(out, p1, p2, color, thickness, cv2.LINE_AA)
    return out
