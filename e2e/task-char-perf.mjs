// Character stage 3 Task 1 — 교실 100명 렌더 비용 (phone, 375×812, CPU 4× 느리게).
//
// Standalone Playwright against: a server that already holds ~100 bots in the lecture hall, and the DEV
// client (the render-cost probe `window.__cvRenderInfo` exists only under import.meta.env.DEV):
//
//   npm run build && NODE_ENV=production node server/dist/index.cjs      # server :2567
//   npm run dev -w client                                                 # client :5173
//   npm run loadtest -- --numClients 100 --duration 300 --zone lectureHall
//   node e2e/task-char-perf.mjs --baseline                                # KayKit baseline -> perf-kaykit.json (record only)
//   node e2e/task-char-perf.mjs                                           # toy figure      -> perf-toy.json    (judges the gates)
//
// What it does: one phone-sized tab (375×812, touch, DPR 2) joins with the nickname "성능측정" and the submit button
// only (no character / colour clicks: the picker is replaced in Task 7 and this script is re-run unchanged in Task 11),
// the localStorage `cv-settings-v1` = {"coachDone":true} is seeded so the first-visit guide stays out of the way, then
// CDP `Emulation.setCPUThrottlingRate { rate: 4 }` and the same keyboard walk into the lecture hall as e2e/task-ux-perf.mjs.
// Once `__cv.getRemotes().length >= 100` (and 90 %+ of them stand in the hall) it samples SAMPLE_MS (20 s):
//
//   - fps: the mean over the window, and the "하위 5 %" = the fps of the slowest 5 % of frames (1000 / p95 of the
//     frame times). Every animation frame is timestamped in the page.
//   - once a second: `__cvRenderInfo()` (draw calls, triangles, geometries, textures) and `performance.memory.usedJSHeapSize`
//   - once a second, when `window.__cvAvatars` exists (Task 5 on; a function or the object itself): the number of entries,
//     the largest `drawMeshes` and the mean `triangles` of the entries.
//
// Headless fps is a REFERENCE only; the 30 fps goal on a real phone is judged by the owner in Task 11.
//
// Gates (toy only; exit 1 if any fails):
//   `__cvAvatars` has >= 100 entries (the smallest count over the window)
//   largest `drawMeshes` <= 8 (MAX_DRAW_MESHES)
//   mean draw calls <= the mean draw calls in perf-kaykit.json
// Exit code 0 = no gate failed, the 100-player scene was really there, and no console/page error.
//
// Evidence -> .superpowers/sdd/evidence/task-char/perf-<label>.json and perf-<label>.png (kaykit with --baseline, toy otherwise).
//
// Knobs: CV_PERF_MS (sample length, default 20000), CV_PERF_THROTTLE (CPU slowdown, default 4; 1 = none), CV_CLIENT_URL
// (default http://localhost:5173), CV_CHROME_PATH, CV_E2E_RENDER=software (SwiftShader on purpose: the hardware-GPU check is skipped).

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASELINE = process.argv.includes("--baseline");
const LABEL = BASELINE ? "kaykit" : "toy";
const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;
const SAMPLE_MS = Number(process.env.CV_PERF_MS || 20000);
const THROTTLE = Number(process.env.CV_PERF_THROTTLE || 4);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const EVIDENCE = join(REPO, ".superpowers", "sdd", "evidence", "task-char");
mkdirSync(EVIDENCE, { recursive: true });

const PORTRAIT = { width: 375, height: 812 };
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const NICKNAME = "성능측정";
const HALL_SPOT = { x: 12, z: 0 }; // the z = 0 aisle, mid-hall: clear of desks (as task-ux-perf.mjs)
const MIN_BOTS = 100;
const MAX_DRAW_MESHES = 8;
const MIN_AVATARS = 100;
const SOFTWARE_RENDER = process.env.CV_E2E_RENDER === "software";

// ───────────────────────────── tiny harness ─────────────────────────────

const results = [];
const errors = [];
function check(name, ok, detail) {
  const row = { name, ok: !!ok, detail: detail === undefined ? null : detail };
  results.push(row);
  const text = detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${text}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

/** Same launch as task-ux-perf.mjs: the GPU by default (SwiftShader makes every frame number meaningless). */
async function launchBrowser() {
  const software = ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"];
  const gpu = process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-gpu", "--ignore-gpu-blocklist"];
  // precise-memory-info: performance.memory.usedJSHeapSize is otherwise rounded into coarse buckets.
  const args = [...(SOFTWARE_RENDER ? software : gpu), "--enable-precise-memory-info"];
  if (process.env.CV_CHROME_PATH) return chromium.launch({ headless: true, executablePath: process.env.CV_CHROME_PATH, args });
  try {
    return await chromium.launch({ headless: true, args });
  } catch {
    // Playwright's bundled Chromium is not installed here: use the installed Chrome.
    return chromium.launch({ headless: true, channel: "chrome", args });
  }
}

function watchErrors(page) {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return; // judged via the response events below
    errors.push(`console.error: ${text}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().startsWith(CLIENT_ORIGIN)) errors.push(`local ${r.status()}: ${r.url()}`);
  });
}

// ───────────────────────────── in-page recorder ─────────────────────────────

/**
 * Runs in every document before the app: the rAF timestamp of EVERY frame, and once a second the render counters,
 * the JS heap and (when it exists) the avatar probe.
 */
function installRecorder() {
  const rec = { t: [], samples: [] };
  window.__perfRec = rec;
  const loop = (now) => {
    rec.t.push(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  setInterval(() => {
    const s = { t: performance.now(), render: null, heap: null, avatars: null };
    if (typeof window.__cvRenderInfo === "function") s.render = window.__cvRenderInfo();
    if (performance.memory) s.heap = performance.memory.usedJSHeapSize;
    const probe = window.__cvAvatars;
    if (probe) {
      const data = typeof probe === "function" ? probe() : probe;
      const values = data instanceof Map ? Array.from(data.values()) : Object.values(data || {});
      let maxDrawMeshes = 0;
      let triSum = 0;
      let triN = 0;
      for (const v of values) {
        if (!v) continue;
        if (typeof v.drawMeshes === "number" && v.drawMeshes > maxDrawMeshes) maxDrawMeshes = v.drawMeshes;
        if (typeof v.triangles === "number") {
          triSum += v.triangles;
          triN++;
        }
      }
      s.avatars = { count: values.length, maxDrawMeshes, meanTriangles: triN ? triSum / triN : 0 };
    }
    rec.samples.push(s);
  }, 1000);
}

// ───────────────────────────── statistics ─────────────────────────────

function pct(sorted, p) {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}
const mean = (v) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN);

// ───────────────────────────── page helpers (walk-to-hall routine of task-ux-perf.mjs) ─────────────────────────────

const getPos = (p) => p.evaluate(() => window.__cv.getPos());
const getOrbit = (p) => p.evaluate(() => window.__cv.getOrbit());
const getRemotes = (p) => p.evaluate(() => window.__cv.getRemotes());

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

/** Nickname + the submit button only — nothing about the character picker, which Task 7 replaces. */
async function enterWorld(page, nickname) {
  const input = page.locator('input.cv-input[placeholder="2~12자"]');
  await input.waitFor({ state: "visible", timeout: 30000 });
  await input.fill(nickname);
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, { timeout: 60000 });
  await page.locator("canvas").first().waitFor({ state: "visible", timeout: 30000 });
  await sleep(1200);
}

function fmtInt(n) {
  return Number(n).toLocaleString("en-US");
}

function readBaseline() {
  const file = join(EVIDENCE, "perf-kaykit.json");
  if (!existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    return j && j.render && j.render.calls && Number.isFinite(j.render.calls.mean) ? j : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────── the run ───────────────────────────────

const report = { label: LABEL, baseline: BASELINE, clientUrl: CLIENT_URL, startedAt: new Date().toISOString(), throttle: THROTTLE, sampleMs: SAMPLE_MS, nickname: NICKNAME };
let measured = null;
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
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("cv-settings-v1", JSON.stringify({ coachDone: true }));
    } catch {
      /* storage blocked: the guide just shows */
    }
  });
  const page = await ctx.newPage();
  watchErrors(page);
  const cdp = await ctx.newCDPSession(page);

  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
  await enterWorld(page, NICKNAME);
  check("DEV render probe is installed (window.__cvRenderInfo)", await pollUntil(() => page.evaluate(() => typeof window.__cvRenderInfo === "function"), (v) => v, 10000));

  // Which renderer is this run on? (a software renderer would make every frame number meaningless)
  report.renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl");
    const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, cores: navigator.hardwareConcurrency };
  });
  console.log("renderer:", JSON.stringify(report.renderer));
  if (SOFTWARE_RENDER) {
    check("hardware GPU check skipped: CV_E2E_RENDER=software asked for the software renderer (frame numbers are a reference only)", true, report.renderer);
  } else {
    check("a hardware GPU renderer (not SwiftShader)", !/swiftshader|software/i.test(String(report.renderer.gpu)), report.renderer);
  }

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  check(`CPU throttled ${THROTTLE}x`, true, { rate: THROTTLE });

  const spot = await walkTo(page, HALL_SPOT.x, HALL_SPOT.z);
  check("the tab stands in the lecture hall aisle", spot.x > 8 && Math.abs(spot.z) < 3, { x: r2(spot.x), z: r2(spot.z) });

  // The "강의실 100명" precondition: the bots are really in the hall.
  const crowd = await pollUntil(
    async () => {
      const rs = await getRemotes(page);
      return { total: rs.length, inHall: rs.filter((r) => r.x > 0).length };
    },
    (c) => c.total >= MIN_BOTS && c.inHall >= c.total * 0.9,
    120000,
    500,
  );
  check(`${MIN_BOTS}+ remotes in the room, 90%+ of them inside the hall`, crowd.total >= MIN_BOTS && crowd.inHall >= crowd.total * 0.9, crowd);
  report.crowd = crowd;
  await sleep(4000); // everyone is mounted; the first frames of the full scene settle

  // The sample window: hold Z so the camera turns and every view direction counts equally.
  await page.keyboard.down("z");
  const t0 = await page.evaluate(() => performance.now());
  await sleep(SAMPLE_MS);
  const t1 = await page.evaluate(() => performance.now());
  await page.keyboard.up("z");
  const rec = await page.evaluate(() => ({ t: window.__perfRec.t, samples: window.__perfRec.samples }));
  await page.screenshot({ path: join(EVIDENCE, `perf-${LABEL}.png`) });
  const remotesAfter = await getRemotes(page);
  report.crowdAfter = { total: remotesAfter.length, inHall: remotesAfter.filter((r) => r.x > 0).length };

  measured = { rec, t0, t1 };
} finally {
  await browser.close();
}

if (measured) {
  const { rec, t0, t1 } = measured;
  // ── fps ──
  const frames = rec.t.filter((t) => t >= t0 && t <= t1);
  const dts = [];
  for (let j = 1; j < frames.length; j++) dts.push(frames[j] - frames[j - 1]);
  const span = frames.length > 1 ? frames[frames.length - 1] - frames[0] : NaN;
  const sortedDt = dts.slice().sort((a, b) => a - b);
  const fps = {
    frames: frames.length,
    mean: r2(((frames.length - 1) * 1000) / span),
    // "하위 5 %": the fps of the slowest 5 % of frames, i.e. 1000 / the 95th percentile of the frame time.
    low5: r2(1000 / pct(sortedDt, 95)),
    frameMs: { p50: r2(pct(sortedDt, 50)), p95: r2(pct(sortedDt, 95)), p99: r2(pct(sortedDt, 99)), max: r2(sortedDt[sortedDt.length - 1] ?? NaN) },
  };

  // ── once-a-second samples inside the window ──
  const samples = rec.samples.filter((s) => s.t >= t0 && s.t <= t1);
  const renders = samples.map((s) => s.render).filter(Boolean);
  const heaps = samples.map((s) => s.heap).filter((h) => typeof h === "number");
  const avs = samples.map((s) => s.avatars).filter(Boolean);
  const calls = renders.map((x) => x.calls);
  const tris = renders.map((x) => x.triangles);
  const render = {
    samples: renders.length,
    calls: { mean: r2(mean(calls)), min: Math.min(...calls), max: Math.max(...calls) },
    triangles: { mean: Math.round(mean(tris)), min: Math.min(...tris), max: Math.max(...tris) },
    geometries: { last: renders.length ? renders[renders.length - 1].geometries : null, max: renders.length ? Math.max(...renders.map((x) => x.geometries)) : null },
    textures: { last: renders.length ? renders[renders.length - 1].textures : null, max: renders.length ? Math.max(...renders.map((x) => x.textures)) : null },
  };
  const heapMiB = heaps.map((h) => h / 1048576);
  const heap = heaps.length
    ? { samples: heaps.length, meanMiB: r2(mean(heapMiB)), maxMiB: r2(Math.max(...heapMiB)), lastMiB: r2(heapMiB[heapMiB.length - 1]) }
    : null;
  const avatars = avs.length
    ? {
        samples: avs.length,
        entriesMin: Math.min(...avs.map((a) => a.count)),
        entriesMax: Math.max(...avs.map((a) => a.count)),
        maxDrawMeshes: Math.max(...avs.map((a) => a.maxDrawMeshes)),
        meanTriangles: Math.round(mean(avs.map((a) => a.meanTriangles))),
      }
    : null;
  Object.assign(report, { fps, render, heap, avatars });

  console.log(`\n══ 강의실 100명 렌더 (${LABEL}, CPU ${THROTTLE}x 느리게, 샘플 ${SAMPLE_MS / 1000}초) ══`);
  console.log(`fps 평균 ${fps.mean} / 하위 5% ${fps.low5} (프레임 ${fps.frames}개, 프레임 시간 p50 ${fps.frameMs.p50} p95 ${fps.frameMs.p95} p99 ${fps.frameMs.p99} max ${fps.frameMs.max} ms)`);
  console.log(`draw calls 평균 ${render.calls.mean} (${render.calls.min}~${render.calls.max}), triangles 평균 ${fmtInt(render.triangles.mean)} (${fmtInt(render.triangles.min)}~${fmtInt(render.triangles.max)}), geometries ${render.geometries.last}, textures ${render.textures.last}`);
  console.log(`JS heap ${heap ? `평균 ${heap.meanMiB} MiB / 최대 ${heap.maxMiB} MiB` : "(performance.memory 없음)"}`);
  console.log(`__cvAvatars ${avatars ? `항목 ${avatars.entriesMin}~${avatars.entriesMax}, 최대 drawMeshes ${avatars.maxDrawMeshes}, 평균 triangles ${fmtInt(avatars.meanTriangles)}` : "없음"}`);

  check("recorded a usable number of frames", fps.frames >= 40, { frames: fps.frames, fps: fps.mean });
  check("render counters were sampled (__cvRenderInfo)", render.samples >= Math.floor(SAMPLE_MS / 1000) - 3 && render.calls.max > 0, { samples: render.samples });
  check("the heap was sampled (performance.memory)", !!heap);

  if (!BASELINE) {
    const base = readBaseline();
    check("GATE __cvAvatars exists", !!avatars);
    if (avatars) {
      check(`GATE __cvAvatars entries ${avatars.entriesMin} >= ${MIN_AVATARS}`, avatars.entriesMin >= MIN_AVATARS);
      check(`GATE largest drawMeshes ${avatars.maxDrawMeshes} <= ${MAX_DRAW_MESHES}`, avatars.maxDrawMeshes <= MAX_DRAW_MESHES);
    }
    check(`GATE perf-kaykit.json is there to compare against`, !!base);
    if (base) {
      check(`GATE mean draw calls ${render.calls.mean} <= KayKit ${base.render.calls.mean}`, render.calls.mean <= base.render.calls.mean);
      report.kaykit = { fps: base.fps, render: base.render, heap: base.heap };
    }
  }
}

check("no console error or page error on the tab", errors.length === 0, errors.slice(0, 5));
report.endedAt = new Date().toISOString();
report.results = results;
report.errors = errors;
const failed = results.filter((r) => !r.ok);
report.ok = failed.length === 0;
writeFileSync(join(EVIDENCE, `perf-${LABEL}.json`), JSON.stringify(report, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed -> .superpowers/sdd/evidence/task-char/perf-${LABEL}.json`);
for (const f of failed) console.log(`FAIL ${f.name}`);
process.exit(failed.length === 0 ? 0 : 1);
