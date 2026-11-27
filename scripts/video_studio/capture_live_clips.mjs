/**
 * Record REAL LIVE interactive UI bursts from the running EGY-SCOUT web app (127.0.0.1:3000)
 * at 15 fps via Chrome CDP, stored strictly on D:\egy-scout-data\video_studio_tmp\clips_v4:
 *   1. Big 5 European Leagues + Egypt EPL (real official HD logos in tabs)
 *   2. LIVE AI prompt typing ("ارسم خطة 3-4-2-1" / "Draw 3-4-2-1" — zero coach names) -> live 3-4-2-1 pitch & passes
 *   3. IDENTICAL 3-Phase Live Switching + 3.5s smooth player morphing in BOTH AR & EN (verified by frame-diff check)
 *   4. Multi-format (5x5 -> 7x7 -> 11x11) + Command starter Player Modal + Training & Admin
 *   5. Full Video Analysis Studio (Alpha/Beta at /) playing real match footage + Spotlight, 3D Arrow, Zone, Ghost & 2D Radar
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const TMP_ROOT = "D:\\egy-scout-data\\video_studio_tmp";
const CLIPS_ROOT = path.join(TMP_ROOT, "clips_v4");
fs.mkdirSync(CLIPS_ROOT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAPTURE_FPS = 15;
const STEP_MS = 1000 / CAPTURE_FPS;

async function createCdp() {
  const userDataDir = path.join(TMP_ROOT, "chrome_profile_live_v4");
  fs.mkdirSync(userDataDir, { recursive: true });
  const proc = spawn(
    CHROME_PATH,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--autoplay-policy=no-user-gesture-required",
      "--remote-debugging-port=9348",
      `--user-data-dir=${userDataDir}`,
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let wsUrl = "";
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch("http://127.0.0.1:9348/json/list");
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await sleep(250);
  }
  if (!wsUrl) throw new Error("Chrome CDP 9348 not ready");

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
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return r?.result?.value;
  };

  return { proc, ws, send, evalJs };
}

async function clickByText(evalJs, substr) {
  return evalJs(`(() => {
    const btns = [...document.querySelectorAll("button, a")];
    const target = btns.find(b => (b.innerText || "").includes(${JSON.stringify(substr)}));
    if (target) { target.click(); return true; }
    return false;
  })()`);
}

async function clickNavTab(evalJs, substr) {
  return evalJs(`(() => {
    const btns = [...document.querySelectorAll("aside nav button")];
    const target = btns.find(b => (b.innerText || "").includes(${JSON.stringify(substr)}));
    if (target) { target.click(); return true; }
    return false;
  })()`);
}

async function waitForSelector(evalJs, sel, maxWaitMs = 9000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const ok = await evalJs(`Boolean(document.querySelector(${JSON.stringify(sel)}))`);
    if (ok) return true;
    await sleep(160);
  }
  return false;
}

async function waitForText(evalJs, substr, maxWaitMs = 9000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const ok = await evalJs(`document.body.innerText.includes(${JSON.stringify(substr)})`);
    if (ok) return true;
    await sleep(160);
  }
  return false;
}

async function recordBurst(send, clipKey, actionFn) {
  const dir = path.join(CLIPS_ROOT, clipKey);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  let recording = true;
  let frameCount = 0;

  const loopPromise = (async () => {
    while (recording) {
      const t0 = Date.now();
      try {
        const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 90 });
        frameCount++;
        const fn = `f_${String(frameCount).padStart(4, "0")}.jpg`;
        fs.writeFileSync(path.join(dir, fn), Buffer.from(shot.data, "base64"));
      } catch {
        break;
      }
      const elapsed = Date.now() - t0;
      if (elapsed < STEP_MS) await sleep(STEP_MS - elapsed);
    }
  })();

  try {
    await actionFn();
  } finally {
    recording = false;
    await loopPromise;
  }
  console.log(`[CLIP] ${clipKey} -> ${frameCount} frames (${(frameCount / CAPTURE_FPS).toFixed(2)}s @ ${CAPTURE_FPS}fps)`);
  return { clipKey, frameCount, fps: CAPTURE_FPS, dir };
}

function countFrameTransitions(dir, startFraction = 0.4) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
  if (files.length < 4) return 0;
  const startIdx = Math.floor(files.length * startFraction);
  let prevHash = "";
  let diffs = 0;
  for (let i = startIdx; i < files.length; i++) {
    const h = crypto.createHash("sha1").update(fs.readFileSync(path.join(dir, files[i]))).digest("hex");
    if (prevHash && h !== prevHash) diffs++;
    prevHash = h;
  }
  return diffs;
}

async function setReactInput(evalJs, selector, value) {
  return evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
}

async function typeIntoSelector(evalJs, selector, fullText, charDelayMs = 45) {
  for (let i = 1; i <= fullText.length; i++) {
    await setReactInput(evalJs, selector, fullText.slice(0, i));
    await sleep(charDelayMs);
  }
}

async function captureCoachLang(send, evalJs, lang) {
  const isAr = lang === "ar";
  const prefix = lang;
  const results = {};

  await send("Page.navigate", { url: "http://127.0.0.1:3000/coach" });
  await waitForSelector(evalJs, "#coach-name-input, aside nav button", 10000);
  await sleep(600);

  const currentIsAr = await evalJs(
    `document.documentElement.lang === "ar" || document.body.innerText.includes("لوحة القيادة") || document.body.innerText.includes("بوابة")`
  );
  if (isAr && !currentIsAr) {
    await clickByText(evalJs, "عربي");
    await sleep(900);
  } else if (!isAr && currentIsAr) {
    await clickByText(evalJs, "EN");
    await sleep(900);
  }

  const hasGate = await evalJs(`Boolean(document.querySelector("#coach-name-input"))`);
  if (hasGate) {
    await setReactInput(evalJs, "#coach-name-input", isAr ? "عبدالله ياسين" : "Abdullah Yassin");
    await sleep(300);
    await evalJs(`document.querySelector("form")?.requestSubmit()`);
    await waitForSelector(evalJs, "aside nav button", 10000);
    await sleep(1100);
  } else {
    await waitForSelector(evalJs, "aside nav button", 10000);
    await sleep(500);
  }

  // 1. LIVE Multi-League Switcher: Egypt EPL + All Big 5 European Leagues
  await clickNavTab(evalJs, isAr ? "الدوريات الحية" : "Live Hub");
  await waitForText(evalJs, isAr ? "المصري" : "Standings", 6000);
  await sleep(650);
  results[`${prefix}_leagues`] = await recordBurst(send, `${prefix}_leagues`, async () => {
    await sleep(650);
    await clickByText(evalJs, isAr ? "الإنجليزي" : "Premier League");
    await sleep(800);
    await clickByText(evalJs, isAr ? "الإسباني" : "LaLiga");
    await sleep(800);
    await clickByText(evalJs, isAr ? "الألماني" : "Bundesliga");
    await sleep(800);
    await clickByText(evalJs, isAr ? "الإيطالي" : "Serie A");
    await sleep(800);
    await clickByText(evalJs, isAr ? "الفرنسي" : "Ligue 1");
    await sleep(950);
  });

  // 2. LIVE AI Prompt Typing "ارسم خطة 3-4-2-1" / "Draw 3-4-2-1" (NO coach names)
  await clickNavTab(evalJs, isAr ? "الخطط والتكتيك" : "Tactics");
  await waitForText(evalJs, isAr ? "في حالة الاستحواذ" : "In Possession", 6000);
  await sleep(650);
  const promptText = isAr ? "ارسم خطة 3-4-2-1" : "Draw 3-4-2-1";
  results[`${prefix}_ai_3421`] = await recordBurst(send, `${prefix}_ai_3421`, async () => {
    await sleep(400);
    await typeIntoSelector(evalJs, 'header input[type="text"]', promptText, 48);
    await sleep(260);
    await clickByText(evalJs, isAr ? "تنفيذ بالـ AI" : "Run AI");
    for (let k = 0; k < 28; k++) {
      await sleep(160);
      const ok = await evalJs(
        `document.body.innerText.includes("3-4-2-1") && !document.querySelector('header button[type="submit"]')?.disabled`
      );
      if (ok && k > 8) break;
    }
    await sleep(1800);
  });

  // 3. IDENTICAL LIVE 3-Phase Switching + 3.5s Continuous Smooth Morph in BOTH AR & EN
  results[`${prefix}_3phases`] = await recordBurst(send, `${prefix}_3phases`, async () => {
    await clickByText(evalJs, isAr ? "1. في حالة الاستحواذ" : "1. In Possession");
    await sleep(1000);
    await clickByText(evalJs, isAr ? "2. في حالة الهجوم" : "2. Attacking");
    await sleep(1200);
    await clickByText(evalJs, isAr ? "3. قطع الكرة والدفاع" : "3. Defense & Recovery");
    await sleep(1200);
    const clickedMorph = await clickByText(evalJs, isAr ? "عرض تحول الحالات الـ 3" : "Animate 3 Phases");
    if (!clickedMorph) {
      throw new Error(`[${prefix}] Failed to click 3-phase animate button!`);
    }
    await sleep(3500);
    await clickByText(evalJs, isAr ? "إيقاف التحول" : "Stop Motion");
    await clickByText(evalJs, isAr ? "1. في حالة الاستحواذ" : "1. In Possession");
    await sleep(250);
  });

  const morphTransitions = countFrameTransitions(results[`${prefix}_3phases`].dir, 0.45);
  console.log(`[ASSERT] ${prefix}_3phases morph frame transitions = ${morphTransitions}`);
  if (morphTransitions < 8) {
    throw new Error(`[${prefix}] 3-phase live morph produced only ${morphTransitions} frame transitions!`);
  }

  // 4. Multi-Format (5x5 -> 7x7 -> 11x11) + Editable Player Detail + Training & Admin
  results[`${prefix}_formats_more`] = await recordBurst(send, `${prefix}_formats_more`, async () => {
    await clickByText(evalJs, "5×5");
    await sleep(850);
    await clickByText(evalJs, "7×7");
    await sleep(850);
    await clickByText(evalJs, "11×11");
    await sleep(700);
    await clickNavTab(evalJs, isAr ? "لوحة القيادة" : "Command");
    await sleep(600);
    await evalJs(`(() => {
      const btns = [...document.querySelectorAll("button")].filter(b => !b.disabled && b.querySelector("span"));
      const target = btns.find(b => /^(ST|AM|RW|LW|CM)$/.test((b.querySelector("span")?.textContent || "").trim()));
      target?.click();
    })()`);
    await sleep(1250);
    await evalJs(`document.querySelector('[aria-label="Close"]')?.click()`);
    await sleep(350);
    await clickNavTab(evalJs, isAr ? "التدريب والأحمال" : "Training");
    await sleep(1100);
    await clickNavTab(evalJs, isAr ? "الإداري وكشف المباراة" : "Admin & XI");
    await sleep(1100);
  });

  return results;
}

async function captureVideoAlphaBeta(send, evalJs) {
  await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
  await sleep(3000);

  await evalJs(`(() => {
    const vid = document.querySelector("video");
    if (vid) {
      try { vid.currentTime = 4.0; vid.play().catch(()=>{}); } catch {}
    }
  })()`);
  await sleep(1100);

  const meta = await recordBurst(send, "shared_video_alpha", async () => {
    await sleep(850);
    await clickByText(evalJs, "Spotlight");
    await sleep(1150);
    await clickByText(evalJs, "3D Arrow");
    await sleep(1150);
    await clickByText(evalJs, "Zone");
    await sleep(1150);
    await clickByText(evalJs, "Ghost");
    await sleep(1200);
  });
  return { shared_video_alpha: meta };
}

async function main() {
  const { proc, ws, send, evalJs } = await createCdp();
  try {
    const ar = await captureCoachLang(send, evalJs, "ar");
    const en = await captureCoachLang(send, evalJs, "en");
    const shared = await captureVideoAlphaBeta(send, evalJs);

    const manifest = { fps: CAPTURE_FPS, clips: { ...ar, ...en, ...shared } };
    fs.writeFileSync(path.join(CLIPS_ROOT, "clips_meta.json"), JSON.stringify(manifest, null, 2));
    console.log("ALL V4 LIVE CLIPS SAVED:", Object.keys(manifest.clips).join(", "));
  } finally {
    ws.close();
    proc.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
