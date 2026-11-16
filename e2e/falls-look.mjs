/**
 * e2e/falls-look.mjs — B1 폭포 W3: the integrated falls (waterfall.glb + light maps + the runtime) in the real game, from fixed
 * camera poses: still pictures, short frame sequences (to judge the water in motion), and frame-time / draw / triangle
 * numbers with the falls drawn and hidden at the same pose (docs/designs/waterfall/design.md §6, §9).
 *
 *   server:  PORT=3041 npx tsx src/index.ts   (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:3041 npx vite --port 5641 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5641 node e2e/falls-look.mjs --mode shots --poses photo12,photo05 --times noon,golden,night
 *                [--tier high|low] [--device pc|phone] [--out <folder>]
 *   ... --mode seq --poses s8 --frames 8 --gap 90 --times noon          (a frame sequence: the water moving)
 *   ... --mode perf --poses s8,s1 --times noon [--throttle 4] [--ms 5000]  (falls on / off at the same pose, same page)
 *   ... --mode sound --poses s8,s6,s2,s1 --hud      (the falls' sound level by distance; the menu's 소리 button off and on)
 *
 * The camera is pinned through the DEV hook's scene (`scene.onBeforeRender`, as e2e/fountain-water.mjs) and the falls are
 * told where it is (`__cvFalls.set({ pinEye })`), so the spray / sound / LOD follow the picture's eye. Times are KST on
 * 2026-11-03 through `?time=` (villageClock.ts). Prints JSON lines; writes PNGs and falls-look-<mode>.json in --out.
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { CLIENT_URL, DESKTOP, PHONE, entryReady, press, sleep } from "./lib/common.mjs";

const { values: args } = parseArgs({
  options: {
    mode: { type: "string", default: "shots" },
    tier: { type: "string", default: "high" },
    device: { type: "string", default: "pc" },
    times: { type: "string", default: "noon" },
    poses: { type: "string", default: "photo12" },
    out: { type: "string" },
    frames: { type: "string", default: "8" },
    gap: { type: "string", default: "90" },
    ms: { type: "string", default: "5000" },
    throttle: { type: "string", default: "1" },
    falls: { type: "string", default: "" },
    hud: { type: "boolean", default: false },
  },
});

const OUT = args.out ?? join(process.cwd(), "falls-look-out");
mkdirSync(OUT, { recursive: true });

const TIMES = { dawn: "06:49", morning: "09:30", noon: "12:00", golden: "17:00", dusk: "17:40", night: "21:00" };

/** Poses (game metres): eye, target, vertical fov. The photo poses are W1's render cameras (render_falls_w1.py). */
const POSES = {
  // photo 12 (용추, 함양): from the rest area at eye height, the whole fall in its groove
  photo12: { eye: [-96.0, 1.7, -81.5], target: [-117.0, 12.5, -77.5], fov: 70 },
  // photo 05 (직소): low at the pool's edge on the front slab, looking up the fall
  photo05: { eye: [-101.8, 0.7, -73.6], target: [-116.5, 9.5, -80.0], fov: 66 },
  // the design's spots (9.1): S1 spawn far view, S2 plaza west, S6 entry, S7 rest-area middle, S8 front slab, S9 north end
  s1: { eye: [0, 3.6, 22], target: [-110, 12, -78], fov: 50 },
  s2: { eye: [-30, 3.4, -1], target: [-112, 12, -78], fov: 50 },
  s6: { eye: [-92, 2.8, -78], target: [-114, 8, -78], fov: 60 },
  s7: { eye: [-99.5, 2.6, -79], target: [-114, 10, -78], fov: 60 },
  s8: { eye: [-103.6, 1.9, -79], target: [-113, 6, -78], fov: 60 },
  s9: { eye: [-100.5, 2.2, -88.5], target: [-114, 7, -78], fov: 60 },
  lip: { eye: [-104, 4, -73], target: [-115.5, 15, -78], fov: 45 },
  impact: { eye: [-104.5, 1.6, -75.5], target: [-112.5, 1.2, -78], fov: 50 },
  // W6 (village cut): the seam and the site's edges from outside the box, and the forest round it
  aerial: { eye: [-55, 75, -30], target: [-120, 8, -80], fov: 55 },
  seamS: { eye: [-93, 3.2, -46], target: [-121, 6, -63], fov: 60 },
  seamN: { eye: [-93, 3.2, -112], target: [-121, 8, -98], fov: 60 },
  seamE: { eye: [-94.5, 1.8, -95], target: [-104, 0.5, -70], fov: 60 },
  ridge: { eye: [-80, 28, -80], target: [-140, 38, -80], fov: 60 },
  shoreS: { eye: [-99.5, 1.7, -69.5], target: [-108.5, -0.2, -75.5], fov: 60 },
  shoreN: { eye: [-100, 1.7, -88], target: [-108.5, -0.2, -80.5], fov: 60 },
  // the plaza fountain at the same time of day (the owner's reference for "real water")
  fountain: { eye: [0.6, 1.55, 7.6], target: [0, 1.25, 0], fov: 55 },
  fountainMid: { eye: [7.5, 2.6, 7.5], target: [0, 1.4, 0], fov: 55 },
};

const DEVICES = { pc: DESKTOP, phone: PHONE };

let seq = 0;
async function join_(browser, { tier, time, device }) {
  const ctx = await browser.newContext({ ...DEVICES[device] });
  await ctx.addInitScript((graphics) => {
    try {
      localStorage.setItem("cv-settings-v1", JSON.stringify({ coachDone: true, graphics }));
    } catch {}
  }, tier);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      const t = m.text();
      if (/X3595|WebGLProgram: Program Info Log/.test(t)) return; // the known D3D11 gradient-in-loop warning (baseline)
      if (m.type() === "error" || /falls|shader|THREE/i.test(t)) errors.push(`${m.type()} ${t.slice(0, 300)}`);
    }
  });
  const q = new URLSearchParams({ time: `2026-11-03T${TIMES[time] ?? time}` });
  if (args.falls) q.set("falls", args.falls);
  await page.goto(`${CLIENT_URL}/?${q}`, { waitUntil: "domcontentloaded" });
  const p = { page, touch: device === "phone" };
  await entryReady(p);
  await page.locator("input.cv-input").first().fill(`폭포${++seq}`);
  await press(p, page.locator(".cv-submit"));
  await page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
  await page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  if (args.falls !== "off" && args.falls !== "old")
    await page.waitForFunction(() => !!window.__cvFalls?.stats?.(), null, { timeout: 60000 }).catch(() => errors.push("falls never loaded"));
  await sleep(2500);
  return { ctx, page, errors };
}

async function pin(page, pose) {
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
    window.__cvFalls?.set({ pinEye: pose.eye });
  }, pose);
  await sleep(1200);
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

const stats = (page) =>
  page.evaluate(() => ({ falls: window.__cvFalls?.stats?.() ?? null, render: window.__cvRenderInfo?.() ?? null }));

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", ...(args.mode === "perf" ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : [])],
});
const results = [];
const tag = `${args.device}-${args.tier}`;
try {
  for (const time of args.times.split(",")) {
    const { ctx, page, errors } = await join_(browser, { tier: args.tier, time, device: args.device });
    if (!args.hud) await hideHud(page);
    for (const name of args.poses.split(",")) {
      const pose = POSES[name];
      if (!pose) throw new Error(`no pose ${name}`);
      await pin(page, pose);
      if (args.mode === "shots") {
        const file = `${name}-${time}-${tag}${args.falls ? `-falls_${args.falls}` : ""}.png`;
        await page.screenshot({ path: join(OUT, file) });
        const s = await stats(page);
        results.push({ pose: name, time, tag, file, ...s, list: await page.evaluate(() => window.__cvFalls?.list?.() ?? []) });
        console.log(JSON.stringify({ pose: name, time, tag, file, falls: s.falls && { tri: s.falls.triangles, draws: s.falls.draws, lod: s.falls.lod, d: Math.round(s.falls.distance) }, calls: s.render?.calls, tris: s.render?.triangles }));
      } else if (args.mode === "seq") {
        const n = Number(args.frames);
        for (let i = 0; i < n; i++) {
          await page.screenshot({ path: join(OUT, `seq-${name}-${time}-${tag}-${String(i).padStart(2, "0")}.png`) });
          await sleep(Number(args.gap));
        }
        console.log(JSON.stringify({ seq: name, time, tag, frames: n }));
      } else if (args.mode === "sound") {
        // a user gesture first (the AudioContext starts on it, as on an iPhone), then read the falls' sound target
        await page.mouse.click(5, 400).catch(() => {});
        await sleep(800);
        const read = () => page.evaluate(() => window.__cvFalls?.stats?.()?.audio ?? null);
        const on = await read();
        const btn = page.getByRole("button", { name: "소리 켜기/끄기" });
        await btn.click();
        await sleep(600);
        const off = await read();
        await btn.click();
        await sleep(600);
        const back = await read();
        results.push({ pose: name, time, tag, sound: { on, off, back } });
        console.log(JSON.stringify({ sound: name, d: Math.round((await stats(page)).falls?.distance ?? -1), on, off, back }));
      } else if (args.mode === "perf") {
        const cdp = await ctx.newCDPSession(page);
        const rate = Number(args.throttle);
        const one = async (visible) => {
          await page.evaluate((v) => window.__cvFalls?.set({ visible: v, resetCpu: true }), visible);
          await sleep(1500);
          if (rate > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
          await page.evaluate(() => window.__cv.getFrameStats(1)); // warm
          await sleep(Number(args.ms));
          const fs = await page.evaluate((ms) => window.__cv.getFrameStats(ms), Number(args.ms));
          if (rate > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
          const s = await stats(page);
          return { visible, frame: fs, calls: s.render?.calls, tris: s.render?.triangles, fallsCpuMs: s.falls?.cpuMsPerFrame, fallsTri: s.falls?.triangles };
        };
        const rounds = [];
        for (let r = 0; r < 2; r++) rounds.push(await one(true), await one(false));
        await page.evaluate(() => window.__cvFalls?.set({ visible: true }));
        results.push({ pose: name, time, tag, throttle: rate, rounds });
        console.log(JSON.stringify({ perf: name, time, tag, throttle: rate, rounds: rounds.map((x) => ({ v: x.visible, avg: x.frame?.meanMs, p95: x.frame?.p95Ms, calls: x.calls, tris: x.tris, cpu: x.fallsCpuMs })) }));
      }
    }
    results.push({ time, errors });
    if (errors.length) console.log("ERRORS", time, JSON.stringify(errors));
    await ctx.close();
  }
} finally {
  await browser.close();
  writeFileSync(join(OUT, `falls-look-${args.mode}-${tag}-${Date.now()}.json`), JSON.stringify(results, null, 1));
}
