"""Standalone FastAPI Entrypoint for EGY-SCOUT Coach Pro (Coach, Training, Director & Admin)."""
from __future__ import annotations

from typing import Any

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.api.rbac import TenantContext, get_tenant_context
from apps.api.routes_coach import router as coach_router
from apps.api.routes_players import router as players_router
from apps.api.routes_v9 import router as v9_router

app = FastAPI(title="EGY-SCOUT Coach Pro API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(coach_router)
app.include_router(v9_router)
app.include_router(players_router)


@app.get("/api/health")
def coach_health(ctx: TenantContext = Depends(get_tenant_context)) -> dict[str, Any]:
    return {
        "status": "ok",
        "edition": "coach_pro",
        "version": "1.0.0",
        "tenant_id": ctx.tenant_id,
        "role": ctx.role,
    }
