"""Generate clean broadcast-quality ElevenLabs voiceovers (AR priority + EN) with ZERO synthetic AI SFX.

Reads API key strictly from os.environ['ELEVENLABS_API_KEY'] (never stored in repository files).
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

AR_VOICE_ID = "onwK4e9ZLuTAKqWW03F9"  # Daniel - Steady Broadcaster (clean multilingual Arabic)
EN_VOICE_ID = "cjVigY5qzO86Huf0OWal"  # Eric - Smooth, Trustworthy

SCENES = {
    "ar": [
        {
            "id": "s1_intro",
            "title_top": "EGY-SCOUT COACH PRO",
            "headline": "غرفة القيادة الفنية الشاملة للمدرب المصري",
            "sub": "نسخة المدرب المعتمدة من bedigital — تصميم نهاري واضح بلا أي بيانات وهمية",
            "screen": "ar_00_onboarding.png",
            "cursor": [0.76, 0.28, 0.34, 0.88],
            "vo": "من بِي ديجيتال، إليك إي جي سكاوت كوتش برو: منصة القيادة الفنية والتدريبية والإدارية المصممة خصيصاً للمدير الفني والجهاز المعاون في الدوري المصري، بتصميم نهاري واضح وبيانات حية ومضمونة من موسم ألفين ستة وعشرين ألفين سبعة وعشرين.",
        },
        {
            "id": "s2_onboarding",
            "title_top": "LIVE 2026/2027 REGISTRY",
            "headline": "عشرون نادياً مصرياً بتحديث تلقائي لحظي",
            "sub": "اختر فريقك والمنافس لتظهر القائمة الحقيقية والمدرب وترتيب الجدول فوراً",
            "screen": "ar_00_onboarding.png",
            "cursor": [0.68, 0.48, 0.25, 0.86],
            "vo": "بمجرد كتابة اسمك واختيار فريقك وفريق الخصم، يتصل البرنامج مباشرةً ببيانات موسم ألفين ستة وعشرين ألفين سبعة وعشرين المحدثة تلقائياً: عشرون نادياً مصرياً بأكثر من سبعمئة وأربعين لاعباً بأسمائهم الحقيقية، أعمارهم، أطوالهم، وأجهزتهم الفنية.",
        },
        {
            "id": "s3_command",
            "title_top": "EXECUTIVE COMMAND CENTER",
            "headline": "لوحة القيادة: التشكيل المتزامن والأحمال الحقيقية",
            "sub": "تبديل التشكيل بضغطة واحدة، كارت تفاصيل كل لاعب، ومؤشر حصة الأجانب",
            "screen": "ar_01_dashboard.png",
            "cursor": [0.35, 0.56, 0.54, 0.42],
            "vo": "في لوحة القيادة ترى التشكيل الأساسي الجاهز متزامناً مع كل أقسام البرنامج، وتضغط على أي لاعب لفتح ملفه الكامل، مع مؤشرات حصة الأجانب الخمسة، المهددين بالإيقاف، ومخطط الأحمال التدريبية المسجلة فعلياً بدون أي أرقام وهمية.",
        },
        {
            "id": "s4_tactics_11",
            "title_top": "3-PHASE TACTICAL STUDIO",
            "headline": "ثلاث حالات تكتيكية وأسماء ومراكز قابلة للتعديل",
            "sub": "الاستحواذ — الهجوم — قطع الكرة والدفاع، مع قلم حر وشبكة أنصاف المساحات",
            "screen": "ar_02_tactics_11v11.png",
            "cursor": [0.62, 0.45, 0.24, 0.52],
            "vo": "على السبورة التكتيكية تعمل بثلاث حالات واضحة لكل فريق: الاستحواذ والبناء، الهجوم والاختراق، وقطع الكرة والدفاع. يظهر اسم كل لاعب بالكامل على أرض الملعب، ويمكنك تعديل مركز أي لاعب ودوره التكتيكي بحرية، والرسم بالقلم الحر والأسهم والمناطق مع تفعيل شبكة المساحات.",
        },
        {
            "id": "s5_tactics_small",
            "title_top": "5v5 · 6v6 · 7v7 · 8v8 · 9v9 · 10v10 · 11v11",
            "headline": "سبورات لكل أحجام التقسيمة وتسجيل اللقطات",
            "sub": "انتقال فوري بين تقسيمات التدريب ومباريات الخماسي والسباعي والتساعي",
            "screen": "ar_03_tactics_7v7_attack.png",
            "cursor": [0.78, 0.22, 0.42, 0.22],
            "vo": "ولأن عمل المدرب لا يتوقف عند أحد عشر لاعباً، أضفنا سبورات تكتيكية جاهزة من خمسة ضد خمسة وحتى أحد عشر ضد أحد عشر، مع تسجيل لقطاتك الخاصة وتشغيل سيناريو التحرك بين الخطوط بسلاسة.",
        },
        {
            "id": "s6_training_director",
            "title_top": "PERIODIZATION & SCOUTING",
            "headline": "ستوديو التدريب والأحمال والكشاف الرياضي الشامل",
            "sub": "وحدات MD-5 إلى MD+1 بحركة الكرة + مقارنة وبحث في كل لاعبي الدوري",
            "screen": "ar_04_training.png",
            "cursor": [0.58, 0.48, 0.28, 0.65],
            "vo": "وفي ستوديو التدريب تصمم وحدات الأسبوع بمؤشرات الشدة والحمل وحركة الكرة واللاعبين، بينما يمنحك قسم المدير الفني خريطة عمق كل مركز وبحثاً ومقارنة فورية بين جميع لاعبي الدوري المصري.",
        },
        {
            "id": "s7_admin_live",
            "title_top": "TEAM MANAGER & MATCHDAY XI",
            "headline": "الإداري وكشف المباراة مع الجدول الحي المباشر",
            "sub": "استبعاد تلقائي للمصاب والموقوف بـ 3 إنذارات، وتبديل الأساسي والبديل بضغطة",
            "screen": "ar_06_admin.png",
            "cursor": [0.22, 0.48, 0.34, 0.68],
            "vo": "ولإداري الفريق، يربط الكشف الرسمي بين السجل الطبي والإنذارات: يستبعد المصاب والموقوف تلقائياً، يتيح تبديل الأساسي والبديل بضغطة واحدة والطباعة الفورية، مع جدول ترتيب ونتائج الدوري المصري الحية بتوقيت اليوم.",
        },
        {
            "id": "s8_ai_and_beta",
            "title_top": "CORE AI COPILOT & FULL VIDEO BETA",
            "headline": "مساعد ذكي ينفذ الخطط + استوديو الفيديو الكامل Beta",
            "sub": "اطلب أي خطة أو وحدة تدريب أو كشف مباراة فينفذها المساعد الذكي مباشرةً",
            "screen": "ar_08_ai_copilot.png",
            "cursor": [0.18, 0.38, 0.14, 0.84],
            "vo": "المساعد الذكي متصل بكل بيانات فريقك؛ اطلب منه رسم خطة أو تصميم حصة أو تجهيز كشف المباراة وسينفذها على اللوحات فوراً. وإذا أردت تحليل فيديوهات المباريات، تنتظرك النسخة الكاملة التجريبية بيتا بضغطة زر واحدة من القائمة.",
        },
        {
            "id": "s9_outro",
            "title_top": "START WITH A DOT",
            "headline": "EGY-SCOUT Coach Pro — جاهز للعمل اليوم",
            "sub": "بيانات حية · خطط 5×5 إلى 11×11 · إدارة كاملة · ذكاء اصطناعي",
            "screen": "ar_01_dashboard.png",
            "cursor": [0.5, 0.5, 0.5, 0.5],
            "vo": "إي جي سكاوت كوتش برو من بِي ديجيتال: قرارات فنية دقيقة تبدأ بنقطة.",
        },
    ],
    "en": [
        {
            "id": "s1_intro",
            "title_top": "BEDIGITAL PRESENTS",
            "headline": "EGY-SCOUT Coach Pro — Certified Staff Edition",
            "sub": "Crisp light-mode workspace built exclusively with live 2026/27 data",
            "screen": "ar_00_onboarding.png",
            "cursor": [0.24, 0.28, 0.66, 0.88],
            "vo": "Meet EGY-SCOUT Coach Pro by bedigital: a crisp, daylight-first command platform built for head coaches, technical directors, and team managers, powered by verified live 2026-27 Egyptian Premier League data with zero synthetic numbers.",
        },
        {
            "id": "s2_command",
            "title_top": "LIVE COMMAND CENTER",
            "headline": "Auto-Updated 2026/27 Clubs & Synced Starting XI",
            "sub": "20 live clubs, real head coaches, instant player bio modal & foreign quota",
            "screen": "en_01_dashboard.png",
            "cursor": [0.65, 0.54, 0.42, 0.44],
            "vo": "Start from the Command Center. Every club roster, coach name, and league table point updates automatically from the 2026-27 season. Click any starter on the pitch for verified bio details, or switch your base formation once and sync the entire platform.",
        },
        {
            "id": "s3_tactics_11",
            "title_top": "3-PHASE TACTICAL BOARD",
            "headline": "Possession, Attack & Defense + Editable Positions",
            "sub": "Full player names on pitch, custom role edits, freehand chalk & 5-channel grid",
            "screen": "en_02_tactics_11v11.png",
            "cursor": [0.42, 0.46, 0.78, 0.52],
            "vo": "Inside the Tactics Studio, shape all three match phases: in possession, attacking penetration, and defensive recovery. Full player names appear right on the grass, and every tactical position and duty stays fully editable alongside freehand drawing and the five-channel positional grid.",
        },
        {
            "id": "s4_tactics_small",
            "title_top": "MULTI-FORMAT BOARDS",
            "headline": "Switch Instantly from 5v5 up to 11v11",
            "sub": "Plus custom keyframe playbook recording and smooth tactical playback",
            "screen": "en_03_tactics_7v7.png",
            "cursor": [0.22, 0.22, 0.58, 0.22],
            "vo": "Plan small-sided training games just as easily as matchday eleven-versus-eleven. Switch between 5v5, 7v7, 9v9, and 11v11 formats in one click, and record custom tactical keyframes to animate player runs cleanly.",
        },
        {
            "id": "s5_training_director",
            "title_top": "TRAINING & TECHNICAL DIRECTOR",
            "headline": "Foster sRPE Periodization & Full League Scout",
            "sub": "Real logged training loads, animated drills & side-by-side player comparison",
            "screen": "en_04_training.png",
            "cursor": [0.45, 0.52, 0.72, 0.56],
            "vo": "Design your weekly MD microcycle using real logged sRPE training loads and animated field drills, while Technical Directors map squad depth and scout or compare players across the entire league.",
        },
        {
            "id": "s6_admin_live",
            "title_top": "TEAM ADMIN & LIVE 2026/27 HUB",
            "headline": "Automated Suspension Blocking & 1-Click XI Swap",
            "sub": "Print-ready 20-man matchday sheets + live fixtures updated to today",
            "screen": "en_06_admin.png",
            "cursor": [0.72, 0.46, 0.34, 0.65],
            "vo": "Team managers get automatic exclusion for injuries and three-card suspensions, one-click starter-to-bench swaps, instant matchday printouts, and live standings and fixtures updated automatically.",
        },
        {
            "id": "s7_ai_beta",
            "title_top": "CORE AI COPILOT + VIDEO STUDIO BETA",
            "headline": "Ask in Natural Language, Apply Directly to the Board",
            "sub": "Plus one-click access to the Full Video Analysis Studio (Beta)",
            "screen": "en_08_ai_copilot.png",
            "cursor": [0.85, 0.42, 0.88, 0.85],
            "vo": "Ask the integrated AI Copilot to draw a tactical plan, build a training session, or assemble your matchday sheet directly on screen — with separate access to our experimental Full Video Studio Beta whenever needed.",
        },
        {
            "id": "s8_outro",
            "title_top": "START WITH A DOT",
            "headline": "EGY-SCOUT Coach Pro — Built by bedigital",
            "sub": "Live 2026/27 Football · 5v5 to 11v11 Tactics · Zero Fake Data",
            "screen": "en_01_dashboard.png",
            "cursor": [0.5, 0.5, 0.5, 0.5],
            "vo": "EGY-SCOUT Coach Pro by bedigital. Clear screens. Honest data. Start with a dot.",
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
    return 6.0


def synthesize_clip(api_key: str, voice_id: str, text: str, out_mp3: Path) -> float:
    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    if out_mp3.is_file() and out_mp3.stat().st_size > 2000:
        return media_duration(out_mp3)
    r = httpx.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        json={
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.62, "similarity_boost": 0.78, "style": 0.18, "use_speaker_boost": True},
        },
        timeout=45.0,
    )
    r.raise_for_status()
    out_mp3.write_bytes(r.content)
    return media_duration(out_mp3)


def build_language_vo(api_key: str, lang: str) -> dict:
    voice_id = AR_VOICE_ID if lang == "ar" else EN_VOICE_ID
    vo_dir = ASSETS_ROOT / f"vo_{lang}"
    vo_dir.mkdir(parents=True, exist_ok=True)

    timeline = []
    cur_t = 0.25  # tiny lead-in before voice begins
    wav_parts: list[Path] = []
    pad_tail = 0.55

    # Lead-in silence 0.25s
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
        aud_dur = synthesize_clip(api_key, voice_id, sc["vo"], mp3_path)
        seg_dur = round(aud_dur + pad_tail, 3)

        seg_wav = vo_dir / f"{idx:02d}_{sc['id']}.wav"
        # Pad each voice clip cleanly with pure natural silence tail (zero synthetic SFX)
        subprocess.run(
            [
                FFMPEG,
                "-y",
                "-i",
                str(mp3_path),
                "-af",
                f"apad=pad_dur={pad_tail:.3f},aresample=48000",
                "-ac",
                "2",
                "-t",
                f"{seg_dur:.3f}",
                str(seg_wav),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        wav_parts.append(seg_wav)
        timeline.append(
            {
                **sc,
                "start_s": round(cur_t if idx > 1 else 0.0, 3),
                "duration_s": round(seg_dur + (0.25 if idx == 1 else 0.0), 3),
                "audio_dur_s": round(aud_dur, 3),
            }
        )
        cur_t += seg_dur

    concat_txt = vo_dir / "concat.txt"
    concat_txt.write_text("\n".join(f"file '{p.as_posix()}'" for p in wav_parts), encoding="utf-8")
    raw_full = vo_dir / f"full_{lang}_raw.wav"
    master_m4a = ASSETS_ROOT / f"vo_{lang}_master.m4a"
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
            "loudnorm=I=-14:TP=-1.5:LRA=10",
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
    # Match final scene end cleanly to audio duration
    if timeline:
        last = timeline[-1]
        last["duration_s"] = round(max(last["duration_s"], total_dur - last["start_s"]), 3)

    manifest = {
        "lang": lang,
        "voice_id": voice_id,
        "total_duration_s": round(total_dur, 3),
        "audio_file": str(master_m4a),
        "scenes": timeline,
    }
    manifest_path = ASSETS_ROOT / f"manifest_{lang}.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[{lang.upper()}] Built VO master: {master_m4a} ({total_dur:.2f}s across {len(timeline)} scenes)")
    return manifest


def main() -> int:
    api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        print("ERROR: ELEVENLABS_API_KEY env var is required.", file=sys.stderr)
        return 1
    for lang in ("ar", "en"):
        build_language_vo(api_key, lang)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
