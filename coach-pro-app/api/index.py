"""Standalone FastAPI Serverless entrypoint for EGY-SCOUT Coach Pro."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.api.rbac import TenantContext, get_tenant_context
from apps.api.routes_coach import get_coach_store, router as coach_router
from packages.tactics_engine.plan_validator import validate_tactical_plan

app = FastAPI(title="EGY-SCOUT Coach Pro API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(coach_router)


@app.get("/api/health")
def api_health() -> dict[str, Any]:
    return {"status": "ok", "service": "egy-scout-coach-pro", "vercel": bool(os.environ.get("VERCEL"))}


@app.get("/api/chat/models")
def api_chat_models() -> dict[str, Any]:
    return {
        "source": "live" if os.environ.get("GROQ_API_KEY") else "fallback",
        "models": [
            {"id": "auto", "ar": "تلقائي ذكي", "en": "Auto Smart Router"},
            {"id": "openai/gpt-oss-120b", "ar": "GPT-OSS 120B (للخطط المعقدة)", "en": "GPT-OSS 120B (Deep Tactical)"},
            {"id": "qwen/qwen3.8-27b", "ar": "Qwen 3.8 27B (سريع بالعربي)", "en": "Qwen 3.8 27B (Fast Arabic)"},
            {"id": "openai/gpt-oss-20b", "ar": "GPT-OSS 20B (فائق السرعة)", "en": "GPT-OSS 20B (Turbo)"},
            {"id": "allam-2-7b", "ar": "ALLaM 2 7B (عربي)", "en": "ALLaM 2 7B (Arabic)"},
        ],
    }


@app.post("/api/plans/validate")
def api_validate_plan(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:tactics")
    nodes_a = payload.get("nodes_a") or payload.get("nodes") or []
    nodes_b = payload.get("nodes_b") or payload.get("opponent_nodes") or []
    formation_code = str(payload.get("formation_code") or "")
    return validate_tactical_plan(nodes_a, nodes_b, formation_code=formation_code)


@app.get("/api/plans")
def api_list_plans_root(
    club_id: str | None = None,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:tactics")
    store = get_coach_store()
    return {"plans": store.list_tactical_plans(ctx.tenant_id, club_id)}


@app.post("/api/plans")
def api_save_plan_root(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:tactics")
    store = get_coach_store()
    match_id = str(payload.get("match_id") or "")
    club_id = str(payload.get("club_id") or (match_id.split("_vs_")[0] if "_vs_" in match_id else "al_ahly"))
    saved = store.save_tactical_plan(ctx.tenant_id, club_id, payload)
    return {"saved": True, "plan": saved, "plans": store.list_tactical_plans(ctx.tenant_id, club_id)}
