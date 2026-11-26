import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ASSETS_ROOT =
  "C:\\Users\\Abdullah_Yassen\\.gemini\\antigravity\\brain\\63f869d2-f74e-4708-9f2a-2f435628b8c8\\scratch\\video_assets";
const SCREENS_DIR = path.join(ASSETS_ROOT, "screens");
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

// Preload screenshots as base64 data URIs for instant zero-flicker frame injection
const screenCache = new Map();
function getScreenUri(filename) {
  if (!screenCache.has(filename)) {
    const buf = fs.readFileSync(path.join(SCREENS_DIR, filename));
    screenCache.set(filename, `data:image/png;base64,${buf.toString("base64")}`);
  }
  return screenCache.get(filename);
}

async function openChromeCdp(port) {
  const userDataDir = path.join(ASSETS_ROOT, `chrome_render_${port}`);
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
  await sleep(1800);
  return { proc, ws, send };
}

async function renderOneVideo(lang, cdpPort) {
  const manifestPath = path.join(ASSETS_ROOT, `manifest_${lang}.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const scenes = manifest.scenes;
  const totalDur = manifest.total_duration_s;
  const totalFrames = Math.ceil(totalDur * FPS);
  const outMp4 = path.join(OUT_DIR, `EGY_SCOUT_Coach_Pro_${lang.toUpperCase()}.mp4`);

  console.log(`[${lang.toUpperCase()}] Rendering ${totalFrames} frames (${totalDur.toFixed(2)}s @ ${FPS}fps) -> ${outMp4}`);

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
    const compoundScreens = {
      ar: {
        s6_training_director: "ar_05_director.png",
        s7_admin_live: "ar_07_live_hub.png",
        s8_ai_and_beta: "shared_09_beta_studio.png",
      },
      en: {
        s5_training_director: "en_05_director.png",
        s6_admin_live: "en_07_live_hub.png",
        s7_ai_beta: "shared_09_beta_studio.png",
      },
    };
    for (let f = 0; f < totalFrames; f++) {
      const t = f / FPS;
      while (curIdx < scenes.length - 1 && t >= scenes[curIdx].start_s + scenes[curIdx].duration_s) {
        curIdx++;
      }
      const sc = scenes[curIdx];
      const localTime = Math.max(0, t - sc.start_s);
      const altScr = compoundScreens[lang]?.[sc.id];
      const activeScreen = altScr && localTime >= sc.duration_s * 0.52 ? altScr : sc.screen;
      const imgUri = getScreenUri(activeScreen);

      await send("Runtime.evaluate", {
        expression: `window.renderFrame(${JSON.stringify({
          lang,
          sceneIdx: curIdx,
          totalScenes: scenes.length,
          scene: sc,
          localTime,
          globalProgress: t / totalDur,
          imgDataUri: imgUri,
        })})`,
        awaitPromise: true,
      });

      const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 92 });
      const buf = Buffer.from(shot.data, "base64");
      if (!ff.stdin.write(buf)) {
        await new Promise((res) => ff.stdin.once("drain", res));
      }

      if (f % 150 === 0 || f === totalFrames - 1) {
        console.log(`[${lang.toUpperCase()}] frame ${f + 1}/${totalFrames} (scene ${sc.id})`);
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
  // Arabic video first (Priority #1), then English video (#2)
  await renderOneVideo("ar", 9340);
  await renderOneVideo("en", 9341);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
