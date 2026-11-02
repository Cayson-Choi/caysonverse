// Character stage 3 Task 1 — 교실 100명 렌더 비용 (phone, 375×812, CPU 4× 느리게).
//
// Standalone Playwright against: a server that already holds ~100 bots in the lecture hall, and the DEV
// client (the render-cost probe `window.__cvRenderInfo` exists only under import.meta.env.DEV):
//
//   npm run build && NODE_ENV=production node server/dist/index.cjs      # server :2567
//   npm run dev -w client                                                 # client :5173
//   npm run loadtest -- --numClients 100 --duration 600 --zone lectureHall   # 3 runs take about 4-5 minutes
//   node e2e/task-char-perf.mjs --baseline                                # KayKit baseline -> perf-kaykit.json (record only)
//   node e2e/task-char-perf.mjs                                           # toy figure      -> perf-toy.json    (judges the gates)
//
// What it does, RUNS (default 3) times in a row, each in a fresh browser: one phone-sized tab (375×812, touch, DPR 2)
// joins with the nickname "성능측정" and the submit button only (no character / colour clicks: the picker is replaced
// in Task 7 and this script is re-run unchanged in Task 11), the localStorage `cv-settings-v1` = {"coachDone":true} is
// seeded so the first-visit guide stays out of the way, then CDP `Emulation.setCPUThrottlingRate { rate: 4 }` and the
// same keyboard walk into the lecture hall as e2e/task-ux-perf.mjs. Once `__cv.getRemotes().length >= 100` (all of them
// connected, 90 %+ standing in the hall) it samples SAMPLE_MS (20 s):
//
//   - fps: the mean over the window, and the "하위 5 %" = the fps of the slowest 5 % of frames (1000 / p95 of the
//     frame times). Every animation frame is timestamped in the page.
//   - once a second: `__cvRenderInfo()` (draw calls, triangles, geometries, textures) and `performance.memory.usedJSHeapSize`
//   - once a second, when `window.__cvAvatars` exists (Task 5 on; a function, a Map or the object itself): the number of
//     entries, how many entries lack a numeric `drawMeshes` / `triangles`, the largest `drawMeshes`, the mean `triangles`.
//
// One run is noisy (draw calls moved -3 %..+5 % between three runs of the same KayKit build), so the judged number is the
// MEAN of the RUNS per-run means. Between runs the script waits GAP_MS (default 25 s) so the previous tab's ghost (the
// server holds a dropped seat for 20 s) is gone and every run sees the same 100 remotes.
//
// Headless fps is a REFERENCE only; the 30 fps goal on a real phone is judged by the owner in Task 11.
//
// Gates (toy only; exit 1 if any fails):
//   the toy run is comparable to the KayKit baseline: same CPU throttle, sample length, renderer kind (hardware GPU),
//     crowd size, hall zone and scene (viewport, DPR, hall spot, minimum bots) — otherwise it fails with the reason
//   in EVERY run: `__cvAvatars` was there in every 1 s sample, every entry carries a numeric `drawMeshes` and `triangles`,
//     the smallest entry count is >= 100, the largest `drawMeshes` is >= 1 and <= 8 (MAX_DRAW_MESHES)
//   mean draw calls (mean over the runs) <= the mean draw calls of perf-kaykit.json (itself the mean of its runs)
// Exit code 0 = no gate failed, the 100-player scene was really there in every run, and no console/page error.
//
// Evidence -> .superpowers/sdd/evidence/task-char/perf-<label>.json and perf-<label>-run<k>.png (kaykit with --baseline,
// toy otherwise). The JSON holds `runs[]` and, at the top level, the aggregate of the same shape a single run has.
//
// Knobs: CV_PERF_RUNS (runs, default 3), CV_PERF_GAP_MS (default 25000), CV_PERF_MS (sample length, default 20000),
// CV_PERF_THROTTLE (CPU slowdown, default 4; 1 = none), CV_PERF_MIN_BOTS (default 100; smaller only for smoke tests of this
// script — it is recorded in `scene` and a baseline made with another value is not comparable), CV_CHAR_EVIDENCE_DIR
// (default .superpowers/sdd/evidence/task-char), CV_CLIENT_URL (default http://localhost:5173), CV_CHROME_PATH,
// CV_E2E_RENDER=software (SwiftShader on purpose: the hardware-GPU check is skipped).
//
// The pure judging helpers are exported so they can be checked against fixture JSON without a browser; the measuring
// run itself only starts when this file is executed directly.

import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASELINE = process.argv.includes("--baseline");
const LABEL = BASELINE ? "kaykit" : "toy";
const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
// Task 14 (AI 학교 탈출): "/" opens the school entry now; the world is entered through its legacy link.
const ENTRY_URL = new URL("/?world=legacy", CLIENT_URL).href;
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;
const SAMPLE_MS = Number(process.env.CV_PERF_MS || 20000);
const THROTTLE = Number(process.env.CV_PERF_THROTTLE || 4);
const RUNS = Math.max(1, Math.floor(Number(process.env.CV_PERF_RUNS || 3)));
const GAP_MS = Number(process.env.CV_PERF_GAP_MS || 25000);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const EVIDENCE = process.env.CV_CHAR_EVIDENCE_DIR
  ? resolve(process.env.CV_CHAR_EVIDENCE_DIR)
  : join(REPO, ".superpowers", "sdd", "evidence", "task-char");

const PORTRAIT = { width: 375, height: 812 };
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const NICKNAME = "성능측정";
const HALL_SPOT = { x: 12, z: 0 }; // the z = 0 aisle, mid-hall: clear of desks (as task-ux-perf.mjs)
const MIN_BOTS = Math.max(1, Math.floor(Number(process.env.CV_PERF_MIN_BOTS || 100)));
const MAX_DRAW_MESHES = 8;
const MIN_AVATARS = 100;
const SOFTWARE_RENDER = process.env.CV_E2E_RENDER === "software";

/** The scene a run measures. Written into every JSON; a toy run is only comparable to a baseline with the same scene. */
export const SCENE = {
  viewport: PORTRAIT,
  deviceScaleFactor: 2,
  hallSpot: HALL_SPOT,
  minBots: MIN_BOTS,
  zone: "lectureHall",
};

// ───────────────────────────── pure helpers (exported, no browser) ─────────────────────────────

const r2 = (n) => Math.round(n * 100) / 100;
const fmtInt = (n) => Number(n).toLocaleString("en-US");
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const mean = (v) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN);

function pct(sorted, p) {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

/** "software" for SwiftShader-like renderer strings, otherwise "hardware". */
export function rendererKind(gpu) {
  return /swiftshader|software/i.test(String(gpu)) ? "software" : "hardware";
}

/**
 * Runs in every document before the app: the rAF timestamp of EVERY frame, and once a second the render counters,
 * the JS heap and (when it exists) the avatar probe. Exported so it can be exercised in a page with a fake probe.
 */
export function installRecorder() {
  const rec = { t: [], samples: [] };
  window.__perfRec = rec;
  const loop = (now) => {
    rec.t.push(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  setInterval(() => {
    const s = { t: performance.now(), render: null, heap: null, avatars: null, avatarsError: null };
    if (typeof window.__cvRenderInfo === "function") s.render = window.__cvRenderInfo();
    if (performance.memory) s.heap = performance.memory.usedJSHeapSize;
    const probe = window.__cvAvatars;
    if (probe) {
      try {
        const data = typeof probe === "function" ? probe() : probe;
        const values = data instanceof Map ? Array.from(data.values()) : Object.values(data || {});
        const num = (x) => typeof x === "number" && Number.isFinite(x);
        let invalid = 0; // entries that do not carry a numeric drawMeshes AND triangles
        let maxDrawMeshes = 0;
        let triSum = 0;
        let triN = 0;
        for (const v of values) {
          if (!v || typeof v !== "object" || !num(v.drawMeshes) || !num(v.triangles)) {
            invalid++;
            continue;
          }
          if (v.drawMeshes > maxDrawMeshes) maxDrawMeshes = v.drawMeshes;
          triSum += v.triangles;
          triN++;
        }
        s.avatars = { count: values.length, invalid, maxDrawMeshes, meanTriangles: triN ? triSum / triN : 0 };
      } catch (err) {
        s.avatarsError = String(err && err.message ? err.message : err);
      }
    }
    rec.samples.push(s);
  }, 1000);
}

/**
 * The once-a-second avatar samples of one window. null when no sample saw `__cvAvatars` at all (the KayKit build).
 * `samples` of `of` is how many of the window's 1 s samples saw it — a gate needs all of them, or a single late sample
 * could carry the verdict.
 */
export function summarizeAvatars(samples) {
  const seen = samples.filter((s) => s.avatars);
  if (seen.length === 0) return null;
  const av = seen.map((s) => s.avatars);
  return {
    samples: seen.length,
    of: samples.length,
    invalidEntries: Math.max(...av.map((a) => a.invalid)), // the most entries any one sample found without numbers
    entriesMin: Math.min(...av.map((a) => a.count)),
    entriesMax: Math.max(...av.map((a) => a.count)),
    maxDrawMeshes: Math.max(...av.map((a) => a.maxDrawMeshes)),
    meanTriangles: Math.round(mean(av.map((a) => a.meanTriangles))),
  };
}

/** fps, render counters, heap and avatars of one sample window [t0, t1] from the in-page recording. */
export function summarizeRun(rec, t0, t1) {
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
  const samples = rec.samples.filter((s) => s.t >= t0 && s.t <= t1);
  const renders = samples.map((s) => s.render).filter(Boolean);
  const heaps = samples.map((s) => s.heap).filter(finite);
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
  const avatarsError = samples.map((s) => s.avatarsError).find(Boolean) || null;
  return { fps, render, heap, avatars: summarizeAvatars(samples), avatarsError, samplesInWindow: samples.length };
}

/**
 * The aggregate of several runs, in the shape a single run has (so `render.calls.mean` etc. read the same everywhere):
 * every `mean` is the mean of the runs' means; min / max are over all runs. `heap` averages only the runs that have one.
 */
export function aggregateRuns(runs) {
  const avg = (xs) => mean(xs.filter(finite));
  const maxOf = (xs) => {
    const v = xs.filter(finite);
    return v.length ? Math.max(...v) : null;
  };
  const heapRuns = runs.filter((r) => r.heap);
  const avatarRuns = runs.map((r) => r.avatars);
  const everyRunHasAvatars = runs.length > 0 && avatarRuns.every(Boolean);
  return {
    runCount: runs.length,
    fps: { mean: r2(avg(runs.map((r) => r.fps.mean))), low5: r2(avg(runs.map((r) => r.fps.low5))) },
    render: {
      calls: {
        mean: r2(avg(runs.map((r) => r.render.calls.mean))),
        min: Math.min(...runs.map((r) => r.render.calls.min)),
        max: Math.max(...runs.map((r) => r.render.calls.max)),
      },
      triangles: {
        mean: Math.round(avg(runs.map((r) => r.render.triangles.mean))),
        min: Math.min(...runs.map((r) => r.render.triangles.min)),
        max: Math.max(...runs.map((r) => r.render.triangles.max)),
      },
      geometries: { mean: Math.round(avg(runs.map((r) => r.render.geometries.last))), max: maxOf(runs.map((r) => r.render.geometries.max)) },
      textures: { mean: Math.round(avg(runs.map((r) => r.render.textures.last))), max: maxOf(runs.map((r) => r.render.textures.max)) },
    },
    heap: heapRuns.length
      ? { runs: heapRuns.length, meanMiB: r2(avg(heapRuns.map((r) => r.heap.meanMiB))), maxMiB: r2(Math.max(...heapRuns.map((r) => r.heap.maxMiB))) }
      : null,
    avatars: everyRunHasAvatars
      ? {
          entriesMin: Math.min(...avatarRuns.map((a) => a.entriesMin)),
          entriesMax: Math.max(...avatarRuns.map((a) => a.entriesMax)),
          maxDrawMeshes: Math.max(...avatarRuns.map((a) => a.maxDrawMeshes)),
          invalidEntries: Math.max(...avatarRuns.map((a) => a.invalidEntries)),
          meanTriangles: Math.round(avg(avatarRuns.map((a) => a.meanTriangles))),
        }
      : null,
  };
}

/**
 * The toy avatar gates for ONE run. A gate can not pass vacuously: the probe has to be in every 1 s sample, every entry
 * has to carry a numeric drawMeshes and triangles (else the max of "nothing" would read 0), and something has to be drawn.
 * Returns [{ name, ok, detail }].
 */
export function judgeAvatars(av, avatarsError = null, cfg = { minAvatars: MIN_AVATARS, maxDrawMeshes: MAX_DRAW_MESHES }) {
  const out = [];
  const add = (name, ok, detail) => out.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
  if (!av) {
    add("GATE __cvAvatars exists", false, avatarsError ? { error: avatarsError } : "window.__cvAvatars was never there");
    return out;
  }
  add(`GATE __cvAvatars was there in every 1 s sample (${av.samples}/${av.of})`, av.samples === av.of && av.of > 0, { samples: av.samples, of: av.of, error: avatarsError });
  add(`GATE every __cvAvatars entry has a numeric drawMeshes and triangles (${av.invalidEntries} without)`, av.invalidEntries === 0);
  add(`GATE __cvAvatars entries (smallest count) ${av.entriesMin} >= ${cfg.minAvatars}`, av.entriesMin >= cfg.minAvatars);
  add(`GATE avatars really draw: largest drawMeshes ${av.maxDrawMeshes} >= 1`, av.maxDrawMeshes >= 1);
  add(`GATE largest drawMeshes ${av.maxDrawMeshes} <= ${cfg.maxDrawMeshes}`, av.maxDrawMeshes <= cfg.maxDrawMeshes);
  return out;
}

/**
 * Whether a toy result and the baseline JSON measured the same thing. `cur` = { throttle, sampleMs, scene, runs: [{ renderer, crowd }] }.
 * Every failing item says what differs, so the cure (re-run with the same settings, or re-baseline) is obvious.
 */
export function checkEquivalence(base, cur) {
  const out = [];
  const add = (name, ok, detail) => out.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
  const baseRuns = Array.isArray(base.runs) ? base.runs : [];
  add(`EQUIV CPU throttle ${cur.throttle}x = baseline ${base.throttle}x`, base.throttle === cur.throttle, { baseline: base.throttle, now: cur.throttle });
  add(`EQUIV sample length ${cur.sampleMs} ms = baseline ${base.sampleMs} ms`, base.sampleMs === cur.sampleMs, { baseline: base.sampleMs, now: cur.sampleMs });

  const kinds = (rs) => [...new Set(rs.filter(Boolean).map((g) => g.kind || rendererKind(g.gpu)))];
  const baseKinds = kinds([base.renderer, ...baseRuns.map((r) => r.renderer)]);
  const curKinds = kinds(cur.runs.map((r) => r.renderer));
  add(
    `EQUIV renderer kind ${curKinds.join("/") || "?"} = baseline ${baseKinds.join("/") || "?"}`,
    baseKinds.length === 1 && curKinds.length === 1 && baseKinds[0] === curKinds[0],
    { baseline: baseKinds, now: curKinds },
  );

  const totals = (rs) => [...new Set(rs.map((r) => r.crowd && r.crowd.total))];
  const baseTotals = totals(baseRuns.length ? baseRuns : [base]);
  const curTotals = totals(cur.runs);
  add(
    `EQUIV crowd size ${curTotals.join("/")} remotes = baseline ${baseTotals.join("/")}`,
    baseTotals.length === 1 && curTotals.length === 1 && finite(baseTotals[0]) && baseTotals[0] === curTotals[0],
    { baseline: baseTotals, now: curTotals },
  );
  const inHallShare = (rs) => rs.map((r) => (r.crowd && r.crowd.total ? r.crowd.inHall / r.crowd.total : 0));
  const hallOk = (rs) => inHallShare(rs).every((x) => x >= 0.9);
  add("EQUIV crowd zone: 90%+ of the remotes in the lecture hall, in the baseline and now", hallOk(baseRuns.length ? baseRuns : [base]) && hallOk(cur.runs), {
    baseline: inHallShare(baseRuns.length ? baseRuns : [base]).map(r2),
    now: inHallShare(cur.runs).map(r2),
  });

  if (!base.scene) {
    add("EQUIV scene (viewport, DPR, hall spot, minimum bots, zone) is recorded in the baseline", false, "the baseline JSON has no `scene` block — re-baseline");
  } else {
    for (const key of Object.keys(cur.scene)) {
      add(`EQUIV scene.${key} = baseline`, JSON.stringify(base.scene[key]) === JSON.stringify(cur.scene[key]), { baseline: base.scene[key], now: cur.scene[key] });
    }
  }
  return out;
}

/** The draw-call gate: the toy mean (mean of its runs) against the baseline mean (mean of ITS runs). */
export function judgeAgainstBaseline(agg, base) {
  const out = [];
  const add = (name, ok, detail) => out.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
  const baseMean = base && base.render && base.render.calls ? base.render.calls.mean : NaN;
  if (!finite(baseMean)) {
    add("GATE perf-kaykit.json has a mean draw call count to compare against", false, "missing or unreadable");
    return out;
  }
  const baseRuns = Array.isArray(base.runs) ? base.runs.length : 1;
  add(
    `GATE mean draw calls ${agg.render.calls.mean} (mean of ${agg.runCount} runs) <= KayKit ${baseMean} (mean of ${baseRuns} runs)`,
    agg.render.calls.mean <= baseMean,
    { toy: agg.render.calls.mean, kaykit: baseMean },
  );
  return out;
}

// ───────────────────────────── the measuring run ─────────────────────────────

const IS_MAIN = (() => {
  try {
    return !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase();
  } catch {
    return false;
  }
})();

if (IS_MAIN) await main();

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  const results = [];
  const errors = [];
  let tag = "";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const record = (row) => {
    results.push(row);
    const text = row.detail === null ? "" : "  " + (typeof row.detail === "string" ? row.detail : JSON.stringify(row.detail));
    console.log(`${row.ok ? "PASS" : "FAIL"}  ${row.name}${text}`);
  };
  const check = (name, ok, detail) => record({ name: tag + name, ok: !!ok, detail: detail === undefined ? null : detail });
  const checkAll = (rows) => rows.forEach((r) => check(r.name, r.ok, r.detail));

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
      errors.push(`${tag}console.error: ${text}`);
    });
    page.on("pageerror", (err) => errors.push(`${tag}pageerror: ${err.message}`));
    page.on("response", (r) => {
      if (r.status() >= 400 && r.url().startsWith(CLIENT_ORIGIN)) errors.push(`${tag}local ${r.status()}: ${r.url()}`);
    });
  }

  // page helpers (the walk-to-hall routine of task-ux-perf.mjs)
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
    // `*=`: the Task 7b placeholder is "이름을 지어 주세요 (2~12자)" (same match as task-char-load.mjs).
    const input = page.locator('input.cv-input[placeholder*="2~12자"]');
    await input.waitFor({ state: "visible", timeout: 30000 });
    await input.fill(nickname);
    await page.locator(".cv-submit").click();
    await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, { timeout: 60000 });
    await page.locator("canvas").first().waitFor({ state: "visible", timeout: 30000 });
    await sleep(1200);
  }

  /** One full measurement in a fresh browser. Returns the run object (or throws when the browser part fails). */
  async function measureOnce(k) {
    tag = RUNS > 1 ? `[run ${k}/${RUNS}] ` : "";
    console.log(`\n── run ${k}/${RUNS}`);
    const run = { run: k, startedAt: new Date().toISOString() };
    let measured = null;
    const browser = await launchBrowser();
    try {
      const ctx = await browser.newContext({
        viewport: PORTRAIT,
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: SCENE.deviceScaleFactor,
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

      await page.goto(ENTRY_URL, { waitUntil: "domcontentloaded" });
      await enterWorld(page, NICKNAME);
      check("DEV render probe is installed (window.__cvRenderInfo)", await pollUntil(() => page.evaluate(() => typeof window.__cvRenderInfo === "function"), (v) => v, 10000));

      // Which renderer is this run on? (a software renderer would make every frame number meaningless)
      const renderer = await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl");
        const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
        return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, cores: navigator.hardwareConcurrency };
      });
      run.renderer = { ...renderer, kind: rendererKind(renderer.gpu) };
      console.log("renderer:", JSON.stringify(run.renderer));
      if (SOFTWARE_RENDER) {
        check("hardware GPU check skipped: CV_E2E_RENDER=software asked for the software renderer (frame numbers are a reference only)", true, run.renderer);
      } else {
        check("a hardware GPU renderer (not SwiftShader)", run.renderer.kind === "hardware", run.renderer);
      }

      await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
      check(`CPU throttled ${THROTTLE}x`, true, { rate: THROTTLE });

      const spot = await walkTo(page, HALL_SPOT.x, HALL_SPOT.z);
      check("the tab stands in the lecture hall aisle", spot.x > 8 && Math.abs(spot.z) < 3, { x: r2(spot.x), z: r2(spot.z) });

      // The "강의실 100명" precondition: the bots are really in the hall, and no ghost of an earlier tab is left.
      const crowdOf = async () => {
        const rs = await getRemotes(page);
        return { total: rs.length, inHall: rs.filter((r) => r.x > 0).length, ghosts: rs.filter((r) => r.connected === false).length };
      };
      const crowd = await pollUntil(crowdOf, (c) => c.total >= MIN_BOTS && c.inHall >= c.total * 0.9 && c.ghosts === 0, 120000, 500);
      check(`${MIN_BOTS}+ remotes in the room, 90%+ of them inside the hall, no disconnected ghost`, crowd.total >= MIN_BOTS && crowd.inHall >= crowd.total * 0.9 && crowd.ghosts === 0, crowd);
      run.crowd = crowd;
      await sleep(4000); // everyone is mounted; the first frames of the full scene settle

      // The sample window: hold Z so the camera turns and every view direction counts equally.
      await page.keyboard.down("z");
      const t0 = await page.evaluate(() => performance.now());
      await sleep(SAMPLE_MS);
      const t1 = await page.evaluate(() => performance.now());
      await page.keyboard.up("z");
      const rec = await page.evaluate(() => ({ t: window.__perfRec.t, samples: window.__perfRec.samples }));
      await page.screenshot({ path: join(EVIDENCE, `perf-${LABEL}-run${k}.png`) });
      const after = await crowdOf();
      run.crowdAfter = after;
      measured = { rec, t0, t1 };
    } finally {
      await browser.close();
    }
    run.endedAt = new Date().toISOString();

    const s = summarizeRun(measured.rec, measured.t0, measured.t1);
    Object.assign(run, { fps: s.fps, render: s.render, heap: s.heap, avatars: s.avatars, avatarsError: s.avatarsError, samplesInWindow: s.samplesInWindow });

    console.log(`fps 평균 ${s.fps.mean} / 하위 5% ${s.fps.low5} (프레임 ${s.fps.frames}개, 프레임 시간 p50 ${s.fps.frameMs.p50} p95 ${s.fps.frameMs.p95} p99 ${s.fps.frameMs.p99} max ${s.fps.frameMs.max} ms)`);
    console.log(`draw calls 평균 ${s.render.calls.mean} (${s.render.calls.min}~${s.render.calls.max}), triangles 평균 ${fmtInt(s.render.triangles.mean)} (${fmtInt(s.render.triangles.min)}~${fmtInt(s.render.triangles.max)}), geometries ${s.render.geometries.last}, textures ${s.render.textures.last}`);
    console.log(`JS heap ${s.heap ? `평균 ${s.heap.meanMiB} MiB / 최대 ${s.heap.maxMiB} MiB` : "(performance.memory 없음)"}`);
    console.log(
      `__cvAvatars ${s.avatars ? `${s.avatars.samples}/${s.avatars.of} 샘플, 항목 ${s.avatars.entriesMin}~${s.avatars.entriesMax} (규격 밖 ${s.avatars.invalidEntries}), 최대 drawMeshes ${s.avatars.maxDrawMeshes}, 평균 triangles ${fmtInt(s.avatars.meanTriangles)}` : "없음"}`,
    );

    check("recorded a usable number of frames", s.fps.frames >= 40, { frames: s.fps.frames, fps: s.fps.mean });
    check("render counters were sampled (__cvRenderInfo)", s.render.samples >= Math.floor(SAMPLE_MS / 1000) - 3 && s.render.calls.max > 0, { samples: s.render.samples });
    check("the heap was sampled (performance.memory)", !!s.heap);
    if (!BASELINE) checkAll(judgeAvatars(s.avatars, s.avatarsError));
    return run;
  }

  // ── the runs ──
  const report = {
    label: LABEL,
    baseline: BASELINE,
    clientUrl: CLIENT_URL,
    startedAt: new Date().toISOString(),
    throttle: THROTTLE,
    sampleMs: SAMPLE_MS,
    runsRequested: RUNS,
    gapMs: GAP_MS,
    nickname: NICKNAME,
    scene: SCENE,
  };
  const runs = [];
  for (let k = 1; k <= RUNS; k++) {
    if (k > 1) {
      console.log(`\n(${GAP_MS / 1000} s pause so the previous tab's ghost leaves the room)`);
      await sleep(GAP_MS);
    }
    try {
      runs.push(await measureOnce(k));
    } catch (err) {
      check("the run went to the end", false, String(err && err.stack ? err.stack : err));
      break;
    }
  }
  tag = "";

  if (runs.length > 0) {
    report.renderer = runs[0].renderer;
    report.crowd = runs[0].crowd;
    report.runs = runs;
    Object.assign(report, aggregateRuns(runs));
    const { fps, render, heap, avatars } = report;
    console.log(`\n══ 강의실 100명 렌더 (${LABEL}, CPU ${THROTTLE}x 느리게, 샘플 ${SAMPLE_MS / 1000}초 × ${runs.length}회의 평균) ══`);
    console.log(`fps 평균 ${fps.mean} / 하위 5% ${fps.low5}`);
    console.log(`draw calls 평균 ${render.calls.mean} (${render.calls.min}~${render.calls.max}), triangles 평균 ${fmtInt(render.triangles.mean)} (${fmtInt(render.triangles.min)}~${fmtInt(render.triangles.max)}), geometries ${render.geometries.mean}, textures ${render.textures.mean}`);
    console.log(`JS heap ${heap ? `평균 ${heap.meanMiB} MiB / 최대 ${heap.maxMiB} MiB (${heap.runs}회)` : "(performance.memory 없음)"}`);
    console.log(`__cvAvatars ${avatars ? `항목 ${avatars.entriesMin}~${avatars.entriesMax}, 최대 drawMeshes ${avatars.maxDrawMeshes}, 평균 triangles ${fmtInt(avatars.meanTriangles)}` : "없음"}`);
  }

  check(`all ${RUNS} runs finished`, runs.length === RUNS, { finished: runs.length });

  if (!BASELINE && runs.length > 0) {
    const base = readBaseline();
    if (!base.json) {
      check("GATE perf-kaykit.json is there to compare against", false, base.error);
    } else {
      const equiv = checkEquivalence(base.json, { throttle: THROTTLE, sampleMs: SAMPLE_MS, scene: SCENE, runs });
      checkAll(equiv);
      const notSame = equiv.filter((r) => !r.ok);
      if (notSame.length > 0) {
        console.log(
          "\nThis toy run is NOT comparable to perf-kaykit.json, so its numbers say nothing about the swap: " +
            notSame.map((r) => r.name).join("; ") +
            ". Re-run with the baseline's settings, or re-baseline the KayKit numbers (--baseline) if the settings were changed on purpose.",
        );
      }
      checkAll(judgeAgainstBaseline(report, base.json));
      report.kaykit = { runs: Array.isArray(base.json.runs) ? base.json.runs.length : 1, fps: base.json.fps, render: base.json.render, heap: base.json.heap };
      report.comparison = {
        callsToy: report.render.calls.mean,
        callsKaykit: base.json.render.calls.mean,
        equivalent: equiv.every((r) => r.ok),
      };
    }
  }

  check("no console error or page error on the tabs", errors.length === 0, errors.slice(0, 5));
  report.endedAt = new Date().toISOString();
  report.results = results;
  report.errors = errors;
  const failed = results.filter((r) => !r.ok);
  report.ok = failed.length === 0;
  writeFileSync(join(EVIDENCE, `perf-${LABEL}.json`), JSON.stringify(report, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed -> ${join(EVIDENCE, `perf-${LABEL}.json`)}`);
  for (const f of failed) console.log(`FAIL ${f.name}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

function readBaseline() {
  const file = join(EVIDENCE, "perf-kaykit.json");
  if (!existsSync(file)) return { json: null, error: `${file} does not exist — run with --baseline first` };
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    if (!(j && j.render && j.render.calls && Number.isFinite(j.render.calls.mean))) return { json: null, error: `${file} has no render.calls.mean` };
    return { json: j, error: null };
  } catch (err) {
    return { json: null, error: `${file} is not readable JSON: ${err.message}` };
  }
}
