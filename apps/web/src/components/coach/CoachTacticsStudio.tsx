"use client";

import React, { useCallback, useState } from "react";
import { Compass, Sparkles } from "lucide-react";
import FormationBlueprintBoard from "@/components/FormationBlueprintBoard";
import { apiFetch, FormationBlueprintPayload } from "@/lib/api";
import { CoachChatResponse } from "./CoachAICopilot";
import { CoachClubDetail } from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  club: CoachClubDetail;
  opponent: CoachClubDetail;
  defaultFormation: string;
  externalBlueprint?: FormationBlueprintPayload | null;
}

interface SetPieceResult {
  scenario: string;
  simulations_run: number;
  baseline_goal_prob_pct: number;
  optimized_goal_prob_pct: number;
  uplift_pct_points: number;
  target_zone_xy: number[];
  decoy_run_vector: number[];
}

export default function CoachTacticsStudio({
  lang,
  club,
  opponent,
  defaultFormation,
  externalBlueprint = null,
}: Props) {
  const isAr = lang === "ar";
  const [setPieceRes, setSetPieceRes] = useState<SetPieceResult | null>(null);
  const [runningSp, setRunningSp] = useState(false);

  const fitCount = club.players.filter((p) => p.is_eligible_starter).length;
  const outCount = club.players.length - fitCount;

  const fetchClubBlueprint = useCallback(
    async (formA: string, formB: string, styleA: string, styleB: string) => {
      try {
        const res = await apiFetch<CoachChatResponse>(
          "/api/coach/chat",
          {
            method: "POST",
            body: JSON.stringify({
              question: `ارسم خطة ${formA}`,
              club_id: club.club_id,
              opponent_id: opponent.club_id,
              formation: formA,
              opponent_formation_code: formB,
              tactical_mode: styleA,
              opponent_tactical_mode: styleB,
              model: "auto",
            }),
          },
          "club_demo_egypt",
          "coach"
        );
        return res.ai_drawing_blueprint || null;
      } catch {
        return null;
      }
    },
    [club.club_id, opponent.club_id]
  );

  const runSetPieceLab = async () => {
    setRunningSp(true);
    try {
      const res = await apiFetch<SetPieceResult>(
        "/api/coach/set-pieces/optimize",
        { method: "POST", body: JSON.stringify({ scenario: "right_corner_inswinger" }) },
        "club_demo_egypt",
        "coach"
      );
      setSetPieceRes(res);
    } finally {
      setRunningSp(false);
    }
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="space-y-4">
      {/* Fit-Only Roster Integration Banner */}
      <div className="studio-panel px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-emerald-400" />
          <span className="font-extrabold text-white">
            {isAr
              ? `السبورة التكتيكية الذكية: ${club.name_ar} × ${opponent.name_ar}`
              : `Tactical Board: ${club.name_en} vs ${opponent.name_en}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 font-bold">
            {isAr ? `متاحون للتشكيل: ${fitCount}` : `Eligible: ${fitCount}`}
          </span>
          {outCount > 0 && (
            <span className="px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/35 text-rose-300 font-bold">
              {isAr ? `مستبعدون إدارياً/طبياً: ${outCount}` : `Excluded: ${outCount}`}
            </span>
          )}
        </div>
      </div>

      {/* Proven Multi-Formation Interactive Blueprint Board */}
      <FormationBlueprintBoard
        lang={lang}
        matchId="m2_ahly_enppi"
        role="coach"
        defaultFormation={defaultFormation}
        externalBlueprint={externalBlueprint}
        onFetchCustomBlueprint={fetchClubBlueprint}
      />

      {/* Integrated Set-Piece Monte Carlo Optimizer */}
      <div className="studio-panel p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div>
          <div className="flex items-center gap-2 font-extrabold text-white">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>{isAr ? "معمل الكرات الثابتة (محاكاة 9,600 ركنية بزمن استجابة 250ms)" : "Set-Piece Self-Play Lab (9,600 Rollouts)"}</span>
          </div>
          {setPieceRes ? (
            <div className="text-slate-300 mt-1">
              {isAr
                ? `احتمال التهديف الأساسي: ${setPieceRes.baseline_goal_prob_pct}% ← بعد التحسين: ${setPieceRes.optimized_goal_prob_pct}% (+${setPieceRes.uplift_pct_points}%) • منطقة الهدف (${setPieceRes.target_zone_xy.join(", ")})`
                : `Baseline ${setPieceRes.baseline_goal_prob_pct}% -> Optimized ${setPieceRes.optimized_goal_prob_pct}% (+${setPieceRes.uplift_pct_points}%)`}
            </div>
          ) : (
            <div className="text-slate-400 mt-0.5">
              {isAr ? "احسب أفضل نقطة سقوط للكرة وحركة سحب المدافع (Decoy Run) ضد التكتل." : "Compute optimal corner delivery target & decoy runner."}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={runSetPieceLab}
          disabled={runningSp}
          className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold shrink-0"
        >
          {runningSp ? (isAr ? "جاري المحاكاة..." : "Running...") : isAr ? "تشغيل 9,600 محاكاة ركنية" : "Run 9,600 Rollouts"}
        </button>
      </div>
    </div>
  );
}
