/**
 * e2e/coaster-tall-shots.mjs — 별똥별 급행's tall lift and new back half (owner 2026-11-19: "아주 높이 올라가게", "뒷 부분은 그냥 밋밋해"),
 * seen from the ground: the village's skyline of the park, then in the park the whole coaster from the star plaza and from afar, the lift
 * towers, and each back-half element (the loop and the zero-g roll, the bunny hops, the helix, the tunnel under its top lap). A fixed photo
 * camera (window.__cvShot) per view; the train runs on the shared clock, so it is wherever the lap puts it.
 *
 *   CV_CLIENT_URL=http://localhost:5975 node e2e/coaster-tall-shots.mjs [--phone] [--night] [--out=<folder>]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const night = process.argv.includes("--night");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(`coaster-tall-shots-${phone ? "phone" : "pc"}-${night ? "night" : "day"}`);
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });
const TIME = night ? "2026-11-03T21:30" : "2026-11-03T12:30";

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
const view = async (p, name, cam, wait = 1600) => {
  await p.page.evaluate((c) => { window.__cvShot = c; }, cam);
  await sleep(wait);
  await run.shot(p, `${name}.png`);
};

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: phone ? "A-phone" : "A-pc", device: phone ? PHONE : DESKTOP });

await run.step("village skyline", async () => {
  await A.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(TIME)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(A);
  await A.page.locator("input.cv-input").first().fill(`Ct${Math.floor(Math.random() * 900 + 100)}`);
  await press(A, A.page.locator(".cv-submit"));
  await A.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 * SLOW });
  await A.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 30000 * SLOW });
  await sleep(15000); // the loading card fades and the far skyline streams in
  // the park's skyline behind the village's south gate (world: the gate lot at x -24, the park beyond z 104)
  const sky = await A.page.evaluate(async () => {
    const m = await window.__imp("/src/village/skyline/skylinePlacement.ts");
    return { ox: m.OX, oz: m.OZ };
  });
  const s = 0.4;
  const w = (x, z) => [sky.ox + x * s, sky.oz + z * s];
  const [lx, lz] = w(130, 7); // the lift's crest
  const [cx, cz] = w(110, 30); // the circuit's middle
  await view(A, "01-village-skyline-from-the-square", { x: -24, y: 4, z: 40, tx: cx, ty: 14, tz: cz, fov: 55 }, 3000);
  await view(A, "02-village-skyline-near-the-gate", { x: -10, y: 3, z: 88, tx: lx, ty: 22, tz: lz, fov: 60 }, 2500);
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
  await sleep(6000);
});

await run.step("the coaster from the ground", async () => {
  const meta = await A.page.evaluate(async () => {
    const t = (await window.__imp("/land/coaster.ts")).coasterTrack();
    const p = (i) => [t.pos[3 * i], t.pos[3 * i + 1], t.pos[3 * i + 2]];
    const m = t.marks;
    const mid = (a, b) => p(Math.round((a + b) / 2));
    return { crest: p(t.liftTo), loop: mid(m.loopFrom, m.loopTo), roll: mid(m.rollFrom, m.rollTo), hops: mid(m.hopsFrom, m.hopsTo), helix: mid(m.helixFrom, m.helixTo), tunnel: mid(m.tunnelFrom, m.tunnelTo), turn: mid(m.turnFrom, m.turnTo) };
  });
  console.log("track", JSON.stringify(meta));
  const v = (p, dx, dy, dz, fov = 55, ty = 0) => ({ x: p[0] + dx, y: p[1] + dy, z: p[2] + dz, tx: p[0], ty: p[1] + ty, tz: p[2], fov });
  await view(A, "10-from-the-plaza", { x: 40, y: 1.7, z: -128, tx: 95, ty: 22, tz: 20, fov: 72 }, 2500);
  await view(A, "11-from-the-station-approach", { x: 2, y: 1.7, z: -60, tx: 120, ty: 30, tz: 7, fov: 70 });
  await view(A, "12-from-afar-whole-coaster", { x: 110, y: 140, z: -270, tx: 110, ty: 10, tz: 25, fov: 55 }, 2500);
  await view(A, "13-from-afar-low", { x: -120, y: 30, z: -150, tx: 120, ty: 20, tz: 25, fov: 60 }, 2000);
  await view(A, "14-lift-towers", { x: 62, y: 1.7, z: -16, tx: 140, ty: 45, tz: 7, fov: 70 });
  await view(A, "15-lift-crest-close", v(meta.crest, -18, -4, -26, 55, -6));
  await view(A, "16-loop-and-roll", { x: 175, y: 4, z: 100, tx: 185, ty: 12, tz: 55, fov: 65 });
  await view(A, "17-hops", { x: 40, y: 3, z: 95, tx: 40, ty: 4, tz: 56, fov: 70 });
  await view(A, "18-helix", { x: -40, y: 6, z: 70, tx: meta.helix[0], ty: 5, tz: meta.helix[2], fov: 70 });
  await view(A, "19-tunnel-and-head-chopper", { x: -20, y: 2.2, z: -9, tx: meta.tunnel[0] - 15, ty: 4, tz: meta.tunnel[2], fov: 65 });
  await view(A, "20-turnaround", v(meta.turn, -60, 8, -40, 60, -6));
  await A.page.evaluate(() => { window.__cvShot = null; });
});

run.finish({});
await b.close();
process.exit(run.results.every((r) => r.ok) && run.errors.length === 0 ? 0 : 1);
