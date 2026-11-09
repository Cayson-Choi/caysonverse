// Character stage 3 final review (Important 2) E2E — a failed character.glb download never leaves a blank page.
//
// Standalone Playwright against the dev stack (server :2567, client :5173):
//   npm run dev
//   node e2e/task-char-glb-retry.mjs            # CV_CLIENT_URL=http://localhost:5173 by default
//
// Before the fix the loader cached the failed download as an error (suspend-react), the preview boundary only reset
// on a look change, and after 입장 the world's own avatar rethrew that cached error with nothing to catch it: React
// unmounted the root and left a blank page.
//
//   0  observer O enters normally (it watches who is in the world)
//   1  tab A: every character.glb request answers 503 → the preview shows the "다시 받아 오는 중" card, and the
//      boundary downloads again by itself (a 2nd request after ~1.5 s: the cached failure was cleared)
//   2  A presses 입장 while the model is failing → it downloads once more, then stays on the entry screen with
//      "캐릭터를 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요": no blank page, no error screen, not joined (O never sees A)
//   3  A keeps failing → after the 3 retries the card says "인터넷 연결을 확인한 뒤 입장하기를 눌러 주세요"
//   4  the GLB is unblocked → A presses 입장 → enters the world with its avatar; O sees A
//   5  tab C: every character.glb request waits 4 s and then answers 503; C presses 입장 at once (the model is still
//      downloading, so it joins) → the world's avatar load fails → the app error screen "문제가 생겼어요.
//      새로고침(F5)하면 다시 들어갈 수 있어요" with a 새로고침 button (not a blank page); C leaves the room, so O sees C
//      appear and then disappear; unblocked, 새로고침 reloads to the entry screen and C enters
//
// Evidence → .superpowers/sdd/evidence/task-char/ (glb-retry-*.png, assertions-glb-retry.json).
// Exit code 0 = every assertion passed and no unexpected console/page error (the deliberate 503s and the errors React
// logs for the boundaries that caught them are expected on tabs A and C only; O must stay clean).

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
// Task 14 (AI 학교 탈출): "/" opens the school entry now; the world is entered through its legacy link.
const ENTRY_URL = new URL("/?world=legacy", CLIENT_URL).href;
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const EVIDENCE = join(REPO, ".superpowers", "sdd", "evidence", "task-char");
mkdirSync(EVIDENCE, { recursive: true });

const VIEW = { width: 1280, height: 800 };
/** Per-run nicknames: a tab of an earlier run may still hold its seat for the 20 s reconnection window. */
const RUN = String(Date.now() % 10000).padStart(4, "0");
const NAME = { O: `O${RUN}`, A: `A${RUN}`, C: `C${RUN}` }; // ≤ 5 characters (NICKNAME_MAX since 2026-11-10)
const GLB = /\/models\/character\.glb(\?|$)/;
const COPY = {
  retrying: "캐릭터를 불러오지 못해 다시 받아 오는 중이에요…",
  failed: "캐릭터를 불러오지 못했어요. 인터넷 연결을 확인한 뒤 입장하기를 눌러 주세요.",
  submitRetry: "캐릭터를 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요",
  crash: "문제가 생겼어요. 새로고침(F5)하면 다시 들어갈 수 있어요",
  reload: "새로고침",
};

// ───────────────────────────── tiny harness ─────────────────────────────

const results = [];
const errors = [];
let currentStep = "setup";
function check(name, ok, detail) {
  const row = { step: currentStep, name, ok: !!ok, detail: detail === undefined ? null : detail };
  results.push(row);
  const text = detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail));
  console.log(`${ok ? "PASS" : "FAIL"}  [${currentStep}] ${name}${text.length > 600 ? text.slice(0, 600) + "…" : text}`);
}
async function step(name, fn) {
  currentStep = name;
  console.log(`\n── ${name}`);
  const t0 = Date.now();
  try {
    await fn();
  } catch (err) {
    check("step ran to the end", false, String(err && err.stack ? err.stack : err));
  }
  console.log(`   (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(read, pred, timeoutMs = 8000, stepMs = 40) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!pred(value) && Date.now() < deadline) {
    await sleep(stepMs);
    value = await read();
  }
  return value;
}

/** The installed Chrome, headless, on the GPU (task-char-builder's launch); CV_E2E_RENDER=software for SwiftShader. */
async function launchBrowser() {
  const software = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  const gpu = process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-gpu", "--ignore-gpu-blocklist"];
  const args = process.env.CV_E2E_RENDER === "software" ? software : gpu;
  if (process.env.CV_CHROME_PATH) return chromium.launch({ headless: true, executablePath: process.env.CV_CHROME_PATH, args });
  return chromium.launch({ headless: true, channel: "chrome", args });
}

/**
 * Console/page errors. `expectGlbFailures` (tabs A and C): the deliberate 503s on character.glb and what React logs for
 * the error boundaries that caught the resulting load error are expected; everything else still counts. `seen` keeps
 * the expected ones so the run can show they really happened.
 */
function watchErrors(page, tag, { expectGlbFailures = false } = {}) {
  const seen = [];
  const expected = (text) =>
    expectGlbFailures && (/Could not load \/models\/character\.glb/.test(text) || /error boundary|The above error occurred/i.test(text));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return; // judged through the response events below
    if (expected(text)) seen.push(text.slice(0, 160));
    else errors.push(`[${tag}] console.error: ${text}`);
  });
  page.on("pageerror", (err) => {
    if (expected(err.message)) seen.push(`pageerror: ${err.message.slice(0, 160)}`);
    else errors.push(`[${tag}] pageerror: ${err.message}`);
  });
  page.on("response", (r) => {
    if (r.status() < 400 || !r.url().startsWith(CLIENT_ORIGIN)) return;
    if (expectGlbFailures && r.status() === 503 && GLB.test(r.url())) return;
    errors.push(`[${tag}] local ${r.status()}: ${r.url()}`);
  });
  return seen;
}

/**
 * A context whose character.glb requests go through `gate`: "pass" (served as usual), "fail" (503 at once) or
 * "slowFail" (503 after 4 s). `log` gets every request's URL and the answer it got.
 */
async function openTab(browser, tag, gate, { expectGlbFailures = false } = {}) {
  const ctx = await browser.newContext({ viewport: VIEW });
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem("cv-settings-v1")) localStorage.setItem("cv-settings-v1", JSON.stringify({ coachDone: true }));
    } catch {
      /* storage blocked: the guide just shows */
    }
  });
  const log = [];
  await ctx.route(GLB, async (route) => {
    const mode = gate.mode;
    log.push({ url: route.request().url().replace(CLIENT_ORIGIN, ""), mode, at: Date.now() });
    if (mode === "pass") return route.continue();
    if (mode === "slowFail") await sleep(4000);
    return route.fulfill({ status: 503, contentType: "text/plain", body: "unavailable (e2e)" });
  });
  const page = await ctx.newPage();
  const seen = watchErrors(page, tag, { expectGlbFailures });
  return { tag, ctx, page, log, seen };
}

const getRemotes = (p) => p.evaluate(() => window.__cv.getRemotes());
const remoteNamed = async (p, nickname) => (await getRemotes(p)).find((r) => r.nickname === nickname) ?? null;
const avatarOf = (p, id) => p.evaluate((id) => window.__cvAvatars?.()[id] ?? null, id);
const shot = (p, name) => p.screenshot({ path: join(EVIDENCE, name) });

/** What the page shows right now: entry screen, error screen, failure card, message, world hook, text length. */
const screenOf = (page) =>
  page.evaluate(() => {
    const visible = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const card = document.querySelector(".cv-builder-hint.is-failed");
    return {
      entry: visible(".cv-entry"),
      crash: visible(".cv-crash"),
      crashText: document.querySelector(".cv-crash-text")?.textContent ?? null,
      crashButton: document.querySelector(".cv-crash-reload")?.textContent ?? null,
      failure: card?.getAttribute("data-failure") ?? null,
      cardText: card?.textContent ?? null,
      message: document.querySelector(".cv-message")?.textContent ?? null,
      submitDisabled: document.querySelector(".cv-submit")?.disabled ?? null,
      world: typeof window.__cv?.getSessionId === "function",
      rootChildren: document.getElementById("root")?.childElementCount ?? 0,
      textLength: document.body.innerText.trim().length,
    };
  });

/** Fill the nickname and press 입장; returns the own session id once the own avatar is assembled. */
async function enter(page, nickname) {
  await page.locator("input.cv-input").first().fill(nickname);
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => typeof window.__cv?.getSessionId === "function", null, { timeout: 90000 });
  const sid = await page.evaluate(() => window.__cv.getSessionId());
  await pollUntil(() => avatarOf(page, sid), (e) => !!e && e.parts.length > 0, 30000);
  return sid;
}

// ───────────────────────────── the run ─────────────────────────────

const browser = await launchBrowser();
try {
  let O;
  const gateA = { mode: "fail" };
  let A;

  await step("0 observer enters", async () => {
    O = await openTab(browser, "O", { mode: "pass" });
    await O.page.goto(ENTRY_URL, { waitUntil: "domcontentloaded" });
    const sid = await enter(O.page, NAME.O);
    check("observer O is in the world", !!sid, sid);
  });

  await step("1 preview retries a failed download", async () => {
    A = await openTab(browser, "A", gateA, { expectGlbFailures: true });
    await A.page.goto(ENTRY_URL, { waitUntil: "domcontentloaded" });
    await A.page.locator('.cv-builder-hint.is-failed[data-failure="modelRetrying"]').waitFor({ timeout: 30000 });
    const s = await screenOf(A.page);
    check("the preview shows the retrying card (not a blank page)", s.entry && !s.crash && s.cardText === COPY.retrying, s);
    const firstAt = A.log[0]?.at ?? 0;
    const log = await pollUntil(() => A.log.slice(), (l) => l.length >= 2, 6000, 50);
    check(
      "the boundary downloads again by itself ~1.5 s later (the cached failure was cleared)",
      log.length >= 2 && log[1].at - firstAt >= 1200,
      log.map((r) => ({ url: r.url, mode: r.mode, ms: r.at - firstAt })),
    );
    check("every request uses the versioned URL /models/character.glb?v=<8 hex>", log.every((r) => /^\/models\/character\.glb\?v=[0-9a-f]{8}$/.test(r.url)), log.map((r) => r.url));
    await shot(A.page, "glb-retry-1-preview-retrying.png");
  });

  await step("2 입장 while the model fails stays on the entry screen", async () => {
    const before = A.log.length;
    await A.page.locator("input.cv-input").first().fill(NAME.A);
    await A.page.locator(".cv-submit").click();
    const s = await pollUntil(() => screenOf(A.page), (x) => x.message === COPY.submitRetry, 15000, 50);
    check("the retry message shows under 입장", s.message === COPY.submitRetry, s);
    check("no blank page: the entry screen is still there, root has content", s.entry && s.rootChildren > 0 && s.textLength > 20, s);
    check("no error screen, no world", !s.crash && !s.world, s);
    check("입장 can be pressed again (not stuck on 입장 중…)", s.submitDisabled === false, s);
    check("입장 downloaded the model once more before giving up", A.log.length > before, { before, after: A.log.length });
    await sleep(1000);
    check("observer O never saw A join", (await remoteNamed(O.page, NAME.A)) === null);
    await shot(A.page, "glb-retry-2-submit-blocked.png");
  });

  await step("3 the preview gives up after 3 retries", async () => {
    const s = await pollUntil(() => screenOf(A.page), (x) => x.failure === "modelFailed", 25000, 100);
    check("the card says to check the connection and press 입장", s.failure === "modelFailed" && s.cardText === COPY.failed, s);
    check("still on the entry screen", s.entry && !s.crash && !s.world, s);
    const n = A.log.length;
    await sleep(3000);
    check("no more automatic downloads once it gave up", A.log.length === n, { before: n, after: A.log.length });
    await shot(A.page, "glb-retry-3-preview-gave-up.png");
  });

  await step("4 unblocked, 입장 enters the world", async () => {
    gateA.mode = "pass";
    const sid = await enter(A.page, NAME.A);
    const s = await screenOf(A.page);
    check("A is in the world with its avatar", !!sid && s.world && !s.crash && !s.entry, { sid, ...s });
    const seen = await pollUntil(() => remoteNamed(O.page, NAME.A), (r) => r !== null, 8000, 50);
    check("observer O sees A", seen !== null, seen && { sessionId: seen.sessionId });
    check("A's expected GLB failures were logged by the boundaries (sanity)", A.seen.length > 0, A.seen.slice(0, 3));
    await shot(A.page, "glb-retry-4-entered.png");
  });

  await step("5 a failure inside the world shows the error screen and leaves the room", async () => {
    const gateC = { mode: "slowFail" };
    const C = await openTab(browser, "C", gateC, { expectGlbFailures: true });
    await C.page.goto(ENTRY_URL, { waitUntil: "domcontentloaded" });
    await C.page.locator("input.cv-input").first().fill(NAME.C);
    await C.page.locator(".cv-submit").click();
    // The model is still downloading (4 s), so 입장 joins; O watches C arrive.
    const joined = await pollUntil(() => remoteNamed(O.page, NAME.C), (r) => r !== null, 6000, 25);
    check("C joined while its model was still downloading (O saw it)", joined !== null);
    const s = await pollUntil(() => screenOf(C.page), (x) => x.crash, 20000, 50);
    check("the error screen replaces the page (not blank)", s.crash && s.crashText === COPY.crash && s.crashButton === COPY.reload && s.textLength > 20, s);
    check("the world is gone behind it", !s.world, s);
    const gone = await pollUntil(() => remoteNamed(O.page, NAME.C), (r) => r === null, 5000, 50);
    check("C left the room: O no longer sees C", gone === null);
    await shot(C.page, "glb-retry-5-error-screen.png");

    gateC.mode = "pass";
    await Promise.all([C.page.waitForEvent("load", { timeout: 30000 }), C.page.getByRole("button", { name: COPY.reload }).click()]);
    await C.page.waitForFunction(() => window.__cvPreview?.().shown === true, null, { timeout: 60000 });
    const after = await screenOf(C.page);
    check("새로고침 reloads to the entry screen with the figure", after.entry && !after.crash && after.failure === null, after);
    const sid = await enter(C.page, NAME.C);
    check("C enters after the refresh", !!sid);
    const back = await pollUntil(() => remoteNamed(O.page, NAME.C), (r) => r !== null, 8000, 50);
    check("O sees C again", back !== null);
    check("C's expected GLB failures were logged by the boundary (sanity)", C.seen.length > 0, C.seen.slice(0, 3));
    await C.ctx.close();
  });

  await step("errors", async () => {
    check("no unexpected console/page errors on any tab", errors.length === 0, errors.slice(0, 20));
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
writeFileSync(join(EVIDENCE, "assertions-glb-retry.json"), JSON.stringify({ when: new Date().toISOString(), results, errors }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
