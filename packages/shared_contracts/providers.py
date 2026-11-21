"""Pluggable Compute & Storage Providers for Zero-Budget ($0) -> Paid Cloud GPU migration.

Switching from Kaggle/Colab Free GPU to Modal L4 (or local) requires ONLY changing
EGY_SCOUT_COMPUTE_PROVIDER / EGY_SCOUT_STORAGE_PROVIDER configuration — zero code rewrites.
"""
from __future__ import annotations

import os
import platform
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Optional


@dataclass
class DeviceInfo:
    provider: str
    environment: str  # kaggle | colab | modal | local
    device: str  # cuda | cpu
    gpu_name: str
    vram_total_gb: float
    recommended_batch_size: int
    recommended_precision: str  # bf16 | fp16 | fp32

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _probe_cuda() -> tuple[str, str, float]:
    try:
        import torch

        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            vram_gb = round(props.total_memory / (1024**3), 2)
            return "cuda", str(props.name), vram_gb
    except Exception:
        pass
    return "cpu", platform.processor() or "CPU", 0.0


def _tune_for_gpu(gpu_name: str, vram_gb: float) -> tuple[int, str]:
    name_upper = gpu_name.upper()
    if "L4" in name_upper or vram_gb >= 20.0:
        return 64, "bf16"
    if "T4" in name_upper or "P100" in name_upper or vram_gb >= 12.0:
        return 32, "fp16"
    if vram_gb >= 6.0:
        return 16, "fp16"
    return 8, "fp32"


class ComputeProvider(ABC):
    """Abstract compute provider interface."""

    name: str = "base"

    @abstractmethod
    def get_device_info(self) -> DeviceInfo:
        """Return detected hardware & tuned execution parameters."""

    @abstractmethod
    def run_job(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        """Execute a pipeline job on this compute backend."""


class LocalComputeProvider(ComputeProvider):
    name = "local"

    def get_device_info(self) -> DeviceInfo:
        device, gpu_name, vram = _probe_cuda()
        bs, prec = _tune_for_gpu(gpu_name, vram) if device == "cuda" else (8, "fp32")
        return DeviceInfo(
            provider=self.name,
            environment="local",
            device=device,
            gpu_name=gpu_name,
            vram_total_gb=vram,
            recommended_batch_size=bs,
            recommended_precision=prec,
        )

    def run_job(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        return fn(*args, **kwargs)


class KaggleComputeProvider(ComputeProvider):
    name = "kaggle"

    def get_device_info(self) -> DeviceInfo:
        device, gpu_name, vram = _probe_cuda()
        bs, prec = _tune_for_gpu(gpu_name, vram) if device == "cuda" else (8, "fp32")
        return DeviceInfo(
            provider=self.name,
            environment="kaggle",
            device=device,
            gpu_name=gpu_name,
            vram_total_gb=vram,
            recommended_batch_size=bs,
            recommended_precision=prec,
        )

    def run_job(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        return fn(*args, **kwargs)


class ColabComputeProvider(ComputeProvider):
    name = "colab"

    def get_device_info(self) -> DeviceInfo:
        device, gpu_name, vram = _probe_cuda()
        bs, prec = _tune_for_gpu(gpu_name, vram) if device == "cuda" else (8, "fp32")
        return DeviceInfo(
            provider=self.name,
            environment="colab",
            device=device,
            gpu_name=gpu_name,
            vram_total_gb=vram,
            recommended_batch_size=bs,
            recommended_precision=prec,
        )

    def run_job(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        return fn(*args, **kwargs)


class ModalComputeProvider(ComputeProvider):
    """Production Cloud GPU provider stub (NVIDIA L4 24GB, Scale-to-Zero).

    Activated in Wave 1 by setting EGY_SCOUT_COMPUTE_PROVIDER=modal_l4 and
    deploying the Modal app — keeping all downstream pipeline code unchanged.
    """

    name = "modal_l4"

    def __init__(self, app_name: str = "egy-scout-cv-worker", gpu: str = "L4"):
        self.app_name = app_name
        self.gpu = gpu

    def get_device_info(self) -> DeviceInfo:
        return DeviceInfo(
            provider=self.name,
            environment="modal",
            device="cuda",
            gpu_name=f"NVIDIA {self.gpu} (Modal)",
            vram_total_gb=24.0,
            recommended_batch_size=64,
            recommended_precision="bf16",
        )

    def run_job(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        if os.environ.get("MODAL_ENVIRONMENT"):
            return fn(*args, **kwargs)
        raise RuntimeError(
            "ModalComputeProvider requires running inside a deployed Modal container "
            "or configuring MODAL_TOKEN_ID/MODAL_TOKEN_SECRET (Wave 1)."
        )


def detect_runtime_environment() -> str:
    if os.environ.get("KAGGLE_KERNEL_RUN_TYPE") or os.path.exists("/kaggle/working"):
        return "kaggle"
    if os.environ.get("COLAB_RELEASE_TAG") or os.path.exists("/content"):
        return "colab"
    if os.environ.get("MODAL_ENVIRONMENT"):
        return "modal_l4"
    return "local"


def get_compute_provider(provider_name: Optional[str] = None) -> ComputeProvider:
    """Factory that resolves the active ComputeProvider from config or auto-detection."""
    selected = (
        provider_name
        or os.environ.get("EGY_SCOUT_COMPUTE_PROVIDER", "auto")
    ).strip().lower()
    if selected == "auto":
        selected = detect_runtime_environment()

    registry: dict[str, Callable[[], ComputeProvider]] = {
        "local": LocalComputeProvider,
        "kaggle": KaggleComputeProvider,
        "colab": ColabComputeProvider,
        "modal": ModalComputeProvider,
        "modal_l4": ModalComputeProvider,
    }
    if selected not in registry:
        raise ValueError(f"Unknown compute provider: {selected!r}. Choices: {sorted(registry)}")
    return registry[selected]()


class StorageProvider(ABC):
    """Abstract storage provider (Local/Kaggle/Colab -> Cloudflare R2 / Supabase)."""

    name: str = "base"

    @abstractmethod
    def write_bytes(self, key: str, data: bytes) -> str:
        """Persist raw bytes under key and return its URI."""

    @abstractmethod
    def read_bytes(self, key: str) -> bytes:
        """Read raw bytes stored at key."""

    @abstractmethod
    def exists(self, key: str) -> bool:
        """Check whether key exists."""


class LocalStorageProvider(StorageProvider):
    name = "local"

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        clean = key.lstrip("/\\")
        p = (self.root / clean).resolve()
        if not str(p).startswith(str(self.root.resolve())):
            raise ValueError(f"Path traversal blocked for key: {key!r}")
        return p

    def write_bytes(self, key: str, data: bytes) -> str:
        target = self._resolve(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return str(target)

    def read_bytes(self, key: str) -> bytes:
        return self._resolve(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._resolve(key).is_file()


def get_storage_provider(
    provider_name: Optional[str] = None, root: Optional[str | Path] = None
) -> StorageProvider:
    selected = (
        provider_name
        or os.environ.get("EGY_SCOUT_STORAGE_PROVIDER", "local")
    ).strip().lower()
    if selected in ("local", "kaggle", "colab"):
        from .config import get_data_paths

        base = Path(root) if root is not None else get_data_paths().outputs
        return LocalStorageProvider(base)
    raise ValueError(
        f"Storage provider {selected!r} is not configured in Wave 0 (use 'local')."
    )
