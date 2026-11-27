"""Multi-Tenant & Role-Based Access Control (RBAC) for EGY-SCOUT V8 (Section 13).

Board role has full READ-ONLY access to all GET screens (matches, tactics, scouting, reports)
while strictly blocking all mutating POST/PUT/DELETE operations.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from fastapi import Header, HTTPException

UserRole = Literal["coach", "analyst", "scout", "board", "player"]

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "coach": {
        "read:matches",
        "read:tactics",
        "write:tactics",
        "read:scouting",
        "read:reports",
        "run:live_proof",
    },
    "analyst": {
        "read:matches",
        "write:qa",
        "read:tactics",
        "write:tactics",
        "read:scouting",
        "write:scouting",
        "read:reports",
        "run:live_proof",
    },
    "scout": {
        "read:matches",
        "read:tactics",
        "read:scouting",
        "write:scouting",
        "read:reports",
    },
    "board": {
        "read:matches",
        "read:tactics",
        "read:scouting",
        "read:reports",
    },
    "player": {
        "read:matches",
        "read:own_clips",
        "read:tactics",
        "read:scouting",
        "read:reports",
    },
}

SAFE_TENANT_RE = re.compile(r"^[A-Za-z0-9_\-]{2,48}$")


@dataclass(frozen=True)
class TenantContext:
    tenant_id: str
    role: UserRole

    @property
    def is_read_only(self) -> bool:
        return self.role in ("board", "player")

    def require(self, permission: str) -> None:
        allowed = ROLE_PERMISSIONS.get(self.role, set())
        if permission not in allowed:
            raise HTTPException(
                status_code=403,
                detail=f"Role '{self.role}' is read-only or lacks permission '{permission}'.",
            )


def get_tenant_context(
    x_tenant_id: str = Header(default="club_demo_egypt"),
    x_user_role: str = Header(default="analyst"),
) -> TenantContext:
    tid = x_tenant_id.strip() or "club_demo_egypt"
    if not SAFE_TENANT_RE.match(tid):
        raise HTTPException(status_code=400, detail="Invalid X-Tenant-Id header")
    role = x_user_role.strip().lower() or "analyst"
    if role not in ROLE_PERMISSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid X-User-Role '{role}'. Allowed: {sorted(ROLE_PERMISSIONS)}",
        )
    return TenantContext(tenant_id=tid, role=role)  # type: ignore[arg-type]
