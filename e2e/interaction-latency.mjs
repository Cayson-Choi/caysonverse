// 케이슨 마을 입력 지연 측정 — 프로덕션 빌드에서 Event Timing(Vercel 툴바의 "Interaction Timing"과 INP가 쓰는 바로 그 자료)으로 잰다.
//
//   node e2e/interaction-latency.mjs [--url http://localhost:5301] [--throttle 1,4] [--gpu default|software|none]
//        [--graphics auto|high|low] [--dpr 1.5] [--w 1707] [--h 860] [--contend 0] [--reps 1] [--only click,keys,hud]
//        [--steady 5000] [--gputime] [--label run] [--out <dir>]
//
// 준비(프로덕션 빌드 + 서버, 이 PC의 포트 규칙 2701-2709 / 5301-5309):
//   cd client && VITE_SERVER_URL=http://localhost:2701 npx vite build --outDir <dir>
//   cd client && npx vite preview --outDir <dir> --port 5301 --strictPort
//   cd server && PORT=2701 npx tsx src/index.ts
//
// 무엇을 하나: 입장 화면에서 닉네임을 넣고 마을에 들어가, 입력 없이 --steady ms 동안 프레임 간격을 잰 뒤 사람 손처럼(누르고 약 90 ms 뒤 뗌)
// 캔버스 클릭 10번(클릭 이동), 키 누름(WASD·방향키 길게, Shift 달리기, Space 점프, Enter 채팅 열기·글자·Escape 닫기),
// HUD 버튼(이모지, 지도, 메뉴, 배경음악, 소리, 시점, 접속자 목록)을 차례로 누른다. --throttle 값마다 브라우저를 새로 띄운다(CDP CPU 스로틀).
//
// 숫자 읽는 법(상호작용 하나 = 같은 interactionId의 Event Timing 항목들):
//   inp     가장 느린 항목의 duration(INP가 쓰는 값, 8 ms 단위로 반올림됨)
//   render  툴바식 "render"(= 다음 그림이 화면에 나올 때까지): 마지막 항목의 duration - (processingEnd - startTime)
//   input / proc  툴바식 입력 지연(첫 항목 processingStart - startTime) / 처리 시간(항목별 processingEnd - processingStart의 합)
//   프레임   rAF 간격(입력 없는 구간과 상호작용 구간), rAF 콜백 안의 JS 시간, --gputime이면 프레임당 GPU 시간(EXT_disjoint_timer_query_webgl2)
// --contend N: 같은 GPU를 쓰는 다른 브라우저 프로세스 N개가 마을을 그리는 동안 잰다(다른 탭·창·3D 앱이 GPU를 나눠 쓰는 상황).
//   --contend-url: 그 브라우저들이 여는 주소(기본 --url, 곧 같은 빌드 두 창). 다른 빌드를 주면 바깥 부하를 고정한 채 비교할 수 있다.
// --gpu software: SwiftShader(소프트웨어 GL), 그래픽 드라이버가 막힌 PC의 최악 조건.
// 결과: <out>/<label>-t<스로틀>.json (요약 + 상호작용별 자료), 콘솔에 유형별 표.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: process.env.CV_CLIENT_URL || "http://localhost:5301" },
    throttle: { type: "string", default: "1,4" },
    gpu: { type: "string", default: "default" },
    graphics: { type: "string", default: "auto" },
    dpr: { type: "string", default: "1.5" },
    w: { type: "string", default: "1707" },
    h: { type: "string", default: "860" },
    contend: { type: "string", default: "0" },
    "contend-url": { type: "string", default: "" },
    reps: { type: "string", default: "1" },
    only: { type: "string", default: "" },
    steady: { type: "string", default: "5000" },
    settle: { type: "string", default: "8000" },
    hold: { type: "string", default: "90" },
    gputime: { type: "boolean", default: false },
    label: { type: "string", default: "run" },
    out: { type: "string", default: join(REPO, ".superpowers", "sdd", "evidence", "interaction-latency") },
  },
});
mkdirSync(a.out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (x) => Math.round(x * 10) / 10;
const pct = (arr, p) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const GPU_ARGS = {
  default: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
  software: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
  none: [],
};
if (!GPU_ARGS[a.gpu]) {
  console.error("--gpu default|software|none");
  process.exit(2);
}

/** Page-side instrumentation (an init script): Event Timing, rAF callback timing, optional GPU time per frame. */
function instrument(opts) {
  const M = (window.__lat = { events: [], raf: [], gpu: [], loaf: [], sizes: [] });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        let tgt = "";
        try {
          const t = e.target;
          if (t) tgt = t.tagName + (typeof t.className === "string" && t.className ? "." + t.className.split(" ")[0] : "");
        } catch {}
        M.events.push({ name: e.name, start: e.startTime, dur: e.duration, ps: e.processingStart, pe: e.processingEnd, id: e.interactionId, tgt });
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
  } catch (err) {
    M.err = String(err);
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) M.loaf.push([e.startTime, e.duration, e.blockingDuration]);
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch {}
  // GPU time of everything a rAF callback submits (one TIME_ELAPSED query around the callback, read back frames later).
  const ctxs = [];
  if (opts.gputime) {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      const c = orig.call(this, type, attrs);
      if (c && type === "webgl2" && !ctxs.some((x) => x.gl === c)) {
        const ext = c.getExtension("EXT_disjoint_timer_query_webgl2");
        if (ext) ctxs.push({ gl: c, ext, pending: [] });
      }
      return c;
    };
  }
  const main = () => ctxs.find((x) => x.gl.drawingBufferWidth > 64);
  const origRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return origRAF(function (ts) {
      const t0 = performance.now();
      const g = opts.gputime ? main() : null;
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
      try {
        cb(ts);
      } finally {
        if (q) {
          g.gl.endQuery(g.ext.TIME_ELAPSED_EXT);
          g.open = false;
          g.pending.push([q, ts]);
        }
        M.raf.push(ts, t0, performance.now());
        if (M.raf.length > 300000) M.raf.splice(0, 150000);
        // The game canvas's drawing-buffer size: a change is the frame governor stepping the dpr (renderBudget.ts).
        const c = document.querySelector(".cv-canvas canvas"); // (react-three-fiber puts the class on the canvas's wrapper)
        const last = M.sizes[M.sizes.length - 1];
        if (c && (!last || last[1] !== c.width || last[2] !== c.height)) M.sizes.push([ts, c.width, c.height]);
      }
    });
  };
}

async function joinVillage(page, graphics, prefix, url = a.url) {
  await page.goto(url + "/", { waitUntil: "domcontentloaded" });
  const input = page.locator("input.cv-input").first();
  await input.waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector(".cv-builder-hint.is-loading"), null, { timeout: 30000 }).catch(() => {});
  await input.fill((prefix + Math.floor(Math.random() * 1e6)).slice(0, 8));
  await page.locator(".cv-submit").click();
  await page.locator("canvas").first().waitFor({ state: "visible", timeout: 60000 });
  await page.locator(".cv-hud-right").waitFor({ state: "visible", timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 120000 }).catch(() => {});
  void graphics;
}

async function newContext(browser, graphics) {
  const ctx = await browser.newContext({ viewport: { width: Number(a.w), height: Number(a.h) }, deviceScaleFactor: Number(a.dpr) });
  await ctx.addInitScript((g) => {
    try {
      // The guide (coach marks) is done, so its cards do not cover the HUD; the graphics setting as asked.
      localStorage.setItem("cv-settings-v1", JSON.stringify({ coachDone: true, graphics: g }));
    } catch {}
  }, graphics);
  return ctx;
}

/** Other browsers rendering the village on the same GPU (separate GPU processes), for --contend. */
async function startContention(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const browser = await chromium.launch({ channel: "chrome", headless: true, args: GPU_ARGS[a.gpu] });
    const ctx = await newContext(browser, a.graphics);
    const page = await ctx.newPage();
    await joinVillage(page, a.graphics, "L", a["contend-url"] || a.url);
    out.push(browser);
  }
  return out;
}

async function runOnce(throttle) {
  const contention = await startContention(Number(a.contend));
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: [...GPU_ARGS[a.gpu], "--enable-blink-features=LongAnimationFrameTiming"] });
  const ctx = await newContext(browser, a.graphics);
  await ctx.addInitScript(instrument, { gputime: a.gputime });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
  });
  const cdp = await ctx.newCDPSession(page);
  await joinVillage(page, a.graphics, "p");
  await sleep(Number(a.settle));
  const info = () =>
    page.evaluate(() => {
      const c = document.querySelector(".cv-canvas canvas") || document.querySelector("canvas");
      let renderer = "";
      try {
        const gl = document.createElement("canvas").getContext("webgl2");
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        renderer = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {}
      return { renderer, canvas: c ? `${c.width}x${c.height}` : null, dpr: devicePixelRatio, gfx: document.documentElement.dataset.gfx ?? null };
    });
  const infoStart = await info();
  if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  const now = () => page.evaluate(() => performance.now());

  const marks = [];
  async function act(label, fn, settle = 1300) {
    const t0 = await now();
    await fn();
    marks.push({ label, t0, t1: await now() });
    await sleep(settle);
  }
  const steadyStart = await now();
  await sleep(Number(a.steady));
  const steadyEnd = await now();

  const W = Number(a.w);
  const H = Number(a.h);
  const HOLD = Number(a.hold);
  const spots = [[0.5, 0.72], [0.35, 0.65], [0.65, 0.68], [0.5, 0.58], [0.25, 0.8], [0.75, 0.78], [0.45, 0.62], [0.55, 0.85], [0.5, 0.7], [0.4, 0.75]];
  const tap = async (k) => {
    await page.keyboard.down(k);
    await sleep(HOLD);
    await page.keyboard.up(k);
  };
  const hold = async (keys, ms) => {
    for (const k of keys) await page.keyboard.down(k);
    await sleep(ms);
    for (const k of [...keys].reverse()) await page.keyboard.up(k);
  };
  const press = async (loc) => {
    const b = await loc.boundingBox();
    if (!b) return;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await sleep(HOLD);
    await page.mouse.up();
  };
  const want = (k) => !a.only || a.only.split(",").includes(k);
  const button = async (label, sel, settle = 1200) => {
    const loc = page.locator(sel).first();
    if (await loc.count()) await act(label, () => press(loc), settle);
  };
  for (let r = 0; r < Number(a.reps); r++) {
    if (want("click"))
      for (const [i, [fx, fy]] of spots.entries())
        await act(`click#${i}`, async () => {
          await page.mouse.move(Math.round(W * fx), Math.round(H * fy));
          await page.mouse.down();
          await sleep(HOLD);
          await page.mouse.up();
        }, 1100);
    if (want("keys")) {
      await act("W hold", () => hold(["KeyW"], 700));
      await act("ArrowLeft hold", () => hold(["ArrowLeft"], 500));
      await act("Shift+W run", () => hold(["ShiftLeft", "KeyW"], 800));
      await act("S hold", () => hold(["KeyS"], 600));
      await act("Space jump", () => tap("Space"), 1500);
      await act("Space jump2", () => tap("Space"), 1500);
      await act("D tap", () => tap("KeyD"));
      await act("Enter open chat", () => tap("Enter"), 1000);
      await act("type h", () => tap("KeyH"), 500);
      await act("Escape close chat", () => tap("Escape"), 1000);
    }
    if (want("hud")) {
      await button("emoji btn", ".cv-emoji-btn", 2000);
      await act("Digit2 emoji", () => tap("Digit2"), 2000);
      await button("map open", '[aria-label="지도 보기"]', 1800);
      await button("map close", '[aria-label="지도 보기"]', 1800);
      await act("M key map", () => tap("KeyM"), 1800);
      await act("M key close", () => tap("KeyM"), 1800);
      await button("menu open", '[aria-label="메뉴 열기"]');
      await button("menu close", ".cv-menu-close");
      await button("bgm toggle", '[aria-label="배경음악 켜기/끄기"]');
      await button("bgm toggle2", '[aria-label="배경음악 켜기/끄기"]');
      await button("sound toggle", '[aria-label="소리 켜기/끄기"]', 1000);
      await button("sound toggle2", '[aria-label="소리 켜기/끄기"]', 1000);
      await button("view toggle", '[aria-label="1인칭/3인칭 전환"]');
      await button("view toggle2", '[aria-label="1인칭/3인칭 전환"]');
      await button("roster open", ".cv-hud-people", 1000);
      await button("roster close", ".cv-hud-people", 1000);
    }
  }
  await sleep(800);
  if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const infoEnd = await info();
  const m = await page.evaluate(() => window.__lat);
  await browser.close();
  for (const b of contention) await b.close();

  // ── frames ──
  const frames = []; // one per rAF timestamp (several callbacks can share one)
  for (let i = 0; i < m.raf.length; i += 3) {
    const [ts, s, e] = [m.raf[i], m.raf[i + 1], m.raf[i + 2]];
    const last = frames[frames.length - 1];
    if (last && last.ts === ts) {
      last.js += e - s;
      last.end = e;
    } else frames.push({ ts, js: e - s, start: s, end: e });
  }
  const gpuAt = new Map();
  for (const [ts, ms] of m.gpu) gpuAt.set(ts, (gpuAt.get(ts) ?? 0) + ms);
  const frameStats = (t0, t1) => {
    const fs = frames.filter((f) => f.ts >= t0 && f.ts <= t1);
    const dts = [];
    for (let i = 1; i < fs.length; i++) dts.push(fs[i].ts - fs[i - 1].ts);
    const js = fs.map((f) => f.js);
    const gpu = fs.map((f) => gpuAt.get(f.ts)).filter((x) => x !== undefined);
    const stat = (xs) => ({ p50: r1(pct(xs, 50)), p90: r1(pct(xs, 90)), max: r1(Math.max(...xs)), mean: r1(xs.reduce((s, x) => s + x, 0) / (xs.length || 1)) });
    return { fps: r1((fs.length / Math.max(1, t1 - t0)) * 1000), interval: stat(dts), js: stat(js), ...(gpu.length ? { gpu: stat(gpu) } : {}) };
  };

  // ── interactions ──
  const byId = new Map();
  for (const e of m.events) {
    if (!e.id) continue;
    if (!byId.has(e.id)) byId.set(e.id, []);
    byId.get(e.id).push(e);
  }
  const inters = [];
  for (const [id, es] of byId) {
    const ord = [...es].sort((x, y) => x.start - y.start);
    const first = ord[0];
    const last = ord[ord.length - 1];
    const top = es.reduce((x, y) => (y.dur > x.dur ? y : x));
    const mk = marks.find((k) => first.start >= k.t0 - 30 && first.start <= k.t1 + 30) ?? marks.filter((k) => k.t0 <= first.start).pop();
    const input = first.ps - first.start;
    const proc = es.reduce((s, e) => s + (e.pe - e.ps), 0);
    const render = Math.max(0, last.dur - (last.pe - last.start));
    inters.push({
      id,
      label: mk ? mk.label : "?",
      names: ord.map((e) => `${e.name}:${Math.round(e.dur)}`).join(","),
      tgt: top.tgt,
      inp: top.dur,
      input: r1(input),
      proc: r1(proc),
      render: r1(render),
      total: r1(input + proc + render),
    });
  }
  inters.sort((x, y) => x.id - y.id);
  const kind = (l) => (l.startsWith("click#") ? "canvasClick" : /hold|run/.test(l) ? "keyHold" : /jump|tap|chat|type|Digit|M key/.test(l) ? "keyTap" : "hud");
  const byType = {};
  for (const i of inters) {
    if (i.label === "?") continue;
    (byType[kind(i.label)] ||= []).push(i);
  }
  const types = {};
  for (const [k, is] of Object.entries(byType)) {
    const inp = is.map((i) => i.inp);
    const render = is.map((i) => i.render);
    types[k] = {
      n: is.length,
      inp: { p50: pct(inp, 50), p90: pct(inp, 90), max: Math.max(...inp) },
      render: { p50: r1(pct(render, 50)), max: r1(Math.max(...render)) },
      over100: inp.filter((x) => x > 100).length,
      over200: inp.filter((x) => x > 200).length,
    };
  }
  const all = inters.filter((i) => i.label !== "?").map((i) => i.inp);
  const summary = {
    label: a.label,
    throttle,
    gpu: a.gpu,
    graphics: a.graphics,
    contend: Number(a.contend),
    viewport: `${a.w}x${a.h}@${a.dpr}`,
    infoStart,
    infoEnd,
    steady: frameStats(steadyStart, steadyEnd),
    during: frameStats(marks[0]?.t0 ?? 0, marks[marks.length - 1]?.t1 ?? 0),
    all: { n: all.length, p50: pct(all, 50), p90: pct(all, 90), p98: pct(all, 98), max: Math.max(...all), over100: all.filter((x) => x > 100).length, over200: all.filter((x) => x > 200).length },
    types,
    longFrames: { n: m.loaf.length, over200: m.loaf.filter((l) => l[1] > 200).length },
    // dpr steps of the frame governor after the scene was in (the first entry is the size the scene started at)
    canvasSizes: m.sizes.map(([ts, w, h]) => {
      const near = marks.filter((k) => k.t0 <= ts).pop();
      // the step's own cost: the longest frame interval and frame JS within 300 ms of it
      const around = frames.filter((f) => f.ts >= ts - 300 && f.ts <= ts + 300);
      let gap = 0;
      for (let i = 1; i < around.length; i++) gap = Math.max(gap, around[i].ts - around[i - 1].ts);
      const js = Math.max(0, ...around.map((f) => f.js));
      return { at: Math.round(ts), size: `${w}x${h}`, phase: ts < steadyStart ? "settle" : ts < steadyEnd ? "steady" : near ? `after ${near.label}` : "?", maxGap: r1(gap), maxJs: r1(js) };
    }),
    errors: errors.filter((e) => !/THREE\.Clock|favicon/.test(e)).slice(0, 10),
  };
  const file = join(a.out, `${a.label}-t${throttle}.json`);
  writeFileSync(file, JSON.stringify({ summary, inters, marks }, null, 1));
  console.log(`\n=== ${a.label} throttle ${throttle}x gpu=${a.gpu} graphics=${a.graphics} contend=${a.contend} ${summary.viewport} -> ${file}`);
  console.log(`renderer ${infoStart.renderer} | canvas ${infoStart.canvas} -> ${infoEnd.canvas} | gfx ${infoStart.gfx} -> ${infoEnd.gfx}`);
  if (summary.canvasSizes.length > 1)
    console.log(`canvas sizes ${summary.canvasSizes.map((c, i) => `${c.size} (${c.phase}${i ? `, frame gap ${c.maxGap} js ${c.maxJs}` : ""})`).join(" -> ")}`);
  const fl = (f) => `fps ${f.fps} | interval p50 ${f.interval.p50} p90 ${f.interval.p90} max ${f.interval.max} | js p50 ${f.js.p50} p90 ${f.js.p90}${f.gpu ? ` | gpu p50 ${f.gpu.p50} p90 ${f.gpu.p90}` : ""}`;
  console.log(`steady  ${fl(summary.steady)}`);
  console.log(`during  ${fl(summary.during)}`);
  console.log(`ALL     n ${summary.all.n} p50 ${summary.all.p50} p90 ${summary.all.p90} p98 ${summary.all.p98} max ${summary.all.max} >100 ${summary.all.over100} >200 ${summary.all.over200}`);
  for (const [k, t] of Object.entries(types))
    console.log(`${k.padEnd(12)} n ${String(t.n).padStart(2)} | inp p50 ${t.inp.p50} p90 ${t.inp.p90} max ${t.inp.max} | toolbar render p50 ${t.render.p50} max ${t.render.max} | >100 ${t.over100} >200 ${t.over200}`);
  for (const i of inters)
    if (i.label !== "?") console.log(`  ${i.label.padEnd(18)} inp ${String(i.inp).padStart(4)} | in ${i.input} proc ${i.proc} render ${i.render} | ${i.names}`);
  if (summary.errors.length) console.log("errors:", summary.errors.join(" | "));
  return summary;
}

const results = [];
for (const t of a.throttle.split(",").map(Number)) results.push(await runOnce(t));
writeFileSync(join(a.out, `${a.label}-summary.json`), JSON.stringify(results, null, 1));
