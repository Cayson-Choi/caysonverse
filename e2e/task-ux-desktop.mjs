// Controls/UX overhaul Task 18 E2E — PC, 1280×800: 입장 → 걷기 → 달리기 → 1인칭 옆걸음 → 점프 →
// 앉기 → 채팅 → 이모지 → 카메라 → 메뉴/접속자 목록 → 선생님.
//
// Standalone Playwright against the dev stack (server :2567, client :5173):
//   ADMIN_CODE=e2e-teacher npm run dev
//   node e2e/task-ux-desktop.mjs                    # CV_CLIENT_URL=http://localhost:5173 by default
//
// Three tabs in one room: A (the player under test), B (the observer — everything A does
// is asserted on B's DEV hooks), C (the teacher, joins last). The 걷기/달리기/점프/앉기/채팅/
// 이모지/카메라/메뉴 steps follow the Task 18 brief item by item; the extra checks the earlier
// tasks asked for are marked "(extra)".
//
// Timing rules: nothing waits on a fixed sleep to decide a result — every wait polls with a
// deadline. Speeds and latencies come from in-page samplers (Date.now() is one clock for all
// tabs), not from Playwright round trips.
//
// Evidence → .superpowers/sdd/evidence/task-ux/ (pc-*.png, assertions-desktop.json).
// Exit code 0 = every assertion passed, no console/page error on any tab.

import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
// Task 14 (AI 학교 탈출): "/" opens the school entry now; the world is entered through its legacy link.
const ENTRY_URL = new URL("/?world=legacy", CLIENT_URL).href;
const ADMIN_CODE = process.env.CV_ADMIN_CODE || "e2e-teacher";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const EVIDENCE = join(REPO, ".superpowers", "sdd", "evidence", "task-ux");
mkdirSync(EVIDENCE, { recursive: true });
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;

const VIEW = { width: 1280, height: 800 };
/** A player that closed its tab lingers 20 s as a ghost: nicknames are unique per run so B never mistakes one for A. */
const RUN = String(Date.now() % 1000).padStart(3, "0");
const NAME = { A: `에이${RUN}`, B: `비이${RUN}`, C: `선생님${RUN}` };
const CAMERA_FOV_DEG = 55; // WorldScene <Canvas camera={{ fov: 55 }}>
const HEAD_LOOK_Y = 1.4 + 0.25; // HEAD_HEIGHT + CAMERA_LOOK_LIFT (the camera's look-at height)

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

/**
 * Rendering matters here: the Z / C key turn is capped at 0.1 s of frame time, so on a software
 * renderer (4-7 fps with two tabs) a 0.5 s hold turns far less than 1.1 rad. The default therefore
 * asks for the real GPU (ANGLE/D3D11 on Windows); CV_E2E_RENDER=software forces SwiftShader (slow:
 * the frame-rate precondition below will say so).
 */
async function launchBrowser() {
  const software = ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"];
  const gpu = process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-gpu", "--ignore-gpu-blocklist"];
  const args = process.env.CV_E2E_RENDER === "software" ? software : gpu;
  if (process.env.CV_CHROME_PATH) {
    return chromium.launch({ headless: true, executablePath: process.env.CV_CHROME_PATH, args });
  }
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

/** Count the room messages a tab sends / receives by type name (Colyseus frames carry the type as text). */
function watchWs(page) {
  const counts = { sent: {}, recv: {} };
  const TYPES = ["jump", "emoji", "chat", "typing"];
  page.on("websocket", (ws) => {
    const scan = (dir) => (frame) => {
      const text = typeof frame.payload === "string" ? frame.payload : frame.payload.toString("latin1");
      for (const t of TYPES) if (text.includes(t)) counts[dir][t] = (counts[dir][t] || 0) + 1;
    };
    ws.on("framesent", scan("sent"));
    ws.on("framereceived", scan("recv"));
  });
  return counts;
}

async function joinWorld(browser, { tag, nickname, preset, admin = false }) {
  const ctx = await browser.newContext({ viewport: VIEW });
  const page = await ctx.newPage();
  watchErrors(page, tag);
  const ws = watchWs(page);
  await page.goto(ENTRY_URL, { waitUntil: "domcontentloaded" });
  await page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 30000 });
  await page.locator("input.cv-input").first().fill(nickname);
  // Character stage 3: the builder replaced the 8 characters + 8 colours — wear a preset card instead.
  await page.locator(".cv-preset", { hasText: new RegExp(`^${preset}$`) }).click();
  if (admin) {
    await page.locator(".cv-admin-link").click();
    await page.getByLabel("관리자 코드").fill(ADMIN_CODE);
  }
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, { timeout: 60000 });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30000 });
  await sleep(1200);
  return { tag, ctx, page, ws };
}

// ───────────────────────────── page helpers ─────────────────────────────

const getPos = (p) => p.evaluate(() => window.__cv.getPos());
const getOrbit = (p) => p.evaluate(() => window.__cv.getOrbit());
const getView = (p) => p.evaluate(() => window.__cv.getView());
const getGait = (p) => p.evaluate(() => window.__cv.getGait());
const getRemotes = (p) => p.evaluate(() => window.__cv.getRemotes());
const getTarget = (p) => p.evaluate(() => window.__cvClickTarget?.() ?? null);
const active = (p) =>
  p.evaluate(() => ({
    tag: document.activeElement?.tagName ?? null,
    cls: document.activeElement?.className ?? "",
    value: document.activeElement?.value ?? null,
  }));
const shot = (p, name) => p.screenshot({ path: join(EVIDENCE, name) });

/**
 * A continuous in-page recorder. `fn` runs every ~20 ms and its result is stored with
 * `Date.now()` (one clock shared by every tab on this machine), so speeds, latencies and
 * "never showed X" claims are decided from the samples, not from Playwright round trips.
 */
async function startRecorder(page, name, fn, arg) {
  await page.evaluate(
    ({ name, src, arg }) => {
      const read = (0, eval)("(" + src + ")");
      const rec = (window.__recs ??= {});
      rec[name] = { rows: [], iv: null };
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
      rec[name].iv = setInterval(tick, 20);
    },
    { name, src: fn.toString(), arg },
  );
}
const rowsBetween = (page, name, t0, t1) =>
  page.evaluate(({ name, t0, t1 }) => window.__recs[name].rows.filter((r) => r.t >= t0 && r.t <= t1), { name, t0, t1 });

/**
 * Path speed (m/s) over the middle of a held movement (skip the first 0.3 s and the last 0.05 s).
 * A position only changes when a frame is drawn, so the speed is measured between the moments the
 * position CHANGED (first to last), not between arbitrary sampler ticks.
 */
function speedOf(rows, kd, ku) {
  const win = rows.filter((r) => r.t >= kd + 300 && r.t <= ku - 50);
  const ev = win.filter((r, i) => i === 0 || r.x !== win[i - 1].x || r.z !== win[i - 1].z);
  if (ev.length < 3) return NaN;
  let len = 0;
  for (let i = 1; i < ev.length; i++) len += Math.hypot(ev[i].x - ev[i - 1].x, ev[i].z - ev[i - 1].z);
  return len / ((ev[ev.length - 1].t - ev[0].t) / 1000);
}

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

/** Hold keys for `ms` (Playwright wall clock); returns the down / up times. */
async function holdKeys(page, keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  const kd = Date.now();
  await sleep(ms);
  const ku = Date.now();
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
  return { kd, ku };
}

/** Closed-loop keyboard walk to (tx, tz) — camera-relative, reads the live orbit yaw every poll. */
async function walkTo(page, tx, tz, { tol = 0.5, timeout = 30000 } = {}) {
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
  await sleep(250);
  return getPos(page);
}

/** Numbers read from the source modules once A is in the world (see "shared constants" below). */
let CODE = null;

/** Closed-loop camera aim with Z (yaw up) / C (yaw down). */
async function aimCamera(page, targetYaw, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const { yaw } = await getOrbit(page);
    const d = norm(targetYaw - yaw);
    if (Math.abs(d) < 0.04) break;
    const key = d > 0 ? "z" : "c";
    await page.keyboard.down(key);
    await sleep(Math.min(600, Math.max(50, (Math.abs(d) / CODE.keyYawRate) * 1000 * 0.7)));
    await page.keyboard.up(key);
    await sleep(120);
  }
  return getOrbit(page);
}

/** World point → viewport pixel, from the live camera (`__cvCamera`) looking at the player's head. */
function projectToPixel(cam, pose, wx, wy, wz) {
  const f = [pose.x - cam.x, HEAD_LOOK_Y - cam.y, pose.z - cam.z];
  const fl = Math.hypot(...f);
  f[0] /= fl; f[1] /= fl; f[2] /= fl;
  const rt = [-f[2], 0, f[0]];
  const rl = Math.hypot(rt[0], rt[2]);
  rt[0] /= rl; rt[2] /= rl;
  const up = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]];
  const v = [wx - cam.x, wy - cam.y, wz - cam.z];
  const zc = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
  if (zc <= 0.01) return null;
  const xc = v[0] * rt[0] + v[1] * rt[1] + v[2] * rt[2];
  const yc = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
  const th = Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  const nx = xc / (zc * th * (VIEW.width / VIEW.height));
  const ny = yc / (zc * th);
  return { x: ((nx + 1) / 2) * VIEW.width, y: ((1 - ny) / 2) * VIEW.height };
}

// ─────────────────────────────── the run ───────────────────────────────

const browser = await launchBrowser();
let A, B, C;
try {
  // ── 0. 입장: A, B (the teacher joins last) ─────────────────────────────────────
  currentStep = "입장";
  A = await joinWorld(browser, { tag: "A", nickname: NAME.A, preset: "기사" });
  const pa = A.page;
  // The previous run's players stay in the room as ghosts for the 20 s reconnect window: let them go first.
  const empty = await pollUntil(() => getRemotes(pa), (r) => r.length === 0, 30000, 500);
  check("the room holds no one else yet (previous run's ghosts gone)", empty.length === 0, { others: empty.map((r) => r.nickname) });
  B = await joinWorld(browser, { tag: "B", nickname: NAME.B, preset: "해적" });
  const pb = B.page;

  const sidA = await pollUntil(
    () => pb.evaluate((n) => window.__cv.getRemotes().find((r) => r.nickname === n)?.sessionId ?? null, NAME.A),
    (v) => !!v,
    15000,
  );
  check("B sees A in the room", !!sidA, { sidA });

  // Shared constants straight from the source modules (the dev server serves them), so the
  // assertions follow the code instead of a copy of its numbers.
  const fsUrl = (rel) => "/@fs/" + pathToFileURL(join(REPO, rel)).pathname.replace(/^\//, "");
  const shared = await pa.evaluate(
    async ({ wm, kc, cc, jp }) => {
      const W = await import(wm);
      const K = await import(kc);
      const C = await import(cc);
      const J = await import(jp);
      return {
        SEATS: W.SEATS,
        SEAT_YAW: W.SEAT_YAW,
        MOVE_SPEED: K.MOVE_SPEED,
        RUN_SPEED: K.RUN_SPEED,
        RUN_SPEED_MULTIPLIER: K.RUN_SPEED_MULTIPLIER,
        ROLE_TEACHER: K.ROLE_TEACHER,
        TYPING_WINDOW_MS: K.TYPING_RATE.windowMs,
        KEY_YAW_RATE: C.CAMERA_KEY_YAW_RATE,
        JUMP_COOLDOWN_MS: J.JUMP_CLIENT_COOLDOWN_MS,
      };
    },
    { wm: fsUrl("shared/src/worldMap.ts"), kc: fsUrl("shared/src/constants.ts"), cc: "/src/game/cameraControls.ts", jp: "/src/game/jump.ts" },
  );
  const { SEATS, SEAT_YAW, MOVE_SPEED, RUN_SPEED, ROLE_TEACHER } = shared;
  CODE = { keyYawRate: shared.KEY_YAW_RATE, jumpCooldownMs: shared.JUMP_COOLDOWN_MS, typingWindowMs: shared.TYPING_WINDOW_MS };
  // Not a copy of the numbers: only that the modules loaded and the relations the steps rely on hold.
  check("shared constants loaded from the source modules", MOVE_SPEED > 0 && Math.abs(RUN_SPEED - MOVE_SPEED * shared.RUN_SPEED_MULTIPLIER) < 1e-9 && SEATS.length > 1 && CODE.keyYawRate > 0 && CODE.jumpCooldownMs > 0, {
    MOVE_SPEED, RUN_SPEED, seats: SEATS.length, SEAT_YAW, ...CODE,
  });

  await startRecorder(pa, "A", () => {
    const p = window.__cv.getPos();
    const o = window.__cv.getOrbit();
    const v = window.__cv.getView();
    return {
      x: p.x, z: p.z, yaw: p.yaw, seat: p.seatIndex, gait: window.__cv.getGait(),
      oy: o.yaw, mode: v.mode, fpYaw: v.fpYaw,
      jumps: window.__cv.getJumps().map((j) => j.seq),
    };
  });
  await startRecorder(
    pb,
    "B",
    (sid) => {
      const r = window.__cv.getRemotes().find((q) => q.sessionId === sid);
      return {
        gait: window.__cv.getRemoteGaits()[sid] ?? null,
        rx: r ? r.x : null, rz: r ? r.z : null,
        jumps: window.__cv.getJumps().filter((j) => j.sid === sid).map((j) => j.seq),
        typing: window.__cv.getTyping().includes(sid),
        emojis: window.__cv.getEmojis().filter((e) => e.sid === sid).map((e) => e.index),
        bubbles: window.__cv.getBubbles().filter((b) => b.sid === sid).map((b) => b.text),
      };
    },
    sidA,
  );
  await shot(pa, "pc-00-entered-A.png");
  const fps = [await measureFps(pa), await measureFps(pb)];
  check("precondition: both tabs render ≥ 15 fps (the Z/C turn is frame-time capped; use the GPU, not SwiftShader)", fps.every((f) => f >= 15), {
    fpsA: Math.round(fps[0]), fpsB: Math.round(fps[1]),
  });

  // The first-visit guide card must stay clear of the HUD at every PC window width — the emoji row folds
  // into a 3 × 2 grid under 900 px and the card used to run over it under ~744 px (final review).
  await step("0b 안내 카드: 좁은 PC 창에서도 이모지·채팅 칸을 가리지 않음", async () => {
    const box = (sel) =>
      pa.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { l: r.left, t: r.top, r: r.right, b: r.bottom };
      }, sel);
    const hit = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    for (const width of [1280, 960, 900, 800, 744, 743, 700, 600]) {
      await pa.setViewportSize({ width, height: VIEW.height });
      await sleep(350);
      const card = await box(".cv-coach");
      const hud = { emoji: await box(".cv-emoji-palette"), chatBar: await box(".cv-chat-input"), chatLog: await box(".cv-chat-log"), action: await box(".cv-action-btn") };
      const hits = Object.entries(hud).filter(([, r]) => hit(card, r)).map(([name]) => name);
      check(`${width} px: the guide card is on screen and overlaps no HUD box`, !!card && card.l >= 0 && card.r <= width && hits.length === 0, {
        card: card && { l: Math.round(card.l), t: Math.round(card.t), r: Math.round(card.r), b: Math.round(card.b) }, hits,
      });
    }
    await pa.setViewportSize(VIEW);
    await sleep(500);
  });

  // B steps aside (north-west corner of the lounge) so A's way east is never blocked by another
  // solid avatar — both spawn within 2 m of the same point, so this can't be left to chance.
  await walkTo(pb, -24, -10, { tol: 1, timeout: 12000 });
  const lane = { a: await getPos(pa), b: await getPos(pb) };
  check("B is out of A's way east (setup)", !(lane.b.x > lane.a.x - 0.5 && Math.abs(lane.b.z - lane.a.z) < 2.5), {
    a: [r2(lane.a.x), r2(lane.a.z)], b: [r2(lane.b.x), r2(lane.b.z)],
  });
  // A looks east (+X), so W / Shift+W / strafing below run along the free lounge floor.
  await pa.bringToFront();
  const o0 = await aimCamera(pa, -Math.PI / 2);
  check("A aimed the camera east (setup)", Math.abs(norm(o0.yaw + Math.PI / 2)) < 0.1, { yaw: r2(o0.yaw) });

  // ── 1. 걷기 ─────────────────────────────────────────────────────────────────────
  await step("1 걷기: W 1 s", async () => {
    const p0 = await getPos(pa);
    const { kd, ku } = await holdKeys(pa, ["w"], 1000);
    const midGait = await rowsBetween(pa, "A", kd + 400, ku - 100);
    const rowsA = await rowsBetween(pa, "A", kd - 50, ku + 50);
    const spd = speedOf(rowsA, kd, ku);
    check(`speed ≈ MOVE_SPEED ${MOVE_SPEED} m/s (±20%)`, spd >= MOVE_SPEED * 0.8 && spd <= MOVE_SPEED * 1.2, { speed: r2(spd) });
    check('getGait() === "walk" while walking', midGait.length > 0 && midGait.every((r) => r.gait === "walk"), {
      gaits: [...new Set(midGait.map((r) => r.gait))],
    });
    const rowsB = await rowsBetween(pb, "B", kd - 50, ku + 800);
    const gaitsB = [...new Set(rowsB.map((r) => r.gait))];
    check("(extra) B shows A's walk as a walk, never as the run gait", gaitsB.includes("walk") && !gaitsB.includes("run"), { gaitsOnB: gaitsB });
    const p1 = await getPos(pa);
    check("A moved east about one stride", p1.x - p0.x > 2.8, { dx: r2(p1.x - p0.x) });
    await shot(pa, "pc-01-walk-A.png");
    await sleep(500);
  });

  // ── 2. 달리기 ───────────────────────────────────────────────────────────────────
  await step("2 달리기: Shift+W 1 s", async () => {
    const { kd, ku } = await holdKeys(pa, ["Shift", "w"], 1000);
    const rowsA = await rowsBetween(pa, "A", kd - 50, ku + 50);
    const spd = speedOf(rowsA, kd, ku);
    check(`speed ≈ RUN_SPEED ${RUN_SPEED} m/s (±20%)`, spd >= RUN_SPEED * 0.8 && spd <= RUN_SPEED * 1.2, { speed: r2(spd) });
    const midGait = rowsA.filter((r) => r.t >= kd + 400 && r.t <= ku - 100);
    check('getGait() === "run" while running', midGait.length > 0 && midGait.every((r) => r.gait === "run"), {
      gaits: [...new Set(midGait.map((r) => r.gait))],
    });
    const rowsB = await rowsBetween(pb, "B", kd - 50, ku + 1500);
    const firstRun = rowsB.find((r) => r.gait === "run");
    check('B\'s getRemoteGaits()[A] becomes "run" within 1 s', !!firstRun && firstRun.t - kd <= 1000, {
      afterMs: firstRun ? firstRun.t - kd : null,
    });
    // P8 (controller ruling): compare B's view of A only after A has stopped, +1 s settle, 1 m tolerance.
    await sleep(1200);
    const posA = await getPos(pa);
    const remoteA = (await getRemotes(pb)).find((r) => r.sessionId === sidA);
    const gap = remoteA ? dist(posA, remoteA) : Infinity;
    check("B's position of A is within 1 m of A's own after the stop (server kept the run)", gap < 1, { gap: r2(gap), a: [r2(posA.x), r2(posA.z)] });
    await shot(pa, "pc-02-run-A.png");
    await shot(pb, "pc-02-run-B.png");
  });

  // ── 2b. Tab 누수 방지 (최종 검토 반영) ────────────────────────────────────────────
  // A held Tab (key-repeat after ~0.5 s) and Shift+Tab used to slip past the hotkey table, so the
  // browser walked focus onto the chat toggle / field: the "chat" capture froze WASD and the next W was
  // typed into the chat. Playwright's keyboard.down() on a key that is already down sends a real
  // key-repeat keydown (autoRepeat) through CDP, and Shift is held in the run phase.
  await step("2b Tab 누수 방지: 걷는 중 Tab 반복 · 달리는 중 Shift+Tab", async () => {
    // Room to run east: step 1-2 left A near the lounge/hall divider, so start from the west end.
    await walkTo(pa, -22, 0, { tol: 0.6 });
    await pa.evaluate(() => {
      window.__tabLog = [];
      // Registered AFTER the app's window listener, so it sees defaultPrevented as the app left it.
      window.addEventListener("keydown", (e) => {
        if (e.code === "Tab") window.__tabLog.push({ repeat: e.repeat, shift: e.shiftKey, prevented: e.defaultPrevented });
      });
    });

    // Phase 1 — walking (W held): Tab pressed, then held past key-repeat.
    await pa.keyboard.down("w");
    const w0 = await getPos(pa);
    await sleep(150);
    await pa.keyboard.down("Tab");
    await pa.locator(".cv-roster").waitFor({ state: "visible", timeout: 3000 });
    for (let i = 0; i < 4; i++) {
      await pa.keyboard.down("Tab"); // already down → keydown with repeat: true
      await sleep(60);
    }
    const heldFocus = await active(pa);
    const w1 = await getPos(pa);
    check("Tab held through key-repeat → roster still visible", await pa.locator(".cv-roster").isVisible(), {});
    check("…activeElement is still the body (focus never left the canvas)", heldFocus.tag === "BODY", heldFocus);
    await pa.keyboard.up("Tab");
    await pa.locator(".cv-roster").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    await sleep(200);
    const w2 = await getPos(pa);
    await pa.keyboard.up("w");
    check("W kept walking while Tab was held (the chat capture never froze it)", dist(w0, w2) > 1.2, { moved: r2(dist(w0, w2)), duringTab: r2(dist(w0, w1)) });

    // Phase 2 — running (Shift+W held): Shift+Tab, then repeats of it.
    await sleep(300);
    const s0 = await getPos(pa);
    await pa.keyboard.down("Shift");
    await pa.keyboard.down("w");
    await sleep(150);
    await pa.keyboard.down("Tab"); // Shift+Tab
    await pa.locator(".cv-roster").waitFor({ state: "visible", timeout: 3000 });
    const rosterOnShiftTab = await pa.locator(".cv-roster").isVisible();
    for (let i = 0; i < 3; i++) {
      await pa.keyboard.down("Tab");
      await sleep(60);
    }
    const runFocus = await active(pa);
    await pa.keyboard.up("Tab");
    await pa.locator(".cv-roster").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    await sleep(200);
    const s1 = await getPos(pa);
    await pa.keyboard.up("w");
    await pa.keyboard.up("Shift");
    check("Shift+Tab while running shows the roster (Shift is the run key)", rosterOnShiftTab, {});
    check("…and repeated Shift+Tab leaves activeElement on the body", runFocus.tag === "BODY", runFocus);
    check("A kept running while Shift+Tab was held", dist(s0, s1) > 2.5, { moved: r2(dist(s0, s1)) });

    const log = await pa.evaluate(() => window.__tabLog);
    check("every Tab keydown (repeats and Shift+Tab included) was default-prevented", log.length >= 9 && log.every((e) => e.prevented), {
      n: log.length, repeats: log.filter((e) => e.repeat).length, shift: log.filter((e) => e.shift).length, unprevented: log.filter((e) => !e.prevented).length,
    });
    check("…the log really holds key-repeats and Shift+Tab (the test is not vacuous)", log.some((e) => e.repeat) && log.some((e) => e.shift), {});

    // The next W is movement, not text in the chat.
    await sleep(300);
    const after = await active(pa);
    const n0 = await getPos(pa);
    await holdKeys(pa, ["w"], 500);
    await sleep(150);
    const n1 = await getPos(pa);
    check("afterwards the chat field is not focused and W still moves A", !/cv-chat-field/.test(after.cls) && after.tag === "BODY" && dist(n0, n1) > 0.8, {
      active: after, moved: r2(dist(n0, n1)),
    });
    check("…and nothing was typed into the chat field", (await pa.locator(".cv-chat-field").inputValue().catch(() => "")) === "", {});
  });

  // ── 3. 1인칭 옆걸음 ──────────────────────────────────────────────────────────────
  await step("3 1인칭 옆걸음: V, A 1 s", async () => {
    await pa.keyboard.press("v");
    const v = await pollUntil(() => getView(pa), (s) => s.mode === "fp" && s.blend > 0.99, 4000);
    check("V enters first person", v.mode === "fp", { mode: v.mode, blend: r2(v.blend) });
    const fp0 = v.fpYaw;
    const p0 = await getPos(pa);
    const { kd, ku } = await holdKeys(pa, ["a"], 1000);
    await sleep(300);
    const fp1 = (await getView(pa)).fpYaw;
    const p1 = await getPos(pa);
    const dir = { x: p1.x - p0.x, z: p1.z - p0.z };
    const len = Math.hypot(dir.x, dir.z);
    const look = { x: -Math.sin(fp0), z: -Math.cos(fp0) };
    const dot = len > 0 ? (dir.x * look.x + dir.z * look.z) / len : 1;
    check("fpYaw changed by < 0.01 while strafing", Math.abs(norm(fp1 - fp0)) < 0.01, { fp0: r2(fp0), fp1: r2(fp1), d: Math.abs(norm(fp1 - fp0)) });
    check("moved ≥ 2.5 m", len > 2.5, { len: r2(len) });
    check("movement is perpendicular to the look direction", Math.abs(dot) < 0.15, { cos: r2(dot), dir: [r2(dir.x), r2(dir.z)], look: [r2(look.x), r2(look.z)] });
    // Screen-right of a view with yaw φ is R = (cos φ, −sin φ) (input.ts worldDirection); the A key goes the other way.
    const right = { x: Math.cos(fp0), z: -Math.sin(fp0) };
    const side = len > 0 ? (dir.x * right.x + dir.z * right.z) / len : 0;
    check("A strafes to the left of the view", side < -0.9, { towardRight: r2(side) });
    await shot(pa, "pc-03-fp-strafe-A.png");
    await pa.keyboard.press("v");
    await pollUntil(() => getView(pa), (s) => s.mode === "tp" && s.blend < 0.01, 4000);
    await sleep(300);
  });

  // ── 4. 점프 ─────────────────────────────────────────────────────────────────────
  await step("4 점프: Space", async () => {
    const COOL = CODE.jumpCooldownMs; // client cooldown between two jumps
    await sleep(COOL + 50);
    const wsBefore = { ...A.ws.sent };
    const t0 = Date.now();
    await pa.keyboard.press("Space");
    const own = await pollUntil(() => pa.evaluate(() => window.__cv.getJumps().length), (n) => n >= 1, 1500, 20);
    check("A shows its own jump at once", own >= 1, { jumps: own });
    await sleep(600);
    const rowsB = await rowsBetween(pb, "B", t0, t0 + 1500);
    const seenB = rowsB.find((r) => r.jumps.length > 0);
    check("B sees A's jump within 500 ms", !!seenB && seenB.t - t0 <= 500, { afterMs: seenB ? seenB.t - t0 : null });
    check("exactly one jump message was sent", (A.ws.sent.jump || 0) - (wsBefore.jump || 0) === 1, { sent: (A.ws.sent.jump || 0) - (wsBefore.jump || 0) });
    await shot(pa, "pc-04-jump-A.png");
    await shot(pb, "pc-04-jump-B.png");

    // Two Space presses within 300 ms → one jump on B (the second falls inside the client cooldown).
    await sleep(COOL + 350);
    const wsMid = { ...A.ws.sent };
    const t1 = Date.now();
    await pa.keyboard.press("Space");
    await sleep(120);
    await pa.keyboard.press("Space");
    await sleep(1500);
    const rowsB2 = await rowsBetween(pb, "B", t1, t1 + 1700);
    const rowsA2 = await rowsBetween(pa, "A", t1, t1 + 1700);
    const seqsB = [...new Set(rowsB2.flatMap((r) => r.jumps))];
    const seqsA = [...new Set(rowsA2.flatMap((r) => r.jumps))];
    check("two Space presses within 300 ms → B sees 1 jump", seqsB.length === 1, { seqsB });
    check("…and A plays 1 jump / sends 1 jump message", seqsA.length === 1 && (A.ws.sent.jump || 0) - (wsMid.jump || 0) === 1, { seqsA, sent: (A.ws.sent.jump || 0) - (wsMid.jump || 0) });

    // (extra, Review Focus 2) a mouse click on an emoji button, then Space: no extra emoji message.
    await sleep(COOL + 50);
    const emojiBtn = pa.locator(".cv-emoji-btn").first();
    await emojiBtn.click();
    const emojiB = await pollUntil(
      () => pb.evaluate((sid) => window.__cv.getEmojis().filter((e) => e.sid === sid).map((e) => e.index), sidA),
      (l) => l.includes(0),
      3000,
    );
    check("the clicked emoji button reaches B", emojiB.includes(0), { emojis: emojiB });
    const focus = await active(pa);
    check("(extra) the emoji button does not keep focus after a click", focus.tag === "BODY", focus);
    const wsE = { sent: { ...A.ws.sent }, recv: { ...B.ws.recv } };
    await sleep(COOL + 50);
    const t2 = Date.now();
    await pa.keyboard.press("Space");
    await sleep(1400);
    const rowsB3 = await rowsBetween(pb, "B", t2, t2 + 1400);
    check("Space after the emoji click jumps (A and B)", rowsB3.some((r) => r.jumps.length > 0), {});
    check("…and sends 0 extra emoji messages (Review Focus 2)", (A.ws.sent.emoji || 0) === (wsE.sent.emoji || 0) && (B.ws.recv.emoji || 0) === (wsE.recv.emoji || 0), {
      sent: [wsE.sent.emoji || 0, A.ws.sent.emoji || 0], recvB: [wsE.recv.emoji || 0, B.ws.recv.emoji || 0],
    });
  });

  // ── 5. 앉기 ─────────────────────────────────────────────────────────────────────
  await step("5 앉기: 바닥 클릭 이동 → E → Space → E", async () => {
    const seat = SEATS[1];
    const stand = { x: seat.standX, z: seat.standZ };
    // Through the door (the divider has a 4 m gap at z = 0) into the lecture hall's aisle.
    for (const [x, z, tol] of [[-2.5, 0, 0.45], [3, 0, 0.6], [stand.x, -1.0, 0.35]]) await walkTo(pa, x, z, { tol });
    // Look north, turned a little to the side: a ring straight ahead would hide behind the avatar.
    await aimCamera(pa, 0.6);
    await sleep(900); // the follow point and the arm settle behind the player
    const here = await getPos(pa);
    check("A stands in the hall aisle", Math.abs(here.x - stand.x) < 1 && Math.abs(here.z - -1.0) < 0.8, { x: r2(here.x), z: r2(here.z) });

    // Click the floor at SEATS[1]'s dismount point: aim from the live camera, correct from what the click hit.
    let want = { x: stand.x, y: 0, z: stand.z };
    let hit = null;
    let aim = { x: 0, y: 0 };
    const attempts = [];
    for (let i = 0; i < 4; i++) {
      const cam = await pa.evaluate(() => window.__cvCamera());
      const px = projectToPixel(cam, await getPos(pa), want.x, 0, want.z);
      if (!px || px.x < 0 || px.x > VIEW.width || px.y < 0 || px.y > VIEW.height) break;
      aim = px;
      await pa.mouse.click(px.x, px.y);
      hit = await pollUntil(() => getTarget(pa), (t) => t !== null, 1500);
      attempts.push({ click: [Math.round(px.x), Math.round(px.y)], hit: hit ? [r2(hit.x), r2(hit.z)] : null });
      if (hit && dist(hit, stand) < 1.0) break;
      // Aim again, shifted by how far the click landed from where it was meant to.
      if (hit) want = { x: want.x + (stand.x - hit.x), y: 0, z: want.z + (stand.z - hit.z) };
      await pa.keyboard.down("s"); // drop that target before re-aiming
      await sleep(80);
      await pa.keyboard.up("s");
      await sleep(250);
      // pollUntil returns the last reading: null = the target is gone, anything else = it could not be dropped.
      if ((await pollUntil(() => getTarget(pa), (t) => t === null, 1000)) !== null) break;
    }
    check("the floor click set a target next to SEATS[1]'s dismount point", !!hit && dist(hit, stand) < 1.0, {
      target: hit ? [r2(hit.x), r2(hit.z)] : null, stand: [stand.x, stand.z], click: [Math.round(aim.x), Math.round(aim.y)], attempts,
    });
    check("the ring is clear of the avatar on screen (≥ 150 px to the side of the screen centre)", Math.abs(aim.x - VIEW.width / 2) >= 150, {
      px: [Math.round(aim.x), Math.round(aim.y)],
    });
    await shot(pa, "pc-05-click-ring-A.png"); // the destination ring, while A is still on its way
    const midPos = await getPos(pa);
    check("the ring screenshot was taken with A still walking (target not reached yet)", dist(midPos, stand) > 1.5 || (await getTarget(pa)) !== null, {
      left: r2(dist(midPos, stand)),
    });

    const arrived = await pollUntil(() => getPos(pa), (p) => dist(p, stand) < 0.7, 15000, 80);
    check("A walked to the dismount point", dist(arrived, stand) < 0.7, { x: r2(arrived.x), z: r2(arrived.z) });
    await pollUntil(() => getTarget(pa), (t) => t === null, 4000);
    await sleep(300);

    const yawBefore = (await getOrbit(pa)).yaw;
    const btn = await pa.evaluate(() => {
      const b = document.querySelector(".cv-action-btn");
      return b ? { kbd: b.querySelector("kbd")?.textContent ?? null, text: b.querySelector(".cv-action-text")?.textContent ?? null } : null;
    });
    check('the action pill reads "E 앉기" beside the free chair', btn && btn.kbd === "E" && btn.text === "앉기", btn);
    await pa.keyboard.press("e");
    const sat = await pollUntil(() => getPos(pa), (p) => p.seatIndex === 1, 6000);
    check("E → seatIndex === 1", sat.seatIndex === 1, { seatIndex: sat.seatIndex });
    await sleep(1000);
    const seatYaw = (await getOrbit(pa)).yaw;
    check(`1 s later orbit.yaw ≈ recenterYaw(SEAT_YAW) ±0.1`, Math.abs(norm(seatYaw - recenterYaw(SEAT_YAW))) <= 0.1, {
      yaw: r2(seatYaw), want: r2(recenterYaw(SEAT_YAW)),
    });
    await shot(pa, "pc-05-seated-A.png");

    // (Review Focus 4) Space while seated: no jump anywhere.
    const wsSeat = A.ws.sent.jump || 0;
    const t0 = Date.now();
    await pa.keyboard.press("Space");
    await sleep(1300);
    const rowsB = await rowsBetween(pb, "B", t0, t0 + 1300);
    const rowsA = await rowsBetween(pa, "A", t0, t0 + 1300);
    check("Space while seated → 0 jumps (sent, on A, on B)", (A.ws.sent.jump || 0) === wsSeat && rowsA.every((r) => r.jumps.length === 0) && rowsB.every((r) => r.jumps.length === 0), {
      sent: (A.ws.sent.jump || 0) - wsSeat,
    });
    const seatedB = (await getRemotes(pb)).find((r) => r.sessionId === sidA);
    check("B sees A seated in seat 1", seatedB && seatedB.seatIndex === 1, { seatIndex: seatedB?.seatIndex });

    await pa.keyboard.press("e");
    const stood = await pollUntil(() => getPos(pa), (p) => p.seatIndex === -1, 6000);
    check("E again → stands up (seatIndex === -1)", stood.seatIndex === -1, { seatIndex: stood.seatIndex });
    const back = await pollUntil(() => getOrbit(pa), (o) => Math.abs(norm(o.yaw - yawBefore)) <= 0.1, 4000);
    check("orbit.yaw is back to the value before sitting ±0.1", Math.abs(norm(back.yaw - yawBefore)) <= 0.1, {
      before: r2(yawBefore), after: r2(back.yaw),
    });
    await sleep(700);
  });

  // ── 6. 채팅 ─────────────────────────────────────────────────────────────────────
  await step("6 채팅: / → 입력 → Enter", async () => {
    await pa.bringToFront();
    const pos0 = await getPos(pa);
    const pill = await pa.evaluate(() => {
      const b = document.querySelector(".cv-action-btn");
      return b ? { kbd: b.querySelector("kbd")?.textContent ?? null, text: b.querySelector(".cv-action-text")?.textContent ?? null } : null;
    });
    check('A stands beside a free chair: the pill reads "E 앉기", so a stray E would sit', pos0.seatIndex === -1 && !!pill && pill.kbd === "E" && pill.text === "앉기", {
      x: r2(pos0.x), z: r2(pos0.z), pill,
    });
    const ws0 = { jump: A.ws.sent.jump || 0, emoji: A.ws.sent.emoji || 0 };
    const t0 = Date.now();

    await pa.keyboard.press("Slash");
    const f = await pollUntil(() => active(pa), (a) => /cv-chat-field/.test(a.cls), 3000);
    check("/ focuses the chat input", /cv-chat-field/.test(f.cls), f);
    check('…and no "/" was typed into it', f.value === "", { value: f.value });

    await pa.keyboard.type("안녕 wasd e1", { delay: 45 });
    const typedB = await pollUntil(() => pb.evaluate((sid) => window.__cv.getTyping().includes(sid), sidA), (v) => v, 2000, 30);
    check("B's getTyping() lists A while A types", typedB === true, {});
    await sleep(500);
    const typed = await active(pa);
    check("the whole line went into the field", typed.value === "안녕 wasd e1", { value: typed.value });
    const pos1 = await getPos(pa);
    const rowsB = await rowsBetween(pb, "B", t0, Date.now());
    check("typing moved nothing (x, z)", dist(pos0, pos1) < 0.01, { moved: dist(pos0, pos1) });
    check("typing: 0 jumps, 0 emojis, 0 sit (Review Focus 1)", (A.ws.sent.jump || 0) === ws0.jump && (A.ws.sent.emoji || 0) === ws0.emoji && pos1.seatIndex === -1 && rowsB.every((r) => r.jumps.length === 0), {
      jump: (A.ws.sent.jump || 0) - ws0.jump, emoji: (A.ws.sent.emoji || 0) - ws0.emoji, seat: pos1.seatIndex,
    });
    await shot(pa, "pc-06-typing-A.png");
    await shot(pb, "pc-06-typing-B.png");

    await pa.keyboard.press("Enter");
    const bubble = await pollUntil(
      () => pb.evaluate((sid) => window.__cv.getBubbles().filter((b) => b.sid === sid).map((b) => b.text), sidA),
      (l) => l.includes("안녕 wasd e1"),
      4000,
    );
    check('Enter → B shows the bubble "안녕 wasd e1"', bubble.includes("안녕 wasd e1"), { bubbles: bubble });
    const gone = await pollUntil(() => pb.evaluate((sid) => window.__cv.getTyping().includes(sid), sidA), (v) => v === false, 2000, 30);
    check("…and A leaves B's typing list", gone === false, {});
    await sleep(500);
    await shot(pb, "pc-06-bubble-B.png");

    // (extra) blur clears the typing indicator too: type one character, then Esc.
    await sleep(CODE.typingWindowMs + 200); // typing ON is limited to once per window
    await pa.keyboard.press("Enter");
    await pollUntil(() => active(pa), (a) => /cv-chat-field/.test(a.cls), 2000);
    await pa.keyboard.type("x", { delay: 20 });
    const on = await pollUntil(() => pb.evaluate((sid) => window.__cv.getTyping().includes(sid), sidA), (v) => v, 2500, 30);
    await pa.keyboard.press("Escape");
    const off = await pollUntil(() => pb.evaluate((sid) => window.__cv.getTyping().includes(sid), sidA), (v) => v === false, 2000, 30);
    check("(extra) typing shows on B, and Esc (blur) clears it", on === true && off === false, { on, off });
    const blurred = await active(pa);
    check("(extra) Esc left the field and did not open the menu", !/cv-chat-field/.test(blurred.cls) && (await pa.locator(".cv-menu").count()) === 0, blurred);
  });

  // ── 7. 이모지 ────────────────────────────────────────────────────────────────────
  await step("7 이모지: 2", async () => {
    await sleep(700);
    await pa.keyboard.press("2");
    const got = await pollUntil(
      () => pb.evaluate((sid) => window.__cv.getEmojis().filter((e) => e.sid === sid).map((e) => e.index), sidA),
      (l) => l.includes(1),
      3000,
    );
    check("B's getEmojis() has { sid: A, index: 1 }", got.includes(1), { emojis: got });
    await shot(pb, "pc-07-emoji-B.png");
  });

  // ── 8. 카메라 ────────────────────────────────────────────────────────────────────
  await step("8 카메라: Z / C / R", async () => {
    await sleep(500);
    const y0 = (await getOrbit(pa)).yaw;
    await holdKeys(pa, ["z"], 500);
    await sleep(150);
    const y1 = (await getOrbit(pa)).yaw;
    const dz = norm(y1 - y0);
    const wantTurn = CODE.keyYawRate * 0.5; // the brief's "about +1.1" for 0.5 s, from the code's rate
    check("the key turn rate gives ≈ 1.1 rad per 0.5 s (the brief's number)", Math.abs(wantTurn - 1.1) < 0.05, { rate: CODE.keyYawRate });
    check("Z held 0.5 s → yaw ≈ +1.1", Math.abs(dz - wantTurn) <= 0.3, { delta: r2(dz), want: r2(wantTurn) });
    await holdKeys(pa, ["c"], 500);
    await sleep(150);
    const y2 = (await getOrbit(pa)).yaw;
    const dc = norm(y2 - y1);
    check("C held 0.5 s → the opposite way, ≈ −1.1", Math.abs(dc + wantTurn) <= 0.3, { delta: r2(dc), want: r2(-wantTurn) });

    // R: make sure the camera is NOT behind the body first, then press R.
    const pose = await getPos(pa);
    const gapBefore = () => Math.abs(norm(y2 - recenterYaw(pose.yaw)));
    if (gapBefore() < 0.5) await holdKeys(pa, ["z"], 500);
    await sleep(150);
    const yawNow = (await getOrbit(pa)).yaw;
    const startGap = Math.abs(norm(yawNow - recenterYaw(pose.yaw)));
    check("setup: the camera is off-centre before R", startGap > 0.4, { gap: r2(startGap) });
    await pa.evaluate(() => {
      window.__rt = null;
      const handler = (e) => {
        if (e.code !== "KeyR" || e.repeat) return;
        window.removeEventListener("keydown", handler, true);
        const n = (a) => Math.atan2(Math.sin(a), Math.cos(a));
        const goal = n(window.__cv.getPos().yaw + Math.PI);
        const t0 = performance.now();
        const tick = () => {
          if (Math.abs(n(window.__cv.getOrbit().yaw - goal)) < 0.05) window.__rt = { ms: performance.now() - t0, goal };
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };
      window.addEventListener("keydown", handler, true);
    });
    await pa.keyboard.press("r");
    const rt = await pollUntil(() => pa.evaluate(() => window.__rt), (v) => v !== null, 3000);
    check("R → orbit.yaw reaches recenterYaw(pose.yaw) ±0.05 within 0.4 s", !!rt && rt.ms <= 400, {
      ms: rt ? Math.round(rt.ms) : null, note: "measured from the R keydown to the first frame inside ±0.05",
    });
    await sleep(400);
    const fin = (await getOrbit(pa)).yaw;
    const poseNow = await getPos(pa);
    check("…and stays there", Math.abs(norm(fin - recenterYaw(poseNow.yaw))) <= 0.05, { yaw: r2(fin), want: r2(recenterYaw(poseNow.yaw)) });
    await shot(pa, "pc-08-recentered-A.png");
  });

  // ── 9. 메뉴 / 접속자 목록 ─────────────────────────────────────────────────────────
  await step("9 메뉴·접속자 목록: Esc / Tab", async () => {
    await pa.keyboard.press("Escape");
    await pa.locator(".cv-menu").waitFor({ state: "visible", timeout: 3000 });
    check("Esc → .cv-menu visible", await pa.locator(".cv-menu").isVisible(), {});
    await shot(pa, "pc-09-menu-A.png");
    await pa.keyboard.press("Escape");
    await pa.locator(".cv-menu").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    check("Esc again → .cv-menu hidden", (await pa.locator(".cv-menu").count()) === 0 || !(await pa.locator(".cv-menu").isVisible()), {});

    await pa.keyboard.down("Tab");
    await pa.locator(".cv-roster").waitFor({ state: "visible", timeout: 3000 });
    const heldFocus = await active(pa);
    check("Tab held → .cv-roster visible", await pa.locator(".cv-roster").isVisible(), {});
    check("(extra) Tab did not move focus into a HUD button (activeElement is still the body)", heldFocus.tag === "BODY", heldFocus);
    await shot(pa, "pc-09-roster-held-A.png");
    await pa.keyboard.up("Tab");
    await pa.locator(".cv-roster").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    check("Tab released → .cv-roster hidden", (await pa.locator(".cv-roster").count()) === 0, {});

    // (extra) the window losing focus while Tab is held also drops the list.
    await pa.keyboard.down("Tab");
    await pa.locator(".cv-roster").waitFor({ state: "visible", timeout: 3000 });
    await pa.evaluate(() => window.dispatchEvent(new Event("blur")));
    await pa.locator(".cv-roster").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    check("(extra) a window blur while Tab is held hides the roster", (await pa.locator(".cv-roster").count()) === 0, {});
    await pa.keyboard.up("Tab");

    // (extra) a HUD button clicked with the mouse never keeps focus: Space / Enter do not press it again.
    await sleep(CODE.jumpCooldownMs + 50);
    await pa.locator(".cv-hud-people").click();
    await pa.locator(".cv-roster").waitFor({ state: "visible", timeout: 3000 });
    const afterClick = await active(pa);
    const jumpsBefore = A.ws.sent.jump || 0;
    await pa.keyboard.press("Space");
    await sleep(500);
    const stillOpen = await pa.locator(".cv-roster").isVisible();
    await pa.keyboard.press("Enter");
    const chatFocus = await pollUntil(() => active(pa), (a) => /cv-chat-field/.test(a.cls), 2000);
    check("(extra) after a mouse click the 👥 button is not focused", afterClick.tag === "BODY", afterClick);
    check("(extra) Space does not re-press it (the list stays open) — it jumps instead", stillOpen && (A.ws.sent.jump || 0) === jumpsBefore + 1, {
      stillOpen, jumps: (A.ws.sent.jump || 0) - jumpsBefore,
    });
    check("(extra) Enter opens the chat instead of re-pressing it", /cv-chat-field/.test(chatFocus.cls) && (await pa.locator(".cv-roster").isVisible()), chatFocus);
    await pa.keyboard.press("Escape"); // leaves the chat field only
    await pa.keyboard.press("Escape"); // closes the roster
    await sleep(300);
    check("(extra) Esc, Esc → chat blurred, roster closed, menu not opened", (await pa.locator(".cv-roster").count()) === 0 && (await pa.locator(".cv-menu").count()) === 0, {});
  });

  // ── 10. 선생님 ───────────────────────────────────────────────────────────────────
  await step("10 선생님: adminCode 입장", async () => {
    C = await joinWorld(browser, { tag: "C", nickname: NAME.C, preset: "마법사", admin: true });
    const remoteC = await pollUntil(
      async () => (await getRemotes(pb)).find((r) => r.nickname === NAME.C) ?? null,
      (r) => r && r.role === ROLE_TEACHER,
      8000,
    );
    check("B getRemotes() has C with the teacher role (1)", !!remoteC && remoteC.role === ROLE_TEACHER, { role: remoteC?.role });
    // A name tag is only drawn for someone ON SCREEN (and within 30 m): B turns its camera toward C.
    const me = await getPos(pb);
    const toC = await aimCamera(pb, Math.atan2(-(remoteC.x - me.x), -(remoteC.z - me.z)));
    await sleep(600);
    const tag = await pollUntil(
      async () => (await pb.evaluate(() => window.__cv.getNametags())).find((t) => t.id === remoteC?.sessionId) ?? null,
      (t) => t && t.selected,
      6000,
      100,
    );
    check("B's getNametags() has C selected", !!tag && tag.selected === true, tag ? { selected: tag.selected, opacity: r2(tag.opacity) } : null);
    const roleA = (await getRemotes(pb)).find((r) => r.sessionId === sidA)?.role;
    check("A (no code) stays a student on B", typeof roleA === "number" && roleA !== ROLE_TEACHER, { roleA });
    const cost = await pb.evaluate(() => ({ ms: window.__cv.getNametagCostMs(), mode: window.__cv.getNametagMode() }));
    check("name tag system reports its cost and the default mode", typeof cost.ms === "number" && cost.mode === "nearby", cost);
    await shot(pb, "pc-10-teacher-B.png");
    await shot(C.page, "pc-10-teacher-C.png");
  });

  // ── errors ───────────────────────────────────────────────────────────────────────
  currentStep = "errors";
  check("0 console / page errors on A, B and C", errors.length === 0, errors);
} catch (err) {
  currentStep = "fatal";
  check("script ran to the end", false, String(err && err.stack ? err.stack : err));
} finally {
  writeFileSync(join(EVIDENCE, "assertions-desktop.json"), JSON.stringify({ url: CLIENT_URL, results, errors }, null, 2));
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.error("FAILED:\n- " + failed.map((r) => `[${r.step}] ${r.name}`).join("\n- "));
  process.exit(1);
}
console.log("E2E PASSED — PC 입장·걷기·달리기·1인칭 옆걸음·점프·앉기·채팅·이모지·카메라·메뉴·선생님, 콘솔 오류 0.");
