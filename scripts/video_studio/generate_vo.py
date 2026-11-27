"""Generate snappy ElevenLabs v4 voiceovers (AR priority + EN) with ZERO synthetic AI SFX.

Reads API key strictly from os.environ['ELEVENLABS_API_KEY'] (never stored in repository files).
Outputs v2 assets under scratch/video_assets/{vo_v2_ar,vo_v2_en,manifest_v2_ar.json,manifest_v2_en.json}.
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

# Native Egyptian shared voice candidates (added via ElevenLabs /v1/voices/add when permitted)
EGYPTIAN_SHARED_CANDIDATES = [
    (
        "Haytham - Energetic, Warm and Cheerful",
        "IES4nrmZdUBHByLBde0P",
        "3d998c483296bb27f46ec1449845265d57d55797749b21aeae5502741b9b62d0",
    ),
    (
        "Masry - Narrative, Clear and Strong",
        "LXrTqFIgiubkrMkwvOUr",
        "2ac7f9ea6c747c974065f31afe052580bd3aef08f621902b8d040e7559e934c6",
    ),
]
AR_FALLBACK_VOICE_IDS = [
    "IKne3meq5aSn9XLyUdCD",  # Charlie - Deep, Confident, Energetic
    "TX3LPaxmHKxFdv7VOQHJ",  # Liam - Energetic, Social Media Creator
]
EN_VOICE_ID = "TX3LPaxmHKxFdv7VOQHJ"  # Liam - Energetic, Social Media Creator

SCENES = {
    "ar": [
        {
            "id": "s01_hook1",
            "template": "kinetic_hook",
            "headline": "بيانات قديمة؟",
            "highlight": "أرقام وهمية؟",
            "sub": "كشوفات ورقية وتأخير قبل كل ماتش",
            "screens": [],
            "gap_after": 0.14,
            "vo": "بيانات قديمة؟ أرقام وهمية؟",
        },
        {
            "id": "s02_hook2",
            "template": "kinetic_accent",
            "headline": "وقتك كمدرب",
            "highlight": "أهم من كده.",
            "sub": "",
            "screens": [],
            "gap_after": 0.22,
            "vo": "وقتك كمدرب أهم من كده.",
        },
        {
            "id": "s03_brand",
            "template": "logo_morph",
            "headline": "EGY-SCOUT Coach Pro",
            "highlight": "2026/27 · Live Edition",
            "sub": "منظومة المدرب والمدير الفني والإداري في الدوري المصري",
            "screens": [],
            "gap_after": 0.18,
            "vo": "من بي ديجيتال.. إي چي سكاوت كوتش برو.",
        },
        {
            "id": "s04_live",
            "template": "floating_cards",
            "headline": "دوري 2026/27",
            "highlight": "محدّث لحظياً",
            "sub": "20 نادياً · 748 لاعباً · جدول ومدربين حقيقيين",
            "screens": ["ar_00_onboarding.png", "ar_07_live_hub.png"],
            "cards": [
                "#1 بيراميدز · 27 نقطة",
                "#2 الزمالك · 22 نقطة",
                "#3 الأهلي · 20 نقطة",
                "20 نادياً · 748 لاعباً حقيقياً",
            ],
            "gap_after": 0.16,
            "vo": "عشرين نادي مصري، سبعمية تمانية وأربعين لاعب، بجدول ومدربين موسم ألفين ستة وعشرين، محدثين تلقائياً كل يوم.",
        },
        {
            "id": "s05_command",
            "template": "tilted_3d_hero",
            "headline": "لوحة قيادة",
            "highlight": "متزامنة بالكامل",
            "sub": "غيّر خطتك بضغطة فتتحدث في كل الشاشات",
            "badge": "SYNCED XI",
            "screens": ["ar_01_dashboard.png"],
            "gap_after": 0.14,
            "vo": "من لوحة القيادة، غيّر خطتك بضغطة فتتحدث في البرنامج كله.",
        },
        {
            "id": "s06_modal",
            "template": "macro_zoom",
            "headline": "ملف كل لاعب",
            "highlight": "في ثانية",
            "sub": "الجاهزية، الإنذارات، الطول، المركز والبيانات الفعلية",
            "badge": "LIVE BIO MODAL",
            "crop": {"scale": 1.38, "ox": "50%", "oy": "42%"},
            "screens": ["ar_01b_player_modal.png"],
            "gap_after": 0.20,
            "vo": "اضغط على أي لاعب، يفتح ملفه الحقيقي فوراً.",
        },
        {
            "id": "s07_phases",
            "template": "split_bento",
            "headline": "تلات حالات",
            "highlight": "لعب واضح",
            "sub": "سبورة ذكية تفصل كل لحظة في المباراة",
            "phases": ["1. الاستحواذ والبناء", "2. الهجوم والاختراق", "3. قطع الكرة والدفاع"],
            "screens": ["ar_02_tactics_11v11.png"],
            "gap_after": 0.14,
            "vo": "على السبورة التكتيكية.. تلات حالات واضحة: استحواذ، هجوم، وقطع الكرة والدفاع.",
        },
        {
            "id": "s08_edit_pitch",
            "template": "macro_pitch",
            "headline": "أسماء ظاهرة",
            "highlight": "ومراكز مرنة",
            "sub": "عدّل مركز ودور كل لاعب + قلم حر + شبكة المساحات",
            "badge": "EDITABLE SLOTS + CHALK",
            "crop": {"scale": 1.32, "ox": "48%", "oy": "58%"},
            "screens": ["ar_02_tactics_11v11.png"],
            "gap_after": 0.16,
            "vo": "أسماء اللاعيبة ظاهرة قدامك، وتعدل مركز ودور كل لاعب بحرية، مع قلم حر وشبكة المساحات.",
        },
        {
            "id": "s09_formats",
            "template": "format_montage",
            "headline": "كل التقسيمات",
            "highlight": "من 5 إلى 11",
            "sub": "تسجيل لقطاتك بالفيديو والحركة بين الخطوط",
            "formats": ["5×5", "6×6", "7×7", "8×8", "9×9", "10×10", "11×11"],
            "screens": ["ar_03b_tactics_5v5.png", "ar_03_tactics_7v7_attack.png", "ar_02_tactics_11v11.png"],
            "gap_after": 0.22,
            "vo": "مش بس حداشر ضد حداشر.. معاك سبورات جاهزة من خمسة لحد حداشر، وتسجيل لقطاتك بالفيديو.",
        },
        {
            "id": "s10_train_dir",
            "template": "layered_stack",
            "headline": "تدريب حقيقي",
            "highlight": "وكشاف شامل",
            "sub": "أحمال sRPE فعلية + مقارنة فورية لكل لاعبي الدوري",
            "screens": ["ar_04_training.png", "ar_05_director.png"],
            "gap_after": 0.18,
            "vo": "صمّم تدريباتك بأحمال حقيقية من غير أرقام وهمية، وقارن أي لاعبين في الدوري في ثانية.",
        },
        {
            "id": "s11_admin_live",
            "template": "marquee_split",
            "headline": "كشف العشرين",
            "highlight": "بضغطة واحدة",
            "sub": "استبعاد آلي للمصاب والموقوف + تبديل فوري + طباعة",
            "pills": [
                "كشف الـ 20 الرسمي",
                "استبعاد المصاب والموقوف",
                "تبديل بضغطة",
                "جدول 2026/27 الحي",
                "توقيت القاهرة",
            ],
            "screens": ["ar_06_admin.png", "ar_07_live_hub.png"],
            "gap_after": 0.20,
            "vo": "والإداري يطبع كشف العشرين بضغطة، باستبعاد تلقائي للمصاب والموقوف، وتبديل الأساسي والبديل فوراً.",
        },
        {
            "id": "s12_ai",
            "template": "ai_prompt_card",
            "headline": "مساعد ذكي",
            "highlight": "ينفذ فوراً",
            "sub": "متصل بفريقك وبياناتك طول الوقت",
            "prompt": "جهّز خطة 4-3-3 هجومية قدام الزمالك",
            "screens": ["ar_08_ai_copilot.png"],
            "gap_after": 0.18,
            "vo": "والمساعد الذكي متصل بفريقك.. اطلب منه أي خطة أو تدريب، هينفذها على الملعب قدامك.",
        },
        {
            "id": "s13_beta",
            "template": "beta_peek",
            "headline": "استوديو الفيديو",
            "highlight": "النسخة الكاملة Beta",
            "sub": "تحليل فيديوهات المباريات التجريبي بضغطة زر",
            "badge": "Full Video Studio · Beta",
            "screens": ["shared_09_beta_studio.png"],
            "gap_after": 0.22,
            "vo": "وعندك كمان النسخة الكاملة لتحليل الفيديوهات بيتا، جاهزة بضغطة زر.",
        },
        {
            "id": "s14_outro",
            "template": "dexatel_outro",
            "headline": "EGY-SCOUT Coach Pro",
            "highlight": "قرارات أسرع، ملعب أوضح.",
            "sub": "جاهز للعمل اليوم · 2026/27",
            "screens": [],
            "gap_after": 0.45,
            "vo": "إي چي سكاوت كوتش برو.. قرارات أسرع، ملعب أوضح.",
        },
    ],
    "en": [
        {
            "id": "s01_hook1",
            "template": "kinetic_hook",
            "headline": "Outdated squads?",
            "highlight": "Fake stats?",
            "sub": "Static spreadsheets and last-minute guesswork",
            "screens": [],
            "gap_after": 0.14,
            "vo": "Outdated squads? Fake stats?",
        },
        {
            "id": "s02_hook2",
            "template": "kinetic_accent",
            "headline": "Leave guesswork",
            "highlight": "behind.",
            "sub": "",
            "screens": [],
            "gap_after": 0.22,
            "vo": "Leave guesswork behind.",
        },
        {
            "id": "s03_brand",
            "template": "logo_morph",
            "headline": "EGY-SCOUT Coach Pro",
            "highlight": "2026/27 · Live Edition",
            "sub": "Head Coach, Technical Director & Team Manager Suite",
            "screens": [],
            "gap_after": 0.18,
            "vo": "By bedigital. Meet EGY-SCOUT Coach Pro.",
        },
        {
            "id": "s04_live",
            "template": "floating_cards",
            "headline": "2026/27 League",
            "highlight": "Auto-Synced Live",
            "sub": "20 clubs · 748 verified players · Real coaches",
            "screens": ["en_07_live_hub.png", "ar_00_onboarding.png"],
            "cards": [
                "#1 Pyramids · 27 pts",
                "#2 Zamalek · 22 pts",
                "#3 Al Ahly · 20 pts",
                "20 Clubs · 748 Real Players",
            ],
            "gap_after": 0.16,
            "vo": "Twenty live Egyptian Premier League clubs, over seven hundred real players, auto-synced to the 2026-27 season.",
        },
        {
            "id": "s05_command",
            "template": "tilted_3d_hero",
            "headline": "Command Center",
            "highlight": "Zero-Drift Sync",
            "sub": "Change your shape once, sync every tab instantly",
            "badge": "SYNCED XI",
            "screens": ["en_01_dashboard.png"],
            "gap_after": 0.14,
            "vo": "Switch your formation once in Command Center, and sync your entire staff workspace.",
        },
        {
            "id": "s06_modal",
            "template": "macro_zoom",
            "headline": "Verified Player",
            "highlight": "Cards in a Tap",
            "sub": "Readiness, cards, height, position and form",
            "badge": "LIVE BIO MODAL",
            "crop": {"scale": 1.38, "ox": "50%", "oy": "42%"},
            "screens": ["en_01b_player_modal.png"],
            "gap_after": 0.20,
            "vo": "Tap any starter for verified bio details in an instant.",
        },
        {
            "id": "s07_phases",
            "template": "split_bento",
            "headline": "Three Phases",
            "highlight": "Editable Roles",
            "sub": "Full player names & open role assignments on grass",
            "phases": ["1. In Possession", "2. Attacking", "3. Defense & Recovery"],
            "screens": ["en_02_tactics_11v11.png"],
            "gap_after": 0.16,
            "vo": "Master all three phases: possession, attack, and defensive recovery, with full player names and editable roles.",
        },
        {
            "id": "s08_formats",
            "template": "format_montage",
            "headline": "Every Pitch Size",
            "highlight": "5v5 to 11v11",
            "sub": "Freehand chalk, 5-channel grid & keyframe playback",
            "formats": ["5v5", "6v6", "7v7", "8v8", "9v9", "10v10", "11v11"],
            "screens": ["en_03b_tactics_5v5.png", "en_03_tactics_7v7.png", "en_02_tactics_11v11.png"],
            "gap_after": 0.22,
            "vo": "Jump seamlessly from 5v5 up to 11v11 boards, draw freehand, toggle the five-channel grid, and play back keyframes.",
        },
        {
            "id": "s09_train_dir",
            "template": "layered_stack",
            "headline": "Real Training",
            "highlight": "& League Scout",
            "sub": "Actual logged sRPE loads + instant player comparison",
            "screens": ["en_04_training.png", "en_05_director.png"],
            "gap_after": 0.18,
            "vo": "Log real training loads with zero fake numbers, and compare every player across the league.",
        },
        {
            "id": "s10_admin_live",
            "template": "marquee_split",
            "headline": "Matchday XI",
            "highlight": "Built in 1 Click",
            "sub": "Auto injury/card exclusion + live 2026/27 standings",
            "pills": [
                "20-Man Matchday Sheet",
                "Auto Card Blocking",
                "1-Click XI Swap",
                "Live 2026/27 Standings",
                "Instant Print View",
            ],
            "screens": ["en_06_admin.png", "en_07_live_hub.png"],
            "gap_after": 0.20,
            "vo": "Auto-block injured or suspended players, swap starters in one click, and print matchday sheets with live tables.",
        },
        {
            "id": "s11_ai",
            "template": "ai_prompt_card",
            "headline": "AI Copilot",
            "highlight": "Draws Live Plans",
            "sub": "Connected to your club data and tactical boards",
            "prompt": "Build 4-3-3 high press vs Zamalek",
            "screens": ["en_08_ai_copilot.png"],
            "gap_after": 0.18,
            "vo": "Ask your AI Copilot to draw a plan or build a session, and it applies straight onto the board.",
        },
        {
            "id": "s12_beta",
            "template": "beta_peek",
            "headline": "Full Video Studio",
            "highlight": "Beta Access",
            "sub": "Experimental match video CV pipeline one click away",
            "badge": "Full Video Studio · Beta",
            "screens": ["shared_09_beta_studio.png"],
            "gap_after": 0.22,
            "vo": "Plus one-click access to the Full Video Analysis Studio Beta.",
        },
        {
            "id": "s13_outro",
            "template": "dexatel_outro",
            "headline": "EGY-SCOUT Coach Pro",
            "highlight": "Faster decisions. Clearer football.",
            "sub": "Built for Matchday · 2026/27",
            "screens": [],
            "gap_after": 0.45,
            "vo": "EGY-SCOUT Coach Pro. Faster decisions. Clearer football.",
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


def synthesize_tts(api_key: str, voice_id: str, text: str, out_mp3: Path) -> bytes:
    """Call ElevenLabs v4 strictly without speed/style keys."""
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
    return r.content


def resolve_ar_voice(api_key: str, first_clip_path: Path, first_text: str) -> tuple[str, str]:
    """Try adding and testing a native Egyptian shared voice; fall back gracefully if tier limits block it."""
    if first_clip_path.is_file() and first_clip_path.stat().st_size > 2000:
        # Cached run - check if previously saved selection exists
        meta_file = first_clip_path.parent / "voice_meta.json"
        if meta_file.is_file():
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            return meta["voice_id"], meta["voice_label"]

    try:
        r_list = httpx.get(
            "https://api.elevenlabs.io/v1/voices",
            headers={"xi-api-key": api_key},
            timeout=20.0,
        )
        r_list.raise_for_status()
        existing = {v["voice_id"]: v["name"] for v in r_list.json().get("voices", [])}
    except Exception:
        existing = {}

    for label, vid, owner_id in EGYPTIAN_SHARED_CANDIDATES:
        try:
            if vid not in existing:
                r_add = httpx.post(
                    f"https://api.elevenlabs.io/v1/voices/add/{owner_id}/{vid}",
                    headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                    json={"new_name": label[:32]},
                    timeout=20.0,
                )
                if r_add.status_code >= 400:
                    print(f"[AR Voice] Could not add shared voice {label}: {r_add.status_code} {r_add.text[:140]}")
                    continue
            # Probe actual v4 synthesis on the first beat (saves quota by keeping the file!)
            synthesize_tts(api_key, vid, first_text, first_clip_path)
            print(f"[AR Voice] Selected native Egyptian shared voice: {label} ({vid}) on {MODEL_ID}")
            (first_clip_path.parent / "voice_meta.json").write_text(
                json.dumps({"voice_id": vid, "voice_label": label}, ensure_ascii=False),
                encoding="utf-8",
            )
            return vid, label
        except httpx.HTTPStatusError as exc:
            print(f"[AR Voice] Rejected {label} ({vid}): {exc.response.status_code} {exc.response.text[:160]}")
            if first_clip_path.exists():
                first_clip_path.unlink()
        except Exception as exc:
            print(f"[AR Voice] Error testing {label}: {exc}")

    for vid in AR_FALLBACK_VOICE_IDS:
        try:
            synthesize_tts(api_key, vid, first_text, first_clip_path)
            label = existing.get(vid, vid)
            print(f"[AR Voice] Using account fallback voice: {label} ({vid}) on {MODEL_ID}")
            (first_clip_path.parent / "voice_meta.json").write_text(
                json.dumps({"voice_id": vid, "voice_label": label}, ensure_ascii=False),
                encoding="utf-8",
            )
            return vid, label
        except httpx.HTTPStatusError as exc:
            print(f"[AR Voice] Fallback {vid} failed: {exc.response.status_code} {exc.response.text[:160]}")

    raise RuntimeError("No working ElevenLabs voice succeeded on eleven_v4 for Arabic.")


def trim_clip_silence(mp3_path: Path, out_wav: Path) -> float:
    """Trim leading/trailing dead air cleanly so kinetic cuts land right on speech onset."""
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-i",
            str(mp3_path),
            "-af",
            "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_silence=0.08:start_threshold=-45dB,areverse,aresample=48000",
            "-ac",
            "2",
            str(out_wav),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    dur = media_duration(out_wav)
    if dur < 0.35:
        subprocess.run(
            [FFMPEG, "-y", "-i", str(mp3_path), "-af", "aresample=48000", "-ac", "2", str(out_wav)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        dur = media_duration(out_wav)
    return dur


def build_language_vo(api_key: str, lang: str) -> dict:
    vo_dir = ASSETS_ROOT / f"vo_v2_{lang}"
    vo_dir.mkdir(parents=True, exist_ok=True)

    first_sc = SCENES[lang][0]
    first_mp3 = vo_dir / f"01_{first_sc['id']}.mp3"

    if lang == "ar":
        voice_id, voice_label = resolve_ar_voice(api_key, first_mp3, first_sc["vo"])
    else:
        voice_id, voice_label = EN_VOICE_ID, "Liam - Energetic, Social Media Creator"

    timeline = []
    cur_t = 0.08  # Snappy 80ms visual lead-in
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
        if not (mp3_path.is_file() and mp3_path.stat().st_size > 2000):
            synthesize_tts(api_key, voice_id, sc["vo"], mp3_path)

        trim_wav = vo_dir / f"{idx:02d}_{sc['id']}_trim.wav"
        aud_dur = trim_clip_silence(mp3_path, trim_wav)
        pad_tail = float(sc.get("gap_after", 0.16))
        seg_dur = round(aud_dur + pad_tail, 3)

        seg_wav = vo_dir / f"{idx:02d}_{sc['id']}.wav"
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
                "duration_s": round(seg_dur + (0.08 if idx == 1 else 0.0), 3),
                "audio_dur_s": round(aud_dur, 3),
            }
        )
        cur_t += seg_dur

    concat_txt = vo_dir / "concat.txt"
    concat_txt.write_text("\n".join(f"file '{p.as_posix()}'" for p in wav_parts), encoding="utf-8")
    raw_full = vo_dir / f"full_v2_{lang}_raw.wav"
    master_m4a = ASSETS_ROOT / f"vo_v2_{lang}_master.m4a"
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
        "voice_id": voice_id,
        "voice_label": voice_label,
        "total_duration_s": round(total_dur, 3),
        "audio_file": str(master_m4a),
        "scenes": timeline,
    }
    manifest_path = ASSETS_ROOT / f"manifest_v2_{lang}.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[{lang.upper()}] Built {MODEL_ID} VO ({voice_label}): {master_m4a} ({total_dur:.2f}s / {len(timeline)} beats)")
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
