/**
 * e2e/carousel-ride.mjs — 케이슨랜드 달빛 회전목마: one full ride in the real game (PC, or a phone with --phone).
 * A walks to the carousel pad, boards while it loads, rides (first-person screenshots at rest, turning, bobbing, looking sideways),
 * gets off at the unload; B watches from the park and must see A on a horse. Frame times over the ride are recorded.
 *   CV_CLIENT_URL=http://localhost:5411 node e2e/carousel-ride.mjs [--phone] [--out=<folder>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(phone ? "carousel-ride-phone" : "carousel-ride-desktop");
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });

const NOON = "2026-11-03T12:30";
let nickSeq = 0;
async function joinLand(p, prefix) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(NOON)}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  const nick = `${prefix}${++nickSeq}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 10);
  await p.page.locator("input.cv-input").first().fill(nick);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 * SLOW });
  await p.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvBgm, null, { timeout: 30000 * SLOW });
  await sleep(2500);
  p.nick = nick;
}
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
async function enterPark(p) {
  const g = await p.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  await goTo(p, g.x, g.z - 0.5, 1.0);
  await act(p);
  const ok = await until(async () => (await areaOf(p)) === "park", 15000);
  await sleep(4000);
  return ok;
}
const probe = (p) =>
  p.page.evaluate(async () => {
    const m = await window.__imp("/land/coasterRide.ts");
    const c = await window.__imp("/land/carousel.ts");
    const k = await window.__imp("/land/carouselRide.ts");
    const clock = await window.__imp("/src/village/villageClock.ts");
    const n = c.carouselAt(clock.villageClock.liveMs());
    return { slot: m.selfRide.slot, ride: m.selfRide.ride, status: n.status, phase: n.phase, omega: n.omega, rideT: n.rideT, departsInMs: n.departsInMs, probe: { ...k.carouselProbe, eye: [...k.carouselProbe.eye] } };
  });
const remotes = (p) => p.page.evaluate(async () => (await window.__imp("/src/game/remoteStore.ts")).getRemotes());

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: phone ? "A-phone" : "A-pc", device: phone ? PHONE : DESKTOP });
const B = await openPlayer(b, run, { tag: "B-pc", device: DESKTOP });

await run.step("join", async () => {
  await joinLand(A, "Ca");
  await joinLand(B, "Cb");
  run.check("A enters the park", await enterPark(A), { area: await areaOf(A) });
  run.check("B enters the park", await enterPark(B), { area: await areaOf(B) });
  for (const [name, x, y, z, tx, ty, tz] of [
    ["c01-approach", 80, 1.7, -112, 110, 4, -135],
    ["c02-near", 110, 1.7, -112, 110, 4.5, -135],
    ["c03-side", 128, 2.2, -128, 110, 3.5, -135],
  ]) {
    await A.page.evaluate(([x, y, z, tx, ty, tz]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov: 62 }; }, [x, y, z, tx, ty, tz]);
    await sleep(1200);
    await run.shot(A, `${name}.png`);
  }
  await A.page.evaluate(() => { window.__cvShot = null; });
});

await run.step("board", async () => {
  await goTo(A, 110, -119, 1.5);
  await goTo(B, 112, -119, 2);
  const at = await pos(A);
  run.check("A stands at the carousel pad", Math.hypot(at.x - 110, at.z + 119) < 5, at);
  const t0 = Date.now();
  let st = await probe(A);
  while (st.status !== "boarding" && Date.now() - t0 < 160000 * SLOW) {
    await sleep(500);
    st = await probe(A);
  }
  run.check("the carousel opens for boarding", st.status === "boarding", { status: st.status });
  await A.page.evaluate(() => {
    window.__fpsSamples = [];
    window.__ri = { calls: 0, triangles: 0, n: 0, sumCalls: 0, sumTris: 0 };
    const gl = window.__cvThree?.().gl;
    if (gl) gl.info.autoReset = false;
    window.__long = [];
    const t00 = performance.now();
    let last = performance.now();
    const tick = (t) => {
      window.__fpsSamples.push(t - last);
      if (t - last > 60) window.__long.push({ at: Math.round(t - t00), dt: Math.round(t - last) });
      last = t;
      if (gl) {
        const r = gl.info.render;
        window.__ri.calls = Math.max(window.__ri.calls, r.calls);
        window.__ri.triangles = Math.max(window.__ri.triangles, r.triangles);
        window.__ri.n++;
        window.__ri.sumCalls += r.calls;
        window.__ri.sumTris += r.triangles;
        gl.info.reset();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await act(A);
  const seated = await until(async () => (await probe(A)).slot >= 0, 8000);
  const me = await probe(A);
  run.check("A boards: a carousel seat", seated && me.ride === 2, { slot: me.slot, ride: me.ride });
  await sleep(1500);
  const bsee = await remotes(B);
  const a = bsee.find((r) => r.nickname === A.nick);
  run.check("B sees A on the carousel (rideSeat + rideId synced)", !!a && a.rideSeat === me.slot && a.rideId === 2, { rideSeat: a?.rideSeat, rideId: a?.rideId });
  run.check("the ride panel is up", (await A.page.locator("[data-testid=coaster-ride-hud]").count()) === 1);
  await run.shot(A, "c04-seated-at-rest.png");
});

const log = [];
await run.step("ride", async () => {
  const moments = [["c05-turning-slow", 8], ["c06-full-speed", 30], ["c07-full-speed-look-aside", 31.6], ["c08-late", 70]];
  const shot = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 200000) {
    const st = await probe(A);
    if (st.status === "riding") {
      log.push({ t: Math.round(st.rideT * 10) / 10, omega: Math.round(st.omega * 1000) / 1000, y: Math.round(st.probe.bob * 100) / 100 });
      for (const [name, t] of moments)
        if (!shot.has(name) && st.rideT >= t) {
          shot.add(name);
          if (name === "c07-full-speed-look-aside") {
            await A.page.evaluate(async () => { const v = await window.__imp("/src/game/viewState.ts"); v.viewState.fpYaw = 1.3; });
            await sleep(300);
          }
          await run.shot(A, `${name}.png`);
          if (name === "c06-full-speed") {
            await B.page.evaluate(async () => {
              const c = await window.__imp("/land/carousel.ts");
              const clock = await window.__imp("/src/village/villageClock.ts");
              const rs = await window.__imp("/src/game/remoteStore.ts");
              const me = rs.getRemotes().find((r) => r.rideSeat >= 0);
              const p = c.carouselSeatPose(me ? me.rideSeat : 0, clock.villageClock.liveMs());
              window.__cvShot = { x: p.x + 4.2, y: p.y + 1.6, z: p.z + 5.5, tx: p.x, ty: p.y + 0.3, tz: p.z, fov: 55 };
            });
            await sleep(500);
            await run.shot(B, "c09-B-watches-A.png");
          }
        }
    }
    if (st.status === "unloading" && shot.size > 0) break;
    await sleep(150);
  }
  run.check("every checkpoint photographed", shot.size === moments.length, { got: [...shot] });
  const maxO = Math.max(...log.map((l) => l.omega));
  const ys = log.map((l) => l.y);
  run.check("the carousel turned (> 0.35 rad/s)", maxO > 0.35, { maxO });
  run.check("the rider's eye rose and fell with the horse (> 0.3 m)", Math.max(...ys) - Math.min(...ys) > 0.3, { range: Math.max(...ys) - Math.min(...ys) });
});

await run.step("unload", async () => {
  const freed = await until(async () => (await probe(A)).slot < 0, 25000);
  run.check("the server put A off", freed);
  await sleep(1200);
  run.check("the ride panel is gone", (await A.page.locator("[data-testid=coaster-ride-hud]").count()) === 0);
  await run.shot(A, "c10-after.png");
});

const fps = await A.page.evaluate(() => {
  const a = (window.__fpsSamples ?? []).slice(30);
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  return { frames: a.length, over50ms: a.filter((x) => x > 50).length, over100ms: a.filter((x) => x > 100).length, fpsMean: Math.round(1000 / mean), p95ms: Math.round(q(0.95) * 10) / 10, maxMs: Math.round(s[s.length - 1]) };
});
const info = await A.page.evaluate(() => (window.__ri ? { maxCalls: window.__ri.calls, maxTriangles: window.__ri.triangles, meanCalls: Math.round(window.__ri.sumCalls / Math.max(1, window.__ri.n)), meanTriangles: Math.round(window.__ri.sumTris / Math.max(1, window.__ri.n)) } : null));
console.log("frame times", JSON.stringify(fps));
console.log("render info", JSON.stringify(info));
console.log("long frames", JSON.stringify(await A.page.evaluate(() => (window.__long ?? []).slice(0, 20))));
writeFileSync(join(run.evidence, "ride-log.json"), JSON.stringify({ fps, info, log }, null, 1));
const code = run.finish({ fps });
await b.close();
process.exit(code);
