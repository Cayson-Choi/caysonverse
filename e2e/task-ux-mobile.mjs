// Controls/UX overhaul Task 18 E2E — phone, 375×812 (hasTouch + isMobile): 입장 → 스틱 → 시점 끌기 →
// 핀치 → 두 번 톡 → 점프 → 의자 → 채팅 → 이모지 → 버튼 배치(보통/크게/왼손잡이) → 첫 안내.
//
// Standalone Playwright against the dev stack (server :2567, client :5173):
//   ADMIN_CODE=e2e-teacher npm run dev        # the admin code is not used here, any dev server works
//   node e2e/task-ux-mobile.mjs               # CV_CLIENT_URL=http://localhost:5173 by default
//
// A is the phone. B is a PC tab that only watches: jumps, chat bubbles and emojis are asserted
// both on A and on B's DEV hooks (what the room actually sees). Every touch is a real touch from
// the Chrome DevTools protocol (Input.dispatchTouchEvent, several fingers at once), so the pointer
// events carry pointerType "touch" and are hit-tested against the live layout — the stick zone,
// the HUD buttons and the canvas are reached exactly as a thumb reaches them.
//
// Evidence → .superpowers/sdd/evidence/task-ux/ (m-*.png, assertions-mobile.json).
// Exit code 0 = every assertion passed, no console/page error on any tab.

import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const EVIDENCE = join(REPO, ".superpowers", "sdd", "evidence", "task-ux");
mkdirSync(EVIDENCE, { recursive: true });
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;

const PHONE = { width: 375, height: 812 };
const PC = { width: 1280, height: 800 };
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
/** A player that closed its tab lingers 20 s as a ghost: nicknames are unique per run. */
const RUN = String(Date.now() % 1000).padStart(3, "0");
const NAME = { A: `폰${RUN}`, B: `관찰${RUN}`, G: `안내${RUN}` };
/** Numbers read from the source modules once A is in the world (see "shared constants" in the run). */
let CODE = null;

// ───────────────────────────── tiny harness ─────────────────────────────

const results = [];
const errors = [];
let currentStep = "setup";
function check(name, ok, detail) {
  const row = { step: currentStep, name, ok: !!ok, detail: detail === undefined ? null : detail };
  results.push(row);
  const text = detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail));
  console.log(`${ok ? "PASS" : "FAIL"}  [${currentStep}] ${name}${text}`);
}
async function step(name, fn) {
  currentStep = name;
  console.log(`\n── ${name}`);
  try {
    await fn();
  } catch (err) {
    check("step ran to the end", false, String(err && err.stack ? err.stack : err));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = (n) => Math.round(n * 100) / 100;
/** Assert-only copy of cameraControls.recenterYaw (the camera right behind a body facing `bodyYaw`). */
const recenterYaw = (bodyYaw) => norm(bodyYaw + Math.PI);

async function pollUntil(read, pred, timeoutMs = 8000, stepMs = 40) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!pred(value) && Date.now() < deadline) {
    await sleep(stepMs);
    value = await read();
  }
  return value;
}

/** See task-ux-desktop.mjs: the GPU by default (SwiftShader makes the frame-time-capped steps meaningless). */
async function launchBrowser() {
  const software = ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"];
  const gpu = process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-gpu", "--ignore-gpu-blocklist"];
  const args = process.env.CV_E2E_RENDER === "software" ? software : gpu;
  if (process.env.CV_CHROME_PATH) return chromium.launch({ headless: true, executablePath: process.env.CV_CHROME_PATH, args });
  try {
    return await chromium.launch({ headless: true, args });
  } catch {
    // Playwright's bundled Chromium is not installed here: use the installed Chrome.
    return chromium.launch({ headless: true, channel: "chrome", args });
  }
}

function watchErrors(page, tag) {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return; // judged via the response events below
    errors.push(`[${tag}] console.error: ${text}`);
  });
  page.on("pageerror", (err) => errors.push(`[${tag}] pageerror: ${err.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().startsWith(CLIENT_ORIGIN)) errors.push(`[${tag}] local ${r.status()}: ${r.url()}`);
  });
}

async function enterWorld(page, { nickname, preset }) {
  await page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 30000 });
  await page.locator("input.cv-input").first().fill(nickname);
  // Character stage 3: the builder replaced the 8 characters + 8 colours — wear a preset card instead.
  await page.locator(".cv-preset", { hasText: new RegExp(`^${preset}$`) }).click();
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, { timeout: 60000 });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30000 });
  await sleep(1200);
}

/** A phone: 375×812, touch, mobile. `coachDone` pre-saves the guide as seen (everything but the guide step). */
async function newPhone(browser, { tag, coachDone = true }) {
  const ctx = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: IPHONE_UA });
  if (coachDone) {
    await ctx.addInitScript(() => {
      try {
        if (!localStorage.getItem("cv-settings-v1")) localStorage.setItem("cv-settings-v1", JSON.stringify({ coachDone: true }));
      } catch {
        /* storage blocked: the guide just shows */
      }
    });
  }
  const page = await ctx.newPage();
  watchErrors(page, tag);
  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
  const cdp = await ctx.newCDPSession(page);
  return { tag, ctx, page, touch: makeTouch(cdp) };
}

/**
 * Real multi-finger touch through the DevTools protocol. `id` is the finger number. touchStart and
 * touchMove carry ALL fingers that are down (CDP derives which one pressed / moved from the diff);
 * touchEnd carries only the finger that is lifted — listing the others would lift them instead.
 */
function makeTouch(cdp) {
  const fingers = new Map();
  const send = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([id, [x, y]]) => ({ x, y, id })) });
  const api = {
    async down(id, x, y) {
      fingers.set(id, [x, y]);
      await send("touchStart", [...fingers]);
    },
    async move(id, x, y) {
      fingers.set(id, [x, y]);
      await send("touchMove", [...fingers]);
    },
    async up(id) {
      const at = fingers.get(id);
      if (!at) return;
      fingers.delete(id);
      await send("touchEnd", [[id, at]]);
    },
    async tap(x, y, holdMs = 45, id = 9) {
      await api.down(id, x, y);
      await sleep(holdMs);
      await api.up(id);
    },
    /** One finger from (x0, y0) to (x1, y1) in `steps` moves, then lift (unless `hold`). */
    async drag(id, x0, y0, x1, y1, { steps = 12, stepMs = 16, hold = false } = {}) {
      await api.down(id, x0, y0);
      for (let i = 1; i <= steps; i++) {
        await api.move(id, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
        await sleep(stepMs);
      }
      if (!hold) await api.up(id);
    },
  };
  return api;
}

async function joinPc(browser, { tag, nickname, preset }) {
  const ctx = await browser.newContext({ viewport: PC });
  const page = await ctx.newPage();
  watchErrors(page, tag);
  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
  await enterWorld(page, { nickname, preset });
  return { tag, ctx, page };
}

// ───────────────────────────── page helpers ─────────────────────────────

const getPos = (p) => p.evaluate(() => window.__cv.getPos());
const getOrbit = (p) => p.evaluate(() => window.__cv.getOrbit());
const getView = (p) => p.evaluate(() => window.__cv.getView());
const getRemotes = (p) => p.evaluate(() => window.__cv.getRemotes());
const getTarget = (p) => p.evaluate(() => window.__cvClickTarget?.() ?? null);
const shot = (p, name) => p.screenshot({ path: join(EVIDENCE, name) });
const rect = (p, sel) =>
  p.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, sel);
const center = async (p, sel) => {
  const r = await rect(p, sel);
  if (!r) throw new Error("no element: " + sel);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};
const stickState = (p) =>
  p.evaluate(() => {
    const el = document.querySelector(".cv-stick");
    const cs = el ? getComputedStyle(el) : null;
    return { active: !!el && el.classList.contains("is-active"), visibility: cs ? cs.visibility : null };
  });
const topAt = (p, x, y) =>
  p.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? (el.className && String(el.className)) || el.tagName : null;
  }, { x, y });

/** Same in-page recorder as the PC script: `fn` every ~20 ms, stamped with Date.now() (one clock for all tabs). */
async function startRecorder(page, name, fn, arg) {
  await page.evaluate(
    ({ name, src, arg }) => {
      const read = (0, eval)("(" + src + ")");
      const rec = (window.__recs ??= {});
      rec[name] = { rows: [] };
      const tick = () => {
        let row;
        try {
          row = read(arg);
        } catch (e) {
          row = { error: String(e) };
        }
        row.t = Date.now();
        rec[name].rows.push(row);
      };
      tick();
      setInterval(tick, 20);
    },
    { name, src: fn.toString(), arg },
  );
}
const rowsBetween = (page, name, t0, t1) =>
  page.evaluate(({ name, t0, t1 }) => window.__recs[name].rows.filter((r) => r.t >= t0 && r.t <= t1), { name, t0, t1 });

/** The moments the position CHANGED inside [t0 + skip, t1] — a position only moves when a frame is drawn. */
function moveEvents(rows, t0, t1, skipMs = 0) {
  const win = rows.filter((r) => r.t >= t0 + skipMs && r.t <= t1);
  return win.filter((r, i) => i === 0 || r.x !== win[i - 1].x || r.z !== win[i - 1].z);
}
function speedOf(rows, t0, t1, skipMs = 300) {
  const ev = moveEvents(rows, t0, t1 - 50, skipMs);
  if (ev.length < 3) return 0;
  let len = 0;
  for (let i = 1; i < ev.length; i++) len += Math.hypot(ev[i].x - ev[i - 1].x, ev[i].z - ev[i - 1].z);
  return len / ((ev[ev.length - 1].t - ev[0].t) / 1000);
}
/** Heading (rad, atan2(dx, dz)) of the path over a window, or null when it did not move. */
function headingOf(rows, t0, t1) {
  const ev = moveEvents(rows, t0, t1);
  if (ev.length < 3) return null;
  const a = ev[0];
  const b = ev[ev.length - 1];
  return Math.hypot(b.x - a.x, b.z - a.z) < 0.2 ? null : Math.atan2(b.x - a.x, b.z - a.z);
}

/**
 * Closed-loop walk to (tx, tz) with the on-screen stick: one finger held in the stick zone, its
 * position recomputed from the live camera yaw every ~40 ms (a push of 60 px runs, 34 px walks).
 */
async function stickWalkTo(page, touch, tx, tz, { tol = 0.5, timeout = 40000, anchor = { x: 110, y: 640 } } = {}) {
  const deadline = Date.now() + timeout;
  let pos = await getPos(page);
  if (Math.hypot(tx - pos.x, tz - pos.z) <= tol) return pos;
  await touch.down(0, anchor.x, anchor.y);
  try {
    while (Date.now() < deadline) {
      pos = await getPos(page);
      const { yaw } = await getOrbit(page);
      const dx = tx - pos.x;
      const dz = tz - pos.z;
      const d = Math.hypot(dx, dz);
      if (d <= tol) break;
      const f = (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / d;
      const r = (dx * Math.cos(yaw) + dz * -Math.sin(yaw)) / d;
      const push = d > 5 ? CODE.stickRadius : CODE.stickRadius * 0.6; // rim = run, 0.6 of it = walk
      await touch.move(0, anchor.x + r * push, anchor.y - f * push);
      await sleep(40);
    }
  } finally {
    await touch.up(0);
  }
  await sleep(300);
  return getPos(page);
}

/** Closed-loop keyboard walk — only for the PC observer (B), which just has to step out of the way. */
async function pcWalkTo(page, tx, tz, { tol = 1, timeout = 12000 } = {}) {
  const held = new Set();
  const press = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  const deadline = Date.now() + timeout;
  try {
    while (Date.now() < deadline) {
      const p = await getPos(page);
      const { yaw } = await getOrbit(page);
      const dx = tx - p.x;
      const dz = tz - p.z;
      if (Math.hypot(dx, dz) <= tol) break;
      const f = dx * -Math.sin(yaw) + dz * -Math.cos(yaw);
      const r = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
      const want = new Set();
      const th = tol / 2;
      if (f > th) want.add("w"); else if (f < -th) want.add("s");
      if (r > th) want.add("d"); else if (r < -th) want.add("a");
      await press(want);
      await sleep(50);
    }
  } finally {
    for (const k of [...held]) await page.keyboard.up(k);
  }
}

/** Wait for the click-move target to clear (arrival / cancel). */
/** Frames per second the page's rAF loop actually gets, measured over `ms`. */
const measureFps = (page, ms = 1000) =>
  page.evaluate(
    (ms) =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => {
          n++;
          const dt = performance.now() - t0;
          if (dt >= ms) res((n * 1000) / dt);
          else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
    ms,
  );

const settleWalk = (page, ms = 9000) => pollUntil(() => getTarget(page), (t) => t === null, ms, 100);

/** Every touch button that is reachable right now, with its box and whether it is round. */
const hudButtons = (page) =>
  page.evaluate(() => {
    const SEL = ".cv-hud-btn, .cv-action-btn, .cv-jump-btn, .cv-chat-btn, .cv-emoji-toggle, .cv-chat-toggle";
    const out = [];
    for (const el of document.querySelectorAll(SEL)) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none") continue;
      let op = 1;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) op *= parseFloat(getComputedStyle(n).opacity);
      if (op < 0.05) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const br = cs.borderTopLeftRadius;
      const round = br.endsWith("%") ? parseFloat(br) >= 50 : parseFloat(br) >= Math.min(r.width, r.height) / 2 - 0.5;
      out.push({
        name: (el.getAttribute("aria-label") || el.className || el.tagName).toString().slice(0, 40),
        x: r.x, y: r.y, w: r.width, h: r.height, round,
      });
    }
    return out;
  });

/** Distance between the nearest points of two buttons (a round one is its inscribed circle); 0 = touching or overlapping. */
function gap(a, b) {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  if (a.round && b.round) return Math.max(0, Math.hypot(acx - bcx, acy - bcy) - (a.w + b.w) / 2);
  if (a.round || b.round) {
    const [c, box] = a.round ? [a, b] : [b, a];
    const px = Math.min(box.x + box.w, Math.max(box.x, c.x + c.w / 2));
    const py = Math.min(box.y + box.h, Math.max(box.y, c.y + c.h / 2));
    return Math.max(0, Math.hypot(c.x + c.w / 2 - px, c.y + c.h / 2 - py) - c.w / 2);
  }
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

/** Plain bounding-box gap (0 = touching or overlapping). */
function boxGap(a, b) {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

/** Assert the 48 px / 8 px / on-screen layout rules over everything reachable right now. */
function checkLayout(label, els, { mustHave = [] } = {}) {
  const small = els.filter((e) => e.w < 48 - 1e-3 || e.h < 48 - 1e-3).map((e) => `${e.name} ${r2(e.w)}×${r2(e.h)}`);
  const outside = els.filter((e) => e.x < -0.01 || e.y < -0.01 || e.x + e.w > PHONE.width + 0.01 || e.y + e.h > PHONE.height + 0.01).map((e) => e.name);
  const tight = [];
  // Two readings of every pair: the shape-aware gap (a round button is its circle) decides; the plain
  // bounding-box gap is logged next to it (round buttons placed diagonally read smaller there).
  let minShape = { g: Infinity, pair: "" };
  let minBox = { g: Infinity, pair: "" };
  for (let i = 0; i < els.length; i++)
    for (let j = i + 1; j < els.length; j++) {
      const g = gap(els[i], els[j]);
      const bg = boxGap(els[i], els[j]);
      const pair = `${els[i].name} | ${els[j].name}`;
      if (g < minShape.g) minShape = { g, pair };
      if (bg < minBox.g) minBox = { g: bg, pair };
      if (g < 8 - 0.01) tight.push(`${pair} gap ${r2(g)}`); // 0.01: float noise of hypot() on an exact 8
    }
  const missing = mustHave.filter((m) => !els.some((e) => e.name.includes(m) || e.name.split(" ").includes(m)));
  check(`${label}: ${els.length} buttons, every one ≥ 48×48`, small.length === 0 && els.length >= 6, small.length ? small : { count: els.length });
  check(`${label}: every gap ≥ 8 px (none overlap)`, tight.length === 0, {
    tight,
    minShapeGap: r2(minShape.g), minShapePair: minShape.pair,
    minBoxGap: r2(minBox.g), minBoxPair: minBox.pair,
  });
  check(`${label}: all inside the screen`, outside.length === 0, outside);
  check(`${label}: jump, action, emoji and chat buttons are all there`, missing.length === 0, missing.length ? { missing } : { buttons: els.map((e) => e.name) });
}

// ─────────────────────────────── the run ───────────────────────────────

const browser = await launchBrowser();
let A, B, G;
try {
  // ── 0. 입장 ─────────────────────────────────────────────────────────────────────
  currentStep = "입장";
  A = await newPhone(browser, { tag: "A", coachDone: true });
  const pa = A.page;
  const touch = A.touch;
  await enterWorld(pa, { nickname: NAME.A, preset: "해적" });
  // The previous run's players stay in the room as ghosts for the 20 s reconnect window: let them go first.
  const empty = await pollUntil(() => getRemotes(pa), (r) => r.length === 0, 30000, 500);
  check("the room holds no one else yet (previous run's ghosts gone)", empty.length === 0, { others: empty.map((r) => r.nickname) });
  B = await joinPc(browser, { tag: "B", nickname: NAME.B, preset: "기사" });
  const pb = B.page;
  const sidA = await pollUntil(
    () => pb.evaluate((n) => window.__cv.getRemotes().find((r) => r.nickname === n)?.sessionId ?? null, NAME.A),
    (v) => !!v,
    15000,
  );
  check("B sees the phone player", !!sidA, { sidA });
  const isTouchUi = await pa.evaluate(() => matchMedia("(pointer: coarse)").matches && !!document.querySelector(".cv-stick-zone"));
  check("A runs the touch UI (coarse pointer + stick zone)", isTouchUi, {});
  const fps = [await measureFps(pa), await measureFps(pb)];
  check("precondition: both tabs render ≥ 15 fps (use the GPU, not SwiftShader)", fps.every((f) => f >= 15), {
    fpsA: Math.round(fps[0]), fpsB: Math.round(fps[1]),
  });

  const fsUrl = (rel) => "/@fs/" + pathToFileURL(join(REPO, rel)).pathname.replace(/^\//, "");
  const shared = await pa.evaluate(
    async ({ wm, kc, js, tg, ch }) => {
      const W = await import(wm);
      const K = await import(kc);
      const J = await import(js);
      const T = await import(tg);
      const C = await import(ch);
      return {
        SEATS: W.SEATS,
        MOVE_SPEED: K.MOVE_SPEED,
        RUN_SPEED: K.RUN_SPEED,
        RUN_SPEED_MULTIPLIER: K.RUN_SPEED_MULTIPLIER,
        stickRadius: J.STICK_RADIUS_PX,
        stickEdge: J.STICK_EDGE_PX,
        deadZone: J.JOYSTICK_DEAD_ZONE,
        runForce: J.STICK_RUN_FORCE,
        doubleTapMs: T.DOUBLE_TAP_MS,
        coachMoveM: C.COACH_MOVE_M,
        coachPollMs: C.COACH_POLL_MS,
      };
    },
    {
      wm: fsUrl("shared/src/worldMap.ts"),
      kc: fsUrl("shared/src/constants.ts"),
      js: "/src/game/joystick.ts",
      tg: "/src/game/tapGesture.ts",
      ch: "/src/game/coach.ts",
    },
  );
  const { SEATS, MOVE_SPEED, RUN_SPEED } = shared;
  CODE = {
    stickRadius: shared.stickRadius,
    stickEdge: shared.stickEdge,
    doubleTapMs: shared.doubleTapMs,
    coachMoveM: shared.coachMoveM,
    coachPollMs: shared.coachPollMs,
  };
  // Not a copy of the numbers: only that the modules loaded and the relations the steps rely on hold.
  check("shared constants loaded from the source modules", MOVE_SPEED > 0 && Math.abs(RUN_SPEED - MOVE_SPEED * shared.RUN_SPEED_MULTIPLIER) < 1e-9 && SEATS.length > 1 && CODE.stickRadius > 0 && CODE.doubleTapMs > 0 && CODE.coachPollMs > 0, {
    MOVE_SPEED, RUN_SPEED, seats: SEATS.length, ...CODE,
  });
  // The brief's pushes: 20 px up must read as a walk, 60 px up as a run.
  check("a 20 px push is a walk and a 60 px push a run (force = push / stick radius)", 20 / CODE.stickRadius >= shared.deadZone && 20 / CODE.stickRadius < shared.runForce && 60 / CODE.stickRadius >= shared.runForce, {
    walkForce: r2(20 / CODE.stickRadius), runForce: r2(60 / CODE.stickRadius), deadZone: shared.deadZone, runAt: shared.runForce,
  });

  await startRecorder(pa, "A", () => {
    const p = window.__cv.getPos();
    const o = window.__cv.getOrbit();
    return {
      x: p.x, z: p.z, yaw: p.yaw, seat: p.seatIndex, gait: window.__cv.getGait(), oy: o.yaw, dist: o.distance,
      jumps: window.__cv.getJumps().map((j) => j.sid + ":" + j.seq),
      goal: !!window.__cv.getView().orbitGoal, // a recenter / seat glide is pending
      target: window.__cvClickTarget && window.__cvClickTarget() ? 1 : 0, // a click-move target exists
    };
  });
  await startRecorder(
    pb,
    "B",
    (sid) => ({
      jumps: window.__cv.getJumps().filter((j) => j.sid === sid).map((j) => j.seq),
      emojis: window.__cv.getEmojis().filter((e) => e.sid === sid).map((e) => e.index),
      bubbles: window.__cv.getBubbles().filter((b) => b.sid === sid).map((b) => b.text),
    }),
    sidA,
  );
  // B steps out of the phone player's way (south-west corner of the lounge, clear of A's lanes north and east).
  await pcWalkTo(pb, -24, 9);

  // ── 1. 입장 직후 스틱이 안 보인다 ───────────────────────────────────────────────────
  await step("1 입장 직후 스틱 숨김", async () => {
    const st = await stickState(pa);
    check("the stick art is hidden right after entering", !st.active && st.visibility === "hidden", st);
    const zone = await rect(pa, ".cv-stick-zone");
    check("the stick zone is the lower-left quarter", zone && Math.abs(zone.x) < 1 && Math.abs(zone.y - PHONE.height / 2) < 1 && Math.abs(zone.w - PHONE.width / 2) < 1, zone);
    check("a thumb at (110, 640) lands on the stick zone", /cv-stick-zone/.test((await topAt(pa, 110, 640)) ?? ""), await topAt(pa, 110, 640));
    await shot(pa, "m-01-entered.png");
  });

  // ── 2. 스틱: 걷기 → 달리기 → 떼기 ───────────────────────────────────────────────────
  await step("2 스틱 걷기·달리기", async () => {
    const p0 = await getPos(pa);
    await touch.down(0, 110, 640);
    await sleep(60);
    const downState = await stickState(pa);
    check("pressing in the zone shows the stick right there", downState.active && downState.visibility === "visible", downState);
    await touch.move(0, 110, 620); // 20 px up: force 0.36 → walk
    const t1 = Date.now();
    await sleep(1100);
    const g1 = await pa.evaluate(() => window.__cv.getGait());
    await touch.move(0, 110, 580); // 60 px up: force 1 → run
    const t2 = Date.now();
    await sleep(1100);
    const g2 = await pa.evaluate(() => window.__cv.getGait());
    await shot(pa, "m-02-stick-run.png");
    await touch.up(0);
    const t3 = Date.now();
    const rows = await rowsBetween(pa, "A", t1 - 100, t3 + 100);
    const walkSpeed = speedOf(rows, t1, t2);
    const runSpeed = speedOf(rows, t2, t3);
    check(`20 px up → walk speed ≈ ${MOVE_SPEED} m/s (±25%)`, walkSpeed >= MOVE_SPEED * 0.75 && walkSpeed <= MOVE_SPEED * 1.25, { speed: r2(walkSpeed), gait: g1 });
    check(`60 px up → run speed ≈ ${RUN_SPEED} m/s (±25%)`, runSpeed >= RUN_SPEED * 0.75 && runSpeed <= RUN_SPEED * 1.25, { speed: r2(runSpeed), gait: g2 });
    check('getGait() reads "walk" then "run"', g1 === "walk" && g2 === "run", { g1, g2 });
    await sleep(700);
    const p1 = await getPos(pa);
    await sleep(500);
    const p2 = await getPos(pa);
    const after = await stickState(pa);
    const gaitAfter = await pa.evaluate(() => window.__cv.getGait());
    check("lifting the finger stops the avatar", dist(p1, p2) < 0.05 && dist(p0, p1) > 6 && gaitAfter === "idle", { still: r2(dist(p1, p2)), travelled: r2(dist(p0, p1)), gait: gaitAfter });
    check("…and hides the stick", !after.active && after.visibility === "hidden", after);
  });

  // ── 3. 가장자리 24 px에서는 스틱이 안 시작한다 ─────────────────────────────────────────
  await step("3 왼쪽 가장자리 24 px", async () => {
    await stickWalkTo(pa, touch, -15, -3, { tol: 0.6 });
    const p0 = await getPos(pa);
    check("(10, 640) is inside the 24 px edge strip, still under the stick zone (the zone swallows the touch)", 10 < CODE.stickEdge && /cv-stick-zone/.test((await topAt(pa, 10, 640)) ?? ""), {
      top: await topAt(pa, 10, 640),
    });
    await touch.down(0, 10, 640);
    await sleep(50);
    const st = await stickState(pa);
    for (let i = 1; i <= 6; i++) {
      await touch.move(0, 10, 640 - i * 10); // drag 60 px up
      await sleep(30);
    }
    await sleep(700);
    await shot(pa, "m-03-edge-drag.png"); // finger still down, 60 px up from the edge: no stick, no walk
    const p1 = await getPos(pa);
    const target = await getTarget(pa);
    check("no stick appears at the edge", !st.active && st.visibility === "hidden", st);
    check("dragging from the edge moves nothing (0 m)", dist(p0, p1) < 0.05, { moved: r2(dist(p0, p1)) });
    await touch.up(0);
    await sleep(400);
    check("…and does not start a click-move on release", (await getTarget(pa)) === null && target === null, {});
  });

  // ── (extra) 스틱 구역 안의 빠른 톡은 곧바로 클릭 이동 ───────────────────────────────────
  await step("(extra) 스틱 구역 톡 = 바로 이동", async () => {
    await touch.tap(110, 700, 45);
    const t0 = Date.now();
    const target = await pollUntil(() => getTarget(pa), (t) => t !== null, 600, 20);
    await shot(pa, "m-extra-stick-zone-tap.png"); // the destination ring, A already on its way
    check("a quick tap inside the stick zone sets a click-move target at once (before the double-tap wait would end)", !!target && Date.now() - t0 < CODE.doubleTapMs - 50, {
      target: target ? [r2(target.x), r2(target.z)] : null, ms: Date.now() - t0,
    });
    const st = await stickState(pa);
    check("…and never showed the stick", !st.active, st);
    await settleWalk(pa);
  });

  // ── 4. Review Focus 3: 스틱을 쥔 채 오른쪽 드래그 + 스틱 구역 세 번째 손가락 ─────────────────
  await step("4 스틱 + 오른쪽 드래그 + 세 번째 손가락", async () => {
    await stickWalkTo(pa, touch, -15, -1.5, { tol: 0.5 });
    await touch.down(0, 110, 640);
    await touch.move(0, 110, 600); // 40 px: force 0.71 → walk, straight ahead (camera-relative)
    await sleep(500);
    const yaw0 = (await getOrbit(pa)).yaw;
    const posA = await getPos(pa);
    // finger 2: a look drag on the right half while finger 1 keeps the stick
    await touch.down(1, 220, 330);
    for (let i = 1; i <= 12; i++) {
      await touch.move(1, 220 + i * 10, 330);
      await sleep(16);
    }
    await touch.up(1);
    const tAfterDrag = Date.now();
    await sleep(600);
    const yaw1 = (await getOrbit(pa)).yaw;
    const rowsDrag = await rowsBetween(pa, "A", tAfterDrag, Date.now());
    const sp = speedOf(rowsDrag, tAfterDrag, Date.now(), 100);
    const st = await stickState(pa);
    check("the right-half drag turned the camera (orbit.yaw changed)", Math.abs(norm(yaw1 - yaw0)) > 0.3, { yaw0: r2(yaw0), yaw1: r2(yaw1) });
    check("…while the avatar kept walking on the stick", sp > MOVE_SPEED * 0.7 && dist(posA, await getPos(pa)) > 1.5 && st.active, { speed: r2(sp), stickActive: st.active });
    check("…and the drag set no click target", (await getTarget(pa)) === null, {});

    // finger 3: pressing the stick zone while finger 1 owns the stick is ignored
    const camYaw = (await getOrbit(pa)).yaw;
    const fwd = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw)); // heading of "forward" on screen
    const tPre = Date.now();
    await sleep(350);
    const rowsPre = await rowsBetween(pa, "A", tPre, Date.now());
    const headPre = headingOf(rowsPre, tPre, Date.now());
    await touch.down(2, 60, 700);
    for (let i = 1; i <= 6; i++) {
      await touch.move(2, 60 + i * 12, 700); // dragging right: would strafe if it took over the stick
      await sleep(30);
    }
    const tIn = Date.now();
    await sleep(600);
    const rowsIn = await rowsBetween(pa, "A", tIn, Date.now());
    const headIn = headingOf(rowsIn, tIn, Date.now());
    const speedIn = speedOf(rowsIn, tIn, Date.now(), 100);
    check("a third finger in the stick zone is ignored: the heading stays", headPre !== null && headIn !== null && Math.abs(norm(headIn - headPre)) < 0.12, {
      before: headPre === null ? null : r2(headPre), during: headIn === null ? null : r2(headIn),
    });
    check("…the heading is still straight ahead on screen (not a strafe)", headIn !== null && Math.abs(norm(headIn - fwd)) < 0.2, {
      heading: headIn === null ? null : r2(headIn), forward: r2(fwd),
    });
    check("…at walking speed, with the stick still drawn", speedIn > MOVE_SPEED * 0.7 && (await stickState(pa)).active, { speed: r2(speedIn) });
    await shot(pa, "m-04-three-fingers.png");
    await touch.up(2);
    await sleep(350);
    const stillMoving = speedOf(await rowsBetween(pa, "A", Date.now() - 340, Date.now()), Date.now() - 340, Date.now(), 0);
    check("lifting the third finger leaves the stick alone", stillMoving > MOVE_SPEED * 0.6 && (await stickState(pa)).active, { speed: r2(stillMoving) });
    await touch.up(0);
    await sleep(500);
    check("lifting finger 1 ends the walk", !(await stickState(pa)).active, {});
  });

  // ── 5. 오른쪽 절반 핀치 ──────────────────────────────────────────────────────────────
  await step("5 핀치 줌", async () => {
    const d0 = (await getOrbit(pa)).distance;
    await touch.down(3, 245, 400);
    await touch.down(4, 335, 400);
    for (let i = 1; i <= 8; i++) {
      await touch.move(3, 245 - i * 6, 400); // spread: 90 px → 186 px
      await touch.move(4, 335 + i * 6, 400);
      await sleep(16);
    }
    await sleep(200);
    const d1 = (await getOrbit(pa)).distance;
    await shot(pa, "m-05-pinch-in.png");
    for (let i = 1; i <= 12; i++) {
      await touch.move(3, 197 + i * 10, 400); // pinch together: 186 px → 66 px
      await touch.move(4, 383 - i * 10, 400);
      await sleep(16);
    }
    await sleep(200);
    const d2 = (await getOrbit(pa)).distance;
    await touch.up(3);
    await touch.up(4);
    await sleep(300);
    check("spreading two fingers changes orbit.distance, inside [2.5, 18]", Math.abs(d1 - d0) > 0.3 && d1 >= 2.5 && d1 <= 18, { d0: r2(d0), d1: r2(d1) });
    check("pinching them together changes it back (the other way), inside [2.5, 18]", Math.abs(d2 - d1) > 0.3 && d2 >= 2.5 && d2 <= 18 && Math.sign(d2 - d1) !== Math.sign(d1 - d0), { d1: r2(d1), d2: r2(d2) });
    check("a pinch is not a tap (no click target)", (await getTarget(pa)) === null, {});
  });

  // ── 6. 두 번 톡 = 카메라 뒤로, 한 번 톡 = 걷기 ────────────────────────────────────────
  await step("6 오른쪽 절반 톡", async () => {
    // Turn the camera away from behind the body first.
    await touch.drag(5, 150, 330, 280, 330, { steps: 8 });
    await sleep(300);
    const pose = await getPos(pa);
    const yawBefore = (await getOrbit(pa)).yaw;
    check("setup: the camera is not behind the body", Math.abs(norm(yawBefore - recenterYaw(pose.yaw))) > 0.3, { yaw: r2(yawBefore), want: r2(recenterYaw(pose.yaw)) });
    const spotTop = await topAt(pa, 290, 520);
    check("the double tap spot is the canvas (a null or any other element fails)", spotTop === "CANVAS", { top: spotTop });
    const tTap1 = Date.now();
    await touch.tap(290, 520, 40);
    await sleep(110);
    await touch.tap(293, 522, 40);
    await sleep(CODE.doubleTapMs + 500); // past the held-back single-tap walk, and long enough for the glide to finish
    const rowsTap = await rowsBetween(pa, "A", tTap1, Date.now());
    const goalRows = rowsTap.filter((r) => r.goal);
    const targetRows = rowsTap.filter((r) => r.target);
    check("two quick taps: a recenter goal was set at some sample", goalRows.length > 0, { samples: rowsTap.length, withGoal: goalRows.length, firstAfterMs: goalRows.length ? goalRows[0].t - tTap1 : null });
    check("…and no walk target existed at any sample (the first tap's walk was cancelled)", targetRows.length === 0, { withTarget: targetRows.length });
    await sleep(100);
    const yawAfter = (await getOrbit(pa)).yaw;
    check("orbit.yaw ≈ recenterYaw(pose.yaw) ±0.05", Math.abs(norm(yawAfter - recenterYaw(pose.yaw))) <= 0.05, { yaw: r2(yawAfter), want: r2(recenterYaw(pose.yaw)) });
    check("__cvClickTarget() stays null after the 300 ms window", (await getTarget(pa)) === null, {});
    await shot(pa, "m-06-recentered.png");

    // One tap on the floor: held back 300 ms, then the click target appears.
    await sleep(600); // let the previous tap pair age out
    await touch.tap(285, 480, 40);
    const tTap = Date.now();
    await sleep(120);
    const early = await getTarget(pa);
    const late = await pollUntil(() => getTarget(pa), (t) => t !== null, 1500, 25);
    const appearedAfter = Date.now() - tTap;
    check("a single tap: no target yet 120 ms later", early === null, { early });
    check("…the click target appears after the 300 ms wait", !!late && appearedAfter >= CODE.doubleTapMs - 50 && appearedAfter < 1200, {
      afterMs: appearedAfter, target: late ? [r2(late.x), r2(late.z)] : null,
    });
    await shot(pa, "m-06-tap-walk.png");
    await settleWalk(pa);
  });

  // ── 7. 점프 버튼 ─────────────────────────────────────────────────────────────────────
  await step("7 점프 버튼", async () => {
    await sleep(900);
    const c = await center(pa, ".cv-jump-btn");
    const t0 = Date.now();
    await touch.tap(c.x, c.y, 50);
    const own = await pollUntil(() => pa.evaluate(() => window.__cv.getJumps().map((j) => j.sid)), (l) => l.length > 0, 1500, 20);
    check("the jump button makes A's own avatar jump", own.length >= 1 && own.every((s) => s === sidA), { jumps: own });
    await sleep(900);
    const rowsB = await rowsBetween(pb, "B", t0, t0 + 1500);
    check("B sees the jump too", rowsB.some((r) => r.jumps.length > 0), {});
    await shot(pa, "m-07-jump.png");
  });

  // ── 8. 의자 근처 → 🪑 → 앉기 → 일어서기 ─────────────────────────────────────────────
  await step("8 의자 행동 버튼", async () => {
    for (const [x, z, tol] of [[-8, 0, 0.9], [-2.5, 0, 0.5], [3, 0, 0.6], [1.8, -2.2, 0.35]]) await stickWalkTo(pa, touch, x, z, { tol });
    const here = await getPos(pa);
    const label = await pollUntil(
      () => pa.evaluate(() => {
        const b = document.querySelector(".cv-action-btn");
        return b ? { icon: b.querySelector(".cv-action-icon")?.textContent ?? null, text: b.querySelector(".cv-action-text")?.textContent ?? null } : null;
      }),
      (v) => v !== null,
      4000,
    );
    check("beside a free chair the action button shows 🪑 앉기", !!label && label.icon === "🪑" && label.text === "앉기", { label, at: [r2(here.x), r2(here.z)] });
    await shot(pa, "m-08-action-near-chair.png");
    const c = await center(pa, ".cv-action-btn");
    await touch.tap(c.x, c.y, 50);
    const sat = await pollUntil(() => getPos(pa), (p) => p.seatIndex >= 0, 6000);
    check("tap → A sits (server-confirmed seatIndex)", sat.seatIndex >= 0, { seatIndex: sat.seatIndex });
    check("the seat is one of the chairs beside the aisle", sat.seatIndex >= 0 && Math.hypot(SEATS[sat.seatIndex].x - here.x, SEATS[sat.seatIndex].z - here.z) < 1.6, {});
    const seatedLabel = await pollUntil(() => pa.evaluate(() => document.querySelector(".cv-action-text")?.textContent ?? null), (t) => t === "일어서기", 3000);
    check("seated: the button reads 일어서기", seatedLabel === "일어서기", { seatedLabel });
    await sleep(900);
    await shot(pa, "m-08-seated.png");
    const c2 = await center(pa, ".cv-action-btn");
    await touch.tap(c2.x, c2.y, 50);
    const stood = await pollUntil(() => getPos(pa), (p) => p.seatIndex === -1, 6000);
    check("tap again → A stands up", stood.seatIndex === -1, { seatIndex: stood.seatIndex });
    await sleep(900);
  });

  // ── 9. 💬 → 채팅 입력 → Enter ────────────────────────────────────────────────────────
  await step("9 채팅 버튼", async () => {
    const c = await center(pa, ".cv-chat-btn");
    await touch.tap(c.x, c.y, 50);
    const f = await pollUntil(() => pa.evaluate(() => document.activeElement?.className ?? ""), (cls) => /cv-chat-field/.test(cls), 3000);
    check("💬 focuses the chat input", /cv-chat-field/.test(f), { active: f });
    await shot(pa, "m-09-chat-open.png");
    await pa.keyboard.type("안녕하세요 폰이에요", { delay: 30 });
    const typed = await pa.evaluate(() => document.activeElement?.value ?? null);
    check("the line was typed into the field", typed === "안녕하세요 폰이에요", { typed });
    await pa.keyboard.press("Enter");
    const mine = await pollUntil(() => pa.evaluate((sid) => window.__cv.getBubbles().filter((b) => b.sid === sid).map((b) => b.text), sidA), (l) => l.includes("안녕하세요 폰이에요"), 4000);
    check("A's own speech bubble shows the line", mine.includes("안녕하세요 폰이에요"), { bubbles: mine });
    const onB = await pollUntil(() => pb.evaluate((sid) => window.__cv.getBubbles().filter((b) => b.sid === sid).map((b) => b.text), sidA), (l) => l.includes("안녕하세요 폰이에요"), 4000);
    check("B sees the bubble too", onB.includes("안녕하세요 폰이에요"), { bubbles: onB });
    const after = await pa.evaluate(() => document.activeElement?.className ?? "");
    check("sending folds the chat input again", !/cv-chat-field/.test(after), { active: after });
    await sleep(500);
  });

  // ── 10. 이모지 부채 ──────────────────────────────────────────────────────────────────
  await step("10 이모지 부채", async () => {
    const toggle = await center(pa, ".cv-emoji-toggle");
    await touch.tap(toggle.x, toggle.y, 50);
    await sleep(350);
    const fan = await pa.evaluate(() => [...document.querySelectorAll(".cv-emoji-fan-btn")].map((b) => {
      const r = b.getBoundingClientRect();
      return { label: b.getAttribute("aria-label"), x: r.x, y: r.y, w: r.width, h: r.height };
    }));
    check("the emoji button opens six reactions", fan.length === 6, { count: fan.length });
    await shot(pa, "m-10-emoji-fan.png");
    const pick = fan[2];
    const t0 = Date.now();
    await touch.tap(pick.x + pick.w / 2, pick.y + pick.h / 2, 50);
    const onB = await pollUntil(() => pb.evaluate((sid) => window.__cv.getEmojis().filter((e) => e.sid === sid).map((e) => e.index), sidA), (l) => l.includes(2), 3000, 30);
    check("tapping the third reaction broadcasts it (B sees index 2)", onB.includes(2), { emojis: onB, ms: Date.now() - t0 });
    await sleep(300);
    check("…and the fan folds up after a pick", (await pa.locator(".cv-emoji-fan-btn").count()) === 0, {});

    // (extra) a tap anywhere else closes the fan too.
    await sleep(600);
    await touch.tap(toggle.x, toggle.y, 50);
    await sleep(300);
    check("(extra) the fan opens again", (await pa.locator(".cv-emoji-fan-btn").count()) === 6, {});
    await touch.tap(187, 160, 50); // the sky, away from every button
    await sleep(500);
    check("(extra) a tap outside the fan closes it", (await pa.locator(".cv-emoji-fan-btn").count()) === 0, {});
    await settleWalk(pa);
  });

  // ── 11. 버튼 배치: 보통 → 크게 → 크게+왼손잡이 ───────────────────────────────────────────
  await step("11 버튼 배치", async () => {
    const MUST = ["점프", "채팅 입력", "이모지 열기", "앉기"];
    // The action button only exists beside a chair: step 10's tap may have sent A walking, so go back.
    await stickWalkTo(pa, touch, 1.8, -2.2, { tol: 0.4 });
    await pollUntil(() => rect(pa, ".cv-action-btn"), (r) => r !== null, 4000);
    await sleep(300);
    const medium = await hudButtons(pa);
    checkLayout("보통·오른손", medium, { mustHave: MUST });
    const jumpMedium = medium.find((e) => e.name === "점프");
    await shot(pa, "m-11-layout-medium.png");

    // the emoji fan open: its six buttons must keep the same distances
    const toggle = await center(pa, ".cv-emoji-toggle");
    await touch.tap(toggle.x, toggle.y, 50);
    await sleep(400);
    checkLayout("보통·오른손 (이모지 부채 열림)", await hudButtons(pa), { mustHave: ["이모지 닫기"] });
    await touch.tap(toggle.x, toggle.y, 50);
    await sleep(300);

    async function openMenu() {
      const c = await center(pa, '[aria-label="메뉴 열기"]');
      await touch.tap(c.x, c.y, 50);
      await pa.locator(".cv-menu").waitFor({ state: "visible", timeout: 4000 });
      await sleep(250);
    }
    async function closeMenu() {
      const c = await center(pa, ".cv-menu-close");
      await touch.tap(c.x, c.y, 50);
      await pa.locator(".cv-menu").waitFor({ state: "detached", timeout: 4000 });
      await sleep(400);
    }

    await openMenu();
    const largeBtn = await pa.evaluate(() => {
      const b = [...document.querySelectorAll(".cv-menu-seg-btn")].find((x) => x.textContent.trim() === "크게");
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await touch.tap(largeBtn.x, largeBtn.y, 50);
    await sleep(300);
    await shot(pa, "m-11-menu.png");
    await closeMenu();
    const large = await hudButtons(pa);
    checkLayout("크게·오른손", large, { mustHave: MUST });
    const jumpLarge = large.find((e) => e.name === "점프");
    check("크게 makes the jump button bigger", jumpLarge && jumpMedium && jumpLarge.w > jumpMedium.w, { medium: jumpMedium && r2(jumpMedium.w), large: jumpLarge && r2(jumpLarge.w) });
    const zoneRight = await rect(pa, ".cv-stick-zone");
    check("right-handed: the stick zone is the left half", zoneRight && zoneRight.x < 1 && zoneRight.w <= PHONE.width / 2 + 1, zoneRight);
    await shot(pa, "m-11-layout-large.png");

    await openMenu();
    const sw = await center(pa, '.cv-menu-switch[aria-labelledby="cv-menu-left-handed"]');
    await touch.tap(sw.x, sw.y, 50);
    await sleep(300);
    await closeMenu();
    await sleep(300);
    const left = await hudButtons(pa);
    checkLayout("크게·왼손잡이", left, { mustHave: MUST });
    const zoneLeft = await rect(pa, ".cv-stick-zone");
    check("left-handed: the stick zone is the right half", zoneLeft && zoneLeft.x >= PHONE.width / 2 - 1, zoneLeft);
    const jumpLeft = left.find((e) => e.name === "점프");
    check("left-handed: the jump button moved to the left side", jumpLeft && jumpLeft.x + jumpLeft.w / 2 < PHONE.width / 2, { x: jumpLeft && r2(jumpLeft.x) });
    check("left-handed: the saved setting holds", await pa.evaluate(() => JSON.parse(localStorage.getItem("cv-settings-v1")).leftHanded === true && JSON.parse(localStorage.getItem("cv-settings-v1")).buttonSize === "large"), {});
    await shot(pa, "m-11-layout-left.png");
    // A thumb at the mirrored spot walks; the old left spot does not start a stick.
    await touch.down(0, PHONE.width - 110, 640);
    await touch.move(0, PHONE.width - 110, 600);
    await sleep(450);
    const moving = await stickState(pa);
    const gaitHeld = await pa.evaluate(() => window.__cv.getGait());
    await touch.up(0);
    check("left-handed: pressing the right-hand zone starts the stick and walks", moving.active && gaitHeld === "walk", { ...moving, gait: gaitHeld });
  });

  // ── 12. 첫 안내: 새 컨텍스트 ──────────────────────────────────────────────────────────
  await step("12 첫 안내", async () => {
    G = await newPhone(browser, { tag: "G", coachDone: false });
    const pg = G.page;
    const gt = G.touch;
    await enterWorld(pg, { nickname: NAME.G, preset: "마법사" });
    const card = () =>
      pg.evaluate(() => {
        const el = document.querySelector(".cv-coach");
        return el ? { step: el.dataset.step, title: el.querySelector(".cv-coach-title")?.textContent ?? null } : null;
      });
    const c1 = await pollUntil(card, (c) => c !== null, 4000);
    check("① 움직이기 shows on the first visit", c1?.step === "move" && c1.title === "① 움직이기", c1);
    await shot(pg, "m-12-guide-1.png");

    // walk 1.5 m+ with the stick (the card ignores the finger)
    const p0 = await getPos(pg);
    await gt.down(0, 110, 640);
    await gt.move(0, 110, 600);
    await pollUntil(() => getPos(pg), (p) => dist(p, p0) >= CODE.coachMoveM + 0.4, 6000, 40);
    await gt.up(0);
    const c2 = await pollUntil(card, (c) => c?.step === "look", 3000);
    check("walking 1.5 m with the stick moves on to ② 둘러보기", c2?.step === "look" && c2.title === "② 둘러보기", c2);
    await shot(pg, "m-12-guide-2.png");

    // turn the view 0.6 rad+ with a one-finger drag on the right half (below the card).
    // The ② poller takes its baseline on its FIRST tick, COACH_POLL_MS after the card mounts (coach.ts
    // createCoachPoller — by design: a remount must not count the view reset as a turn), so a drag that starts
    // before that tick loses its first part: 140 px is 0.70 rad against the 0.6 rad threshold. Wait out the
    // baseline tick (twice the poll period, for timer slack under load) so the whole drag is measured.
    await sleep(2 * CODE.coachPollMs);
    await gt.drag(0, 340, 520, 200, 520, { steps: 10 }); // right half (the lower-left quarter would be the stick)
    const c3 = await pollUntil(card, (c) => c?.step === "talk", 3000);
    check("dragging the right half moves on to ③ 말하기", c3?.step === "talk" && c3.title === "③ 말하기", c3);
    await shot(pg, "m-12-guide-3.png");

    // say hello with 💬
    const cc = await center(pg, ".cv-chat-btn");
    await gt.tap(cc.x, cc.y, 50);
    await pollUntil(() => pg.evaluate(() => document.activeElement?.className ?? ""), (cls) => /cv-chat-field/.test(cls), 3000);
    await pg.keyboard.type("안녕", { delay: 30 });
    await pg.keyboard.press("Enter");
    const gone = await pollUntil(card, (c) => c === null, 3000);
    check("sending a chat line ends the guide (the card disappears)", gone === null, gone);
    check("coachDone is saved", await pg.evaluate(() => JSON.parse(localStorage.getItem("cv-settings-v1") || "{}").coachDone === true), {});

    // reload: enter again — no guide
    await pg.reload({ waitUntil: "domcontentloaded" });
    await enterWorld(pg, { nickname: NAME.G + "2", preset: "마법사" });
    await sleep(1500);
    check("after a reload the guide does not come back", (await card()) === null, {});
  });

  // ── errors ───────────────────────────────────────────────────────────────────────
  currentStep = "errors";
  check("0 console / page errors on the phones and on B", errors.length === 0, errors);
} catch (err) {
  currentStep = "fatal";
  check("script ran to the end", false, String(err && err.stack ? err.stack : err));
} finally {
  writeFileSync(join(EVIDENCE, "assertions-mobile.json"), JSON.stringify({ url: CLIENT_URL, results, errors }, null, 2));
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.error("FAILED:\n- " + failed.map((r) => `[${r.step}] ${r.name}`).join("\n- "));
  process.exit(1);
}
console.log("E2E PASSED — 휴대폰 스틱·시점·핀치·두 번 톡·점프·의자·채팅·이모지·버튼 배치·첫 안내, 콘솔 오류 0.");
