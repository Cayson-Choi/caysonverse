/**
 * e2e/fountain-water.mjs — 광장 분수의 물(feature/fountain-water): 사진과 성능 측정.
 *
 *   npm run dev   (서버와 클라이언트, 다른 창에서. CV_CLIENT_URL로 주소를 바꾼다)
 *   node e2e/fountain-water.mjs --mode shots --tier high --time night --poses owner,mid --water new --out <폴더>
 *   node e2e/fountain-water.mjs --mode seq   --tier high --time noon  --poses jet --frames 8 --out <폴더>
 *   node e2e/fountain-water.mjs --mode perf  --tier high --time night --poses owner,far --water new,old --out <폴더>
 *   node e2e/fountain-water.mjs --mode ab    --tier high --time night --poses owner,rim,mid --rounds 2 --out <폴더>
 *
 * 카메라는 DEV 훅(window.__cvThree)의 장면에 `onBeforeRender`를 걸어 정해진 자리에 고정한다(플레이어 카메라는 그대로 두고 그
 * 프레임의 그림만 그 자리에서 그린다). 시각은 `?time=`(villageClock.ts), 옛 물은 `?water=old`(VillageModel.tsx).
 *
 * perf: 수직동기·프레임 제한을 끈 크롬(--disable-gpu-vsync --disable-frame-rate-limit)에서 같은 자리의 프레임 간격(평균, p95)을
 * `__cv.getFrameStats`로, 장면 패스의 GPU 시간을 EXT_disjoint_timer_query_webgl2로(있으면), 장면 패스의 드로 콜과 삼각형을
 * renderer.info로 잰다. 새 물과 옛 물을 번갈아 (각각 새로 입장해) 잰다.
 * ab: 한 페이지 안에서 새 물의 몫만 잰다. 물줄기·커튼·물방울을 켜고 끄고, 수면을 분수 전용 재질과 보통 물 재질로 바꿔 가며
 * 2초씩 번갈아 장면 패스의 GPU 시간을 잰다(페이지마다 다른 잡음이 없다). 수직동기를 켠 60 fps에서 잰다(GPU가 밀리지 않아
 * 타이머 쿼리가 한두 프레임 안에 답한다).
 */

import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { CLIENT_URL, PHONE, entryReady, press, sleep } from "./lib/escape.mjs";

const { values: args } = parseArgs({
  options: {
    mode: { type: "string", default: "shots" },
    tier: { type: "string", default: "high" },
    time: { type: "string", default: "night" },
    poses: { type: "string", default: "owner" },
    water: { type: "string", default: "new" },
    out: { type: "string" },
    frames: { type: "string", default: "8" },
    gap: { type: "string", default: "70" },
    ms: { type: "string", default: "6000" },
    rounds: { type: "string", default: "2" },
    device: { type: "string", default: "laptop" },
    label: { type: "string", default: "" },
  },
});

const OUT = args.out ?? join(process.cwd(), "fountain-water-out");
mkdirSync(OUT, { recursive: true });

/** Times (KST, 2026-06-21): noon, the golden hour, dusk (lights coming on), night. */
const TIMES = { noon: "12:30", golden: "18:55", dusk: "20:05", night: "21:00", morning: "09:30" };

/** Camera poses round the fountain (centre 0,0): eye, target, fov. */
const POSES = {
  // The owner's screenshot: low, at the basin's rim, looking across the pool at the pedestal.
  owner: { eye: [0.6, 1.55, 7.6], target: [0, 1.25, 0], fov: 55 },
  // The player's camera at the spawn (z 14), a little above and behind the avatar.
  spawn: { eye: [0, 4.2, 20.5], target: [0, 1.6, 0], fov: 55 },
  mid: { eye: [7.5, 2.6, 7.5], target: [0, 1.4, 0], fov: 55 },
  // A close look at one arc (k = 4: nozzle at (0, 0.42, 5.1), lands at (0, 0.40, 2.9)) from the side.
  jet: { eye: [2.1, 1.25, 4.6], target: [0, 1.15, 3.95], fov: 50 },
  // Where that arc lands, close.
  splash: { eye: [1.1, 0.95, 4.3], target: [0, 0.45, 2.95], fov: 45 },
  // The upright jets' crowns and the curtains.
  crown: { eye: [4.6, 2.2, 3.4], target: [0, 2.3, 0], fov: 55 },
  above: { eye: [9, 10, 9], target: [0, 0.8, 0], fov: 55 },
  far: { eye: [0, 7, 45], target: [0, 2, 0], fov: 55 },
  rim: { eye: [0, 1.4, 6.2], target: [0, 0.9, 2.5], fov: 55 },
  // A phone held upright at the basin, a few steps back.
  portrait: { eye: [0.8, 2.0, 11.5], target: [0, 1.9, 0], fov: 55 },
};

const DEVICES = {
  // The owner's laptop: 2560 x 1290 drawing buffer (dpr 1.5).
  laptop: { viewport: { width: 1707, height: 860 }, deviceScaleFactor: 1.5 },
  hd: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  phone: PHONE,
};

async function launch(perf) {
  const gpu = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];
  const extra = perf ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : [];
  return chromium.launch({ headless: true, channel: "chrome", args: [...gpu, ...extra] });
}

let seq = 0;
async function joinVillage(browser, { tier, time, water, device }) {
  const ctx = await browser.newContext({ ...DEVICES[device] });
  await ctx.addInitScript((graphics) => {
    try {
      localStorage.setItem("cv-settings-v1", JSON.stringify({ coachDone: true, graphics }));
    } catch {}
  }, device === "phone" ? "auto" : tier);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   [pageerror]", e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || /THREE\.WebGLProgram|shader/i.test(m.text())) console.log("   [console]", m.type(), m.text().slice(0, 400));
  });
  const q = new URLSearchParams({ time: `2026-06-21T${TIMES[time] ?? time}` });
  if (water === "old") q.set("water", "old");
  await page.goto(`${CLIENT_URL}/?${q}`, { waitUntil: "domcontentloaded" });
  const p = { page, touch: device === "phone" };
  await entryReady(p);
  await page.locator("input.cv-input").first().fill(`분수${++seq}`);
  await press(p, page.locator(".cv-submit"));
  await page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
  await page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  await sleep(2500);
  return { ctx, page };
}

async function pinCamera(page, pose) {
  await page.evaluate((pose) => {
    const { scene, camera } = window.__cvThree();
    scene.onBeforeRender = () => {
      if (!window.__pin) return;
      const { eye, target, fov } = window.__pin;
      camera.position.set(eye[0], eye[1], eye[2]);
      camera.up.set(0, 1, 0);
      camera.lookAt(target[0], target[1], target[2]);
      if (fov && camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld(true);
    };
    window.__pin = pose;
  }, pose);
}

const hideHud = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    for (const el of document.body.querySelectorAll("*")) {
      if (keep.has(el) || canvas.contains(el)) continue;
      el.style.visibility = "hidden";
    }
  });

/** What the fountain is drawing (the dressed model's probe). */
const fountainInfo = (page) =>
  page.evaluate(() => {
    const n = window.__cvVillage?.();
    const f = n?.fountain;
    if (!f) return { fountain: false };
    const pool = f.pool;
    let poolTris = 0;
    n.root.traverse((o) => {
      if (o.isMesh && o.material === pool) poolTris += o.geometry.getAttribute("position").count / 3;
    });
    return {
      fountain: true,
      poolTriangles: poolTris,
      particles: f.water.particles.total,
      particlesFar: f.water.particles.farCount,
      particlesDrawn: f.water.particles.mesh.geometry.instanceCount,
      ribbonTriangles: f.water.ribbons.geometry.index.count / 3,
      curtainTriangles: f.water.curtains[0].geometry.index.count / 3,
      lights: window.__cvDayNight?.().applied.lights,
    };
  });

async function shots(pose, name) {
  const browser = await launch(false);
  const results = [];
  try {
    for (const water of args.water.split(",")) {
      const { ctx, page } = await joinVillage(browser, { tier: args.tier, time: args.time, water, device: args.device });
      await hideHud(page);
      for (const key of args.poses.split(",")) {
        const pose = POSES[key];
        await pinCamera(page, pose);
        await sleep(1200);
        const file = join(OUT, `${args.label}${key}-${args.tier}-${args.time}-${water}.png`);
        await page.screenshot({ path: file });
        results.push({ file, info: await fountainInfo(page) });
        console.log("   shot", file);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function sequence() {
  const browser = await launch(false);
  try {
    const { ctx, page } = await joinVillage(browser, { tier: args.tier, time: args.time, water: args.water.split(",")[0], device: args.device });
    await hideHud(page);
    for (const key of args.poses.split(",")) {
      await pinCamera(page, POSES[key]);
      await sleep(1200);
      const n = Number(args.frames);
      for (let i = 0; i < n; i++) {
        const file = join(OUT, `${args.label}seq-${key}-${args.tier}-${args.time}-${String(i).padStart(2, "0")}.png`);
        await page.screenshot({ path: file });
        await sleep(Number(args.gap));
      }
      console.log("   sequence", key, n);
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
}

/**
 * Frame cost at a pose. First half of the window: the frame intervals alone (rAF timestamps: median, p95, mean; nothing
 * else running). Second half: the scene pass's GPU time (EXT_disjoint_timer_query_webgl2 around the main scene's render,
 * results read between frames) and its draw calls and triangles (renderer.info right after that render).
 */
async function measure(page, ms) {
  return page.evaluate(async (ms) => {
    const { gl: renderer, scene } = window.__cvThree();
    const ctx = renderer.getContext();
    const ext = ctx.getExtension("EXT_disjoint_timer_query_webgl2");
    const pct = (a, q) => {
      if (!a.length) return null;
      const b = a.slice().sort((x, y) => x - y);
      return b[Math.min(b.length - 1, Math.floor(b.length * q))];
    };
    // 1. Frame intervals.
    const intervals = [];
    await new Promise((resolve) => {
      let last = 0;
      const t0 = performance.now();
      const step = (t) => {
        if (last) intervals.push(t - last);
        last = t;
        if (t - t0 < ms / 2) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    // 2. The scene pass: GPU time, draws, triangles.
    const gpu = [];
    const pending = [];
    const draws = [];
    let disjoint = false;
    const orig = renderer.render.bind(renderer);
    renderer.render = (s, c) => {
      const timed = s === scene && ext && pending.length < 48 && issued < 160;
      let q = null;
      if (timed) {
        q = ctx.createQuery();
        ctx.beginQuery(ext.TIME_ELAPSED_EXT, q);
      }
      orig(s, c);
      if (s === scene) draws.push([renderer.info.render.calls, renderer.info.render.triangles]);
      if (q) {
        ctx.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(q);
        issued++;
      }
    };
    let issued = 0;
    let polling = true;
    const poll = () => {
      for (let i = 0; i < pending.length; ) {
        const p = pending[i];
        if (ctx.getQueryParameter(p, ctx.QUERY_RESULT_AVAILABLE)) {
          gpu.push(ctx.getQueryParameter(p, ctx.QUERY_RESULT) / 1e6);
          ctx.deleteQuery(p);
          pending.splice(i, 1);
        } else i++;
      }
      if (polling) setTimeout(poll, 4);
    };
    if (ext) poll();
    const heap0 = performance.memory?.usedJSHeapSize ?? 0;
    await new Promise((r) => setTimeout(r, ms / 2));
    renderer.render = orig;
    // The last results come in late (the GPU process answers a few frames behind).
    for (let k = 0; k < 40 && pending.length; k++) await new Promise((r) => setTimeout(r, 50));
    polling = false;
    if (ext) disjoint = !!ctx.getParameter(ext.GPU_DISJOINT_EXT);
    const heap1 = performance.memory?.usedJSHeapSize ?? 0;
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    return {
      frames: intervals.length,
      frameMedianMs: pct(intervals, 0.5),
      frameP95Ms: pct(intervals, 0.95),
      frameMeanMs: mean(intervals),
      fps: intervals.length ? 1000 / pct(intervals, 0.5) : null,
      gpuSceneMs: { n: gpu.length, median: pct(gpu, 0.5), p90: pct(gpu, 0.9), mean: mean(gpu), disjoint },
      timerQuery: !!ext,
      sceneDrawCalls: pct(draws.map((d) => d[0]), 0.5),
      sceneTriangles: pct(draws.map((d) => d[1]), 0.5),
      heapDeltaMB: (heap1 - heap0) / 1e6,
    };
  }, ms);
}

/**
 * The new water's own cost, inside one page (no load-to-load noise): the scene pass's GPU time with everything on, with
 * the streams/curtains/drops hidden, and with those hidden and the pool drawn with the plain water material, each
 * shown for `slice` ms in turn, `cycles` times over.
 */
async function abInPage(page, slice, cycles) {
  return page.evaluate(
    async ({ slice, cycles }) => {
      const { gl: renderer, scene } = window.__cvThree();
      const n = window.__cvVillage();
      const f = n.fountain;
      let poolMesh = null;
      n.root.traverse((o) => {
        if (o.isMesh && o.material === f.pool) poolMesh = o;
      });
      const configs = {
        full: () => {
          f.water.group.visible = true;
          poolMesh.material = f.pool;
        },
        noRuntime: () => {
          f.water.group.visible = false;
          poolMesh.material = f.pool;
        },
        plainPool: () => {
          f.water.group.visible = false;
          poolMesh.material = n.water;
        },
      };
      const ctx = renderer.getContext();
      const ext = ctx.getExtension("EXT_disjoint_timer_query_webgl2");
      if (!ext) return null;
      const out = { full: [], noRuntime: [], plainPool: [] };
      const pending = [];
      let current = "full";
      const orig = renderer.render.bind(renderer);
      let skip = 0;
      renderer.render = (s, c) => {
        let q = null;
        if (s === scene && skip <= 0 && pending.length < 16) {
          q = ctx.createQuery();
          ctx.beginQuery(ext.TIME_ELAPSED_EXT, q);
        }
        if (s === scene) skip--;
        orig(s, c);
        if (q) {
          ctx.endQuery(ext.TIME_ELAPSED_EXT);
          pending.push([q, current]);
        }
      };
      let polling = true;
      const poll = () => {
        for (let i = 0; i < pending.length; ) {
          const [q, cfg] = pending[i];
          if (ctx.getQueryParameter(q, ctx.QUERY_RESULT_AVAILABLE)) {
            out[cfg].push(ctx.getQueryParameter(q, ctx.QUERY_RESULT) / 1e6);
            ctx.deleteQuery(q);
            pending.splice(i, 1);
          } else i++;
        }
        if (polling) setTimeout(poll, 4);
      };
      poll();
      for (let k = 0; k < cycles; k++) {
        for (const name of Object.keys(configs)) {
          configs[name]();
          current = name;
          skip = 3; // let the change settle
          await new Promise((r) => setTimeout(r, slice));
        }
      }
      configs.full();
      renderer.render = orig;
      for (let k = 0; k < 40 && pending.length; k++) await new Promise((r) => setTimeout(r, 50));
      polling = false;
      const med = (a) => {
        if (!a.length) return null;
        const b = a.slice().sort((x, y) => x - y);
        return b[Math.floor(b.length / 2)];
      };
      return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { n: v.length, median: med(v) }]));
    },
    { slice, cycles },
  );
}

async function ab() {
  // At the display's pace (60 fps): the GPU is not queued up, and each timer query answers within a frame or two.
  const browser = await launch(false);
  const rows = [];
  try {
    const { ctx, page } = await joinVillage(browser, { tier: args.tier, time: args.time, water: "new", device: args.device });
    await hideHud(page);
    for (const key of args.poses.split(",")) {
      await pinCamera(page, POSES[key]);
      await sleep(2500);
      const r = await abInPage(page, 2000, Number(args.rounds) * 3);
      const d = (a, b) => (r[a].median != null && r[b].median != null ? (r[a].median - r[b].median).toFixed(2) : "-");
      console.log(
        `   ${key.padEnd(8)} all ${r.full.median?.toFixed(2)} (n ${r.full.n}) | streams+curtains+drops hidden ${r.noRuntime.median?.toFixed(2)} | + plain pool ${r.plainPool.median?.toFixed(2)} ms || runtime water +${d("full", "noRuntime")} ms, pool shader +${d("noRuntime", "plainPool")} ms`,
      );
      rows.push({ pose: key, tier: args.tier, time: args.time, device: args.device, ...r });
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
  const file = join(OUT, `ab-${args.label}${args.tier}-${args.time}-${args.device}.json`);
  writeFileSync(file, JSON.stringify(rows, null, 2));
  console.log("   ->", file);
}

/** 60 s at the display's pace near the fountain: the frame governor must not step the picture down. */
async function soak() {
  const browser = await launch(false);
  try {
    const { ctx, page } = await joinVillage(browser, { tier: args.tier, time: args.time, water: args.water.split(",")[0], device: args.device });
    await hideHud(page);
    await pinCamera(page, POSES[args.poses.split(",")[0]]);
    await sleep(3000);
    const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    const marks0 = await page.evaluate(() => performance.getEntriesByName("cv:render-scale").length);
    await sleep(Number(args.ms));
    const r = await page.evaluate((ms) => {
      const st = window.__cv.getFrameStats(ms - 500);
      const marks = performance.getEntriesByName("cv:render-scale").map((e) => e.detail);
      return { stats: st, marks, heap: performance.memory?.usedJSHeapSize ?? 0 };
    }, Number(args.ms));
    const out = { tier: args.tier, time: args.time, pose: args.poses, water: args.water, ...r.stats, stepMarksDuring: r.marks.length - marks0, marks: r.marks, heapDeltaMB: (r.heap - heap0) / 1e6 };
    console.log("   soak", JSON.stringify(out));
    writeFileSync(join(OUT, `soak-${args.label}${args.tier}-${args.time}-${args.water}.json`), JSON.stringify(out, null, 2));
    await ctx.close();
  } finally {
    await browser.close();
  }
}

async function perf() {
  const browser = await launch(true);
  const rows = [];
  try {
    const waters = args.water.split(",");
    for (let round = 0; round < Number(args.rounds); round++) {
      for (const water of round % 2 === 0 ? waters : [...waters].reverse()) {
        const { ctx, page } = await joinVillage(browser, { tier: args.tier, time: args.time, water, device: args.device });
        await hideHud(page);
        for (const key of args.poses.split(",")) {
          await pinCamera(page, POSES[key]);
          await sleep(2500);
          const m = await measure(page, Number(args.ms));
          const info = await fountainInfo(page);
          const level = await page.evaluate(() => {
            const e = performance.getEntriesByName("cv:render-scale");
            return e.length ? e[e.length - 1].detail : null;
          });
          rows.push({ round, water, pose: key, tier: args.tier, time: args.time, device: args.device, renderScaleStep: level, ...m, info });
          console.log(
            `   ${water.padEnd(3)} ${key.padEnd(8)} frame median ${m.frameMedianMs?.toFixed(2)} p95 ${m.frameP95Ms?.toFixed(2)} mean ${m.frameMeanMs?.toFixed(2)} ms (${m.frames}) | gpu scene ${m.gpuSceneMs.median?.toFixed(2) ?? "-"} p90 ${m.gpuSceneMs.p90?.toFixed(2) ?? "-"} ms (n ${m.gpuSceneMs.n}) | draws ${m.sceneDrawCalls} tris ${m.sceneTriangles} | drops ${info.particlesDrawn ?? "-"} | step ${level?.level ?? 0}`,
          );
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  const file = join(OUT, `perf-${args.label}${args.tier}-${args.time}-${args.device}.json`);
  writeFileSync(file, JSON.stringify(rows, null, 2));
  console.log("   ->", file);
}

if (args.mode === "shots") {
  const r = await shots();
  writeFileSync(join(OUT, `shots-${args.label}${args.tier}-${args.time}.json`), JSON.stringify(r, null, 2));
} else if (args.mode === "seq") await sequence();
else if (args.mode === "perf") await perf();
else if (args.mode === "ab") await ab();
else if (args.mode === "soak") await soak();
else {
  console.error("--mode shots|seq|perf|ab");
  process.exit(2);
}
