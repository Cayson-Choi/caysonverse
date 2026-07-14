// Task 13 local PRODUCTION verification: bare `npm start` serves the SPA end-to-end.
//
// Unlike task-05..11 (which run the CLIENT on the Vite dev server :5173 and use the
// dev-only window.__cv hook), this script exercises the PRODUCTION path exactly as
// Railway will: it runs the BUILT server bundle (server/dist/index.cjs — what
// `npm start` runs) with NO NODE_ENV set, and the browser talks to that ONE origin.
// The production client bundle has NO window.__cv (it is behind import.meta.env.DEV),
// so every assertion here is HTTP- or DOM-based, not __cv-based.
//
//   Phase 1 (default PORT 2567):
//     - GET /healthz  → {"ok":true}
//     - GET /         → built SPA HTML (has <div id="root"> + hashed asset script)
//     - GET /deep/spa/route → SPA fallback returns the same index.html (200)
//     - Browser: entry screen renders (SPA served) → join tab A + tab B (same origin,
//       WebSocket to window.location.origin) → walk A (render responds) → B sends a
//       chat message → tab A's chat log shows it (same-origin multiplayer round-trip).
//     - No uncaught JS errors.
//
//   Phase 2 (PORT=8080):
//     - Restart the bundle on :8080 → GET /healthz + / OK, entry screen renders.
//       Proves the injected-PORT path (Railway injects PORT) works on the same bundle.
//
// PREREQUISITE: `npm run build` (server/dist/index.cjs + client/dist) must exist.
// Evidence + assertions.json → .superpowers/sdd/evidence/task-13/. Exit 0 = pass.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const SERVER_ENTRY = join(REPO, "server", "dist", "index.cjs");
const CLIENT_INDEX = join(REPO, "client", "dist", "index.html");
const EVIDENCE = join(REPO, ".superpowers", "sdd", "evidence", "task-13");
mkdirSync(EVIDENCE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });

// ─────────────────────────── server process control ───────────────────────────
let serverProc = null;

async function healthOk(port) {
  try {
    const res = await fetch(`http://localhost:${port}/healthz`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitHealth(port, want, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await healthOk(port)) === want) return true;
    await sleep(300);
  }
  return false;
}

/**
 * Start the BUILT bundle exactly as `npm start` does (node server/dist/index.cjs),
 * with a DELIBERATELY clean env: NODE_ENV and VITE_SERVER_URL removed so we prove
 * the static-serving gate no longer depends on NODE_ENV (task2-m1 closed).
 */
function startServer(port) {
  const env = { ...process.env, PORT: String(port) };
  delete env.NODE_ENV; // bare start sets no NODE_ENV — the whole point of the fix
  delete env.VITE_SERVER_URL; // client must fall back to window.location.origin
  serverProc = spawn("node", [SERVER_ENTRY], { cwd: REPO, env, stdio: "ignore" });
  serverProc.on("error", (e) => console.error("server spawn error:", e.message));
}

async function stopServer(port) {
  if (!serverProc) return;
  const p = serverProc;
  serverProc = null;
  try {
    p.kill("SIGKILL");
  } catch {
    /* already gone */
  }
  await waitHealth(port, false, 8000);
  await sleep(700); // let the OS release the port before a restart
}

// ─────────────────────────── browser helpers ───────────────────────────
function watchErrors(page, tag) {
  const pageErrors = [];
  const netNoise = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/ERR_CONNECTION|Failed to load resource|net::|WebSocket|matchmake|ECONNREFUSED|reconnect|fetch/i.test(text)) {
      netNoise.push(`[${tag}] ${text}`);
    } else {
      pageErrors.push(`[${tag}] console.error: ${text}`);
    }
  });
  page.on("pageerror", (err) => pageErrors.push(`[${tag}] pageerror: ${err.message}`));
  return { pageErrors, netNoise };
}

async function joinAs(page, origin, { nickname, characterLabel, tintIndex }) {
  await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
  await page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator("input.cv-input").first().fill(nickname);
  await page.locator(".cv-character", { hasText: characterLabel }).click();
  await page.getByLabel(`색상 ${tintIndex + 1}`).click();
  await page.locator(".cv-submit").click();
  // Canvas appears once the room is joined (R3F scene mounts).
  await page.locator("canvas").waitFor({ state: "visible", timeout: 45000 });
  await sleep(700);
}

async function sendChat(page, text) {
  const field = page.locator(".cv-chat-field");
  await field.click();
  await field.fill(text);
  await field.press("Enter");
}

async function pollRows(page, needle, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await page.locator(".cv-chat-row").allTextContents();
    if (rows.some((t) => t.includes(needle))) return rows;
    await sleep(200);
  }
  return page.locator(".cv-chat-row").allTextContents();
}

async function main() {
  const failures = [];
  const log = {};

  if (!existsSync(SERVER_ENTRY) || !existsSync(CLIENT_INDEX)) {
    console.error("Build missing. Run `npm run build` first (need server/dist + client/dist).");
    process.exit(1);
  }

  // ─────────────── Phase 1: default PORT 2567, full functional pass ───────────────
  const PORT1 = 2567;
  const ORIGIN1 = `http://localhost:${PORT1}`;
  await stopServer(PORT1);
  startServer(PORT1);
  if (!(await waitHealth(PORT1, true))) {
    console.error(`bare start failed to serve on :${PORT1}`);
    process.exit(1);
  }

  // HTTP-level assertions (no browser): healthz + SPA served + SPA fallback.
  try {
    const health = await (await fetch(`${ORIGIN1}/healthz`)).json();
    log.healthz = health;
    if (!health || health.ok !== true) failures.push(`/healthz not ok: ${JSON.stringify(health)}`);

    const rootRes = await fetch(`${ORIGIN1}/`);
    const rootHtml = await rootRes.text();
    log.rootStatus = rootRes.status;
    log.rootHasRoot = rootHtml.includes('id="root"');
    log.rootHasAsset = /\/assets\/index-.*\.js/.test(rootHtml);
    if (rootRes.status !== 200) failures.push(`GET / status ${rootRes.status}`);
    if (!log.rootHasRoot) failures.push("GET / did not return the built SPA (no #root)");
    if (!log.rootHasAsset) failures.push("GET / missing hashed asset script (not a real build)");

    // SPA fallback: an arbitrary deep client route returns index.html, not 404.
    const deepRes = await fetch(`${ORIGIN1}/deep/spa/route`);
    const deepHtml = await deepRes.text();
    log.spaFallback = deepRes.status === 200 && deepHtml.includes('id="root"');
    if (!log.spaFallback) failures.push(`SPA fallback failed (status ${deepRes.status})`);
  } catch (e) {
    failures.push(`HTTP assertions threw: ${e.message}`);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const errs = [];
  try {
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    errs.push(watchErrors(pageA, "tabA"));
    errs.push(watchErrors(pageB, "tabB"));

    // Entry screen renders from the server-served SPA (before joining).
    await pageA.goto(ORIGIN1 + "/", { waitUntil: "domcontentloaded" });
    await pageA.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 20000 });
    await shot(pageA, "01-entry-screen.png");

    // Join both tabs against the SAME origin (WebSocket → window.location.origin).
    await joinAs(pageA, ORIGIN1, { nickname: "가나다", characterLabel: "기사", tintIndex: 1 });
    await shot(pageA, "02-joined-tabA.png");
    await joinAs(pageB, ORIGIN1, { nickname: "라마바", characterLabel: "마법사", tintIndex: 2 });

    // Walk: focus the canvas and hold W. Frozen render ⇒ identical frames ⇒ fail.
    await pageA.locator("canvas").click();
    const before = await pageA.locator("canvas").screenshot();
    await shot(pageA, "03-before-walk-tabA.png");
    await pageA.keyboard.down("w");
    await sleep(900);
    await pageA.keyboard.up("w");
    await sleep(300);
    const after = await pageA.locator("canvas").screenshot();
    await shot(pageA, "04-after-walk-tabA.png");
    log.walkFramesDiffer = !before.equals(after);
    if (!log.walkFramesDiffer) failures.push("walk: canvas render did not change (frozen?)");

    // Chat round-trip over the same-origin WebSocket: B sends → A's log shows it.
    const MSG = "안녕하세요 프로덕션";
    await sendChat(pageB, MSG);
    const rowsA = await pollRows(pageA, MSG, 8000);
    log.chatRowInA = rowsA.find((t) => t.includes(MSG)) ?? null;
    if (!rowsA.some((t) => t.includes(MSG))) {
      failures.push(`chat: tab A never received B's message. rows=${JSON.stringify(rowsA)}`);
    }
    await shot(pageA, "05-chat-received-tabA.png");

    const pageErrors = errs.flatMap((e) => e.pageErrors);
    log.pageErrors = pageErrors;
    log.netNoiseCount = errs.flatMap((e) => e.netNoise).length;
    if (pageErrors.length) failures.push(`uncaught JS errors:\n  ${pageErrors.join("\n  ")}`);

    // ─────────────── Phase 2: PORT=8080 (Railway injects PORT) ───────────────
    await stopServer(PORT1);
    const PORT2 = 8080;
    const ORIGIN2 = `http://localhost:${PORT2}`;
    startServer(PORT2);
    if (!(await waitHealth(PORT2, true))) failures.push(`PORT=8080 start did not serve /healthz`);
    try {
      const h2 = await (await fetch(`${ORIGIN2}/healthz`)).json();
      log.healthz8080 = h2;
      if (!h2 || h2.ok !== true) failures.push(`:8080 /healthz not ok`);
      const r2 = await fetch(`${ORIGIN2}/`);
      const html2 = await r2.text();
      log.root8080Ok = r2.status === 200 && html2.includes('id="root"');
      if (!log.root8080Ok) failures.push(`:8080 GET / did not serve the SPA`);
    } catch (e) {
      failures.push(`:8080 HTTP assertions threw: ${e.message}`);
    }
    const pageC = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await pageC.goto(ORIGIN2 + "/", { waitUntil: "domcontentloaded" });
    await pageC.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 20000 });
    await shot(pageC, "06-port8080-entry-screen.png");
  } catch (err) {
    failures.push(`exception: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  } finally {
    log.failures = failures;
    writeFileSync(join(EVIDENCE, "assertions.json"), JSON.stringify(log, null, 2));
    await browser.close();
    await stopServer(8080);
  }

  console.log("healthz (want {ok:true}):", JSON.stringify(log.healthz));
  console.log("GET / served SPA (want true):", log.rootHasRoot, "asset:", log.rootHasAsset);
  console.log("SPA fallback (want true):", log.spaFallback);
  console.log("walk frames differ (want true):", log.walkFramesDiffer);
  console.log("chat row in A (want the message):", JSON.stringify(log.chatRowInA));
  console.log("PORT=8080 healthz + SPA (want true):", log.root8080Ok);
  console.log("uncaught JS errors (want 0):", log.pageErrors ? log.pageErrors.length : "n/a");
  if (failures.length) {
    console.error("\nLOCAL PROD VERIFICATION FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nLOCAL PROD VERIFICATION PASSED — bare `npm start` serves the SPA; join+walk+chat work same-origin; PORT injection works.");
}

main();
