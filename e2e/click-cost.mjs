// What a click costs the page (round 5 review: the pick and the plan, a way round included, ran in the pointerup
// handler — 15 ms for a click across the fountain on a desktop, 40-60 ms expected on a CPU 4x slower). For a few village
// clicks: the synchronous time of the pointerup dispatch (every listener of it), and the time from it to the walk's
// target being set, at no CPU throttle and at 4x (CDP Emulation.setCPUThrottlingRate). Synthetic mouse events on the
// canvas (pointerdown, then pointerup 40 ms later), each click repeated; the avatar is held (uiCapture) so the camera
// and the start stay put. Works on any build that has the dev hooks (__cvClickTarget).
//
//   CV_CLIENT_URL=http://localhost:5173 node e2e/click-cost.mjs      (CC_REPEAT=8, CC_RATES=1,4)

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { DESKTOP, createRun, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const REPEAT = Number(process.env.CC_REPEAT || 8);
const RATES = (process.env.CC_RATES || "1,4").split(",").map(Number);
const TAG = process.env.CC_TAG || "run";
const run = createRun(`click-cost-${TAG}`);
if (process.env.CC_EVIDENCE) run.evidence = process.env.CC_EVIDENCE;
run.allow("the probe's own three import", /Multiple instances of Three\.js being imported/);

/** [name, where to stand, the ground point clicked, camera yaw, pitch, distance] */
const CASES = [
  ["plaza_straight", [0, 20.5], [3, 0.01, 16], 0, 0.6, 8],
  ["fountain_across", [0, 8.2], [4.5, 0.01, -8.3], 0, 0.9, 10],
  ["far_bank", [-6, 66], [-6, 0.0, 85], Math.PI, 0.5, 8],
];

async function setOrbitGoal(p, yaw, pitch, distance) {
  await p.page.evaluate(async ([yaw, pitch, distance]) => {
    (await window.__imp("/src/game/viewState.ts")).viewState.orbitGoal = { yaw, pitch, distance };
  }, [yaw, pitch, distance]);
  for (let k = 0; k < 40; k++) {
    await sleep(150);
    if (!(await p.page.evaluate(async () => (await window.__imp("/src/game/viewState.ts")).viewState.orbitGoal))) break;
  }
  await sleep(900);
}

const q = (a, f) => {
  const b = [...a].sort((x, y) => x - y);
  return b.length ? +b[Math.min(b.length - 1, Math.floor(f * b.length))].toFixed(2) : null;
};

const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const results = [];
try {
  const p = await openPlayer(browser, run, { tag: "cost", device: DESKTOP, settings: { graphics: "auto" } });
  await run.step("join the village", async () => {
    await joinVillage(p, "cc");
    await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village" && !!window.__cvClickTarget, null, { timeout: 60000 });
    await sleep(4000);
  });
  const cdp = await p.ctx.newCDPSession(p.page);
  for (const [name, stand, aim, yaw, pitch, dist] of CASES) {
    await run.step(`case ${name}`, async () => {
      await walkAndWait(p, stand[0], stand[1], 40000, 0.3);
      // the given camera, else a lower / farther one, until the clicked point is well inside the screen
      for (const [dp, dd] of [[0, 0], [-0.3, 0], [-0.5, 2], [-0.6, 6]]) {
        await setOrbitGoal(p, yaw, pitch + dp, dist + dd);
        const inView = await p.page.evaluate(async ([ax, ay, az]) => {
          const THREE = await window.__imp("/node_modules/.vite/deps/three.js");
          const f = await window.__imp("/@react-three_fiber.js");
          const canvas = document.querySelector(".cv-canvas canvas");
          const root = f._roots.get(canvas) ?? [...f._roots.values()].pop();
          const v = new THREE.Vector3(ax, ay, az).project(root.store.getState().camera);
          return Math.abs(v.x) < 0.85 && Math.abs(v.y) < 0.8 && v.z < 1;
        }, aim);
        if (inView) break;
      }
      for (const rate of RATES) {
        await cdp.send("Emulation.setCPUThrottlingRate", { rate });
        await sleep(500);
        const handler = [];
        const toTarget = [];
        let planned = null;
        for (let k = 0; k < REPEAT; k++) {
          const r = await p.page.evaluate(async ([ax, ay, az]) => {
            const THREE = await window.__imp("/node_modules/.vite/deps/three.js");
            const f = await window.__imp("/@react-three_fiber.js");
            const ui = await window.__imp("/src/game/uiCapture.ts");
            const cm = await window.__imp("/src/game/clickMove.ts");
            const canvas = document.querySelector(".cv-canvas canvas");
            const root = f._roots.get(canvas) ?? [...f._roots.values()].pop();
            const { camera } = root.store.getState();
            const v = new THREE.Vector3(ax, ay, az).project(camera);
            const rect = canvas.getBoundingClientRect();
            const x = rect.left + ((v.x + 1) / 2) * rect.width;
            const y = rect.top + ((1 - v.y) / 2) * rect.height;
            cm.clearClickTarget();
            ui.acquireUiCapture("cc-probe"); // the avatar stays put: the next click starts from the same spot
            const opts = { pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true };
            canvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, buttons: 1 }));
            await new Promise((res) => setTimeout(res, 40));
            const t0 = performance.now();
            canvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
            const handlerMs = performance.now() - t0;
            let targetMs = null;
            while (performance.now() - t0 < 3000) {
              if (window.__cvClickTarget?.()) {
                targetMs = performance.now() - t0;
                break;
              }
              await new Promise((res) => setTimeout(res, 1));
            }
            const target = window.__cvClickTarget?.();
            const pick = window.__cvClickPick?.();
            cm.clearClickTarget();
            ui.releaseUiCapture("cc-probe");
            const why = pick && { hit: pick.pick && { x: +pick.pick.x.toFixed(2), y: +pick.pick.y.toFixed(2), z: +pick.pick.z.toFixed(2) }, plan: pick.plan };
            return { handlerMs, targetMs, target: target && { x: +target.x.toFixed(2), z: +target.z.toFixed(2), via: target.via?.length ?? 0 }, at: [Math.round(x), Math.round(y)], why };
          }, aim);
          handler.push(r.handlerMs);
          if (r.targetMs != null) toTarget.push(r.targetMs);
          planned = r.target;
          if (!r.target && k === 0) console.log(`    no walk: click at ${JSON.stringify(r.at)}: ${JSON.stringify(r.why)}`);
          await sleep(150);
        }
        const row = { case: name, rate, handlerMed: q(handler, 0.5), handlerMax: q(handler, 1), toTargetMed: q(toTarget, 0.5), toTargetMax: q(toTarget, 1), targets: toTarget.length, of: REPEAT, target: planned };
        results.push(row);
        console.log(`  ${name} x${rate}: pointerup handler median ${row.handlerMed} ms, max ${row.handlerMax} ms; to the target median ${row.toTargetMed} ms, max ${row.toTargetMax} ms (${toTarget.length}/${REPEAT}); target ${JSON.stringify(planned)}`);
        run.check(`${name} x${rate}: every click set a walk`, toTarget.length === REPEAT, row);
      }
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    });
  }
} finally {
  await browser.close();
}
mkdirSync(run.evidence, { recursive: true });
writeFileSync(join(run.evidence, `click-cost-${TAG}.json`), JSON.stringify(results, null, 2));
process.exit(run.finish({ costs: results }));
