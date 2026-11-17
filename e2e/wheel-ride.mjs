/**
 * e2e/wheel-ride.mjs — 케이슨랜드 하늘 등불 바퀴: one full revolution in the real game (PC, or a phone with --phone).
 * A walks to the platform pad, boards while the wheel loads, rides a whole revolution (first-person screenshots at the platform, rising,
 * at the top, looking down, descending), and is put off at the platform; B watches from the park and must see A in the gondola.
 *   CV_CLIENT_URL=http://localhost:5411 node e2e/wheel-ride.mjs [--phone] [--out=<folder>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(phone ? "wheel-ride-phone" : "wheel-ride-desktop");
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
    const w = await window.__imp("/land/wheel.ts");
    const k = await window.__imp("/land/wheelRide.ts");
    const clock = await window.__imp("/src/village/villageClock.ts");
    const n = w.wheelAt(clock.villageClock.liveMs());
    return { slot: m.selfRide.slot, ride: m.selfRide.ride, status: n.status, phase: n.phase, cycle: n.cycle, omega: n.omega, angle: n.angle, probe: { ...k.wheelProbe, eye: [...k.wheelProbe.eye] } };
  });
const remotes = (p) => p.page.evaluate(async () => (await window.__imp("/src/game/remoteStore.ts")).getRemotes());

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: phone ? "A-phone" : "A-pc", device: phone ? PHONE : DESKTOP });
const B = await openPlayer(b, run, { tag: "B-pc", device: DESKTOP });

await run.step("join", async () => {
  await joinLand(A, "Wa");
  await joinLand(B, "Wb");
  run.check("A enters the park", await enterPark(A), { area: await areaOf(A) });
  run.check("B enters the park", await enterPark(B), { area: await areaOf(B) });
  await sleep(6000);
  for (const [name, x, y, z, tx, ty, tz, fov] of [
    ["w01-approach", 190, 1.7, -100, 205, 22, -140, 62],
    ["w02-platform", 216, 1.7, -122, 207, 3, -137, 62],
    ["w03-gondola-close", 214, 2.6, -128, 205, 2, -137, 60],
    ["w03b-whole-wheel", 205, 3, -70, 205, 24, -140, 62],
  ]) {
    await A.page.evaluate(([x, y, z, tx, ty, tz, fov]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov }; }, [x, y, z, tx, ty, tz, fov]);
    await sleep(1500);
    await run.shot(A, `${name}.png`);
  }
  await A.page.evaluate(() => { window.__cvShot = null; });
});

await run.step("board", async () => {
  await goTo(A, 211, -130.8, 1.5);
  await goTo(B, 214, -129, 2.5);
  const at = await pos(A);
  run.check("A stands at the wheel pad", Math.hypot(at.x - 211, at.z + 130.8) < 5, at);
  const t0 = Date.now();
  let st = await probe(A);
  while (st.status !== "boarding" && Date.now() - t0 < 60000 * SLOW) {
    await sleep(500);
    st = await probe(A);
  }
  run.check("the wheel opens for boarding", st.status === "boarding", { status: st.status });
  await A.page.evaluate(() => {
    window.__fpsSamples = [];
    window.__long = [];
    window.__ri = { calls: 0, triangles: 0, n: 0, sumCalls: 0, sumTris: 0 };
    const gl = window.__cvThree?.().gl;
    if (gl) gl.info.autoReset = false;
    const t0 = performance.now();
    let last = performance.now();
    const tick = (t) => {
      window.__fpsSamples.push(t - last);
      if (t - last > 60) window.__long.push({ at: Math.round(t - t0), dt: Math.round(t - last) });
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
  run.check("A boards: a wheel seat", seated && me.ride === 3, { slot: me.slot, ride: me.ride });
  await sleep(1500);
  const bsee = await remotes(B);
  const a = bsee.find((r) => r.nickname === A.nick);
  run.check("B sees A on the wheel (rideSeat + rideId synced)", !!a && a.rideSeat === me.slot && a.rideId === 3, { rideSeat: a?.rideSeat, rideId: a?.rideId });
  run.check("the ride panel is up", (await A.page.locator("[data-testid=coaster-ride-hud]").count()) === 1);
  await run.shot(A, "w04-seated-at-the-platform.png");
  const me2 = await probe(A);
  run.check("the eye is in the gondola at the platform (1.5-3.2 m up)", me2.probe.eye[1] > 1.4 && me2.probe.eye[1] < 3.2, me2.probe);
});

const log = [];
await run.step("ride", async () => {
  const moments = [
    ["w05-rising", (alt) => alt > 12],
    ["w06-halfway-up", (alt) => alt > 28],
    ["w07-top", (alt) => alt > 46],
    ["w08-top-look-down", (alt, s) => alt > 45 && s.shot7],
    ["w09-descending", (alt, s) => s.rise === false && alt < 36],
    ["w10-low-again", (alt, s) => s.rise === false && alt < 8],
  ];
  const shot = new Set();
  const t0 = Date.now();
  let lastAlt = 0;
  let t7 = Infinity;
  while (Date.now() - t0 < 300000) {
    const st = await probe(A);
    const alt = st.probe.eye[1];
    const rise = alt >= lastAlt - 0.02;
    lastAlt = alt;
    if (st.slot >= 0) {
      log.push({ c: st.cycle, ph: Math.round(st.phase / 100) / 10, alt: Math.round(alt * 10) / 10, omega: Math.round(st.omega * 1000) / 1000, sway: Math.round(st.probe.sway * 1000) / 1000 });
      for (const [name, test] of moments)
        if (!shot.has(name) && test(alt, { rise, shot7: shot.has("w07-top") && Date.now() - t7 > 2500 })) {
          shot.add(name);
          if (name === "w07-top") t7 = Date.now();
          if (name === "w08-top-look-down") await A.page.evaluate(async () => { const v = await window.__imp("/src/game/viewState.ts"); v.viewState.fpPitch = 0.75; v.viewState.fpYaw = 0.4; });
          if (name === "w09-descending") await A.page.evaluate(async () => { const v = await window.__imp("/src/game/viewState.ts"); v.viewState.fpPitch = 0.06; v.viewState.fpYaw = 0; });
          await sleep(400);
          await run.shot(A, `${name}.png`);
          if (name === "w06-halfway-up") {
            await B.page.evaluate(async () => {
              const w = await window.__imp("/land/wheel.ts");
              const clock = await window.__imp("/src/village/villageClock.ts");
              const rs = await window.__imp("/src/game/remoteStore.ts");
              const me = rs.getRemotes().find((r) => r.rideSeat >= 0);
              const p = w.wheelSeatPose(me ? me.rideSeat : 0, clock.villageClock.liveMs());
              window.__cvShot = { x: p.x + 14, y: Math.max(3, p.y - 4), z: p.z + 26, tx: p.x, ty: p.y, tz: p.z, fov: 50 };
            });
            await sleep(600);
            await run.shot(B, "w11-B-watches-A-in-the-air.png");
          }
        }
    }
    if (st.slot < 0 && shot.size > 0) break;
    await sleep(500);
  }
  run.check("every checkpoint photographed", shot.size === moments.length, { got: [...shot] });
  const alts = log.map((l) => l.alt);
  run.check("the gondola rose above 40 m", Math.max(...alts) > 40, { max: Math.max(...alts) });
  run.check("the swing was felt on a start (> 0.5 deg)", Math.max(...log.map((l) => Math.abs(l.sway))) > 0.009, {});
});

await run.step("unload", async () => {
  const freed = await until(async () => (await probe(A)).slot < 0, 60000);
  run.check("the server put A off at the platform", freed);
  await sleep(1200);
  run.check("the ride panel is gone", (await A.page.locator("[data-testid=coaster-ride-hud]").count()) === 0);
  await run.shot(A, "w12-after.png");
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
const long = await A.page.evaluate(() => window.__long ?? []);
console.log("frame times", JSON.stringify(fps));
console.log("render info", JSON.stringify(info));
console.log("long frames", JSON.stringify(long.slice(0, 20)));
writeFileSync(join(run.evidence, "ride-log.json"), JSON.stringify({ fps, info, long, log }, null, 1));
const code = run.finish({ fps });
await b.close();
process.exit(code);
