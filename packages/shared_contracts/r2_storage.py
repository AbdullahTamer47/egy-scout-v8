"""Cloudflare R2 StorageProvider + Expiring Video DRM Signed URLs (Wave 3, Section 13)."""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from typing import Optional

from .providers import StorageProvider


def generate_signed_video_token(
    resource_key: str,
    club_id: str,
    ttl_seconds: int = 900,
    secret: Optional[str] = None,
) -> dict[str, str | int]:
    """Generate an expiring HMAC-SHA256 Video DRM signature for private club streams."""
    key_bytes = (secret or os.environ.get("EGY_SCOUT_DRM_SECRET", "dev-local-drm-key")).encode("utf-8")
    expires_at = int(time.time()) + max(30, int(ttl_seconds))
    payload = f"{club_id}:{resource_key}:{expires_at}".encode("utf-8")
    sig = hmac.new(key_bytes, payload, hashlib.sha256).hexdigest()
    return {"club_id": club_id, "key": resource_key, "expires": expires_at, "sig": sig}


def verify_signed_video_token(
    resource_key: str,
    club_id: str,
    expires: int,
    sig: str,
    secret: Optional[str] = None,
) -> bool:
    if int(time.time()) > int(expires):
        return False
    key_bytes = (secret or os.environ.get("EGY_SCOUT_DRM_SECRET", "dev-local-drm-key")).encode("utf-8")
    payload = f"{club_id}:{resource_key}:{int(expires)}".encode("utf-8")
    expected = hmac.new(key_bytes, payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


class CloudflareR2StorageProvider(StorageProvider):
    """S3-compatible Cloudflare R2 provider (zero egress fees; activated via .env in Wave 3)."""

    name = "r2"

    def __init__(
        self,
        bucket: Optional[str] = None,
        endpoint_url: Optional[str] = None,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
    ):
        self.bucket = bucket or os.environ.get("R2_BUCKET_NAME", "egy-scout-v8")
        acct = os.environ.get("R2_ACCOUNT_ID", "")
        self.endpoint_url = endpoint_url or (f"https://{acct}.r2.cloudflarestorage.com" if acct else "")
        self.access_key = access_key or os.environ.get("R2_ACCESS_KEY_ID", "")
        self.secret_key = secret_key or os.environ.get("R2_SECRET_ACCESS_KEY", "")
        self._client = None

    def _s3(self):
        if self._client is None:
            import boto3

            self._client = boto3.client(
                "s3",
                endpoint_url=self.endpoint_url,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                region_name="auto",
            )
        return self._client

    def write_bytes(self, key: str, data: bytes) -> str:
        clean = key.lstrip("/")
        self._s3().put_object(Bucket=self.bucket, Key=clean, Body=data)
        return f"r2://{self.bucket}/{clean}"

    def read_bytes(self, key: str) -> bytes:
        clean = key.lstrip("/")
        obj = self._s3().get_object(Bucket=self.bucket, Key=clean)
        return obj["Body"].read()

    def exists(self, key: str) -> bool:
        try:
            self._s3().head_object(Bucket=self.bucket, Key=key.lstrip("/"))
            return True
        except Exception:
            return False
