"""Generate tight ~58-62s ElevenLabs eleven_v4 voiceovers (AR priority + EN) with 1.08x pace & ZERO AI SFX.

Rules verified:
  - Temp/VO outputs live strictly on D:\\egy-scout-data\\video_studio_tmp (never C:)
  - Model: eleven_v4 (no unsupported speed/style params in JSON; atempo=1.08 in FFmpeg)
  - Terminology: say "الذكاء الاصطناعي (AI)" / "بالـ AI" / "powered by AI" (NEVER say "AI Copilot" / "كوبايلوت")
  - Formations: tactical numbers only (NEVER mention coach names)
  - Multi-league: explicitly cover Egypt + Europe's Big 5 (Premier League, LaLiga, Bundesliga, Serie A, Ligue 1)
  - Logos: use the 15 verified real official HD PNG logos from D:\\egy-scout-data\\video_studio_tmp\\logos
  - Video Analysis Studio: clearly explain what the Full Alpha/Beta studio does and its features at the end
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

ASSETS_ROOT = Path(r"D:\egy-scout-data\video_studio_tmp")
LOGOS_DIR = ASSETS_ROOT / "logos"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
MODEL_ID = "eleven_v4"
TEMPO = 1.08

AR_VOICE_ID = "IKne3meq5aSn9XLyUdCD"  # Charlie - Deep, Confident, Energetic
EN_VOICE_ID = "TX3LPaxmHKxFdv7VOQHJ"  # Liam - Energetic, Social Media Creator

LOGO_SHOWCASE = [
    {"id": "lg_egy", "file": "lg_egy.png", "label": "الدوري المصري", "label_en": "Egypt EPL"},
    {"id": "lg_eng", "file": "lg_eng.png", "label": "الإنجليزي", "label_en": "Premier League"},
    {"id": "lg_esp", "file": "lg_esp.png", "label": "الإسباني", "label_en": "LaLiga"},
    {"id": "lg_ger", "file": "lg_ger.png", "label": "الألماني", "label_en": "Bundesliga"},
    {"id": "lg_ita", "file": "lg_ita.png", "label": "الإيطالي", "label_en": "Serie A"},
    {"id": "lg_fra", "file": "lg_fra.png", "label": "الفرنسي", "label_en": "Ligue 1"},
    {"id": "club_al_ahly", "file": "club_al_ahly.png", "label": "الأهلي", "label_en": "Al Ahly"},
    {"id": "club_zamalek", "file": "club_zamalek.png", "label": "الزمالك", "label_en": "Zamalek"},
    {"id": "club_pyramids", "file": "club_pyramids.png", "label": "بيراميدز", "label_en": "Pyramids"},
    {"id": "club_arsenal", "file": "club_arsenal.png", "label": "Arsenal", "label_en": "Arsenal"},
    {"id": "club_realmadrid", "file": "club_realmadrid.png", "label": "Real Madrid", "label_en": "Real Madrid"},
    {"id": "club_barcelona", "file": "club_barcelona.png", "label": "Barcelona", "label_en": "Barcelona"},
    {"id": "club_bayern", "file": "club_bayern.png", "label": "Bayern", "label_en": "Bayern"},
    {"id": "club_psg", "file": "club_psg.png", "label": "PSG", "label_en": "PSG"},
    {"id": "club_inter", "file": "club_inter.png", "label": "Inter", "label_en": "Inter"},
]

SCENES = {
    "ar": [
        {
            "id": "b01_logo_intro",
            "template": "lovio_logo_reveal",
            "flash": "EGY-SCOUT Coach Pro",
            "pill": "مدعوم بالـ AI بالكامل · bedigital",
            "clip": "",
            "gap_after": 0.14,
            "vo": "من بي ديجيتال.. إي چي سكاوت كوتش برو، مدعوم بالـ AI.",
        },
        {
            "id": "b02_leagues_big5",
            "template": "lovio_multi_leagues",
            "flash": "مصر والدوريات الخمسة الكبرى",
            "pill": "تحديث حي بالـ AI لـ 6 دوريات كبرى",
            "clip": "ar_leagues",
            "gap_after": 0.14,
            "vo": "تحديث حي ومباشر للدوري المصري والدوريات الخمسة الكبرى: الإنجليزي والإسباني والألماني والإيطالي والفرنسي.",
        },
        {
            "id": "b03_ai_3421",
            "template": "lovio_prompt_live",
            "flash": "الـ AI يرسم الخطة لايف",
            "prompt": "ارسم خطة 3-4-2-1",
            "clip": "ar_ai_3421",
            "gap_after": 0.14,
            "vo": "الـ AI داخل في كل خطوة: اطلب منه يرسم لك خطة تلاتة أربعة اتنين واحد، ويرسمها فوراً بالباصات والمراكز.",
        },
        {
            "id": "b04_3phases_live",
            "template": "lovio_phases_live",
            "flash": "الاستحواذ · الهجوم · الدفاع",
            "phases": ["1. الاستحواذ والبناء", "2. الهجوم والاختراق", "3. قطع الكرة والدفاع"],
            "clip": "ar_3phases",
            "gap_after": 0.14,
            "vo": "وشوف اللعيبة بتتحرك لايف قدامك وهي بتبدل بين الاستحواذ، والهجوم، وقطع الكرة والدفاع.",
        },
        {
            "id": "b05_formats_tools",
            "template": "lovio_formats_live",
            "badges": ["سبورات 5×5 → 11×11", "تعديل المراكز والأسماء", "التدريب وكشف المباراة"],
            "clip": "ar_formats_more",
            "gap_after": 0.16,
            "vo": "وكمان تتحكم في سبورات من خمسة لحد حداشر، وتعدّل مراكز وأسماء اللعيبة، مع برامج التدريب وكشف المباراة.",
        },
        {
            "id": "b06_video_alpha",
            "template": "lovio_alpha_live",
            "flash": "النسخة الكاملة · Alpha / Beta (قيد التطوير)",
            "features": ["تتبع اللاعبين والكرة بالـ AI", "رادار تكتيكي 2D", "تحليل التمرير والضغط", "وسم اللقطات تلقائياً"],
            "clip": "shared_video_alpha",
            "gap_after": 0.16,
            "vo": "أما النسخة الكاملة لتحليل الفيديو فهي نسخة ألفا وبيتا لسه شغالين عليها: فكرتها ترفع فيديو الماتش والـ AI يتتبع اللعيبة والكرة، يرسم رادار تو دي، يحسب ممرات التمرير والضغط، ويطلع لك اللقطات تلقائياً.",
        },
        {
            "id": "b07_outro",
            "template": "lovio_end_card",
            "headline": "EGY-SCOUT Coach Pro",
            "pill": "منصة ذكاء تكتيكي بالـ AI · bedigital",
            "clip": "",
            "gap_after": 0.35,
            "vo": "إي چي سكاوت كوتش برو من بي ديجيتال.. منصة ذكاء تكتيكي متكاملة.",
        },
    ],
    "en": [
        {
            "id": "b01_logo_intro",
            "template": "lovio_logo_reveal",
            "flash": "EGY-SCOUT Coach Pro",
            "pill": "Powered by AI · bedigital",
            "clip": "",
            "gap_after": 0.14,
            "vo": "By bedigital. Meet EGY-SCOUT Coach Pro, powered by AI.",
        },
        {
            "id": "b02_leagues_big5",
            "template": "lovio_multi_leagues",
            "flash": "Egypt & Europe's Big 5",
            "pill": "Live auto-synced football data",
            "clip": "en_leagues",
            "gap_after": 0.14,
            "vo": "Live auto-synced coverage for Egypt and Europe's Big Five: Premier League, LaLiga, Bundesliga, Serie A, and Ligue 1.",
        },
        {
            "id": "b03_ai_3421",
            "template": "lovio_prompt_live",
            "flash": "AI Draws Tactics Live",
            "prompt": "Draw 3-4-2-1",
            "clip": "en_ai_3421",
            "gap_after": 0.14,
            "vo": "AI runs at the core: ask it to draw a 3-4-2-1 shape, and watch passing lanes and player roles render live.",
        },
        {
            "id": "b04_3phases_live",
            "template": "lovio_phases_live",
            "flash": "Possession · Attack · Defense",
            "phases": ["1. In Possession", "2. Attacking", "3. Defense & Recovery"],
            "clip": "en_3phases",
            "gap_after": 0.14,
            "vo": "Watch every player glide smoothly across possession, attacking transitions, and defensive recovery.",
        },
        {
            "id": "b05_formats_tools",
            "template": "lovio_formats_live",
            "badges": ["5v5 → 11v11 Boards", "Editable Roles & Names", "Training & Matchday XI"],
            "clip": "en_formats_more",
            "gap_after": 0.16,
            "vo": "Switch boards from 5v5 to 11v11, edit player positions and names, manage training drills, and build matchday squads.",
        },
        {
            "id": "b06_video_alpha",
            "template": "lovio_alpha_live",
            "flash": "Full Video Studio · Alpha / Beta (In Development)",
            "features": ["AI Player & Ball Tracking", "Live 2D Tactical Radar", "Passing & Pressing Score", "Auto Moment Tagging"],
            "clip": "shared_video_alpha",
            "gap_after": 0.16,
            "vo": "And our Full Video Analysis Studio is an Alpha-Beta release still in active development: upload match footage and AI tracks players and the ball, generates a live 2D radar, scores passing and pressing momentum, and tags key moments.",
        },
        {
            "id": "b07_outro",
            "template": "lovio_end_card",
            "headline": "EGY-SCOUT Coach Pro",
            "pill": "Live AI Coaching Workspace · bedigital",
            "clip": "",
            "gap_after": 0.35,
            "vo": "EGY-SCOUT Coach Pro by bedigital. Live AI coaching.",
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
    vo_dir = ASSETS_ROOT / f"vo_v4_{lang}"
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
    raw_full = vo_dir / f"full_v4_{lang}_raw.wav"
    master_m4a = ASSETS_ROOT / f"vo_v4_{lang}_master.m4a"
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

    logos_verified = [
        item for item in LOGO_SHOWCASE if (LOGOS_DIR / item["file"]).is_file()
    ]
    manifest = {
        "lang": lang,
        "model_id": MODEL_ID,
        "tempo": TEMPO,
        "voice_id": voice_id,
        "total_duration_s": round(total_dur, 3),
        "audio_file": str(master_m4a),
        "logos_dir": str(LOGOS_DIR),
        "logos": logos_verified,
        "scenes": timeline,
    }
    manifest_path = ASSETS_ROOT / f"manifest_v4_{lang}.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[{lang.upper()}] Built v4 {MODEL_ID} ({TEMPO}x) VO: {master_m4a} ({total_dur:.2f}s / {len(timeline)} beats)")
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
