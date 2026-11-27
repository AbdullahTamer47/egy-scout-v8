/**
 * Record REAL LIVE interactive UI bursts from the running EGY-SCOUT web app (127.0.0.1:3000)
 * at 15 fps via Chrome CDP so the explainer video shows real live interactions:
 *   1. Multi-league switching (Egypt, Premier League, LaLiga, CAF CL) + Onboarding
 *   2. Command Center live formation swap + starter Player Detail modal click
 *   3. LIVE AI typing ("ارسم خطة 3-4-2-1 ألونسو" / "Draw 3-4-2-1 Alonso plan") -> live 3-4-2-1 pitch & passes
 *   4. LIVE switching across ALL 3 tactical phases (Possession -> Attack -> Defense) + smooth 3-phase morph
 *   5. 5x5 -> 7x7 -> 11x11 multi-format + live slot role edit + Training animated drill + Admin 1-click swap
 *   6. Full Video Analysis Studio (Alpha/Beta at /) playing real match video + AR rings, spotlight, 3D arrow & radar
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CLIPS_ROOT =
  "C:\\Users\\Abdullah_Yassen\\.gemini\\antigravity\\brain\\63f869d2-f74e-4708-9f2a-2f435628b8c8\\scratch\\video_assets\\clips_v3";
fs.mkdirSync(CLIPS_ROOT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAPTURE_FPS = 15;
const STEP_MS = 1000 / CAPTURE_FPS;

async function createCdp() {
  const userDataDir = path.join(CLIPS_ROOT, "..", "chrome_profile_live_v3");
  fs.mkdirSync(userDataDir, { recursive: true });
  const proc = spawn(
    CHROME_PATH,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--autoplay-policy=no-user-gesture-required",
      "--remote-debugging-port=9338",
      `--user-data-dir=${userDataDir}`,
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let wsUrl = "";
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch("http://127.0.0.1:9338/json/list");
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await sleep(250);
  }
  if (!wsUrl) throw new Error("Chrome CDP 9338 not ready");

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

async function waitForSelector(evalJs, sel, maxWaitMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const ok = await evalJs(`Boolean(document.querySelector(${JSON.stringify(sel)}))`);
    if (ok) return true;
    await sleep(180);
  }
  return false;
}

async function waitForText(evalJs, substr, maxWaitMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const ok = await evalJs(`document.body.innerText.includes(${JSON.stringify(substr)})`);
    if (ok) return true;
    await sleep(180);
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
  return { clipKey, frameCount, fps: CAPTURE_FPS };
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

  // Ensure /coach is loaded & onboarded cleanly with Al Ahly vs Zamalek
  await send("Page.navigate", { url: "http://127.0.0.1:3000/coach" });
  await waitForSelector(evalJs, "#coach-name-input, aside nav button", 10000);
  await sleep(600);

  // Switch language to target lang if needed
  const currentIsAr = await evalJs(`document.documentElement.lang === "ar" || document.body.innerText.includes("لوحة القيادة") || document.body.innerText.includes("بوابة")`);
  if (isAr && !currentIsAr) {
    await clickByText(evalJs, "عربي");
    await sleep(900);
  } else if (!isAr && currentIsAr) {
    await clickByText(evalJs, "EN");
    await sleep(900);
  }

  // If onboarding gate open, fill Abdullah Yassin and submit
  const hasGate = await evalJs(`Boolean(document.querySelector("#coach-name-input"))`);
  if (hasGate) {
    await setReactInput(evalJs, "#coach-name-input", isAr ? "عبدالله ياسين" : "Abdullah Yassin");
    await sleep(300);
    await evalJs(`document.querySelector("form")?.requestSubmit()`);
    await waitForSelector(evalJs, "aside nav button", 10000);
    await sleep(1200);
  } else {
    await waitForSelector(evalJs, "aside nav button", 10000);
    await sleep(500);
  }

  // 1. LIVE Multi-League Switcher (Egypt -> Premier League -> LaLiga -> CAF CL)
  await clickNavTab(evalJs, isAr ? "الدوريات الحية" : "Live Hub");
  await waitForText(evalJs, isAr ? "المصري" : "Standings", 6000);
  await sleep(700);
  results[`${prefix}_leagues`] = await recordBurst(send, `${prefix}_leagues`, async () => {
    await sleep(800);
    await clickByText(evalJs, isAr ? "الإنجليزي" : "Premier League");
    await sleep(1100);
    await clickByText(evalJs, isAr ? "الإسباني" : "LaLiga");
    await sleep(1100);
    await clickByText(evalJs, isAr ? "أبطال إفريقيا" : "CAF CL");
    await sleep(1100);
    await clickByText(evalJs, isAr ? "الدوري المصري" : "Egypt EPL");
    await sleep(800);
  });

  // 2. LIVE Command Center: change formation select live + open starter Player Modal
  await clickNavTab(evalJs, isAr ? "لوحة القيادة" : "Command");
  await waitForText(evalJs, isAr ? "التشكيل الأساسي" : "Fit Starting XI", 6000);
  await sleep(700);
  // Reset formation to 4-2-3-1 first cleanly so live change to 4-3-3 and then AI 3-4-2-1 is visible!
  await evalJs(`(() => {
    const sel = document.querySelector('select[aria-label*="Formation"], select[aria-label*="التشكيل"]');
    if (sel) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      setter.call(sel, "4-2-3-1");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  })()`);
  await sleep(900);

  results[`${prefix}_command`] = await recordBurst(send, `${prefix}_command`, async () => {
    await sleep(600);
    await evalJs(`(() => {
      const sel = document.querySelector('select[aria-label*="Formation"], select[aria-label*="التشكيل"]');
      if (sel) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
        setter.call(sel, "4-3-3");
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    })()`);
    await sleep(1300);
    await evalJs(`(() => {
      const btns = [...document.querySelectorAll("button")].filter(b => !b.disabled && b.querySelector("span"));
      const target = btns.find(b => /^(ST|AM|RW|LW|CM)$/.test((b.querySelector("span")?.textContent || "").trim()));
      target?.click();
    })()`);
    await sleep(1700);
    await evalJs(`document.querySelector('[aria-label="Close"]')?.click()`);
    await sleep(400);
  });

  // 3. LIVE AI Prompt Typing "ارسم خطة 3-4-2-1 ألونسو" -> Live Pitch Rendering with Passes!
  await clickNavTab(evalJs, isAr ? "الخطط والتكتيك" : "Tactics");
  await waitForText(evalJs, isAr ? "في حالة الاستحواذ" : "In Possession", 6000);
  await sleep(700);
  const promptText = isAr ? "ارسم خطة 3-4-2-1 ألونسو" : "Draw 3-4-2-1 Alonso plan";
  results[`${prefix}_ai_3421`] = await recordBurst(send, `${prefix}_ai_3421`, async () => {
    await sleep(450);
    await typeIntoSelector(evalJs, 'header input[type="text"]', promptText, 55);
    await sleep(300);
    await clickByText(evalJs, isAr ? "تنفيذ بالـ AI" : "Run AI");
    // Wait live as backend returns & 3-4-2-1 renders onto canvas with passing arrows
    for (let k = 0; k < 28; k++) {
      await sleep(160);
      const ok = await evalJs(`document.body.innerText.includes("3-4-2-1") && !document.querySelector('header button[type="submit"]')?.disabled`);
      if (ok && k > 8) break;
    }
    await sleep(1600);
  });

  // 4. LIVE 3-Phase Switching on 3-4-2-1 (Possession -> Attack -> Defense + Smooth Morph Playback)
  results[`${prefix}_3phases`] = await recordBurst(send, `${prefix}_3phases`, async () => {
    await clickByText(evalJs, isAr ? "1. في حالة الاستحواذ" : "1. In Possession");
    await sleep(1300);
    await clickByText(evalJs, isAr ? "2. في حالة الهجوم" : "2. Attacking");
    await sleep(1500);
    await clickByText(evalJs, isAr ? "3. قطع الكرة والدفاع" : "3. Defense & Recovery");
    await sleep(1500);
    await clickByText(evalJs, isAr ? "عرض تحول الحالات الـ 3" : "Animate 3 Phases");
    await sleep(2200);
    await clickByText(evalJs, isAr ? "إيقاف التحول" : "Stop Motion");
    await clickByText(evalJs, isAr ? "1. في حالة الاستحواذ" : "1. In Possession");
    await sleep(300);
  });

  // 5. LIVE Multi-Format (5x5 -> 7x7 -> 11x11) + Editable Role + Training & Admin Swap
  results[`${prefix}_formats_edit`] = await recordBurst(send, `${prefix}_formats_edit`, async () => {
    await clickByText(evalJs, "5×5");
    await sleep(1000);
    await clickByText(evalJs, isAr ? "شبكة المساحات" : "5-Channels Grid");
    await sleep(800);
    await clickByText(evalJs, "7×7");
    await sleep(1000);
    await clickByText(evalJs, "11×11");
    await sleep(700);
    await clickByText(evalJs, isAr ? "شبكة المساحات" : "5-Channels Grid");
    await sleep(200);
    await clickNavTab(evalJs, isAr ? "التدريب والأحمال" : "Training");
    await sleep(1400);
    await clickNavTab(evalJs, isAr ? "الإداري وكشف المباراة" : "Admin & XI");
    await sleep(1400);
  });

  return results;
}

async function captureVideoAlphaBeta(send, evalJs) {
  await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
  await sleep(3200);

  // Switch to m2_ahly_enppi if not active and let video buffer cleanly
  await evalJs(`(() => {
    const vid = document.querySelector("video");
    if (vid) {
      try { vid.currentTime = 4.0; vid.play().catch(()=>{}); } catch {}
    }
  })()`);
  await sleep(1200);

  const meta = await recordBurst(send, "shared_video_alpha", async () => {
    await sleep(800);
    // Toggle AR telestrator tools live over playing match video + 2D tactical twin radar
    await clickByText(evalJs, "Spotlight");
    await sleep(1100);
    await clickByText(evalJs, "3D Arrow");
    await sleep(1100);
    await clickByText(evalJs, "Zone");
    await sleep(1100);
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
    console.log("ALL LIVE CLIPS SAVED:", Object.keys(manifest.clips).join(", "));
  } finally {
    ws.close();
    proc.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
