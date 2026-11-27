"""Generate tight ~60s ElevenLabs v4 voiceovers (AR priority + EN) with 1.08x pace & ZERO AI SFX.

Rules verified:
  - Target duration: ~60 seconds (~58-62s)
  - Model: eleven_v4 (no unsupported speed/style params in JSON; subtle atempo=1.08 in FFmpeg)
  - Terminology: say "بالـ AI" / "with AI" (NEVER say "AI Copilot" / "كوبايلوت")
  - Multi-league: explicitly cover multiple local, African, and European leagues
  - Honest data: ZERO fabricated/exaggerated stat metrics
  - Video Analysis Studio: showcase Alpha/Beta live features and clearly call it Alpha/Beta under active dev
  - Secret safety: read ELEVENLABS_API_KEY strictly from env
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import av
import httpx
import imageio_ffmpeg

ASSETS_ROOT = Path(
    r"C:\Users\Abdullah_Yassen\.gemini\antigravity\brain\63f869d2-f74e-4708-9f2a-2f435628b8c8\scratch\video_assets"
)
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
MODEL_ID = "eleven_v4"
TEMPO = 1.08  # Slightly faster crisp SaaS delivery while preserving pitch cleanly

AR_VOICE_ID = "IKne3meq5aSn9XLyUdCD"  # Charlie - Deep, Confident, Energetic (eleven_v4 compatible)
EN_VOICE_ID = "TX3LPaxmHKxFdv7VOQHJ"  # Liam - Energetic, Social Media Creator (eleven_v4 compatible)

# Dynamic club crest icons for animated multi-league crest orbit (live synced crests or fallback clean initials)
CLUB_CRESTS_PREVIEW = [
    {"label": "الأهلي", "short": "ASC", "hex": "#DC2626"},
    {"label": "الزمالك", "short": "ZSC", "hex": "#0F172A"},
    {"label": "بيراميدز", "short": "PFC", "hex": "#2563EB"},
    {"label": "EPL", "short": "EPL", "hex": "#3B0764"},
    {"label": "LaLiga", "short": "LLG", "hex": "#EA580C"},
    {"label": "CAF CL", "short": "CAF", "hex": "#0D9488"},
]

SCENES = {
    "ar": [
        {
            "id": "b01_logo_intro",
            "template": "lovio_logo_reveal",
            "headline": "EGY-SCOUT",
            "sub": "Coach Pro",
            "clip": "",
            "gap_after": 0.12,
            "vo": "من بي ديجيتال.. إي چي سكاوت كوتش برو.",
        },
        {
            "id": "b02_leagues_live",
            "template": "lovio_multi_leagues",
            "headline": "دوريات متعددة",
            "highlight": "ببيانات حية",
            "sub": "الدوري المصري، الإنجليزي، الإسباني، الألماني، الإيطالي وأبطال إفريقيا",
            "clip": "ar_leagues",
            "gap_after": 0.14,
            "vo": "بيانات حية بتتحدث تلقائياً لعدة دوريات محلية وأوروبية وإفريقية.",
        },
        {
            "id": "b03_command_modal",
            "template": "lovio_device_live",
            "headline": "تشكيل متزامن",
            "highlight": "وملفات حقيقية",
            "sub": "تغيير الخطة وفتح تفاصيل أي لاعب بضغطة واحدة",
            "clip": "ar_command",
            "gap_after": 0.14,
            "vo": "من لوحة القيادة، تغيّر تشكيلك فيتحدث كل البرنامج، وتفتح تفاصيل أي لاعب بضغطة.",
        },
        {
            "id": "b04_ai_3421",
            "template": "lovio_prompt_live",
            "headline": "ارسم خطتك",
            "highlight": "بالـ AI لايف",
            "sub": "شاهد رسم خطة 3-4-2-1 بالباصات والمراكز مباشرة",
            "prompt": "ارسم خطة 3-4-2-1 ألونسو",
            "clip": "ar_ai_3421",
            "crop": {"scale": 1.12, "ox": "45%", "oy": "50%"},
            "gap_after": 0.12,
            "vo": "اطلب من البرنامج بالـ AI يرسم لك خطة تلاتة أربعة اتنين واحد.. يرسمها قدامك لايف بالباصات والمراكز.",
        },
        {
            "id": "b05_3phases_live",
            "template": "lovio_bento_phases",
            "headline": "تلات حالات",
            "highlight": "تتحول قدامك",
            "sub": "تحول فعلي في تمركز اللاعبين وأسهم التمرير والضغط",
            "phases": ["1. الاستحواذ والبناء", "2. الهجوم والاختراق", "3. قطع الكرة والدفاع"],
            "clip": "ar_3phases",
            "gap_after": 0.14,
            "vo": "وشوف الفريق بيتحول لايف في التلات حالات: الاستحواذ والبناء، والهجوم والاختراق، وقطع الكرة والدفاع.",
        },
        {
            "id": "b06_formats_edit",
            "template": "lovio_device_live",
            "headline": "من 5 إلى 11",
            "highlight": "بمرونة كاملة",
            "sub": "تعديل المراكز والأسماء، شبكة المساحات، وحدات التدريب وكشف المباراة",
            "clip": "ar_formats_edit",
            "gap_after": 0.16,
            "vo": "تعدّل مراكز وأسماء اللاعيبة بحرية، وتتنقل بين سبورات خمسة لحد حداشر، مع التدريب وكشف المباراة.",
        },
        {
            "id": "b07_video_alpha",
            "template": "lovio_alpha_live",
            "headline": "استوديو تحليل الفيديو",
            "highlight": "نسخة ألفا وبيتا",
            "sub": "تتبع اللاعبين والكرة · رادار ثنائي الأبعاد · مؤشر التمرير والضغط · وسم اللقطات",
            "badge": "Alpha / Beta · قيد التطوير",
            "clip": "shared_video_alpha",
            "gap_after": 0.16,
            "vo": "وعندك النسخة الكاملة لتحليل الفيديو.. تتبع لاعيبة ورادار ومؤشر ضغط وتمرير ووسم لقطات؛ نسخة ألفا وبيتا لسه شغالين على تطويرها.",
        },
        {
            "id": "b08_outro",
            "template": "lovio_end_card",
            "headline": "EGY-SCOUT Coach Pro",
            "highlight": "شغلك التكتيكي في مكان واحد.",
            "sub": "bedigital · 2026/27",
            "clip": "",
            "gap_after": 0.35,
            "vo": "إي چي سكاوت كوتش برو.. شغلك التكتيكي في مكان واحد.",
        },
    ],
    "en": [
        {
            "id": "b01_logo_intro",
            "template": "lovio_logo_reveal",
            "headline": "EGY-SCOUT",
            "sub": "Coach Pro",
            "clip": "",
            "gap_after": 0.12,
            "vo": "By bedigital. Meet EGY-SCOUT Coach Pro.",
        },
        {
            "id": "b02_leagues_live",
            "template": "lovio_multi_leagues",
            "headline": "Multiple Leagues",
            "highlight": "Auto-Synced Live",
            "sub": "Egypt, Premier League, LaLiga, Bundesliga, Serie A & CAF Champions",
            "clip": "en_leagues",
            "gap_after": 0.14,
            "vo": "Live auto-updated data across Egyptian, African, and top European leagues.",
        },
        {
            "id": "b03_command_modal",
            "template": "lovio_device_live",
            "headline": "Synced Tactics",
            "highlight": "& Real Profiles",
            "sub": "Switch formations once and open any player's card live",
            "clip": "en_command",
            "gap_after": 0.14,
            "vo": "Switch formations once in Command Center to update every view, and open any player's live profile.",
        },
        {
            "id": "b04_ai_3421",
            "template": "lovio_prompt_live",
            "headline": "Draw Live",
            "highlight": "Powered by AI",
            "sub": "Watch AI plot 3-4-2-1 with exact roles and pass lanes",
            "prompt": "Draw 3-4-2-1 Alonso plan",
            "clip": "en_ai_3421",
            "crop": {"scale": 1.12, "ox": "55%", "oy": "50%"},
            "gap_after": 0.12,
            "vo": "Ask the app with AI to build a 3-4-2-1 shape, and watch it draw live with accurate passes and roles.",
        },
        {
            "id": "b05_3phases_live",
            "template": "lovio_bento_phases",
            "headline": "Three Phases",
            "highlight": "Animating Live",
            "sub": "Watch player positioning and arrows shift phase by phase",
            "phases": ["1. In Possession", "2. Attacking", "3. Defense & Recovery"],
            "clip": "en_3phases",
            "gap_after": 0.14,
            "vo": "See the team shift live across possession, attacking penetration, and defensive recovery.",
        },
        {
            "id": "b06_formats_edit",
            "template": "lovio_device_live",
            "headline": "5v5 to 11v11",
            "highlight": "Fully Editable",
            "sub": "Edit positions and names live, 5-channel grid, training & matchday sheet",
            "clip": "en_formats_edit",
            "gap_after": 0.16,
            "vo": "Freely edit player positions and names, switch from 5v5 up to 11v11 boards, run training drills, and print matchday sheets.",
        },
        {
            "id": "b07_video_alpha",
            "template": "lovio_alpha_live",
            "headline": "Full Video Studio",
            "highlight": "Alpha / Beta",
            "sub": "Player tracking · 2D radar twin · Passing lanes & xPass · Momentum & clip tags",
            "badge": "Alpha / Beta · Under Active Development",
            "clip": "shared_video_alpha",
            "gap_after": 0.16,
            "vo": "Plus our experimental Video Analysis Studio with player tracking, 2D radar, passing lanes, momentum charts, and clip tagging — an Alpha-Beta release still in active development.",
        },
        {
            "id": "b08_outro",
            "template": "lovio_end_card",
            "headline": "EGY-SCOUT Coach Pro",
            "highlight": "Your tactical workspace, live.",
            "sub": "bedigital · 2026/27",
            "clip": "",
            "gap_after": 0.35,
            "vo": "EGY-SCOUT Coach Pro. Your entire tactical workspace, live.",
        },
    ],
}


def media_duration(path: Path) -> float:
    with av.open(str(path)) as container:
        if container.duration:
            return float(container.duration) / 1_000_000.0
        for s in container.streams.audio:
            if s.duration and s.time_base:
                return float(s.duration * s.time_base)
    return 3.0


def synthesize_tts(api_key: str, voice_id: str, text: str, out_mp3: Path) -> None:
    if out_mp3.is_file() and out_mp3.stat().st_size > 2000:
        return
    r = httpx.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        json={
            "text": text,
            "model_id": MODEL_ID,
            "voice_settings": {
                "stability": 0.45,
                "similarity_boost": 0.78,
                "use_speaker_boost": True,
            },
        },
        timeout=45.0,
    )
    r.raise_for_status()
    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    out_mp3.write_bytes(r.content)


def process_clip(mp3_path: Path, out_wav: Path, pad_tail: float) -> tuple[float, float]:
    """Trim dead air AND apply subtle crisp tempo boost (atempo=1.08), returning (aud_dur, seg_dur)."""
    trim_wav = out_wav.with_name(out_wav.stem + "_pre.wav")
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-i",
            str(mp3_path),
            "-af",
            f"silenceremove=start_periods=1:start_silence=0.04:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_silence=0.06:start_threshold=-45dB,areverse,atempo={TEMPO},aresample=48000",
            "-ac",
            "2",
            str(trim_wav),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    aud_dur = media_duration(trim_wav)
    if aud_dur < 0.35:
        subprocess.run(
            [
                FFMPEG,
                "-y",
                "-i",
                str(mp3_path),
                "-af",
                f"atempo={TEMPO},aresample=48000",
                "-ac",
                "2",
                str(trim_wav),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        aud_dur = media_duration(trim_wav)

    seg_dur = round(aud_dur + pad_tail, 3)
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-i",
            str(trim_wav),
            "-af",
            f"apad=pad_dur={pad_tail:.3f},aresample=48000",
            "-ac",
            "2",
            "-t",
            f"{seg_dur:.3f}",
            str(out_wav),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return round(aud_dur, 3), seg_dur


def build_language_vo(api_key: str, lang: str) -> dict:
    voice_id = AR_VOICE_ID if lang == "ar" else EN_VOICE_ID
    vo_dir = ASSETS_ROOT / f"vo_v3_{lang}"
    vo_dir.mkdir(parents=True, exist_ok=True)

    timeline = []
    cur_t = 0.08
    wav_parts: list[Path] = []

    lead_wav = vo_dir / "00_lead.wav"
    subprocess.run(
        [FFMPEG, "-y", "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-t", f"{cur_t:.3f}", str(lead_wav)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    wav_parts.append(lead_wav)

    for idx, sc in enumerate(SCENES[lang], start=1):
        mp3_path = vo_dir / f"{idx:02d}_{sc['id']}.mp3"
        synthesize_tts(api_key, voice_id, sc["vo"], mp3_path)

        seg_wav = vo_dir / f"{idx:02d}_{sc['id']}.wav"
        pad_tail = float(sc.get("gap_after", 0.14))
        aud_dur, seg_dur = process_clip(mp3_path, seg_wav, pad_tail)
        wav_parts.append(seg_wav)

        timeline.append(
            {
                **sc,
                "start_s": round(cur_t if idx > 1 else 0.0, 3),
                "duration_s": round(seg_dur + (0.08 if idx == 1 else 0.0), 3),
                "audio_dur_s": aud_dur,
            }
        )
        cur_t += seg_dur

    concat_txt = vo_dir / "concat.txt"
    concat_txt.write_text("\n".join(f"file '{p.as_posix()}'" for p in wav_parts), encoding="utf-8")
    raw_full = vo_dir / f"full_v3_{lang}_raw.wav"
    master_m4a = ASSETS_ROOT / f"vo_v3_{lang}_master.m4a"
    subprocess.run(
        [FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_txt), "-c:a", "pcm_s16le", str(raw_full)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-i",
            str(raw_full),
            "-af",
            "highpass=f=85,equalizer=f=3200:t=q:w=1.2:g=1.8,loudnorm=I=-15:TP=-1.5:LRA=8",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            str(master_m4a),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    total_dur = media_duration(master_m4a)
    if timeline:
        last = timeline[-1]
        last["duration_s"] = round(max(last["duration_s"], total_dur - last["start_s"]), 3)

    manifest = {
        "lang": lang,
        "model_id": MODEL_ID,
        "tempo": TEMPO,
        "voice_id": voice_id,
        "total_duration_s": round(total_dur, 3),
        "audio_file": str(master_m4a),
        "crests": CLUB_CRESTS_PREVIEW,
        "scenes": timeline,
    }
    manifest_path = ASSETS_ROOT / f"manifest_v3_{lang}.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[{lang.upper()}] Built v3 {MODEL_ID} ({TEMPO}x) VO: {master_m4a} ({total_dur:.2f}s / {len(timeline)} beats)")
    return manifest


def main() -> int:
    api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        print("ERROR: ELEVENLABS_API_KEY env var is required.", file=sys.stderr)
        return 1
    for lang in ("ar", "en"):
        build_language_vo(api_key, lang)
    try:
        sub = httpx.get("https://api.elevenlabs.io/v1/user/subscription", headers={"xi-api-key": api_key}, timeout=15.0).json()
        print(f"Remaining ElevenLabs quota: {sub.get('character_count')} / {sub.get('character_limit')}")
    except Exception as exc:
        print("Quota check warning:", exc)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
