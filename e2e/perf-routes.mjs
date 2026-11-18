/**
 * e2e/perf-routes.mjs — frame-time and hitch budget of the village's scripted routes (perf/no-hitch, 2026-11-17; owner:
 * "게임내에서 끊김이 없도록", "100명이 플레이하는데 끊김이나 렉이나 이런게 걸리면 안돼").
 *
 * One tab walks the routes below (each one is a "phase"); every animation frame is recorded in the page, with the WebGL
 * work done inside it (shader compiles / program links, texture and buffer uploads, timed by wrapping the context's
 * methods), and with a CPU profile (CDP Profiler) the hitches are attributed to the functions that ran in them
 * (garbage collection shows as "(garbage collector)"). Draw calls, triangles, programs, GPU textures/geometries and the
 * JS heap are sampled once a second.
 *
 *   entry     the entry screen → the village (load time; the vegetation veil); not judged (loading screen)
 *   plaza     stand, orbit the camera round, walk round the fountain
 *   map       open the 🗺 map (the camera rises over the whole village), close it, open it again
 *   crowd     stand on the plaza looking at the other players (run bots alongside: see below)
 *   daynight  the clock swept noon → sunset → night → morning (the DEV pin, villageClock.pin), a frame budget all the way
 *   hall      to the memorial's door, in, a walk inside, out again
 *   house     to house 1, the keypad (1004), in, out
 *   lake      to the lake, rent the rod, sit at a fishing chair, cast once, get up
 *   wheel     (after park) one whole ride on the 하늘 등불 바퀴
 *   park      (after lake) to the gate, into Caysonland, along the promenade to the carousel and the wheel and back
 *   bus       to the stop; boards if the boarding window is open and the bus leaves within --bus-wait s, rides a lap
 *
 * Verdict (exit 1 on failure): after the warm-up (--warmup, default 4 s after the vegetation veil lifts), no frame
 * interval over --max-hitch ms (default 100) while nothing covers the screen (the door fade, the house cover and the veil
 * are loading screens; hitches under them are reported, not judged).
 *
 * Stack (DEV client: the probes are DEV only):
 *   (cd server && PORT=3109 npx tsx src/index.ts)                    # CV_DEV_CLOCK_OFFSET_MS=<ms> to bring a bus departure near
 *   (cd client && VITE_SERVER_URL=http://localhost:3109 npx vite --port 5709 --strictPort)
 *   CV_CLIENT_URL=http://localhost:5709 node e2e/perf-routes.mjs --device pc|phone [--routes plaza,hall] [--label before]
 *        [--throttle 4] [--max-hitch 100] [--out <dir>] [--bots 29 --endpoint http://localhost:3109] [--no-profile]
 *
 * --bots N starts loadtest/village.ts with N bots first (the tab is the N+1th player of their room).
 * Output: <out>/perf-<device>-<label>.json (per phase: p50/p95/p99/max frame ms, hitches with their causes, GL work,
 * render stats), <out>/perf-<device>-<label>-<phase>.cpuprofile (open in Chrome DevTools › Performance).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { CLIENT_URL, DESKTOP, PHONE, REPO, cdp, createRun, entryReady, launchBrowser, openPlayer, pos, press, sleep, walkAndWait } from "./lib/common.mjs";
import { DOOR_ROUTE, act, enterHall, leaveHall } from "./lib/village.mjs";
import { bigButton, waitButton } from "./lib/lakeMock.mjs";

const { values: args } = parseArgs({
  options: {
    device: { type: "string", default: "pc" },
    routes: { type: "string", default: "entry,plaza,map,crowd,daynight,hall,house,lake,bus" },
    label: { type: "string", default: "run" },
    throttle: { type: "string" },
    "max-hitch": { type: "string", default: "100" },
    warmup: { type: "string", default: "4000" },
    out: { type: "string" },
    time: { type: "string", default: "2026-11-03T12:30" },
    graphics: { type: "string" },
    bots: { type: "string", default: "0" },
    endpoint: { type: "string", default: "http://localhost:3109" },
    "bus-wait": { type: "string", default: "200" },
    "no-profile": { type: "boolean", default: false },
    "crowd-ms": { type: "string", default: "15000" },
    /** extra page query, e.g. gate=off (DEV: the shader gate left out, to compare) */
    query: { type: "string" },
  },
});
const PHONE_DEV = args.device === "phone";
const device = PHONE_DEV ? PHONE : DESKTOP;
const THROTTLE = Number(args.throttle ?? (PHONE_DEV ? 4 : 1));
const MAX_HITCH = Number(args["max-hitch"]);
const WARMUP = Number(args.warmup);
const ROUTES = args.routes.split(",").map((s) => s.trim()).filter(Boolean);
const OUT = args.out ?? join(REPO, ".superpowers", "sdd", "evidence", "perf-routes");
const PROFILE = !args["no-profile"];
const BOTS = Number(args.bots);
mkdirSync(OUT, { recursive: true });
const tagName = `perf-${args.device}-${args.label}`;
const run = createRun(tagName);
run.evidence = OUT;
run.allow("D3D X3595 (village shaders, baseline)", /X3595/);
run.allow("WebGL performance warnings (GPU stall readback)", /GPU stall due to ReadPixels|GL_CLOSE_PATH_NV|WebGL: too many/);

// ───────────────────────────── the in-page recorder ─────────────────────────────
// Installed before any page script: wraps the WebGL contexts' expensive calls and keeps one record per animation frame.
function recorder() {
  const R = (window.__perf = {
    phase: "boot",
    t: [], // rAF timestamps
    ph: [], // phase of each frame
    cover: [], // 1 when a loading cover was up at that frame
    gl: [], // [compileMs, links, uploadMs, uploads, bufferMs] of the work since the previous frame
    loaf: [],
    samples: [],
    acc: { compileMs: 0, links: 0, uploadMs: 0, uploads: 0, bufferMs: 0 },
    covered: 0,
    draws: [], // [calls, triangles] of each frame (all its render passes: info.autoReset is turned off, reset here)
    programs: [], // programs as three made them: { t, phase, name, key }
    slow: [], // GL calls over 30 ms: { t, phase, name, ms, stack }
  });
  const wrap = (proto, name, kind) => {
    const f = proto[name];
    if (!f) return;
    proto[name] = function (...a) {
      const t0 = performance.now();
      const r = f.apply(this, a);
      const d = performance.now() - t0;
      const acc = R.acc;
      if (d > 30 && R.slow.length < 200) R.slow.push({ t: Math.round(t0), phase: R.phase, name, ms: Math.round(d), stack: (new Error().stack || "").split(String.fromCharCode(10)).slice(2, 14).map((l) => l.trim().replace(/https?:\/\/[^/]+/, "").replace(/\?[^:)]*/, "")).join(" < ") });
      if (kind === "c") {
        acc.compileMs += d;
        if (name === "linkProgram") acc.links++;
      } else if (kind === "u") {
        acc.uploadMs += d;
        acc.uploads++;
      } else acc.bufferMs += d;
      return r;
    };
  };
  for (const C of [self.WebGL2RenderingContext, self.WebGLRenderingContext]) {
    if (!C) continue;
    const p = C.prototype;
    // getProgramParameter / getShaderParameter / useProgram block until a pending (parallel) compile is done
    for (const n of ["compileShader", "linkProgram", "getProgramParameter", "getShaderParameter", "getProgramInfoLog", "useProgram"]) wrap(p, n, "c");
    for (const n of ["texImage2D", "texSubImage2D", "texImage3D", "texSubImage3D", "compressedTexImage2D", "compressedTexSubImage2D", "texStorage2D", "generateMipmap"]) wrap(p, n, "u");
    for (const n of ["bufferData", "bufferSubData"]) wrap(p, n, "b");
  }
  const seenProg = new Set();
  const loop = (now) => {
    const a = R.acc;
    const th = window.__cvThree?.();
    const info = th?.gl?.info;
    if (info) {
      if (info.autoReset) info.autoReset = false;
      R.draws.push([info.render.calls, info.render.triangles]);
      info.reset();
      const progs = info.programs;
      if (progs && progs.length !== seenProg.size) {
        for (const pr of progs) {
          if (seenProg.has(pr.id)) continue;
          seenProg.add(pr.id);
          R.programs.push({ t: Math.round(now), phase: R.phase, name: pr.name, key: String(pr.cacheKey).slice(0, 160) });
        }
      }
    } else R.draws.push([0, 0]);
    R.t.push(now);
    R.ph.push(R.phase);
    R.cover.push(R.covered);
    R.gl.push([+a.compileMs.toFixed(2), a.links, +a.uploadMs.toFixed(2), a.uploads, +a.bufferMs.toFixed(2)]);
    a.compileMs = a.links = a.uploadMs = a.uploads = a.bufferMs = 0;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // loading covers (polled, never per frame): the vegetation veil, the door fade, the house cover, the hall curtain
  setInterval(() => {
    let c = 0;
    for (const sel of [".cv-veg-veil", ".cv-door-fade", ".cv-house-cover", ".cv-curtain", ".cv-loading"]) {
      const e = document.querySelector(sel);
      if (!e) continue;
      const o = parseFloat(getComputedStyle(e).opacity || "1");
      if (o > 0.35 || e.getAttribute("data-covered") === "1") c = 1;
    }
    if (window.__cv?.getScreen?.() !== "village") c = 1;
    R.covered = c;
  }, 50);
  setInterval(() => {
    const th = window.__cvThree?.();
    const info = th?.gl?.info;
    R.samples.push({
      t: performance.now(),
      phase: R.phase,
      programs: info?.programs?.length ?? null,
      textures: info?.memory.textures ?? null,
      geometries: info?.memory.geometries ?? null,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      remotes: window.__cv?.getRemotes ? Object.keys(window.__cv.getRemotes() ?? {}).length : null,
      dpr: th?.gl?.getPixelRatio?.() ?? null,
    });
  }, 1000);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        R.loaf.push({
          start: e.startTime,
          dur: e.duration,
          block: e.blockingDuration,
          phase: R.phase,
          scripts: (e.scripts ?? []).slice(0, 4).map((s) => ({ inv: s.invoker, fn: s.sourceFunctionName, src: (s.sourceURL || "").split("/").slice(-1)[0], dur: Math.round(s.duration) })),
        });
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch {}
}

// ───────────────────────────── CPU-profile attribution ─────────────────────────────
/** For each window [a, b] (page ms), the top self-time functions in it. `offset` maps profile µs to page ms. */
function attribute(profile, windows, offset) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const label = (n) => {
    const f = n.callFrame;
    const file = (f.url || "").split("/").slice(-1)[0].split("?")[0];
    return `${f.functionName || "(anon)"}${file ? ` ${file}:${f.lineNumber + 1}` : ""}`;
  };
  // the first frame up the stack from our own source (client/src), for a "where in the app" bucket
  const appOf = (id) => {
    let k = id;
    let best = null;
    while (k !== undefined) {
      const n = byId.get(k);
      const u = n?.callFrame.url ?? "";
      if (u.includes("/src/") && !u.includes("node_modules")) best = n;
      k = parent.get(k);
      if (best && u.includes("/src/")) break;
    }
    return best ? label(best) : null;
  };
  const times = [];
  let t = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    t += profile.timeDeltas[i];
    times.push(t / 1000 - offset);
  }
  return windows.map(([a, b]) => {
    const self = new Map();
    const app = new Map();
    let n = 0;
    for (let i = 0; i < times.length; i++) {
      if (times[i] < a || times[i] > b) continue;
      const node = byId.get(profile.samples[i]);
      if (!node) continue;
      n++;
      const dt = (profile.timeDeltas[i + 1] ?? profile.timeDeltas[i]) / 1000;
      const l = label(node);
      self.set(l, (self.get(l) ?? 0) + dt);
      const ap = appOf(node.id);
      if (ap) app.set(ap, (app.get(ap) ?? 0) + dt);
    }
    const top = (m) => [...m].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${v.toFixed(1)}ms ${k}`);
    let busy = 0;
    for (const [k, v] of self) if (!k.startsWith("(idle)")) busy += v;
    return { samples: n, busyMs: Math.round(busy), gcMs: Math.round([...self].filter(([k]) => k.startsWith("(garbage")).reduce((a, [, v]) => a + v, 0)), self: top(self), app: top(app) };
  });
}

// ───────────────────────────── per-phase statistics ─────────────────────────────
const pct = (s, q) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0);
function phaseStats(rec, phase, judgeFrom) {
  const iv = [];
  const hitches = [];
  let gl = { compileMs: 0, links: 0, uploadMs: 0, uploads: 0, bufferMs: 0 };
  for (let i = 1; i < rec.t.length; i++) {
    if (rec.ph[i] !== phase) continue;
    const d = rec.t[i] - rec.t[i - 1];
    iv.push(d);
    const g = rec.gl[i];
    gl.compileMs += g[0];
    gl.links += g[1];
    gl.uploadMs += g[2];
    gl.uploads += g[3];
    gl.bufferMs += g[4];
    if (d > 50)
      hitches.push({
        at: Math.round(rec.t[i - 1]),
        ms: Math.round(d),
        covered: !!(rec.cover[i] || rec.cover[i - 1]),
        judged: rec.t[i - 1] >= judgeFrom && !(rec.cover[i] || rec.cover[i - 1]),
        gl: { compileMs: g[0], links: g[1], uploadMs: g[2], uploads: g[3], bufferMs: g[4] },
      });
  }
  const s = [...iv].sort((a, b) => a - b);
  let callsSum = 0, callsMax = 0, trisMax = 0, nd = 0;
  for (let i = 1; i < rec.t.length; i++) {
    if (rec.ph[i] !== phase || !rec.draws[i]?.[0]) continue;
    nd++;
    callsSum += rec.draws[i][0];
    callsMax = Math.max(callsMax, rec.draws[i][0]);
    trisMax = Math.max(trisMax, rec.draws[i][1]);
  }
  const samples = rec.samples.filter((x) => x.phase === phase);
  const max = (k) => samples.reduce((m, x) => (x[k] != null && x[k] > m ? x[k] : m), 0);
  const mean = (k) => {
    const v = samples.map((x) => x[k]).filter((x) => x != null);
    return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(0) : null;
  };
  const loaf = rec.loaf.filter((l) => l.phase === phase);
  return {
    frames: iv.length,
    fps: iv.length ? +(1000 / (iv.reduce((a, b) => a + b, 0) / iv.length)).toFixed(1) : 0,
    p50: +pct(s, 0.5).toFixed(1),
    p95: +pct(s, 0.95).toFixed(1),
    p99: +pct(s, 0.99).toFixed(1),
    max: +(s[s.length - 1] ?? 0).toFixed(1),
    over50: hitches.length,
    over100judged: hitches.filter((h) => h.judged && h.ms > MAX_HITCH).length,
    gl: { compileMs: +gl.compileMs.toFixed(1), links: gl.links, uploadMs: +gl.uploadMs.toFixed(1), uploads: gl.uploads, bufferMs: +gl.bufferMs.toFixed(1) },
    render: { callsMean: nd ? Math.round(callsSum / nd) : null, callsMax, trisMax, programs: max("programs"), textures: max("textures"), geometries: max("geometries"), heapMBMax: max("heapMB"), remotes: max("remotes") },
    longFrames: loaf.length,
    loafBlockMs: Math.round(loaf.reduce((a, l) => a + (l.block ?? 0), 0)),
    hitches,
    newPrograms: rec.programs.filter((x) => x.phase === phase).map((x) => `${Math.round(x.t)} ${x.name}`),
    slowGl: rec.slow.filter((x) => x.phase === phase),
  };
}

// ───────────────────────────── the run ─────────────────────────────
let bots = null;
if (BOTS > 0) {
  const status = join(OUT, `bots-${args.label}`);
  bots = spawn(process.execPath, [join(REPO, "loadtest", "run.mjs"), "--endpoint", args.endpoint, "--numClients", String(BOTS), "--duration", "1500", "--doorShare", "0", "--statusDir", status], {
    cwd: join(REPO, "loadtest"),
    stdio: "ignore",
  });
  console.log(`bots: ${BOTS} starting`);
  await sleep(BOTS * 90 + 3000);
}

const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: args.device, device, settings: args.graphics ? { graphics: args.graphics } : {} });
await p.ctx.addInitScript(recorder);
const session = await cdp(p);
if (THROTTLE > 1) await session.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
await session.send("Profiler.enable");
await session.send("Profiler.setSamplingInterval", { interval: 500 });

const setPhase = (ph) => p.page.evaluate((x) => (window.__perf.phase = x), ph).catch(() => {});
const profiles = {};
const pageNow = () => p.page.evaluate(() => performance.now());
let judgeFrom = Infinity;

async function phase(name, body) {
  if (!ROUTES.includes(name)) return;
  console.log(`— ${name}`);
  let offset = null;
  if (PROFILE) {
    // starting the profiler stalls the page once (V8 logs its code): that frame belongs to no phase
    const before = await pageNow();
    const wall0 = Date.now();
    await session.send("Profiler.start");
    const after = await pageNow();
    offset = { pageAt: (before + after) / 2, wall: Date.now() - wall0 };
    await sleep(800);
  }
  await setPhase(name);
  const t0 = Date.now();
  try {
    await body();
    run.check(`${name}: route done`, true);
  } catch (e) {
    run.check(`${name}: route done`, false, String(e?.message ?? e).slice(0, 300));
  }
  await setPhase("between");
  if (PROFILE) {
    const { profile } = await session.send("Profiler.stop");
    profiles[name] = { profile, offset: profile.startTime / 1000 - offset.pageAt };
    writeFileSync(join(OUT, `${tagName}-${name}.cpuprofile`), JSON.stringify(profile));
  }
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await setPhase("between");
}

const veilUp = () => p.page.evaluate(() => {
  const e = document.querySelector(".cv-veg-veil");
  return !!e && (e.getAttribute("data-covered") === "1" || parseFloat(getComputedStyle(e).opacity) > 0.02);
});
const toScreen = (x, y, z) =>
  p.page.evaluate(([x, y, z]) => {
    const t = window.__cvThree?.();
    if (!t) return null;
    const v = new t.camera.position.constructor(x, y, z).project(t.camera);
    const r = t.gl.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, [x, y, z]);
const dragOrbit = async (dx, steps = 30) => {
  const vp = p.page.viewportSize();
  const x0 = vp.width / 2;
  const y0 = vp.height * 0.45;
  if (p.touch) {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0 * 1.4, y: y0 }] });
    for (let s = 1; s <= steps; s++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 * 1.4 + (dx * s) / steps, y: y0 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await p.page.mouse.move(x0, y0);
    await p.page.mouse.down();
    for (let s = 1; s <= steps; s++) await p.page.mouse.move(x0 + (dx * s) / steps, y0, { steps: 1 });
    await p.page.mouse.up();
  }
};
const areaNow = () => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
const waitArea = async (a, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await areaNow()) === a) return;
    await sleep(120);
  }
  throw new Error(`never reached area ${a}`);
};
const waitCoversGone = () =>
  p.page.waitForFunction(() => window.__perf.covered === 0, null, { timeout: 30000 }).catch(() => {});
const tapButton = async (b) => {
  if (p.touch) await p.page.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2);
  else await p.page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
};
const pressBig = async (label, ms = 15000) => {
  const b = await waitButton(p, label, ms);
  if (!b) throw new Error(`no big button "${label}" (now ${JSON.stringify(await bigButton(p))})`);
  await tapButton(b);
};

const entry = {};
try {
  // ── entry (always: the other routes need the village) ──
  await setPhase("entry");
  const tEntry = Date.now();
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(args.time)}${args.query ? `&${args.query}` : ""}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  entry.entryScreenMs = Date.now() - tEntry;
  await p.page.locator("input.cv-input").first().fill(`perf${Math.floor(Math.random() * 900 + 100)}`);
  const tJoin = Date.now();
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
  entry.villageScreenMs = Date.now() - tJoin;
  await p.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvThree, null, { timeout: 60000 });
  const tVeil = Date.now();
  while ((await veilUp()) && Date.now() - tVeil < 90000) await sleep(200);
  entry.veilMs = Date.now() - tJoin;
  entry.lakeModelMs = await p.page
    .waitForFunction(() => performance.getEntriesByType("resource").some((r) => /lake.*\.glb/.test(r.name)), null, { timeout: 60000 })
    .then(() => p.page.evaluate(() => Math.round(performance.getEntriesByType("resource").find((r) => /lake.*\.glb/.test(r.name)).responseEnd)))
    .catch(() => null);
  entry.vegStats = await p.page.evaluate(() => {
    const s = window.__cvVeg?.();
    return s ? { buildMs: s.buildMs ?? null, trees: Object.values(s.trees ?? {}).reduce((a, k) => a + (k.trees ?? 0), 0) } : null;
  });
  await sleep(WARMUP);
  judgeFrom = await pageNow();
  console.log(`entry: screen ${entry.entryScreenMs} ms, village ${entry.villageScreenMs} ms, veil lifted after ${entry.veilMs} ms`);

  await phase("plaza", async () => {
    await sleep(3000);
    await dragOrbit(PHONE_DEV ? 300 : 500);
    await sleep(1500);
    await dragOrbit(PHONE_DEV ? -600 : -900);
    await sleep(1500);
    for (const [x, z] of [[8, 8], [8, -8], [-8, -8], [-8, 8], [0, 12]]) await walkAndWait(p, x, z, 30000, 1.2);
    await sleep(2000);
  });

  await phase("map", async () => {
    const btn = p.page.locator('[aria-label="지도 보기"]');
    await press(p, btn);
    await sleep(5000);
    await press(p, btn);
    await sleep(2500);
    await press(p, btn);
    await sleep(3500);
    await press(p, btn);
    await sleep(2000);
  });

  await phase("crowd", async () => {
    await walkAndWait(p, 0, 14, 20000, 1.5);
    await dragOrbit(PHONE_DEV ? 200 : 350);
    await sleep(Number(args["crowd-ms"]));
  });

  await phase("daynight", async () => {
    // the clock pinned forward in 5-minute steps, 4 a second (12:30 → 21:30 and morning 06:00 → 09:00): every look the
    // day passes through, in about 40 s
    const base = Date.parse(`${args.time.slice(0, 10)}T12:30:00+09:00`);
    const steps = [];
    for (let m = 0; m <= 9 * 60; m += 5) steps.push(base + m * 60000);
    const morning = Date.parse(`${args.time.slice(0, 10)}T06:00:00+09:00`);
    for (let m = 0; m <= 3 * 60; m += 5) steps.push(morning + 24 * 3600000 + m * 60000);
    for (const t of steps) {
      await p.page.evaluate(async (ms) => (await window.__imp("/src/village/villageClock.ts")).villageClock.pin(ms), t);
      await sleep(250);
    }
    await p.page.evaluate(async (ms) => (await window.__imp("/src/village/villageClock.ts")).villageClock.pin(ms), base);
    await sleep(3000);
  });

  await phase("hall", async () => {
    await enterHall(p);
    await waitCoversGone();
    for (const [x, z] of [[300, -2], [303, -6], [297, -6], [300, 0]]) await walkAndWait(p, x, z, 20000, 1.0);
    await sleep(1500);
    await leaveHall(p);
    await waitCoversGone();
    await sleep(2500);
  });

  await phase("house", async () => {
    for (const [x, z] of [[0, 14], [0, -20], [15, -34], [21, -37.15], [21, -39.3]]) await walkAndWait(p, x, z, 40000, 1.2);
    await act(p);
    await p.page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 });
    for (const c of "1004") await press(p, p.page.locator(`.cv-keypad button[data-key="${c}"]`));
    await press(p, p.page.locator('.cv-keypad button[data-key="ok"]'));
    await waitArea("house:house_1:1", 20000);
    await waitCoversGone();
    await sleep(1500);
    await walkAndWait(p, 365.3, -4.9, 20000, 0.8);
    await dragOrbit(PHONE_DEV ? 250 : 400);
    await sleep(1500);
    // out: the way-out pad inside the front door (e2e/village-house.mjs)
    await walkAndWait(p, 365.3, -0.9, 20000, 0.5);
    await sleep(400);
    await act(p);
    await waitArea("village", 20000);
    await waitCoversGone();
    await sleep(2500);
  });

  await phase("lake", async () => {
    for (const [x, z] of [[0, 14], [40, 0], [80, -9], [100, -12]]) await walkAndWait(p, x, z, 40000, 2);
    await walkAndWait(p, 102, -14.6, 20000, 1);
    await sleep(800);
    await pressBig("낚싯대 빌리기");
    await sleep(1500);
    await walkAndWait(p, 108, -12, 30000, 1.5);
    const goal = await p.page.evaluate(async (i) => {
      const am = await window.__imp("/src/game/activeMap.ts");
      const tap = await window.__imp("/src/game/seatTap.ts");
      const chair = (await window.__imp("/src/lake/lakeNearby.ts")).FISHING_CHAIRS[i];
      const seats = am.VILLAGE_ACTIVE_MAP.seats;
      const idx = seats.findIndex((s) => s.lake === "fishing_chair" && s.spot === chair.spot);
      const g = tap.seatApproachGoal(seats, idx, am.VILLAGE_ACTIVE_MAP.geometry.obstacles, am.VILLAGE_ACTIVE_MAP.bounds);
      return { g, sx: chair.standX, sz: chair.standZ };
    }, 4);
    await walkAndWait(p, goal.sx, goal.sz, 30000, 1);
    await walkAndWait(p, goal.g.x, goal.g.z, 15000, 0.5);
    await sleep(800);
    await pressBig("앉아서 낚시");
    await sleep(2500);
    await pressBig("던지기");
    await sleep(9000);
    await dragOrbit(PHONE_DEV ? 250 : 400);
    await sleep(2000);
  });

  // click-move inside the park with the click planner's detour round the park's solids (as e2e/wheel-ride.mjs goTo)
  const parkGo = async (x, z, tol = 2.5) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await p.page.evaluate(
        async ([x, z]) => {
          const plan = await window.__imp("/src/game/clickPlan.ts");
          const move = await window.__imp("/src/game/clickMove.ts");
          const am = await window.__imp("/src/game/activeMap.ts");
          const P = window.__cv.getPos();
          const via = plan.findDetour(P.x, P.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
          move.setClickTarget(x, z, 0, via ?? undefined);
        },
        [x, z],
      );
      await sleep(400);
      const t0 = Date.now();
      while (Date.now() - t0 < 120000 && (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) !== null) await sleep(150);
      await sleep(300);
      const at = await pos(p);
      if (Math.hypot(at.x - x, at.z - z) < tol) return at;
    }
    return pos(p);
  };
  const enterPark = async () => {
    if ((await pos(p)).seatIndex >= 0) {
      await p.page.evaluate(() => window.__cv.stand());
      await sleep(1500);
    }
    if ((await areaNow()) === "park") return;
    const g = await p.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
    for (const [x, z] of [[80, -9], [40, 0]]) await walkAndWait(p, x, z, 60000, 1.5);
    const at = await parkGo(g.x, g.z - 0.5, 1.0);
    console.log(`park gate: at ${JSON.stringify(at)} pad ${JSON.stringify(g)}`);
    await act(p);
    await waitArea("park", 20000);
    await waitCoversGone();
    await sleep(3000);
  };

  await phase("park", async () => {
    await enterPark();
    // the promenade, the carousel, the wheel, back across the park (park-local metres)
    for (const [x, z] of [[40, -150], [60, -125], [110, -119], [160, -125], [211, -131], [260, -100], [200, -60]]) {
      await parkGo(x, z, 3);
      await dragOrbit(PHONE_DEV ? 200 : 300, 20);
      await sleep(800);
    }
    await sleep(2000);
  });

  // one whole ride on the 하늘 등불 바퀴 (the top is where the whole park is in view)
  await phase("wheel", async () => {
    await enterPark();
    await parkGo(211, -130.8, 1.5);
    const st = () =>
      p.page.evaluate(async () => {
        const w = await window.__imp("/land/wheel.ts");
        const m = await window.__imp("/land/coasterRide.ts");
        const clock = await window.__imp("/src/village/villageClock.ts");
        return { status: w.wheelAt(clock.villageClock.liveMs()).status, slot: m.selfRide.slot };
      });
    const t0 = Date.now();
    while ((await st()).status !== "boarding" && Date.now() - t0 < 60000) await sleep(500);
    await act(p);
    const t1 = Date.now();
    while ((await st()).slot < 0 && Date.now() - t1 < 8000) await sleep(200);
    run.check("wheel: boarded", (await st()).slot >= 0);
    const t2 = Date.now();
    while ((await st()).slot >= 0 && Date.now() - t2 < 220000) await sleep(500);
    await sleep(2500);
  });

  await phase("bus", async () => {
    // off the lake chair first (the lake phase leaves the player seated)
    if ((await pos(p)).seatIndex >= 0) {
      await p.page.evaluate(() => window.__cv.stand());
      await sleep(1500);
    }
    for (const [x, z] of [[80, -9], [40, 0], [38.5, -0.5], [36.9, -6.0]]) await walkAndWait(p, x, z, 40000, 1);
    const sync = () => p.page.evaluate(async () => {
      const s = (await window.__imp("/src/net/transitSync.ts")).getTransitState();
      const snap = s.snapshot;
      return { boarded: s.boarded, snap: snap ? { tripId: snap.tripId, departAt: snap.departAt ?? snap.departureMs ?? null, phase: snap.phase ?? null } : null };
    });
    const t0 = Date.now();
    let boarded = false;
    while (Date.now() - t0 < Number(args["bus-wait"]) * 1000) {
      const tg = await p.page.evaluate(async () => (await window.__imp("/src/game/interactTargets.ts")).getTargets(window.__cv.getPos()).map((x) => x.id));
      if (tg.includes("village_bus_board")) {
        await act(p);
        await sleep(1500);
        if ((await sync()).boarded) {
          boarded = true;
          break;
        }
      }
      await sleep(2000);
    }
    run.check("bus: boarded (or the bus was not boarding in the wait)", true, { boarded, state: await sync() });
    if (!boarded) {
      await sleep(5000);
      return;
    }
    // wait for the ride to start and finish (lap ≈ 50 s + the signal holds)
    const tRide = Date.now();
    while ((await sync()).boarded && Date.now() - tRide < 300000) {
      if (Date.now() - tRide > 20000 && Date.now() - tRide < 24000) await dragOrbit(PHONE_DEV ? 200 : 300);
      await sleep(1500);
    }
    await sleep(3000);
  });
} catch (e) {
  run.check("routes ran", false, String(e?.stack ?? e).slice(0, 600));
}

// ───────────────────────────── report ─────────────────────────────
const rec = await p.page.evaluate(() => window.__perf);
const gate = await p.page.evaluate(() => window.__cvProgramGate?.() ?? null).catch(() => null);
const clipWarm = await p.page.evaluate(() => window.__cvClipWarm ?? null).catch(() => null);
console.log(`bench clip warm-up: ${JSON.stringify(clipWarm)}`);
if (gate) console.log(`shader gate: held ${gate.held}, compiles ${gate.compiles}, forced ${gate.forced}, mismatches ${gate.mismatches?.length ?? 0}`);
const phases = {};
for (const name of ["entry", ...ROUTES.filter((r) => r !== "entry")]) {
  if (!rec.ph.includes(name)) continue;
  const st = phaseStats(rec, name, name === "entry" ? Infinity : judgeFrom);
  if (profiles[name] && st.hitches.length) {
    const att = attribute(profiles[name].profile, st.hitches.map((h) => [h.at, h.at + h.ms]), profiles[name].offset);
    st.hitches.forEach((h, i) => {
      h.cpu = att[i];
      // a frame the main thread spent mostly idle waited on the GPU (or the compositor): reported, judged apart
      h.kind = att[i].samples === 0 ? "?" : att[i].busyMs >= h.ms * 0.5 ? "cpu" : "gpu";
    });
  }
  st.cpuHitchesOver = st.hitches.filter((h) => h.judged && h.ms > MAX_HITCH && h.kind !== "gpu").length;
  st.gpuHitchesOver = st.hitches.filter((h) => h.judged && h.ms > MAX_HITCH && h.kind === "gpu").length;
  phases[name] = st;
}
const report = { gate, label: args.label, device: args.device, throttle: THROTTLE, maxHitch: MAX_HITCH, bots: BOTS, when: new Date().toISOString(), entry, phases, loaf: rec.loaf.slice(0, 400) };
writeFileSync(join(OUT, `${tagName}.json`), JSON.stringify(report, null, 1));

console.log(`\n${"phase".padEnd(10)} ${"fps".padStart(5)} ${"p50".padStart(6)} ${"p95".padStart(6)} ${"p99".padStart(6)} ${"max".padStart(7)} ${">50".padStart(4)} ${"bad".padStart(4)} ${"links".padStart(5)} ${"compMs".padStart(7)} ${"upMs".padStart(7)} ${"calls".padStart(6)} ${"tris".padStart(8)} ${"heap".padStart(6)} ${"rem".padStart(4)}`);
for (const [name, s] of Object.entries(phases)) {
  console.log(
    `${name.padEnd(10)} ${String(s.fps).padStart(5)} ${String(s.p50).padStart(6)} ${String(s.p95).padStart(6)} ${String(s.p99).padStart(6)} ${String(s.max).padStart(7)} ${String(s.over50).padStart(4)} ${String(s.cpuHitchesOver).padStart(4)} ${String(s.gl.links).padStart(5)} ${String(s.gl.compileMs).padStart(7)} ${String(s.gl.uploadMs).padStart(7)} ${String(s.render.callsMax).padStart(6)} ${String(s.render.trisMax).padStart(8)} ${String(s.render.heapMBMax).padStart(6)} ${String(s.render.remotes).padStart(4)}`,
  );
}
for (const [name, s] of Object.entries(phases)) {
  const show = s.hitches.filter((x) => x.ms > 50 && x.kind !== "gpu").sort((a, b) => b.ms - a.ms).slice(0, name === "entry" ? 3 : 6);
  for (const h of show) {
    console.log(`  ${name} ${h.ms} ms [${h.kind ?? "?"} busy ${h.cpu?.busyMs ?? "?"} gc ${h.cpu?.gcMs ?? "?"}]${h.judged ? "" : h.covered ? " (covered)" : " (warm-up)"} gl ${JSON.stringify(h.gl)} :: ${(h.cpu?.app ?? []).slice(0, 3).join(" | ")} :: ${(h.cpu?.self ?? []).slice(0, 3).join(" | ")}`);
  }
}
for (const [name, s] of Object.entries(phases)) {
  if (s.newPrograms.length) console.log(`  ${name}: ${s.newPrograms.length} new programs: ${s.newPrograms.slice(0, 12).join(", ")}`);
  for (const g of s.slowGl.slice(0, 4)) console.log(`  ${name}: slow ${g.name} ${g.ms} ms at ${g.t} :: ${g.stack.slice(0, 400)}`);
}
for (const [name, s] of Object.entries(phases)) {
  if (name === "entry") continue;
  run.check(`${name}: no main-thread hitch over ${MAX_HITCH} ms after warm-up (uncovered)`, s.cpuHitchesOver === 0, s.hitches.filter((h) => h.judged && h.ms > MAX_HITCH && h.kind !== "gpu").map((h) => h.ms));
  if (s.gpuHitchesOver) console.log(`  note: ${name} had ${s.gpuHitchesOver} frame(s) over ${MAX_HITCH} ms with the main thread idle (GPU/compositor wait; shared GPU)`);
}
await browser.close();
if (bots) bots.kill();
process.exit(run.finish({ report: `${tagName}.json` }));
