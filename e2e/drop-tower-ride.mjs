/**
 * e2e/drop-tower-ride.mjs — 케이슨랜드 구름 낙하탑: one full ride in the real game (PC, or a phone with --phone; --night for the night look).
 * O (an observer, PC) and R (the rider; a phone with --phone) walk into the park. Outside shots of the boat at rest (day/night). On a PC a third
 * visitor G boards and closes the page (the ghost rule: the seat frees, O no longer sees G). R then boards, rides the whole swing (first-person
 * shots at the platform, as the swing builds, at the top of the swing, at the bottom), O photographs the swing from outside; R is put off.
 * Also: the swing reaches 55 degrees, the seat gets light (g < 0.7) at the top and heavy (g > 1.7) at the bottom, the eye never goes underground.
 *   CV_CLIENT_URL=http://localhost:5411 node e2e/moon-boat-ride.mjs [--phone] [--night] [--out=<folder>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const night = process.argv.includes("--night");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(`drop-tower-${phone ? "phone" : "pc"}${night ? "-night" : ""}`);
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });

const TIME = night ? "2026-11-03T21:30" : "2026-11-03T12:30";
const SITE = { x: -75, z: -88 };
const PAD = { x: -61, z: -88 };
let nickSeq = 0;
async function joinLand(p, prefix) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(TIME)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(p);
  const nick = `${prefix}${++nickSeq}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 10);
  await p.page.locator("input.cv-input").first().fill(nick);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 120000 * SLOW });
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
    await until(async () => (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 120000);
    await sleep(300);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(p);
}
const areaOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
async function enterPark(p) {
  const g = await p.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  for (let attempt = 0; attempt < 5 && (await areaOf(p)) !== "park"; attempt++) {
    await goTo(p, g.x, g.z - 0.5, 1.0);
    await sleep(800);
    if (await p.page.locator(".cv-action-btn").count()) await act(p);
    await until(async () => (await areaOf(p)) === "park", 8000);
  }
  await p.page.waitForFunction(() => !document.querySelector("[data-testid=park-loading]"), null, { timeout: 60000 * SLOW }).catch(() => undefined);
  await sleep(2500);
  return (await areaOf(p)) === "park";
}
const probe = (p) =>
  p.page.evaluate(async () => {
    const m = await window.__imp("/land/coasterRide.ts");
    const w = await window.__imp("/land/dropTower.ts");
    const k = await window.__imp("/land/dropTowerRide.ts");
    const clock = await window.__imp("/src/village/villageClock.ts");
    const n = w.dropAt(clock.villageClock.liveMs());
    return { slot: m.selfRide.slot, ride: m.selfRide.ride, status: n.status, stage: n.stage, phase: n.phase, rideT: n.rideT, y: n.y, v: n.v, g: w.dropGLoad(n), probe: { ...k.dropProbe, eye: [...k.dropProbe.eye] } };
  });
const remotes = (p) => p.page.evaluate(async () => (await window.__imp("/src/game/remoteStore.ts")).getRemotes());
const shotFrom = async (p, name, x, y, z, tx, ty, tz, fov) => {
  await p.page.evaluate(([x, y, z, tx, ty, tz, fov]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov }; }, [x, y, z, tx, ty, tz, fov]);
  await sleep(1400);
  await run.shot(p, name);
};
async function waitBoarding(p, ms = 150000) {
  const t0 = Date.now();
  let st = await probe(p);
  while (st.status !== "boarding" && Date.now() - t0 < ms * SLOW) {
    await sleep(400);
    st = await probe(p);
  }
  return st.status === "boarding";
}

// Each phase has its own browser with ONE or TWO small pages: several full-size software-GL pages together crash the tab on a busy machine.
const log = [];
let fps = null;

const only3 = process.argv.includes("--remote-only");
// phase 1: the tower from outside (the car rides by the clock whether or not anyone is aboard): at rest, and with the car at the 85 m hold
if (!only3) {
  const b = await launchBrowser();
  const O = await openPlayer(b, run, { tag: "O-pc", device: DESKTOP });
  await run.step("outside", async () => {
    await joinLand(O, "Do");
    run.check("O enters the park", await enterPark(O), { area: await areaOf(O) });
    await sleep(3000);
    await goTo(O, SITE.x + 18, SITE.z, 4);
    await shotFrom(O, "d01-approach-eye-level.png", SITE.x + 24, 1.7, SITE.z, SITE.x, 7, SITE.z, 62);
    await shotFrom(O, "d02-platform-higher.png", SITE.x + 15, 5.5, SITE.z + 8, SITE.x + 3, 3, SITE.z, 62);
    await shotFrom(O, "d03-whole-tower.png", SITE.x + 120, 12, SITE.z + 20, SITE.x, 48, SITE.z, 62);
    await shotFrom(O, "d04-cloud-crown.png", SITE.x - 30, 70, SITE.z - 20, SITE.x, 92, SITE.z, 50);
    await shotFrom(O, "d05-car-close.png", SITE.x + 12, 3.4, SITE.z - 4, SITE.x + 3, 2.2, SITE.z, 52);
    const t0 = Date.now();
    let a = await probe(O);
    while (!(a.stage === "hold" && a.rideT > 21) && Date.now() - t0 < 300000 * SLOW) {
      await sleep(120);
      a = await probe(O);
    }
    run.check("the car holds at 85 m on the clock", a.stage === "hold" && Math.abs(a.y - 85) < 0.2, { stage: a.stage, y: a.y });
    await shotFrom(O, "d06-car-at-the-top.png", SITE.x + 70, 10, SITE.z + 25, SITE.x, 70, SITE.z, 56);
    await shotFrom(O, "d07-car-at-the-top-close.png", SITE.x + 22, 70, SITE.z + 6, SITE.x + 1, 85, SITE.z, 42);
    await O.page.evaluate(() => { window.__cvShot = null; });
  });
  await b.close();
}

// phase 2: the rider (PC or phone) alone: board, the slow lift, the hold at 85 m, the free fall, the brakes, put off
if (!only3) {
  const b = await launchBrowser();
  const R = await openPlayer(b, run, { tag: phone ? "R-phone" : "R-pc", device: phone ? PHONE : DESKTOP });
  await run.step("join rider", async () => {
    await joinLand(R, "Dr");
    run.check("R enters the park", await enterPark(R), { area: await areaOf(R) });
  });
  await run.step("board", async () => {
    await goTo(R, PAD.x, PAD.z, 1.5);
    const at = await pos(R);
    run.check("R stands at the tower's pad", Math.hypot(at.x - PAD.x, at.z - PAD.z) < 5, at);
    run.check("the tower opens for boarding", await waitBoarding(R), {});
    await R.page.evaluate(() => {
      window.__fpsSamples = [];
      let last = performance.now();
      const tick = (t) => {
        window.__fpsSamples.push(t - last);
        last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await act(R);
    const seated = await until(async () => (await probe(R)).slot >= 0, 8000);
    const me = await probe(R);
    run.check("R boards: a tower seat (the east face first), ride 5", seated && me.ride === 5 && me.slot >= 0 && me.slot < 4, { slot: me.slot, ride: me.ride });
    await sleep(1500);
    run.check("the ride panel is up", (await R.page.locator("[data-testid=coaster-ride-hud]").count()) === 1);
    await run.shot(R, "d08-seated-at-the-station.png");
    const eye = (await probe(R)).probe.eye;
    run.check("the eye is at the station (2-3 m over the ground)", eye[1] > 1.8 && eye[1] < 3.2, { eye });
  });
  await run.step("ride", async () => {
    const shot = new Set();
    const t0 = Date.now();
    let maxY = 0;
    let minG = 9;
    let maxG = 0;
    let maxFov = 0;
    let minEyeY = 99;
    let seenStages = new Set();
    while (Date.now() - t0 < 200000 * SLOW) {
      const st = await probe(R);
      if (st.slot < 0 && shot.size > 0) break;
      if (st.slot >= 0 && st.status === "riding") {
        seenStages.add(st.stage);
        maxY = Math.max(maxY, st.probe.eye[1]);
        minEyeY = Math.min(minEyeY, st.probe.eye[1]);
        maxFov = Math.max(maxFov, st.probe.fovExtra);
        if (st.stage === "fall") minG = Math.min(minG, st.g);
        if (st.stage === "brake") maxG = Math.max(maxG, st.g);
        log.push({ t: Math.round(st.rideT * 10) / 10, y: Math.round(st.y * 10) / 10, v: Math.round(st.v * 10) / 10, g: Math.round(st.g * 100) / 100, st: st.stage });
        for (const [name, test] of [
          ["d09-lift-first-metres", st.stage === "lift" && st.y > 12],
          ["d10-lift-half-way", st.stage === "lift" && st.y > 45],
          ["d11-the-hold-at-85m", st.stage === "hold" && st.rideT > 20.6],
          ["d12-free-fall", st.stage === "fall" && st.rideT > 25.4],
          ["d13-brakes", st.stage === "brake" && st.rideT > 28.3],
        ])
          if (!shot.has(name) && test) {
            shot.add(name);
            await run.shot(R, `${name}.png`);
          }
      }
      await sleep(phone ? 200 : 100);
    }
    run.check("the car reached 85 m (the eye above 85.5 m)", maxY > 85.5, { maxEyeY: Math.round(maxY * 10) / 10 });
    run.check("every stage ran: lift, hold, fall, brake", ["lift", "hold", "fall", "brake"].every((s) => seenStages.has(s)), { seen: [...seenStages] });
    run.check("weightless in the fall (g < 0.15) and pressed into the seat in the brakes (g > 1.2)", minG < 0.15 && maxG > 1.2, { minG: Math.round(minG * 100) / 100, maxG: Math.round(maxG * 100) / 100 });
    run.check("the view opens with the speed (field of view widens by 4 degrees or more)", maxFov > 4, { maxFov: Math.round(maxFov * 10) / 10 });
    run.check("the eye never goes under the platform (> 1.8 m)", minEyeY > 1.8, { minEyeY });
    run.check("every checkpoint photographed", shot.size === 5, { got: [...shot] });
  });
  await run.step("unload", async () => {
    const freed = await until(async () => (await probe(R)).slot < 0, 80000);
    run.check("the server put R off at the end of the ride", freed);
    await sleep(1200);
    run.check("the ride panel is gone", (await R.page.locator("[data-testid=coaster-ride-hud]").count()) === 0);
    await run.shot(R, "d14-after.png");
  });
  fps = await R.page.evaluate(() => {
    const a = (window.__fpsSamples ?? []).slice(30);
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const mean = a.reduce((x, y) => x + y, 0) / a.length;
    return { frames: a.length, over50ms: a.filter((x) => x > 50).length, over100ms: a.filter((x) => x > 100).length, fpsMean: Math.round(1000 / mean), p95ms: Math.round(s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] * 10) / 10, maxMs: Math.round(s[s.length - 1]) };
  });
  await b.close();
}

// phase 3 (PC): two small pages: a rider seen from outside (remote rider drawn, rideId/rideSeat synced), the ghost rule, and the second rider's seat
if (!phone && !process.argv.includes("--look")) {
  const b = await launchBrowser();
  const small = { viewport: { width: 640, height: 400 } };
  const O = await openPlayer(b, run, { tag: "O2", device: small });
  const G = await openPlayer(b, run, { tag: "G", device: small });
  await run.step("remote rider and ghost", async () => {
    await joinLand(O, "Do");
    await joinLand(G, "Dg");
    await enterPark(O);
    await enterPark(G);
    await goTo(O, SITE.x + 18, SITE.z - 6, 3);
    await goTo(G, PAD.x, PAD.z, 1.5);
    const gat = await pos(G);
    run.check("G stands at the pad", Math.hypot(gat.x - PAD.x, gat.z - PAD.z) < 5, gat);
    run.check("the tower opens for boarding", await waitBoarding(G), {});
    await act(G);
    const seated = await until(async () => (await probe(G)).slot >= 0, 8000);
    const gs = await probe(G);
    run.check("G boards: seat 0, ride 5", seated && gs.slot === 0 && gs.ride === 5, { slot: gs.slot, ride: gs.ride });
    await sleep(2000);
    const seen = (await remotes(O)).find((r) => r.nickname === G.nick);
    run.check("O sees G on the tower (rideId 5, rideSeat 0)", !!seen && seen.rideId === 5 && seen.rideSeat === 0, { rideId: seen?.rideId, rideSeat: seen?.rideSeat });
    await shotFrom(O, "d15-remote-rider-seen-from-outside.png", SITE.x + 12, 3.2, SITE.z - 6, SITE.x + 2.8, 2.0, SITE.z, 38);
    await O.page.evaluate(() => { window.__cvShot = null; });
    await G.page.close();
    const gone = await until(async () => !(await remotes(O)).some((r) => r.nickname === G.nick), 20000);
    run.check("G closed the page: O no longer sees G (no ghost on the tower)", gone);
  });
  await b.close();
}

console.log("frame times", JSON.stringify(fps));
writeFileSync(join(run.evidence, "ride-log.json"), JSON.stringify({ fps, log }, null, 1));
process.exit(run.finish({ fps }));
