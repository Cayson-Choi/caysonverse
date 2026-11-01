// Controls/UX overhaul Task 19 — 교실 100명 장면의 이름표 성능 (phone, 375×812, CPU 4× 느리게).
//
// Standalone Playwright against: a server that already holds ~100 bots in the lecture hall,
// and the DEV client (the cost probe `__cv.getNametagCostMs` exists only under import.meta.env.DEV):
//
//   npm run build && NODE_ENV=production node server/dist/index.cjs     # server :2567
//   npm run dev -w client                                                # client :5173
//   npm run loadtest -- --numClients 100 --duration 180 --zone lectureHall
//   node e2e/task-ux-perf.mjs                                            # CV_CLIENT_URL=http://localhost:5173
//
// What it does: one phone-sized tab (375×812, touch, DPR 2) joins, then CDP
// `Emulation.setCPUThrottlingRate { rate: 4 }` (a 4× slower CPU, the "phone" stand-in), walks the
// z = 0 aisle into the lecture hall and stands among the bots. For each scenario it holds Z (the
// camera turns at 2.2 rad/s, so every view direction is sampled evenly) for SAMPLE_MS and records,
// on EVERY animation frame, `getNametagCostMs()` and the rAF timestamp:
//
//   1. 세로 · "가까운 사람만" (the default)   ← THE GATE: mean < 1.0 ms/frame, p95 < 2.0 ms
//   2. 세로 · "모두"                          (reference)
//   3. 세로 · "끄기"                          (reference: frame rate with no tags)
//   4. 가로 812×375 · "모두"                  (reference: widest view, most tags on screen)
//
// About the numbers. `getNametagCostMs()` is the AVERAGE over the NametagSystem's last 120 frames, not
// one frame: "sampled" below = that rolling mean read on every animation frame (what the brief asks:
// mean and p95 of the samples). At a throttled 13 fps a 120-frame window is ~9 s long, so 20 s holds
// only ~2 independent windows, and the 5 Hz selection pass (a spike on one frame in a few) is smoothed
// away. So the script ALSO reads the true per-frame costs: it re-serves the dev module
// /src/game/labelRegistry.ts through a Playwright route with one added line in recordNametagCost
// (the value is already measured when it runs, so the cost is not disturbed) that logs every cost the
// NametagSystem records. "per-frame" below = those exact values. Nothing in the repo's client code changes.
// Headless fps is a REFERENCE only (the 30 fps goal on a real phone is the owner's call).
//
// Knobs: CV_PERF_MS (sample length per scenario, default 20000), CV_PERF_THROTTLE (CPU slowdown, default 4;
// 1 = none, for the native baseline), CV_PERF_ONLY (comma list of scenario ids to run, default all four, e.g.
// "portrait-nearby,portrait-all"), CV_CLIENT_URL, CV_CHROME_PATH, CV_E2E_RENDER=software.
//
// Evidence → .superpowers/sdd/evidence/task-ux/ (perf-*.png, assertions-perf.json, perf-raw.json).
// Exit code 0 = the gate passed (sampled AND per-frame mean < 1.0 ms and p95 < 2.0 ms) and no console/page error.
// The gate is the brief's and was never loosened: it first failed on the per-frame p95 (docs/loadtest.md 6.3)
// and passes after the name tag perf fix (docs/loadtest.md 6.3.1).

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const SAMPLE_MS = Number(process.env.CV_PERF_MS || 20000);
const THROTTLE = Number(process.env.CV_PERF_THROTTLE || 4);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const EVIDENCE = join(REPO, ".superpowers", "sdd", "evidence", "task-ux");
mkdirSync(EVIDENCE, { recursive: true });
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;

const PORTRAIT = { width: 375, height: 812 };
const LANDSCAPE = { width: 812, height: 375 };
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const NAME = `퍼프${String(Date.now() % 1000).padStart(3, "0")}`;
const RING = 120; // labelRegistry COST_FRAMES
const GATE = { meanMs: 1.0, p95Ms: 2.0 };
const HALL_SPOT = { x: 12, z: 0 }; // the z = 0 aisle, mid-hall: clear of desks
const MIN_BOTS = 90;

const ALL_SCENARIOS = [
  { id: "portrait-nearby", label: "세로 · 가까운 사람만", mode: "nearby", size: PORTRAIT, gate: true },
  { id: "portrait-all", label: "세로 · 모두", mode: "all", size: PORTRAIT },
  { id: "portrait-off", label: "세로 · 끄기", mode: "off", size: PORTRAIT },
  { id: "landscape-all", label: "가로 · 모두", mode: "all", size: LANDSCAPE },
];
const ONLY = (process.env.CV_PERF_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
const SCENARIOS = ONLY.length ? ALL_SCENARIOS.filter((sc) => ONLY.includes(sc.id)) : ALL_SCENARIOS;
if (SCENARIOS.length === 0) {
  console.error("CV_PERF_ONLY names no known scenario:", ONLY.join(","));
  process.exit(2);
}
const MODE_LABEL = { nearby: "가까운 사람만", all: "모두", off: "끄기" };

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
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

async function pollUntil(read, pred, timeoutMs = 8000, stepMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!pred(value) && Date.now() < deadline) {
    await sleep(stepMs);
    value = await read();
  }
  return value;
}

/** Same launch as the Task 18 scripts: the GPU by default (SwiftShader makes every frame number meaningless). */
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

// ───────────────────────────── in-page recorder ─────────────────────────────

/**
 * Runs in every document before the app: from the first frame `window.__cv` exists, it stores
 * `getNametagCostMs()` and the rAF timestamp of EVERY frame (a[k], t[k]); and once a second the
 * number of tags the NametagSystem selected / actually shows (opacity > 0.05, not occluded).
 */
function installRecorder() {
  const rec = { a: [], t: [], tags: [] };
  window.__perfRec = rec;
  const loop = (now) => {
    const cv = window.__cv;
    if (cv && cv.getNametagCostMs) {
      rec.a.push(cv.getNametagCostMs());
      rec.t.push(now);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  setInterval(() => {
    const cv = window.__cv;
    if (!cv || !cv.getNametags) return;
    const tags = cv.getNametags();
    let selected = 0;
    let shown = 0;
    for (const g of tags) {
      if (g.selected) selected++;
      if (g.opacity > 0.05 && !g.occluded) shown++;
    }
    rec.tags.push({ t: performance.now(), total: tags.length, selected, shown });
  }, 1000);
}

// ───────────────────────────── statistics ─────────────────────────────

function pct(sorted, p) {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}
function stats(values) {
  const v = Array.from(values).filter((x) => Number.isFinite(x));
  if (v.length === 0) return { n: 0, mean: NaN, p50: NaN, p95: NaN, p99: NaN, max: NaN };
  const s = v.slice().sort((x, y) => x - y);
  const mean = v.reduce((x, y) => x + y, 0) / v.length;
  return { n: v.length, mean, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s[s.length - 1] };
}

// ───────────────────────────── page helpers ─────────────────────────────

const getPos = (p) => p.evaluate(() => window.__cv.getPos());
const getOrbit = (p) => p.evaluate(() => window.__cv.getOrbit());
const getRemotes = (p) => p.evaluate(() => window.__cv.getRemotes());
const shot = (p, name) => p.screenshot({ path: join(EVIDENCE, name) });

/** Closed-loop keyboard walk to (tx, tz) — camera-relative, reads the live orbit yaw every poll. */
async function walkTo(page, tx, tz, { tol = 0.6, timeout = 60000 } = {}) {
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
      await sleep(80);
    }
  } finally {
    for (const k of [...held]) await page.keyboard.up(k);
  }
  await sleep(300);
  return getPos(page);
}

async function enterWorld(page, { nickname, characterLabel, tint }) {
  await page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 30000 });
  await page.locator("input.cv-input").first().fill(nickname);
  await page.locator(".cv-character", { hasText: new RegExp(`^${characterLabel}$`) }).click();
  await page.getByLabel(`색상 ${tint}`).click();
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, { timeout: 60000 });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30000 });
  await sleep(1200);
}

/** The settings menu, driven like a player: ☰ → "이름표 보기" segment → 닫기. */
async function setNametagMode(page, mode) {
  await page.locator('[aria-label="메뉴 열기"]').click({ timeout: 20000 });
  await page.locator(".cv-menu").waitFor({ state: "visible", timeout: 20000 });
  await page.locator(".cv-menu-seg-btn", { hasText: new RegExp(`^${MODE_LABEL[mode]}$`) }).click({ timeout: 20000 });
  await sleep(300);
  await page.locator(".cv-menu-close").click({ timeout: 20000 });
  await page.locator(".cv-menu").waitFor({ state: "detached", timeout: 20000 });
  await sleep(400);
}

// ─────────────────────────────── the run ───────────────────────────────

const raw = []; // per-scenario raw samples, written next to the assertions (not committed)
const report = { startedAt: new Date().toISOString(), throttle: THROTTLE, sampleMs: SAMPLE_MS, scenarios: [] };
const browser = await launchBrowser();
try {
  const ctx = await browser.newContext({
    viewport: PORTRAIT,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: IPHONE_UA,
  });
  await ctx.addInitScript(installRecorder);
  // Log every per-frame cost the NametagSystem records (see the header). If vite's output ever changes
  // shape the regex misses and the script says so instead of inventing numbers.
  let injected = false;
  await ctx.route(/\/src\/game\/labelRegistry\.ts(\?.*)?$/, async (route) => {
    const res = await route.fetch();
    const body = await res.text();
    const re = /export function recordNametagCost\((\w+)\)\s*\{/;
    if (!re.test(body)) return route.fulfill({ response: res, body });
    injected = true;
    const patched = body.replace(re, (m, arg) => m + ` (window.__costLog ||= { ms: [], t: [] }).ms.push(${arg}); window.__costLog.t.push(performance.now());`);
    return route.fulfill({ response: res, body: patched });
  });
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem("cv-settings-v1")) localStorage.setItem("cv-settings-v1", JSON.stringify({ coachDone: true }));
    } catch {
      /* storage blocked: the guide just shows */
    }
  });
  const page = await ctx.newPage();
  watchErrors(page, "A");
  const cdp = await ctx.newCDPSession(page);

  await step("입장과 교실로 걷기 (CPU 느리게)", async () => {
    await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
    await enterWorld(page, { nickname: NAME, characterLabel: "기사", tint: 2 });
    check("DEV hook has the cost probe", await page.evaluate(() => typeof window.__cv?.getNametagCostMs === "function"));
    check("per-frame cost log is wired (labelRegistry served with the logging line)", injected && (await page.evaluate(() => (window.__costLog?.ms.length ?? 0) > 0)), { injected });

    // Which renderer is this run on? (a software renderer would make every frame number meaningless)
    report.renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl");
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, cores: navigator.hardwareConcurrency };
    });
    console.log("renderer:", JSON.stringify(report.renderer));
    check("a hardware GPU renderer (not SwiftShader)", !/swiftshader|software/i.test(String(report.renderer.gpu)), report.renderer);

    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    check(`CPU throttled ${THROTTLE}x`, true, { rate: THROTTLE });

    const spot = await walkTo(page, HALL_SPOT.x, HALL_SPOT.z);
    check("A stands in the lecture hall aisle", spot.x > 8 && Math.abs(spot.z) < 3, { x: r2(spot.x), z: r2(spot.z) });

    // The "교실 100명" precondition: the bots are really in the hall and every one has a tag.
    const crowd = await pollUntil(
      async () => {
        const rs = await getRemotes(page);
        return { total: rs.length, inHall: rs.filter((r) => r.x > 0).length };
      },
      (c) => c.total >= MIN_BOTS && c.inHall >= c.total * 0.9,
      90000,
      500,
    );
    check(`${MIN_BOTS}+ bots in the room, 90%+ of them inside the hall`, crowd.total >= MIN_BOTS && crowd.inHall >= crowd.total * 0.9, crowd);
    report.crowd = crowd;
    const tagCount = await page.evaluate(() => window.__cv.getNametags().length);
    check("every avatar registered a name tag", tagCount >= MIN_BOTS, { tags: tagCount });
    await shot(page, "perf-00-hall.png");
  });

  let currentMode = await page.evaluate(() => window.__cv.getNametagMode()).catch(() => "nearby");
  let currentSize = PORTRAIT;

  for (const sc of SCENARIOS) {
    await step(`${sc.label} (${SAMPLE_MS / 1000}초)`, async () => {
      if (sc.size !== currentSize) {
        await page.setViewportSize(sc.size);
        currentSize = sc.size;
        await sleep(1500);
      }
      if (sc.mode !== currentMode) {
        await setNametagMode(page, sc.mode);
        currentMode = sc.mode;
      }
      check(`nametag mode is "${sc.mode}"`, (await page.evaluate(() => window.__cv.getNametagMode())) === sc.mode);
      await sleep(4000); // fades and the first selection settle; the 120-frame ring fills with this scene

      await page.keyboard.down("z"); // the camera turns: every direction gets sampled
      const t0 = await page.evaluate(() => performance.now());
      await sleep(SAMPLE_MS);
      const t1 = await page.evaluate(() => performance.now());
      await page.keyboard.up("z");

      const rec = await page.evaluate(() => ({ a: window.__perfRec.a, t: window.__perfRec.t, tags: window.__perfRec.tags, log: window.__costLog ? { ms: window.__costLog.ms, t: window.__costLog.t } : null }));
      await shot(page, `perf-${sc.id}.png`);

      const idx = [];
      for (let k = 0; k < rec.t.length; k++) if (rec.t[k] >= t0 && rec.t[k] <= t1) idx.push(k);
      const sampled = stats(idx.map((k) => rec.a[k]));
      const frameCosts = rec.log ? rec.log.ms.filter((_, j) => rec.log.t[j] >= t0 && rec.log.t[j] <= t1) : [];
      const perFrame = frameCosts.length >= 40 ? stats(frameCosts) : null;
      const over2 = frameCosts.filter((c) => c >= GATE.p95Ms).length;
      raw.push({ id: sc.id, sampled: idx.map((k) => rec.a[k]), frameCosts, frameDts: [] });
      const dts = [];
      for (let j = 1; j < idx.length; j++) dts.push(rec.t[idx[j]] - rec.t[idx[j - 1]]);
      const frame = stats(dts);
      raw[raw.length - 1].frameDts = dts;
      const spanMs = idx.length > 1 ? rec.t[idx[idx.length - 1]] - rec.t[idx[0]] : NaN;
      const tags = rec.tags.filter((g) => g.t >= t0 && g.t <= t1);
      const tagStats = {
        total: tags.length ? Math.max(...tags.map((g) => g.total)) : 0,
        selectedMean: tags.length ? tags.reduce((s, g) => s + g.selected, 0) / tags.length : 0,
        selectedMax: tags.length ? Math.max(...tags.map((g) => g.selected)) : 0,
        shownMean: tags.length ? tags.reduce((s, g) => s + g.shown, 0) / tags.length : 0,
        shownMax: tags.length ? Math.max(...tags.map((g) => g.shown)) : 0,
      };
      const remotes = await getRemotes(page);
      const row = {
        id: sc.id,
        label: sc.label,
        mode: sc.mode,
        viewport: sc.size,
        frames: idx.length,
        fps: r2(((idx.length - 1) * 1000) / spanMs),
        frameMs: { p50: r2(frame.p50), p95: r2(frame.p95), p99: r2(frame.p99), max: r2(frame.max) },
        sampledCostMs: { mean: r3(sampled.mean), p50: r3(sampled.p50), p95: r3(sampled.p95), p99: r3(sampled.p99), max: r3(sampled.max) },
        perFrameCostMs: perFrame
          ? { n: perFrame.n, mean: r3(perFrame.mean), p50: r3(perFrame.p50), p95: r3(perFrame.p95), p99: r3(perFrame.p99), max: r3(perFrame.max), over2ms: over2 }
          : null,
        tags: { ...tagStats, selectedMean: r2(tagStats.selectedMean), shownMean: r2(tagStats.shownMean) },
        botsInHall: remotes.filter((r) => r.x > 0).length,
        botsTotal: remotes.length,
      };
      report.scenarios.push(row);
      console.log(JSON.stringify(row));

      check("recorded a usable number of frames", idx.length >= 40, { frames: idx.length, fps: row.fps });
      check("per-frame costs were logged", !!perFrame, { frames: frameCosts.length });
      if (sc.gate) {
        check(`GATE sampled mean ${r3(sampled.mean)} ms < ${GATE.meanMs}`, sampled.mean < GATE.meanMs);
        check(`GATE sampled p95 ${r3(sampled.p95)} ms < ${GATE.p95Ms}`, sampled.p95 < GATE.p95Ms);
        if (perFrame) {
          check(`per-frame mean ${r3(perFrame.mean)} ms < ${GATE.meanMs}`, perFrame.mean < GATE.meanMs);
          check(`per-frame p95 ${r3(perFrame.p95)} ms < ${GATE.p95Ms}`, perFrame.p95 < GATE.p95Ms);
        }
        check("the NametagSystem was really drawing tags", tagStats.shownMax >= 1, tagStats);
      }
    });
  }
} finally {
  await browser.close();
}

check("no console error or page error on the tab", errors.length === 0, errors.slice(0, 5));
report.endedAt = new Date().toISOString();
report.results = results;
report.errors = errors;
writeFileSync(join(EVIDENCE, "assertions-perf.json"), JSON.stringify(report, null, 2));
writeFileSync(join(EVIDENCE, "perf-raw.json"), JSON.stringify(raw));

console.log("\n══ 요약 (CPU " + THROTTLE + "x 느리게, 샘플 " + SAMPLE_MS / 1000 + "초) ══");
console.log("장면 | fps | 프레임 p95 | 샘플 평균 | 샘플 p95 | 프레임별 평균 | p50 | p95 | p99 | max | 2ms 넘은 프레임 | 표시 평균/최대");
for (const s of report.scenarios) {
  const pf = s.perFrameCostMs;
  console.log(
    `${s.label.padEnd(20)} | ${String(s.fps).padStart(5)} | ${String(s.frameMs.p95).padStart(8)} ms | ${String(s.sampledCostMs.mean).padStart(8)} ms | ${String(s.sampledCostMs.p95).padStart(7)} ms | ` +
      (pf ? `${pf.mean} | ${pf.p50} | ${pf.p95} | ${pf.p99} | ${pf.max} | ${pf.over2ms}/${pf.n}` : "n/a") +
      ` | ${s.tags.shownMean}/${s.tags.shownMax}`,
  );
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`FAIL [${f.step}] ${f.name}`);
process.exit(failed.length === 0 ? 0 : 1);
