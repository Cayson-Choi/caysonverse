/**
 * e2e/village-veg.mjs — 케이슨 마을 3D 식생 시제품(veg3d) 사진과 비용 측정 (2026-11-10).
 *
 *   서버  (server/)  PORT=2741 npx tsx src/index.ts
 *   클라  (client/)  VITE_SERVER_URL=http://localhost:2741 npx vite --port 5341 --strictPort
 *   node e2e/village-veg.mjs --url http://localhost:5341 --out <폴더> [--shots] [--perf] [--modes old,new] [--tiers high,low]
 *
 * --shots: 같은 카메라 자리(게임 카메라를 그 자리에 고정, 후처리까지 게임 그대로)에서 옛 식생(?veg=old)과 새 식생(?veg=new)을 찍는다.
 *   주인 스크린샷 두 각도(밤: 석재 화분 근접, 벚꽃 수관 근접), 낮 광장(플레이어 카메라 높이), 휴대폰(low) 화면.
 * --perf: 광장 근처 고정 시점 몇 곳에서 tier(high/low) x 낮·밤 x old/new로 프레임 간격, 프레임당 GPU 시간(EXT_disjoint_timer_query),
 *   드로콜·삼각형(한 프레임의 모든 render 합), JS 힙, GPU 메모리 수(three info), 로드 시간, 식생 수치(window.__cvVeg)를 잰다.
 * 헤드리스 크롬(--use-angle=d3d11, 이 노트북의 Radeon 680M). rAF는 60 fps에 묶이므로 판단은 GPU ms로 한다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5341" },
    out: { type: "string", default: "veg-out" },
    shots: { type: "boolean", default: false },
    perf: { type: "boolean", default: false },
    modes: { type: "string", default: "old,new" },
    tiers: { type: "string", default: "high,low" },
    ms: { type: "string", default: "6000" },
    only: { type: "string", default: "" },
  },
});
const OUT = a.out;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NIGHT = "2026-06-21T21:00";
const DAY = "2026-11-03T12:30";
const GPU_ARGS = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];
const DESKTOP = { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 };
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: IPHONE_UA };

/** GPU time per rAF (one TIME_ELAPSED query round each frame's callbacks) and per-frame render totals. */
function instrument() {
  const M = (window.__vegm = { raf: [], gpu: [], calls: [], tris: [], js: [] });
  const ctxs = [];
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const c = orig.call(this, type, attrs);
    if (c && type === "webgl2" && !ctxs.some((x) => x.gl === c)) {
      const ext = c.getExtension("EXT_disjoint_timer_query_webgl2");
      if (ext) ctxs.push({ gl: c, ext, pending: [] });
    }
    return c;
  };
  const main = () => ctxs.find((x) => x.gl.drawingBufferWidth > 64);
  const origRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return origRAF(function (ts) {
      const g = M.on ? main() : null;
      let q = null;
      if (g && !g.open) {
        for (let i = g.pending.length - 1; i >= 0; i--) {
          const [pq, at] = g.pending[i];
          if (g.gl.getQueryParameter(pq, g.gl.QUERY_RESULT_AVAILABLE)) {
            const disjoint = g.gl.getParameter(g.ext.GPU_DISJOINT_EXT);
            if (!disjoint) M.gpu.push([at, g.gl.getQueryParameter(pq, g.gl.QUERY_RESULT) / 1e6]);
            g.gl.deleteQuery(pq);
            g.pending.splice(i, 1);
          }
        }
        q = g.gl.createQuery();
        g.gl.beginQuery(g.ext.TIME_ELAPSED_EXT, q);
        g.open = true;
      }
      const j0 = performance.now();
      try {
        cb(ts);
      } finally {
        if (M.on) M.js.push([ts, performance.now() - j0]);
        if (q) {
          g.gl.endQuery(g.ext.TIME_ELAPSED_EXT);
          g.open = false;
          g.pending.push([q, ts]);
        }
        if (M.on) M.raf.push(ts);
      }
    });
  };
}

async function open(browser, { tier, veg, time, phone }) {
  const ctx = await browser.newContext(phone ? PHONE : DESKTOP);
  await ctx.addInitScript((g) => {
    try {
      localStorage.setItem("cv-settings-v1", JSON.stringify({ coachDone: true, graphics: g }));
    } catch {}
  }, tier);
  await ctx.addInitScript(instrument);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const t0 = Date.now();
  await page.goto(`${a.url}/?time=${encodeURIComponent(time)}&veg=${veg}`, { waitUntil: "domcontentloaded" });
  await page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector(".cv-builder-hint.is-loading"), null, { timeout: 30000 }).catch(() => {});
  await sleep(500);
  await page.locator("input.cv-input").first().fill(`veg${Math.floor(Math.random() * 1e5)}`.slice(0, 8));
  const tJoin = Date.now();
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
  await page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 120000 });
  const loadMs = Date.now() - tJoin;
  // the 3D vegetation is built in steps after the village is up: wait for it (vegReadyMs: from 입장 to ready)
  let vegReadyMs = null;
  if (veg !== "old") {
    await page.waitForFunction(() => window.__cvVeg?.() != null, null, { timeout: 60000 });
    vegReadyMs = Date.now() - tJoin;
  }
  await sleep(2500);
  return { ctx, page, errors, loadMs, vegReadyMs, pageMs: tJoin - t0 };
}

/** Pin the game camera at eye -> look (CameraRig's writes become no-ops), so the real pipeline draws that view. */
async function pin(page, eye, look, fov) {
  await page.evaluate(
    ([eye, look, fov]) => {
      const { camera } = window.__cvThree();
      const V = Object.getPrototypeOf(camera.position);
      if (!camera.__vegPinned) {
        camera.__vegPinned = { set: camera.position.set, look: camera.lookAt, up: camera.up.set };
        camera.position.set = function () {
          return this;
        };
        camera.up.set = function () {
          return this;
        };
        camera.lookAt = function () {};
      }
      V.set.call(camera.position, eye[0], eye[1], eye[2]);
      V.set.call(camera.up, 0, 1, 0);
      camera.__vegPinned.look.call(camera, look[0], look[1], look[2]);
      if (fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
    },
    [eye, look, fov ?? null],
  );
}

async function hideHud(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    for (const el of document.body.querySelectorAll("*")) {
      if (keep.has(el) || canvas.contains(el)) continue;
      el.style.visibility = "hidden";
    }
  });
}

/** Camera views (eye, look, fov). The planter and tree: the cherry at -16 deg (18.26, -5.24). */
const VIEWS = {
  planterNight: { eye: [16.35, 1.55, -4.05], look: [18.05, 0.42, -5.15], fov: 50 },
  planterTop: { eye: [17.4, 2.3, -4.7], look: [18.1, 0.4, -5.2], fov: 50 },
  crownNight: { eye: [14.6, 4.6, -2.6], look: [18.2, 5.3, -5.6], fov: 55 },
  crownUnder: { eye: [16.6, 1.7, -3.6], look: [18.4, 5.6, -5.4], fov: 60 },
  crownClose: { eye: [14.3, 4.7, -4.0], look: [15.9, 5.0, -4.6], fov: 50 },
  plazaDay: { eye: [4.5, 3.4, 3.5], look: [14.5, 1.6, -6.5], fov: 55 },
  plazaWide: { eye: [-2.0, 4.2, 7.0], look: [12.0, 2.2, -8.0], fov: 60 },
  fountainBed: { eye: [2.2, 1.7, 9.0], look: [4.8, 0.4, 5.0], fov: 55 },
  squarePlanter: { eye: [-15.0, 1.9, -14.5], look: [-17.3, 0.6, -17.2], fov: 55 },
  houseBed: { eye: [-17.0, 1.8, -36.5], look: [-21.0, 0.3, -41.0], fov: 55 },
  phonePlaza: { eye: [6.0, 3.6, 2.0], look: [15.5, 1.4, -6.0], fov: 60 },
};

async function shots() {
  const browser = await chromium.launch({ headless: true, channel: "chrome", args: GPU_ARGS });
  const modes = a.modes.split(",");
  const plan = [
    { label: "night", time: NIGHT, tier: "high", views: ["planterNight", "planterTop", "crownNight", "crownClose", "crownUnder"] },
    { label: "day", time: DAY, tier: "high", views: ["plazaDay", "plazaWide", "planterTop", "crownClose", "crownUnder", "fountainBed", "squarePlanter", "houseBed"] },
    { label: "phone", time: DAY, tier: "low", phone: true, views: ["phonePlaza", "planterNight", "crownUnder"] },
  ].filter((p) => !a.only || a.only.split(",").includes(p.label));
  const log = [];
  for (const p of plan) {
    for (const veg of modes) {
      const s = await open(browser, { tier: p.tier, veg, time: p.time, phone: p.phone });
      await hideHud(s.page);
      for (const v of p.views) {
        const view = VIEWS[v];
        await pin(s.page, view.eye, view.look, view.fov);
        await sleep(1500);
        const file = join(OUT, `${p.label}-${v}-${veg}.png`);
        await s.page.screenshot({ path: file });
        log.push(file);
      }
      const stats = await s.page.evaluate(() => window.__cvVeg?.() ?? null);
      log.push(JSON.stringify({ plan: p.label, veg, stats, errors: s.errors.slice(0, 5) }));
      await s.ctx.close();
    }
  }
  await browser.close();
  writeFileSync(join(OUT, "shots.log"), log.join("\n"));
  console.log(log.join("\n"));
}

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mean = (arr) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : null);
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

/** Freeze or wake a page (CDP lifecycle): a frozen page runs no rAF, so it does not load the GPU while the other is measured. */
async function setFrozen(s, frozen) {
  if (!s.cdp) s.cdp = await s.ctx.newCDPSession(s.page);
  await s.cdp.send("Page.setWebLifecycleState", { state: frozen ? "frozen" : "active" });
}

/** Measure `ms` at a pinned view: frame interval, GPU ms per frame, calls and triangles per frame, memory. */
async function measure(page, view, ms) {
  await pin(page, view.eye, view.look, view.fov);
  await sleep(1500);
  await page.evaluate(() => {
    const { gl } = window.__cvThree();
    gl.info.autoReset = false;
    gl.info.reset();
    const M = window.__vegm;
    M.raf.length = 0;
    M.gpu.length = 0;
    M.calls.length = 0;
    M.tris.length = 0;
    M.js.length = 0;
    M.on = true;
    const tick = () => {
      if (!M.on) return;
      M.calls.push(gl.info.render.calls);
      M.tris.push(gl.info.render.triangles);
      gl.info.reset();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await sleep(ms);
  return page.evaluate(() => {
    const M = window.__vegm;
    M.on = false;
    const { gl, scene } = window.__cvThree();
    gl.info.autoReset = true;
    let vegBytes = 0;
    scene.traverse((o) => {
      if (o.name !== "village_vegetation") return;
      o.traverse((c) => {
        const g = c.geometry;
        if (!g) return;
        for (const k in g.attributes) vegBytes += g.attributes[k].array.byteLength;
        if (g.index) vegBytes += g.index.array.byteLength;
        if (c.instanceMatrix) vegBytes += c.instanceMatrix.array.byteLength + (c.instanceColor?.array.byteLength ?? 0);
      });
    });
    // several rAF callbacks run per frame (they share its timestamp): one interval and one GPU sum per frame
    const ts = [...new Set(M.raf)].sort((x, y) => x - y);
    const iv = [];
    for (let i = 1; i < ts.length; i++) iv.push(ts[i] - ts[i - 1]);
    const perFrame = new Map();
    for (const [at, g] of M.gpu) perFrame.set(at, (perFrame.get(at) ?? 0) + g);
    const jsFrame = new Map();
    for (const [at, d] of M.js) jsFrame.set(at, (jsFrame.get(at) ?? 0) + d);
    return {
      iv,
      js: [...jsFrame.values()],
      gpu: [...perFrame.values()],
      calls: M.calls.slice(2),
      tris: M.tris.slice(2),
      heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      vegBytes,
      veg: window.__cvVeg?.() ?? null,
      canvas: [gl.domElement.width, gl.domElement.height],
    };
  });
}

const PERF_VIEWS = ["plazaDay", "plazaWide", "planterNight", "crownNight", "crownUnder", "houseBed"];

/**
 * Old and new side by side in one browser: both pages loaded, the idle one frozen; each view measured old, new, then
 * new, old (the other agents on this GPU then weigh on both alike). Medians per (mode, view).
 */
async function perf() {
  const browser = await chromium.launch({ headless: true, channel: "chrome", args: GPU_ARGS });
  const ms = Number(a.ms);
  const rows = [];
  for (const tier of a.tiers.split(",")) {
    for (const [tl, time] of [
      ["day", DAY],
      ["night", NIGHT],
    ]) {
      const pages = {};
      for (const veg of a.modes.split(",")) {
        pages[veg] = await open(browser, { tier, veg, time, phone: tier === "low" });
        await hideHud(pages[veg].page);
        await setFrozen(pages[veg], true);
      }
      const samples = {};
      for (let round = 0; round < 2; round++) {
        for (const v of PERF_VIEWS) {
          const order = round % 2 === 0 ? Object.keys(pages) : Object.keys(pages).reverse();
          for (const veg of order) {
            const s = pages[veg];
            await setFrozen(s, false);
            const r = await measure(s.page, VIEWS[v], ms);
            await setFrozen(s, true);
            (samples[`${veg}|${v}`] ??= []).push(r);
          }
        }
      }
      for (const [k, list] of Object.entries(samples)) {
        const [veg, view] = k.split("|");
        const all = (f) => list.flatMap(f);
        const r = list[list.length - 1];
        const row = {
          tier,
          time: tl,
          veg,
          view,
          fps: r2(1000 / mean(all((x) => x.iv))),
          ivP95: r2(pct(all((x) => x.iv), 95)),
          gpuMed: r2(pct(all((x) => x.gpu), 50)),
          gpuMean: r2(mean(all((x) => x.gpu))),
          gpuP95: r2(pct(all((x) => x.gpu), 95)),
          jsMed: r2(pct(all((x) => x.js), 50)),
          jsP95: r2(pct(all((x) => x.js), 95)),
          calls: Math.round(mean(all((x) => x.calls)) ?? 0),
          tris: Math.round(mean(all((x) => x.tris)) ?? 0),
          heapMB: r2(r.heapMB),
          geometries: r.geometries,
          textures: r.textures,
          vegMB: r2(r.vegBytes / 1048576),
          vegTris: r.veg?.tris ?? 0,
          vegCalls: r.veg?.calls ?? 0,
          genMs: r2(r.veg?.genMs ?? 0),
          loadMs: pages[veg].loadMs,
          vegReadyMs: pages[veg].vegReadyMs,
          steps: r.veg?.steps ?? null,
          canvas: r.canvas.join("x"),
        };
        rows.push(row);
        console.log(JSON.stringify(row));
      }
      for (const s of Object.values(pages)) {
        if (s.errors.length) console.log("errors", s.errors.slice(0, 5));
        await s.ctx.close();
      }
    }
  }
  await browser.close();
  writeFileSync(join(OUT, "perf.json"), JSON.stringify(rows, null, 1));
}

if (a.shots) await shots();
if (a.perf) await perf();
