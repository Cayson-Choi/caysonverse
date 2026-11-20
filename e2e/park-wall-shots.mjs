/**
 * e2e/park-wall-shots.mjs — 케이슨랜드's castle wall (owner 2026-11-20: "케이슨 랜드 전체를 성벽으로 둘러싸는거지"): in the village the gate
 * approach (the owner's view from the bridge), the gate from further off, the skyline from the square looking south (the rides above the
 * wall) and from the air; in the park the wall from the star plaza, along the west side, from the coaster's lift crest and from the air.
 * A fixed photo camera (window.__cvShot) per view; the renderer's draws and triangles are recorded per view (stats.json).
 *
 *   CV_CLIENT_URL=http://localhost:5941 node e2e/park-wall-shots.mjs [--phone] [--night] [--off] [--out=<folder>]
 *   (--off: `?wall=off`, the before numbers)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const night = process.argv.includes("--night");
const off = process.argv.includes("--off");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const tag = `${phone ? "phone" : "pc"}-${night ? "night" : "day"}${off ? "-before" : ""}`;
const run = createRun(`park-wall-shots-${tag}`);
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });
const TIME = night ? "2026-11-03T21:30" : "2026-11-03T15:30";
const stats = {};

async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}
async function goTo(p, x, z, tol = 1.2) {
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
    await until(async () => (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 90000);
    await sleep(300);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(p);
}
const areaOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
const view = async (p, name, cam, wait = 1800) => {
  await p.page.evaluate((c) => { window.__cvShot = c; }, cam);
  await sleep(wait);
  const info = await p.page.evaluate(() => window.__cvFrameDraws?.() ?? null);
  stats[name] = info ? { calls: info.calls, triangles: info.triangles } : null;
  await run.shot(p, `${tag}-${name}.png`);
};

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: phone ? "A-phone" : "A-pc", device: phone ? PHONE : DESKTOP });
// every GL draw of a frame (shadow passes and all; three's own counters reset at each render() call, so they hold only the last pass)
await A.ctx.addInitScript(() => {
  const acc = { calls: 0, triangles: 0 };
  const last = { calls: 0, triangles: 0 };
  const tri = (mode, count, inst = 1) => (mode === 4 ? (count / 3) * inst : mode === 5 || mode === 6 ? Math.max(0, count - 2) * inst : 0);
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    const de = C.prototype.drawElements;
    C.prototype.drawElements = function (mode, count, type, off) { acc.calls++; acc.triangles += tri(mode, count); return de.call(this, mode, count, type, off); };
    const da = C.prototype.drawArrays;
    C.prototype.drawArrays = function (mode, first, count) { acc.calls++; acc.triangles += tri(mode, count); return da.call(this, mode, first, count); };
    if (C.prototype.drawElementsInstanced) {
      const dei = C.prototype.drawElementsInstanced;
      C.prototype.drawElementsInstanced = function (mode, count, type, off, n) { acc.calls++; acc.triangles += tri(mode, count, n); return dei.call(this, mode, count, type, off, n); };
      const dai = C.prototype.drawArraysInstanced;
      C.prototype.drawArraysInstanced = function (mode, first, count, n) { acc.calls++; acc.triangles += tri(mode, count, n); return dai.call(this, mode, first, count, n); };
    }
  }
  const tick = () => {
    if (acc.calls > 0) { last.calls = acc.calls; last.triangles = Math.round(acc.triangles); }
    acc.calls = 0; acc.triangles = 0;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__cvFrameDraws = () => ({ ...last });
});
const q = `?time=${encodeURIComponent(TIME)}${off ? "&wall=off" : ""}`;

await run.step("village: the gate and the wall", async () => {
  await A.page.goto(`${CLIENT_URL}/${q}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(A);
  await A.page.locator("input.cv-input").first().fill(`Wl${Math.floor(Math.random() * 900 + 100)}`);
  await press(A, A.page.locator(".cv-submit"));
  await A.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 * SLOW });
  await A.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 30000 * SLOW });
  await sleep(18000); // the loading card fades, the skyline and the wall stream in
  // the lot buildings (the gatehouse) and the skyline are in before any view is taken (before and after alike)
  const lotsIn = await until(async () => await A.page.evaluate(() => !!window.__cvLots?.()?.ready && !!window.__cvSkyline?.()), 120000 * SLOW);
  run.check("the gatehouse and the skyline are loaded", lotsIn);
  await sleep(4000);
  if (!off) {
    const ok = await until(async () => await A.page.evaluate(() => !!window.__cvWall?.village), 60000);
    run.check("the village wall is built", ok, await A.page.evaluate(() => window.__cvWall?.village ?? null));
  }
  stats.skyline = await A.page.evaluate(() => window.__cvSkyline?.() ?? null);
  await view(A, "v1-gate-approach", { x: -24, y: 2.4, z: 73, tx: -24, ty: 7, tz: 96, fov: 62 }, 3000);
  await view(A, "v2-gate-far", { x: -18, y: 9, z: 58, tx: -24, ty: 8, tz: 120, fov: 62 });
  await view(A, "v3-square-south", { x: 4, y: 4.5, z: 8, tx: -6, ty: 16, tz: 160, fov: 62 });
  await view(A, "v4-gate-west-corner", { x: -62, y: 3, z: 84, tx: -40, ty: 8, tz: 100, fov: 66 });
  await view(A, "v5-air", { x: -10, y: 110, z: 15, tx: 0, ty: 0, tz: 150, fov: 55 }, 2500);
  await A.page.evaluate(() => { window.__cvShot = null; });
});

await run.step("enter the park", async () => {
  const g = await A.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  await goTo(A, g.x, g.z - 0.5, 1.0);
  await act(A);
  const ok = await until(async () => (await areaOf(A)) === "park", 15000);
  run.check("A goes through the gate into the park", ok);
  const ready = await until(async () => await A.page.evaluate(async () => (await window.__imp("/src/land/parkReady.ts")).parkReady()), 180000 * SLOW);
  run.check("the park finished loading", ready);
  await sleep(8000);
  if (!off) {
    const w = await until(async () => await A.page.evaluate(() => !!window.__cvWall?.park), 60000);
    run.check("the park wall is built", w, await A.page.evaluate(() => window.__cvWall?.park ?? null));
  }
});

await run.step("park: the wall round the edge", async () => {
  const crest = await A.page.evaluate(async () => {
    const t = (await window.__imp("/land/coaster.ts")).coasterTrack();
    return [t.pos[3 * t.liftTo], t.pos[3 * t.liftTo + 1], t.pos[3 * t.liftTo + 2]];
  });
  await view(A, "p1-plaza-north-gate", { x: 40, y: 1.7, z: -128, tx: 40, ty: 7, tz: -190, fov: 70 }, 2500);
  await view(A, "p2-plaza-west", { x: 10, y: 1.7, z: -112, tx: -172, ty: 6, tz: -150, fov: 70 });
  await view(A, "p3-plaza-east", { x: 70, y: 1.7, z: -112, tx: 382, ty: 6, tz: -150, fov: 70 });
  await view(A, "p4-lift-top-east", { x: crest[0], y: crest[1] + 2, z: crest[2], tx: 382, ty: 0, tz: 76, fov: 70 });
  await view(A, "p5-lift-top-south", { x: crest[0], y: crest[1] + 2, z: crest[2], tx: crest[0] - 60, ty: 0, tz: 80, fov: 70 });
  await view(A, "p6-air", { x: 105, y: 260, z: -330, tx: 105, ty: 0, tz: -55, fov: 55 }, 2500);
  await view(A, "p7-wall-close", { x: -150, y: 1.7, z: -160, tx: -171, ty: 8, tz: -186, fov: 70 });
  await A.page.evaluate(() => { window.__cvShot = null; });
  stats.walls = await A.page.evaluate(() => window.__cvWall ?? null);
});

writeFileSync(join(run.evidence, `${tag}-stats.json`), JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats));
run.finish({});
await b.close();
process.exit(run.results.every((r) => r.ok) && run.errors.length === 0 ? 0 : 1);
