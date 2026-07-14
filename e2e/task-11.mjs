// Task 11 E2E smoke: 안정성 — 재접속 + 정원 + 에러 UI.
//
// Standalone Playwright (same shape as task-05..10.mjs), but this one MANAGES the
// server process (dist/index.cjs) so it can kill and restart it — the Vite client
// on :5173 is left running externally throughout ("leave Vite up"). Two contexts
// = two tabs.
//
//   Scenario A — TRANSIENT drop (server stays up):
//     window.__cv.dropConnection() closes the transport with a non-consented code.
//     The server holds the seat (allowReconnection 20s) and the resilience driver
//     re-establishes the SAME session → same avatar, SAME position (getPos before
//     ≈ after). The "재연결 중..." overlay appears while it recovers.
//
//   Scenario B — SERVER KILL → RESTART (required evidence):
//     Kill the server → BOTH tabs show the "재연결 중..." overlay (screenshots) →
//     restart the server → within the retry budget both tabs land back in the
//     world as FRESH avatars that see each other again (screenshots). No uncaught
//     JS errors (network noise while the server is down is expected + classified).
//
// Evidence + assertions.json → .superpowers/sdd/evidence/task-11/. Exit 0 = pass.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const SERVER_PORT = Number(process.env.CV_SERVER_PORT || 2567);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const SERVER_ENTRY = join(REPO, "server", "dist", "index.cjs");
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-11");
mkdirSync(EVIDENCE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getRemotes = (page) => page.evaluate(() => window.__cv.getRemotes());
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ─────────────────────────── server process control ───────────────────────────
let serverProc = null;

async function healthOk() {
  try {
    const res = await fetch(`http://localhost:${SERVER_PORT}/healthz`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Wait until the server is up (want=true) or down/refused (want=false). */
async function waitHealth(want, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await healthOk()) === want) return true;
    await sleep(300);
  }
  return false;
}

function startServer() {
  serverProc = spawn("node", [SERVER_ENTRY], {
    cwd: REPO,
    env: { ...process.env, PORT: String(SERVER_PORT), NODE_ENV: "development" },
    stdio: "ignore",
  });
  serverProc.on("error", (e) => console.error("server spawn error:", e.message));
}

async function stopServer() {
  if (!serverProc) return;
  const p = serverProc;
  serverProc = null;
  try {
    p.kill("SIGKILL");
  } catch {
    /* already gone */
  }
  await waitHealth(false, 8000); // wait until the port stops answering
  await sleep(700); // let the OS release the port before a restart
}

// ─────────────────────────── browser helpers ───────────────────────────
function watchErrors(page, tag) {
  const pageErrors = []; // genuine uncaught JS — a real failure
  const netNoise = []; // resource/WS failures while the server is down — expected
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (
      /ERR_CONNECTION|Failed to load resource|net::|WebSocket|matchmake|ECONNREFUSED|reconnect|fetch/i.test(
        text,
      )
    ) {
      netNoise.push(`[${tag}] ${text}`);
    } else {
      pageErrors.push(`[${tag}] console.error: ${text}`);
    }
  });
  page.on("pageerror", (err) => pageErrors.push(`[${tag}] pageerror: ${err.message}`));
  return { pageErrors, netNoise };
}

async function fillEntry(page, { nickname, characterLabel, tintIndex }) {
  await page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator("input.cv-input").first().fill(nickname);
  await page.locator(".cv-character", { hasText: characterLabel }).click();
  await page.getByLabel(`색상 ${tintIndex + 1}`).click();
  await page.locator(".cv-submit").click();
}

async function joinAs(page, opts) {
  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
  await fillEntry(page, opts);
  await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, {
    timeout: 45000,
  });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 20000 });
  await sleep(500);
}

const waitOverlay = (page, visible, timeoutMs) =>
  page.locator(".cv-reconnecting").waitFor({
    state: visible ? "visible" : "hidden",
    timeout: timeoutMs,
  });

async function main() {
  const failures = [];
  const log = {};

  // Fresh server up before we start.
  await stopServer();
  startServer();
  if (!(await waitHealth(true))) {
    console.error("server failed to start on :" + SERVER_PORT);
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const errs = [];
  try {
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    errs.push(watchErrors(p1, "tab1"));
    errs.push(watchErrors(p2, "tab2"));

    // Two tabs joined; each sees the other.
    await joinAs(p1, { nickname: "가나다", characterLabel: "기사", tintIndex: 1 });
    await joinAs(p2, { nickname: "라마바", characterLabel: "마법사", tintIndex: 2 });
    await p1.waitForFunction(() => window.__cv.getRemotes().length >= 1, null, { timeout: 15000 });
    await p2.waitForFunction(() => window.__cv.getRemotes().length >= 1, null, { timeout: 15000 });
    await shot(p1, "01-joined-tab1.png");

    // ── Scenario A: transient drop → ghost on peers + SAME avatar within 20s ──
    const posBefore = await getPos(p1);
    // Block tab1's RECONNECT matchmake so it lingers in the reconnection window
    // (the server holds the seat, connected=false) long enough to observe both the
    // overlay and the peer ghost deterministically — instead of the sub-second
    // auto-recovery that is otherwise too fast to sample. Unblocked below to let
    // the SAME session re-establish (still inside the 20s window).
    await p1.route("**/matchmake/**", (route) => route.abort());
    await p1.evaluate(() => window.__cv.dropConnection());

    const [toastRes, ghostRes] = await Promise.allSettled([
      // tab1 shows the "재연결 중..." overlay (world frozen, input suspended).
      waitOverlay(p1, true, 6000),
      // tab2 sees tab1 at 50% opacity — its remote record flips connected=false
      // (ghost render end-to-end: state listen → remote store → material opacity).
      p2.waitForFunction(
        () => window.__cv.getRemotes().some((r) => r.connected === false),
        null,
        { timeout: 6000, polling: 100 },
      ),
    ]);
    const transientToast = toastRes.status === "fulfilled";
    const ghostObserved = ghostRes.status === "fulfilled";
    if (transientToast) await shot(p1, "02-transient-toast-tab1.png");
    if (ghostObserved) await shot(p2, "03-transient-ghost-tab2.png");
    log.ghostObserved = ghostObserved;
    if (!transientToast) failures.push("transient: reconnection overlay not shown");
    if (!ghostObserved) failures.push("transient: peer did not render the disconnected ghost");

    // Unblock → tab1 re-establishes the SAME session within the window.
    await p1.unroute("**/matchmake/**");
    await waitOverlay(p1, false, 25000); // recovered
    // The scene remounts on reconnect — wait for the dev hook to reinstall.
    await p1.waitForFunction(() => typeof window.__cv?.getPos === "function", null, {
      timeout: 15000,
    });
    await sleep(600);
    const posAfter = await getPos(p1);
    const drift = dist2(posBefore, posAfter);
    log.transient = { posBefore, posAfter, drift, toastSeen: transientToast };
    if (drift > 0.6) failures.push(`transient: same position not preserved (drift ${drift.toFixed(3)})`);
    // Ghost clears on tab2 (connected=true again); both see each other after remount.
    await p2.waitForFunction(() => window.__cv.getRemotes().every((r) => r.connected === true), null, {
      timeout: 15000,
    });
    await p1.waitForFunction(() => window.__cv.getRemotes().length >= 1, null, { timeout: 15000 });
    await shot(p1, "04-transient-recovered-tab1.png");

    // ── Scenario B: kill the server → both tabs toast → restart → fresh avatars ──
    await stopServer();
    await waitOverlay(p1, true, 15000);
    await waitOverlay(p2, true, 15000);
    log.bothToastOnServerDown = true;
    await shot(p1, "05-serverdown-toast-tab1.png");
    await shot(p2, "06-serverdown-toast-tab2.png");

    // Restart the server → both tabs recover as fresh joins within the budget.
    startServer();
    if (!(await waitHealth(true))) failures.push("server did not restart");
    await waitOverlay(p1, false, 45000);
    await waitOverlay(p2, false, 45000);
    await p1.waitForFunction(() => typeof window.__cv?.getPos === "function", null, {
      timeout: 20000,
    });
    await p2.waitForFunction(() => typeof window.__cv?.getPos === "function", null, {
      timeout: 20000,
    });
    await sleep(1500);
    // Back in the world together — fresh avatars see each other again.
    await p1.waitForFunction(() => window.__cv.getRemotes().length >= 1, null, { timeout: 20000 });
    await p2.waitForFunction(() => window.__cv.getRemotes().length >= 1, null, { timeout: 20000 });
    log.recovered = {
      tab1Pos: await getPos(p1),
      tab1Remotes: (await getRemotes(p1)).length,
      tab2Remotes: (await getRemotes(p2)).length,
    };
    await shot(p1, "07-recovered-tab1.png");
    await shot(p2, "08-recovered-tab2.png");

    // No uncaught JS errors (network noise during the outage is expected).
    const pageErrors = errs.flatMap((e) => e.pageErrors);
    const netNoise = errs.flatMap((e) => e.netNoise);
    log.pageErrors = pageErrors;
    log.netNoiseCount = netNoise.length;
    log.netNoiseSample = netNoise.slice(0, 6);
    if (pageErrors.length) failures.push(`uncaught JS errors:\n  ${pageErrors.join("\n  ")}`);
  } catch (err) {
    failures.push(`exception: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  } finally {
    log.failures = failures;
    writeFileSync(join(EVIDENCE, "assertions.json"), JSON.stringify(log, null, 2));
    await browser.close();
    await stopServer();
  }

  console.log("transient drift (want <=0.6):", log.transient && log.transient.drift?.toFixed(3));
  console.log("transient toast seen:", log.transient && log.transient.toastSeen);
  console.log("ghost observed on tab2 (connected=false, best-effort):", log.ghostObserved);
  console.log("both tabs toasted on server-down (want true):", log.bothToastOnServerDown);
  console.log(
    "recovered remotes (want >=1 each):",
    log.recovered && `tab1=${log.recovered.tab1Remotes} tab2=${log.recovered.tab2Remotes}`,
  );
  console.log("uncaught JS errors (want 0):", log.pageErrors ? log.pageErrors.length : "n/a");
  console.log("expected network noise while down:", log.netNoiseCount);
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log(
    "\nE2E PASSED — transient drop recovers the SAME avatar; server kill toasts both tabs; restart recovers both as fresh avatars.",
  );
}

main();
