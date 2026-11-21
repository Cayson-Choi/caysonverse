/**
 * e2e/rides-view-shots.mjs — what a rider SEES (owner 2026-11-21: "구름탑에 시야를 가리는 걸 다 없애", "달배의 의자 방향이 반대"). One visitor (PC, or a phone
 * with --phone) rides the 구름 낙하탑 and the 달배 and photographs the first-person view at every phase, looking ahead / left / right / down, and the seated
 * rider from outside (the photo camera). No assertions beyond "boarded": it is the before/after evidence.
 *   CV_CLIENT_URL=http://localhost:5661 CV_E2E_SLOW=6 node e2e/rides-view-shots.mjs --out=<folder> [--phone] [--only=drop|moon]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7);
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(`rides-view-${phone ? "phone" : "pc"}`);
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });
const TIME = "2026-11-03T12:30";

async function joinLand(p, prefix) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(TIME)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(p);
  const nick = `${prefix}${Math.floor(Math.random() * 9000 + 1000)}`.slice(0, 10);
  await p.page.locator("input.cv-input").first().fill(nick);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 120000 * SLOW });
  await p.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvBgm, null, { timeout: 30000 * SLOW });
  await sleep(2500);
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
const look = (p, yaw, pitch) =>
  p.page.evaluate(
    async ([yaw, pitch]) => {
      const v = await window.__imp("/src/game/viewState.ts");
      v.viewState.fpYaw = yaw;
      v.viewState.fpPitch = pitch;
    },
    [yaw, pitch],
  );
const LOOKS = [
  ["ahead", 0, 0.05],
  ["left", 1.25, 0.05],
  ["right", -1.25, 0.05],
  ["down", 0, 0.8],
];
async function lookShots(p, name, looks = LOOKS) {
  for (const [tag, yaw, pitch] of looks) {
    await look(p, yaw, pitch);
    await sleep(140);
    await run.shot(p, `${name}-${tag}.png`);
  }
  await look(p, 0, 0.05);
}
const photo = async (p, name, cam, wait = 900) => {
  await p.page.evaluate((c) => {
    window.__cvShot = c;
  }, cam);
  await sleep(wait);
  await run.shot(p, name);
  await p.page.evaluate(() => {
    window.__cvShot = null;
  });
};
const dropProbe = (p) =>
  p.page.evaluate(async () => {
    const m = await window.__imp("/land/coasterRide.ts");
    const w = await window.__imp("/land/dropTower.ts");
    const clock = await window.__imp("/src/village/villageClock.ts");
    const now = clock.villageClock.liveMs();
    const n = w.dropAt(now);
    const sp = m.selfRide.slot >= 0 ? w.dropSeatPose(m.selfRide.slot, now) : null;
    return { slot: m.selfRide.slot, ride: m.selfRide.ride, status: n.status, stage: n.stage, rideT: n.rideT, y: n.y, seat: sp };
  });
const moonProbe = (p) =>
  p.page.evaluate(async () => {
    const m = await window.__imp("/land/coasterRide.ts");
    const w = await window.__imp("/land/moonBoat.ts");
    const clock = await window.__imp("/src/village/villageClock.ts");
    const now = clock.villageClock.liveMs();
    const n = w.moonBoatAt(now);
    const sp = m.selfRide.slot >= 0 ? w.moonSeatPose(m.selfRide.slot, now) : null;
    return { slot: m.selfRide.slot, ride: m.selfRide.ride, status: n.status, rideT: n.rideT, angle: n.angle, omega: n.omega, seat: sp };
  });
async function board(p, probe, pad) {
  await goTo(p, pad.x, pad.z, 1.5);
  await until(async () => (await probe(p)).status === "boarding", 200000 * SLOW);
  await act(p);
  const ok = await until(async () => (await probe(p)).slot >= 0, 10000);
  run.check(`boarded at (${pad.x}, ${pad.z})`, ok, await probe(p));
  await sleep(1500);
  return ok;
}

/** A photo camera beside the swinging boat, aimed where the boat will be `aheadMs` from now (the boat moves metres a second): from the east, level with the benches. */
const boatPhoto = async (p, name, aheadMs = 400) => {
  await p.page.evaluate(async (aheadMs) => {
    const w = await window.__imp("/land/moonBoat.ts");
    const clock = await window.__imp("/src/village/villageClock.ts");
    const st = w.moonBoatAt(clock.villageClock.liveMs() + aheadMs);
    const c = w.moonToWorld(0, -w.MOON_ARM_L + 1.2, 0, st.angle);
    window.__cvShot = { x: c.x + 12, y: c.y + 2.5, z: c.z, tx: c.x, ty: c.y, tz: c.z, fov: 58 };
  }, aheadMs);
  await sleep(aheadMs);
  await run.shot(p, name);
  await p.page.evaluate(() => {
    window.__cvShot = null;
  });
};
const b = await launchBrowser();
const R = await openPlayer(b, run, { tag: phone ? "R-phone" : "R-pc", device: phone ? PHONE : DESKTOP });
await run.step("join", async () => {
  await joinLand(R, "Vw");
  run.check("in the park", await enterPark(R));
});

if (only !== "moon")
  await run.step("drop tower", async () => {
    if (!(await board(R, dropProbe, { x: -61, z: -88 }))) return;
    const s0 = (await dropProbe(R)).seat;
    await lookShots(R, "drop-1-station");
    // the seated rider from outside: from the front (5 m out along the seat's facing) and from the side
    await photo(R, "drop-1-station-outside-front.png", { x: s0.x + s0.fx * 5, y: s0.y + 1.0, z: s0.z + s0.fz * 5 + 1.2, tx: s0.x, ty: s0.y + 0.5, tz: s0.z, fov: 45 });
    await photo(R, "drop-1-station-outside-side.png", { x: s0.x + s0.fx * 1.2 - s0.fz * 4, y: s0.y + 0.8, z: s0.z + s0.fz * 1.2 + s0.fx * 4, tx: s0.x, ty: s0.y + 0.4, tz: s0.z, fov: 45 });
    const done = new Set();
    const t0 = Date.now();
    while (Date.now() - t0 < 200000 * SLOW) {
      const st = await dropProbe(R);
      if (st.slot < 0) break;
      if (st.status === "riding") {
        for (const [name, test, looks] of [
          ["drop-2-lift-6m", st.stage === "lift" && st.y > 5, LOOKS.slice(0, 1)],
          ["drop-3-lift-20m", st.stage === "lift" && st.y > 17, LOOKS],
          ["drop-4-lift-50m", st.stage === "lift" && st.y > 46, LOOKS],
          ["drop-5-top-85m", st.stage === "hold", LOOKS],
          ["drop-6-fall", st.stage === "fall" && st.rideT > 25.2, [LOOKS[0], LOOKS[3]]],
          ["drop-7-brake", st.stage === "brake", LOOKS.slice(0, 1)],
        ])
          if (!done.has(name) && test) {
            done.add(name);
            await lookShots(R, name, looks);
          }
      }
      await sleep(60);
    }
    run.check("every drop phase photographed", done.size === 6, [...done]);
    await until(async () => (await dropProbe(R)).slot < 0, 80000);
    await sleep(1500);
  });

if (only !== "drop")
  await run.step("moon boat", async () => {
    if (!(await board(R, moonProbe, { x: -82.1, z: -140 }))) return;
    const s0 = (await moonProbe(R)).seat;
    run.check("seat pose", true, { slot: (await moonProbe(R)).slot, seat: s0 });
    await lookShots(R, "moon-1-station");
    const f = s0.fz >= 0 ? 1 : -1;
    await photo(R, "moon-1-station-outside-front.png", { x: s0.x + 1.0, y: s0.y + 1.3, z: s0.z + f * 3.2, tx: s0.x, ty: s0.y + 0.4, tz: s0.z, fov: 50 });
    await photo(R, "moon-1-station-outside-side.png", { x: s0.x + 9, y: s0.y + 2.5, z: -140, tx: -95, ty: s0.y + 0.3, tz: -140, fov: 62 });
    await photo(R, "moon-1-station-outside-above.png", { x: -95 + 3, y: s0.y + 9, z: -140 + 0.5, tx: -95, ty: s0.y, tz: -140, fov: 70 });
    const done = new Set();
    const t0 = Date.now();
    while (Date.now() - t0 < 260000 * SLOW) {
      const st = await moonProbe(R);
      if (st.slot < 0) break;
      if (st.status === "riding") {
        for (const [name, test, looks] of [
          ["moon-2-swing-small", st.rideT > 14 && Math.abs(st.angle) > 0.15, LOOKS.slice(0, 1)],
          ["moon-3-swing-mid-up", st.rideT > 40 && st.angle > 0.6, LOOKS.slice(0, 1)],
          ["moon-4-swing-mid-down", st.rideT > 40 && st.angle < -0.6, LOOKS.slice(0, 1)],
          ["moon-5-swing-top", st.rideT > 70 && Math.abs(st.angle) > 1.3, LOOKS.slice(0, 1)],
          ["moon-6-bottom-looks", st.rideT > 75 && Math.abs(st.angle) < 0.25, LOOKS],
        ])
          if (!done.has(name) && test) {
            done.add(name);
            await lookShots(R, name, looks);
            // the boat and my own seated body from the east side, mid-swing
            if (name === "moon-3-swing-mid-up" || name === "moon-5-swing-top") await boatPhoto(R, `${name}-outside.png`);
          }
      }
      await sleep(60);
    }
    run.check("every moon phase photographed", done.size === 5, [...done]);
    await until(async () => (await moonProbe(R)).slot < 0, 80000);
  });
await b.close();
process.exit(run.finish());
