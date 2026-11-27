import { useEffect, useState } from "react";

// Empty base routes directly to same-origin Vercel Python Serverless Function (/api/*)
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export type UserRole = "coach" | "analyst" | "scout" | "board" | "player";

export interface GroqModelItem {
  id: string;
  ar: string;
  en: string;
}

export const FALLBACK_GROQ_MODELS: GroqModelItem[] = [
  { id: "auto", ar: "تلقائي ذكي", en: "Auto Smart Router" },
  { id: "openai/gpt-oss-120b", ar: "GPT-OSS 120B (للخطط المعقدة)", en: "GPT-OSS 120B (Deep Tactical)" },
  { id: "qwen/qwen3.8-27b", ar: "Qwen 3.8 27B (سريع بالعربي)", en: "Qwen 3.8 27B (Fast Arabic)" },
  { id: "openai/gpt-oss-20b", ar: "GPT-OSS 20B (فائق السرعة)", en: "GPT-OSS 20B (Turbo)" },
  { id: "allam-2-7b", ar: "ALLaM 2 7B (عربي)", en: "ALLaM 2 7B (Arabic)" },
];

export function useGroqModels(role: UserRole = "coach") {
  const [models, setModels] = useState<GroqModelItem[]>(FALLBACK_GROQ_MODELS);
  const [source, setSource] = useState<"live" | "fallback">("fallback");

  useEffect(() => {
    let active = true;
    apiFetch<{ models: GroqModelItem[]; source: "live" | "fallback" }>(
      "/api/chat/models",
      {},
      "club_demo_egypt",
      role
    )
      .then((res) => {
        if (!active) return;
        if (Array.isArray(res.models) && res.models.length > 0) {
          setModels(res.models);
          setSource(res.source === "live" ? "live" : "fallback");
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [role]);

  return { models, source };
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  tenantId = "club_demo_egypt",
  role: UserRole = "coach"
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("X-Tenant-Id", tenantId);
  headers.set("X-User-Role", role);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  return (await res.json()) as T;
}

export interface BlueprintNode {
  team?: string;
  slot: string;
  role_ar: string;
  player_label: string;
  track_id: number | null;
  jersey_number: number | null;
  x_m: number;
  y_m: number;
  move_to_x_m: number;
  move_to_y_m: number;
  duty_ar: string;
}

export interface BlueprintPassingArrow {
  team?: string;
  from_slot?: string;
  to_slot?: string;
  from_x_m: number;
  from_y_m: number;
  to_x_m: number;
  to_y_m: number;
  kind?: "run" | "pass" | "press" | "freehand";
  color?: string;
  label_ar: string;
  label_en?: string;
  xpass_pct?: number;
  obv_delta?: number;
}

export interface BlueprintCustomZone {
  x1_m: number;
  y1_m: number;
  x2_m: number;
  y2_m: number;
  color?: string;
  label_ar: string;
}

export interface MathValidationResult {
  overall_balance_score: number;
  rest_defense_score: number;
  half_spaces_score: number;
  rest_defenders_count: number;
  attacking_players_count: number;
  vertical_length_m: number;
  horizontal_width_m: number;
  corridors: Array<{
    id: string;
    label_ar: string;
    label_en: string;
    count: number;
    status: "overload" | "covered" | "empty";
  }>;
  strengths_ar: string[];
  strengths_en: string[];
  vulnerabilities_ar: string[];
  vulnerabilities_en: string[];
  risk_level: "low" | "medium" | "high";
}
