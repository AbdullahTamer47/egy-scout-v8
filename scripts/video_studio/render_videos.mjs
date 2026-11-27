import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ASSETS_ROOT = "D:\\egy-scout-data\\video_studio_tmp";
const CLIPS_ROOT = path.join(ASSETS_ROOT, "clips_v4");
const LOGOS_DIR = path.join(ASSETS_ROOT, "logos");
const OUT_DIR = "D:\\manger\\coach_pro_videos";
const STAGE_URL = "file:///D:/manger/scripts/video_studio/scene_stage.html";
const FPS = 30;

fs.mkdirSync(OUT_DIR, { recursive: true });

function findFfmpeg() {
  const candidates = [
    "D:\\manger\\egy-tactical-scout\\backend\\venv\\Lib\\site-packages\\imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v9.0.2.exe",
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("ffmpeg binary not found");
}

const FFMPEG = findFfmpeg();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clipIndexCache = new Map();
function getClipFrames(clipKey) {
  if (!clipKey) return [];
  if (!clipIndexCache.has(clipKey)) {
    const dir = path.join(CLIPS_ROOT, clipKey);
    const files = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort().map((f) => path.join(dir, f))
      : [];
    clipIndexCache.set(clipKey, files);
  }
  return clipIndexCache.get(clipKey);
}

const uriCache = new Map();
function loadFrameUri(filePath) {
  if (!filePath) return "";
  if (!uriCache.has(filePath)) {
    if (uriCache.size > 220) uriCache.clear();
    const buf = fs.readFileSync(filePath);
    uriCache.set(filePath, `data:image/jpeg;base64,${buf.toString("base64")}`);
  }
  return uriCache.get(filePath);
}

function loadLogoUris(logos) {
  const map = {};
  for (const item of logos || []) {
    const p = path.join(LOGOS_DIR, item.file);
    if (fs.existsSync(p)) {
      map[item.id] = `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
    }
  }
  return map;
}

async function openChromeCdp(port) {
  const userDataDir = path.join(ASSETS_ROOT, `chrome_render_v4_${port}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  const proc = spawn(
    CHROME_PATH,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--window-size=1920,1080",
      "--allow-file-access-from-files",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let wsUrl = "";
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await sleep(250);
  }
  if (!wsUrl) throw new Error(`Chrome CDP port ${port} did not become ready`);

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: STAGE_URL });
  await sleep(1600);
  await send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
  return { proc, ws, send };
}

async function renderOneVideo(lang, cdpPort) {
  const manifestPath = path.join(ASSETS_ROOT, `manifest_v4_${lang}.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const scenes = manifest.scenes;
  const totalDur = manifest.total_duration_s;
  const totalFrames = Math.ceil(totalDur * FPS);
  const logoUris = loadLogoUris(manifest.logos);
  const outMp4 = path.join(OUT_DIR, `EGY_SCOUT_Coach_Pro_${lang.toUpperCase()}.mp4`);

  console.log(
    `[${lang.toUpperCase()}] Rendering ${totalFrames} frames (${totalDur.toFixed(2)}s @ ${FPS}fps) -> ${outMp4}`
  );

  const { proc, ws, send } = await openChromeCdp(cdpPort);

  const ffArgs = [
    "-y",
    "-f",
    "image2pipe",
    "-vcodec",
    "mjpeg",
    "-r",
    String(FPS),
    "-i",
    "pipe:0",
    "-i",
    manifest.audio_file,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    outMp4,
  ];
  const ff = spawn(FFMPEG, ffArgs, { stdio: ["pipe", "inherit", "pipe"] });
  let ffErr = "";
  ff.stderr.on("data", (d) => {
    ffErr += d.toString();
  });

  try {
    let curIdx = 0;
    for (let f = 0; f < totalFrames; f++) {
      const t = f / FPS;
      while (curIdx < scenes.length - 1 && t >= scenes[curIdx].start_s + scenes[curIdx].duration_s) {
        curIdx++;
      }
      const sc = scenes[curIdx];
      const localTime = Math.max(0, t - sc.start_s);
      const frames = getClipFrames(sc.clip);
      let liveFrameDataUri = "";
      if (frames.length > 0) {
        const effTime =
          sc.template === "lovio_multi_leagues"
            ? Math.max(0, localTime - 2.0) / Math.max(0.5, sc.duration_s - 2.0)
            : sc.template === "lovio_prompt_live"
            ? Math.max(0, localTime - 1.25) / Math.max(0.5, sc.duration_s - 1.25)
            : sc.template === "lovio_phases_live"
            ? Math.max(0, localTime - 0.95) / Math.max(0.5, sc.duration_s - 0.95)
            : sc.template === "lovio_alpha_live"
            ? Math.max(0, localTime - 1.05) / Math.max(0.5, sc.duration_s - 1.05)
            : localTime / Math.max(0.5, sc.duration_s);
        const fIdx = Math.min(frames.length - 1, Math.floor(Math.max(0, Math.min(0.999, effTime)) * frames.length));
        liveFrameDataUri = loadFrameUri(frames[fIdx]);
      }

      await send("Runtime.evaluate", {
        expression: `window.renderFrame(${JSON.stringify({
          lang,
          scene: sc,
          logos: manifest.logos || [],
          logoUris: sc.template === "lovio_multi_leagues" ? logoUris : {},
          localTime,
          globalProgress: t / totalDur,
          liveFrameDataUri,
        })})`,
        awaitPromise: true,
      });

      const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 92 });
      const buf = Buffer.from(shot.data, "base64");
      if (!ff.stdin.write(buf)) {
        await new Promise((res) => ff.stdin.once("drain", res));
      }

      if (f % 180 === 0 || f === totalFrames - 1) {
        console.log(`[${lang.toUpperCase()}] frame ${f + 1}/${totalFrames} (${sc.id})`);
      }
    }

    ff.stdin.end();
    const exitCode = await new Promise((res) => ff.on("close", res));
    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited ${exitCode}: ${ffErr.slice(-500)}`);
    }
    console.log(`[${lang.toUpperCase()}] COMPLETED -> ${outMp4}`);
  } finally {
    ws.close();
    proc.kill();
  }
}

async function main() {
  await Promise.all([renderOneVideo("ar", 9350), renderOneVideo("en", 9351)]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
