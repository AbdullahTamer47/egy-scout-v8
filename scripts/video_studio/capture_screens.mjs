import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT_DIR = "C:\\Users\\Abdullah_Yassen\\.gemini\\antigravity\\brain\\63f869d2-f74e-4708-9f2a-2f435628b8c8\\scratch\\video_assets\\screens";
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createCdp() {
  const userDataDir = path.join(OUT_DIR, "..", "chrome_profile_cap");
  fs.mkdirSync(userDataDir, { recursive: true });
  const proc = spawn(
    CHROME_PATH,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--remote-debugging-port=9335",
      `--user-data-dir=${userDataDir}`,
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let wsUrl = "";
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch("http://127.0.0.1:9335/json/list");
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await sleep(250);
  }
  if (!wsUrl) throw new Error("Chrome CDP not ready");

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
    deviceScaleFactor: 2,
    mobile: false,
  });

  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return r?.result?.value;
  };

  const snap = async (filename) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(r.data, "base64"));
    console.log("[SNAP]", filename);
  };

  return { proc, ws, send, evalJs, snap };
}

async function clickByText(evalJs, substr) {
  return evalJs(`(() => {
    const btns = [...document.querySelectorAll("button, a")];
    const target = btns.find(b => (b.innerText || "").includes(${JSON.stringify(substr)}));
    if (target) { target.click(); return true; }
    return false;
  })()`);
}

async function main() {
  const { proc, ws, send, evalJs, snap } = await createCdp();
  try {
    await send("Page.navigate", { url: "http://127.0.0.1:3000/coach" });
    await sleep(3200);

    // Ensure English toggle is NOT active first -> AR screenshots
    await evalJs(`(() => {
      const inp = document.querySelector("#coach-name-input");
      if (inp) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(inp, "عبدالله ياسين");
        inp.dispatchEvent(new Event("input", { bubbles: true }));
      }
    })()`);
    const hasGate = await evalJs(`Boolean(document.querySelector("#coach-name-input"))`);
    if (hasGate) {
      await snap("ar_00_onboarding.png");
      await evalJs(`document.querySelector("form")?.requestSubmit()`);
      await sleep(2500);
    } else {
      await clickByText(evalJs, "تغيير المدرب / الفريق");
      await sleep(700);
      await snap("ar_00_onboarding.png");
      await clickByText(evalJs, "إلغاء والعودة");
      await sleep(600);
    }

    // 1. Command Center
    await clickByText(evalJs, "لوحة القيادة");
    await sleep(1600);
    await snap("ar_01_dashboard.png");

    // 2. Tactics 11v11
    await clickByText(evalJs, "الخطط والتكتيك");
    await sleep(1400);
    await snap("ar_02_tactics_11v11.png");

    // 3. Tactics 7v7 + Attacking phase
    await clickByText(evalJs, "7×7");
    await sleep(1100);
    await clickByText(evalJs, "2. في حالة الهجوم");
    await sleep(700);
    await snap("ar_03_tactics_7v7_attack.png");
    await clickByText(evalJs, "11×11");
    await sleep(900);
    await clickByText(evalJs, "1. في حالة الاستحواذ");
    await sleep(600);

    // 4. Training
    await clickByText(evalJs, "التدريب والأحمال");
    await sleep(1500);
    await snap("ar_04_training.png");

    // 5. Technical Director
    await clickByText(evalJs, "المدير الفني والكشاف");
    await sleep(1400);
    await snap("ar_05_director.png");

    // 6. Admin & 20-man sheet
    await clickByText(evalJs, "الإداري وكشف المباراة");
    await sleep(1200);
    await snap("ar_06_admin.png");

    // 7. Live 2026/27 Standings Hub
    await clickByText(evalJs, "الدوريات الحية");
    await sleep(1500);
    await snap("ar_07_live_hub.png");

    // 8. AI Copilot Slide-over over Tactics
    await clickByText(evalJs, "الخطط والتكتيك");
    await sleep(900);
    await clickByText(evalJs, "المساعد الذكي (AI)");
    await sleep(800);
    await snap("ar_08_ai_copilot.png");
    await evalJs(`document.querySelector('[aria-label="Close AI Copilot"]')?.click()`);
    await sleep(500);

    // Switch language to English for EN scenes
    await clickByText(evalJs, "EN");
    await sleep(1000);
    await clickByText(evalJs, "Command");
    await sleep(1400);
    await snap("en_01_dashboard.png");

    await clickByText(evalJs, "Tactics");
    await sleep(1300);
    await snap("en_02_tactics_11v11.png");

    await clickByText(evalJs, "7×7");
    await sleep(900);
    await clickByText(evalJs, "2. Attacking");
    await sleep(600);
    await snap("en_03_tactics_7v7.png");
    await clickByText(evalJs, "11×11");
    await sleep(700);

    await clickByText(evalJs, "Training");
    await sleep(1300);
    await snap("en_04_training.png");

    await clickByText(evalJs, "Director");
    await sleep(1300);
    await snap("en_05_director.png");

    await clickByText(evalJs, "Admin & XI");
    await sleep(1100);
    await snap("en_06_admin.png");

    await clickByText(evalJs, "Live Hub");
    await sleep(1300);
    await snap("en_07_live_hub.png");

    await clickByText(evalJs, "AI Copilot");
    await sleep(700);
    await snap("en_08_ai_copilot.png");
    await evalJs(`document.querySelector('[aria-label="Close AI Copilot"]')?.click()`);

    // 9. Full Video Studio Beta quick frame
    await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
    await sleep(2500);
    await snap("shared_09_beta_studio.png");
  } finally {
    ws.close();
    proc.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
