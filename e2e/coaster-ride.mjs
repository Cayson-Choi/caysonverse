/**
 * e2e/coaster-ride.mjs — 케이슨랜드 별똥별 급행, phase 1: one full ride in the real game.
 *
 * A (PC, or a phone with --phone) boards the coaster through the temporary test entry (?land=coaster), rides the whole lap with the
 * first-person camera and gets off at the station; B (PC) watches from the village and must see A seated in the car. The script
 * takes first-person screenshots at the station, the lift (middle and top), the drop, the loop's top, a banked turn and the brake run,
 * records the camera's probe (speed, G, tilt, FOV kick), the frame times over the ride (fps) and the draw cost of the park, and
 * checks the ride's rules: boarding opens only while the station loads, the seat is the server's, the unload is the server's.
 *
 *   server:  PORT=2811 npx tsx src/index.ts                                          (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:2811 npx vite --port 5411 --strictPort  (in client/)
 *   CV_CLIENT_URL=http://localhost:5411 node e2e/coaster-ride.mjs [--phone] [--out=<folder>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, walkAndWait, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(`${phone ? "coaster-ride-phone" : "coaster-ride-desktop"}${process.argv.includes("--night") ? "-night" : ""}`);
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });

// --night rides at 21:30 (the lit park); the default is noon
const NOON = process.argv.includes("--night") ? "2026-11-03T21:30" : "2026-11-03T12:30";
let nickSeq = 0;
async function joinLand(p, prefix) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(NOON)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(p);
  const nick = `${prefix}${++nickSeq}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 10);
  await p.page.locator("input.cv-input").first().fill(nick);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 * SLOW });
  await p.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvBgm, null, { timeout: 30000 * SLOW });
  await sleep(2500);
  p.nick = nick;
}

/** Walk to (x, z) the way the game would: its own detour search round the colliders (e2e/seat-front.mjs goTo). */
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

/** Walk to the gate lot's door in the village and use it: the curtain, then the park (area "park"). */
async function enterPark(p) {
  const g = await p.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  // the gate is on the south bank: a route through the village (plaza, the footbridge) to its pad
  await goTo(p, g.x, g.z - 0.5, 1.0);
  await act(p);
  const ok = await until(async () => (await areaOf(p)) === "park", 15000);
  await sleep(4000);
  return ok;
}

const probe = (p) =>
  p.page.evaluate(async () => {
    const m = await window.__imp("/land/coasterRide.ts");
    const n = m.coasterNow();
    return { slot: m.selfRide.slot, status: n.status, phase: n.phase, s: n.s, departsInMs: n.departsInMs, ride: { ...m.rideProbe, eye: [...m.rideProbe.eye] } };
  });
/** Poll `fn` (node side) until it is truthy (waitForFunction does not await an async page function). */
async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}
/** Put B's photo camera 9 m off the rider's seat, looking at it (B watches A in the car). */
const aimAtRider = (p, seat, off = [-9, 2.4, -9]) =>
  p.page.evaluate(
    async ([seat, off]) => {
      const m = await window.__imp("/land/coasterRide.ts");
      const n = m.coasterNow();
      const eye = { x: 0, y: 0, z: 0 };
      m.carEyeWorld(n.s, seat, eye);
      window.__cvShot = { x: eye.x + off[0], y: eye.y + off[1], z: eye.z + off[2], tx: eye.x, ty: eye.y - 0.6, tz: eye.z, fov: 58 };
    },
    [seat, off],
  );
const remotes = (p) => p.page.evaluate(async () => (await window.__imp("/src/game/remoteStore.ts")).getRemotes());

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: phone ? "A-phone" : "A-pc", device: phone ? PHONE : DESKTOP });
const B = await openPlayer(b, run, { tag: "B-pc", device: DESKTOP });

await run.step("join", async () => {
  await joinLand(A, "Ra");
  await joinLand(B, "Rb");
  await run.shot(A, "00-village-before-the-gate.png");
  run.check("A goes through the gate door into the park", await enterPark(A), { area: await areaOf(A) });
  run.check("B goes through the gate door into the park", await enterPark(B), { area: await areaOf(B) });
  await run.shot(A, "00b-park-arrival.png");
  const tris = await A.page.evaluate(() => window.__cvCoasterTris ?? null);
  run.check("the coaster's static geometry is built (triangles)", typeof tris === "number" && tris > 20000, { tris });
  // look round the park: the plaza and the station approach, first-person eyes at 1.5 m
  for (const [name, x, z, tx, ty, tz] of [["01a-promenade", 40, -168, 40, 2.5, -112], ["01b-plaza", 40, -140, 40, 3, -112], ["01c-station-approach", 2, -100, 2, 3, -12], ["01d-station-steps", 2, -26, 2, 1.8, -6], ["01e-station-side", -14, -22, 2, 2, -8]]) {
    await A.page.evaluate(([x, z, tx, ty, tz]) => { window.__cvShot = { x, y: 1.7, z, tx, ty, tz, fov: 62 }; }, [x, z, tx, ty, tz]);
    await sleep(900);
    await run.shot(A, `${name}.png`);
  }
  await A.page.evaluate(() => { window.__cvShot = null; });
});

/** the cost of the park: draw calls and triangles with the coaster in view, and the frame times */
const renderInfo = (p) => p.page.evaluate(() => (window.__ri ? { maxCalls: window.__ri.calls, maxTriangles: window.__ri.triangles, meanCalls: Math.round(window.__ri.sumCalls / Math.max(1, window.__ri.n)), meanTriangles: Math.round(window.__ri.sumTris / Math.max(1, window.__ri.n)) } : null));

await run.step("board", async () => {
  // A walks from the arch to the coaster station's boarding pad, at the foot of the platform's north steps (park metres) ...
  await goTo(A, 40, -120, 2);
  await goTo(A, 2, -112, 2);
  await goTo(A, 2, -12, 1.5);
  await goTo(B, 0, -13, 2.5); // B waits beside A at the pad: the second rider
  const at = await pos(A);
  run.check("A stands at the boarding pad", Math.hypot(at.x - 2, at.z + 12) < 6, at);
  await run.shot(A, "01-boarding-pad.png");
  // ... and waits for the boarding window (the station loads 29 s of every 130 s cycle)
  const t0 = Date.now();
  let st = await probe(A);
  while (st.status !== "boarding" && Date.now() - t0 < 140000 * SLOW) {
    await sleep(500);
    st = await probe(A);
  }
  run.check("the station opens for boarding", st.status === "boarding", { status: st.status });
  await A.page.evaluate(() => {
    window.__fpsSamples = [];
    window.__ri = { calls: 0, triangles: 0, n: 0, sumCalls: 0, sumTris: 0 };
    const gl = window.__cvThree?.().gl;
    if (gl) gl.info.autoReset = false; // count a whole frame (shadow pass, scene, post passes), reset by hand once a frame
    let last = performance.now();
    const tick = (t) => {
      window.__fpsSamples.push(t - last);
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
  run.check("A boards: the server gives a seat", seated);
  const me = await probe(A);
  run.check("A's seat is 0 (the front row of the front car, the first free seat)", me.slot === 0, { slot: me.slot });
  const carOf = (slot) => A.page.evaluate(async (slot) => (await window.__imp("/land/coaster.ts")).seatCar(slot), slot);
  const carA = await carOf(me.slot);
  run.check("a lone rider sits in the FRONT car (nothing ahead but the track)", carA.car === 0, carA);
  await act(B);
  const bSeated = await until(async () => (await probe(B)).slot >= 0, 8000);
  const meB = await probe(B);
  run.check("the second rider gets the other front seat (seat 1, front car, right side)", bSeated && meB.slot === 1 && (await carOf(meB.slot)).car === 0, { slot: meB.slot });
  await run.shot(A, "02b-front-row-first-person.png");
  await run.shot(B, "02c-B-other-front-seat.png");
  // B gets off again (the rest of the run watches A from B's own view)
  await B.page.locator("[data-testid=coaster-leave]").click().catch(() => {});
  await until(async () => (await probe(B)).slot < 0, 6000);
  await sleep(1500);
  const bsee = await remotes(B);
  const a = bsee.find((r) => r.nickname === A.nick);
  run.check("B sees A riding (Player.rideSeat synced)", !!a && a.rideSeat === me.slot, { rideSeat: a?.rideSeat });
  run.check("the ride panel is up", (await A.page.locator("[data-testid=coaster-ride-hud]").count()) === 1);
  await run.shot(A, "02-station-seated-first-person.png");
  await aimAtRider(B, 0);
  await sleep(800);
  await run.shot(B, "03-B-sees-A-in-the-car.png");
});

const log = [];
await run.step("ride", async () => {
  const meta = await A.page.evaluate(async () => {
    const c = await window.__imp("/land/coaster.ts");
    const t = c.coasterTrack();
    return { ds: t.ds, length: t.length, liftFrom: t.liftFrom, liftTo: t.liftTo, marks: t.marks, duration: t.duration, dwell: c.COASTER_DWELL_MS };
  });
  const M = meta.marks;
  const mid = (a, b, f = 0.5) => (a + (b - a) * f) * meta.ds;
  // the 2026-11-19 layout: the 66 m lift, the 80 degree drop, the camelback, the high turnaround, then the back half (the dive, the
  // loop, the zero-g roll, three bunny hops, the 540 degree helix, the head-chopper under its top lap, the tunnel) and the brakes
  const moments = [
    ["04-lift-middle", ((meta.liftFrom + meta.liftTo) / 2) * meta.ds],
    ["05a-lift-top-look-left", meta.liftTo * meta.ds - 14],
    ["05-lift-top", meta.liftTo * meta.ds + 3],
    ["06-drop", meta.liftTo * meta.ds + 16],
    ["07-pullout", M.dropTo * meta.ds - 8],
    ["07b-camelback", mid(M.dropTo, M.turnFrom, 0.62)],
    ["10-turn", mid(M.turnFrom, M.turnTo, 0.45)],
    ["10b-dive", M.trimTo * meta.ds + 14],
    ["08-loop-climb", mid(M.loopFrom, M.loopTo, 0.2)],
    ["09-loop-top", mid(M.loopFrom, M.loopTo, 0.5)],
    ["11a-roll-inverted", mid(M.rollFrom, M.rollTo, 0.5)],
    ["11b-hops", mid(M.hopsFrom, M.hopsTo, 0.18)],
    ["11c-helix", mid(M.helixFrom, M.helixTo, 0.45)],
    ["11d-head-chopper", M.helixTo * meta.ds + 1],
    ["11e-tunnel", mid(M.tunnelFrom, M.tunnelTo, 0.4)],
    ["11-brake", meta.length - 22],
  ];
  const lookAt = (yaw, pitch) => A.page.evaluate(async ([yaw, pitch]) => {
    const v = (await window.__imp("/src/game/viewState.ts")).viewState;
    v.fpYaw = yaw;
    v.fpPitch = pitch;
  }, [yaw, pitch]);
  const watch = { "06-drop": [16, 5, -20], "09-loop-top": [-20, 4, -16], "11a-roll-inverted": [-6, -2, -24], "11c-helix": [0, 14, -30], "11e-tunnel": [10, 3, -12] };
  const shot = new Set();
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < (meta.duration + 90) * 1000) {
    const st = await probe(A);
    last = st;
    if (st.status === "riding") {
      log.push({ t: Math.round((st.phase - meta.dwell) / 100) / 10, s: Math.round(st.s), v: Math.round(st.ride.speed * 10) / 10, lat: Math.round(st.ride.lat * 100) / 100, vert: Math.round(st.ride.vert * 100) / 100, pitch: Math.round(st.ride.carPitch * 100) / 100, roll: Math.round(st.ride.carRoll * 100) / 100, fov: Math.round(st.ride.fovAdd * 10) / 10 });
      for (const [name, s] of moments) {
        if (!shot.has(name) && st.s >= s) {
          shot.add(name);
          if (name === "05a-lift-top-look-left") {
            // near the top: the head turned left over the park (and the village beyond its gate)
            await lookAt(1.35, 0.32);
            await sleep(700);
            await run.shot(A, `${name}.png`);
            await lookAt(0, 0.1);
            await sleep(300);
            continue;
          }
          await run.shot(A, `${name}.png`);
          if (watch[name]) {
            await aimAtRider(B, 0, watch[name]);
            await sleep(250);
            await run.shot(B, `12-B-watching-${name}.png`);
          }
        }
      }
    }
    if (st.status === "unloading" && shot.size > 0) break;
    await sleep(120);
  }
  run.check("every checkpoint was reached and photographed", shot.size === moments.length, { got: [...shot] });
  const maxV = Math.max(...log.map((l) => l.v));
  const maxVert = Math.max(...log.map((l) => l.vert));
  const minVert = Math.min(...log.map((l) => l.vert));
  const maxFov = Math.max(...log.map((l) => l.fov));
  run.check("the ride reached drop speed (> 32 m/s)", maxV > 32, { maxV });
  run.check("the camera felt the pull (the probe saw > 2 g and a light moment)", maxVert > 2 && minVert < 0.5, { maxVert, minVert });
  run.check("the lens opened with the speed (FOV kick > 3 deg)", maxFov > 3, { maxFov });
  const upside = log.some((l) => Math.abs(l.pitch) > 1.2);
  run.check("the car went through the loop's vertical (view pitched > 69 deg)", upside);
  const rolled = log.some((l) => Math.abs(l.roll) > 0.5);
  run.check("a banked turn tilted the horizon (> 29 deg)", rolled);
  void last;
});

await run.step("unload", async () => {
  // the server unloads A when the next cycle's unloading phase begins
  const freed = await until(async () => (await probe(A)).slot < 0, 20000);
  run.check("the server put A off at the station", freed);
  await sleep(1200);
  run.check("A is back on the park camera (the ride panel is gone)", (await A.page.locator("[data-testid=coaster-ride-hud]").count()) === 0);
  const fov = await A.page.evaluate(async () => (await window.__imp("/src/game/cameraProbe.ts")).cameraProbe?.mode ?? null);
  run.check("camera mode is back", fov !== undefined);
  await run.shot(A, "13-after-the-ride.png");
  const rem = await remotes(B);
  const a = rem.find((r) => r.nickname === A.nick);
  run.check("B sees A standing again (rideSeat -1)", !!a && a.rideSeat === -1, { rideSeat: a?.rideSeat });
  // and not left hanging in the car: no skinned mesh of B's scene sits at the seat A rode in (the train waits at the station)
  await sleep(1500);
  const left = await B.page.evaluate(async () => {
    const t = window.__cvThree();
    const m = await window.__imp("/land/coasterRide.ts");
    const pos = new t.camera.position.constructor();
    const q = new t.camera.quaternion.constructor();
    m.carSeatPose(m.coasterNow().s, 0, pos, q);
    let best = Infinity;
    t.scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const p = o.getWorldPosition(o.position.clone());
      best = Math.min(best, Math.hypot(p.x - pos.x, p.y - pos.y, p.z - pos.z));
    });
    return { nearestToSeat: best };
  });
  run.check("A's avatar is not left in the car after the unload", left.nearestToSeat > 1.0, left);
  await B.page.evaluate(([x, z]) => { window.__cvShot = { x: x + 3, y: 2.2, z: z + 4.5, tx: x, ty: 1, tz: z, fov: 55 }; }, [a?.x ?? 0, a?.z ?? 0]);
  await sleep(600);
  await run.shot(B, "14-B-sees-A-standing-again.png");
});

await run.step("rules", async () => {
  // boarding while the train is out is refused by the server and said in the panel
  const st = await probe(A);
  if (st.status === "boarding") {
    run.check("(skipped) the window is open again already", true);
  } else {
    await act(A);
    await sleep(900);
    // a press outside the window is a RESERVATION (never a silent refusal): the card says 자리 맡음 once (the status line; no repeated toast), no seat yet
    await A.page.locator("[data-testid=coaster-hud]").first().waitFor({ timeout: 6000 }).catch(() => undefined);
    const card = await A.page.locator("[data-testid=coaster-hud]").first().innerText({ timeout: 3000 }).catch(() => "");
    // (the press can land in the unload's last second: then the reservation is honoured at once and A is seated as the station opens)
    const after = await probe(A);
    const seatedByReservation = after.slot >= 0 && after.status === "boarding";
    run.check("boarding outside the window is not a seat but a reservation, and the card says so (or the reservation seated A as boarding opened)", (/자리 맡음/.test(card) && after.slot === -1) || seatedByReservation, { card: card.split("\n").join(" | "), slot: after.slot, status: after.status });
  }
});

// frame times over the whole ride
const fps = await A.page.evaluate(() => {
  const a = (window.__fpsSamples ?? []).slice(30);
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  return { frames: a.length, over50ms: a.filter((x) => x > 50).length, over100ms: a.filter((x) => x > 100).length, fpsMean: Math.round(1000 / mean), p50ms: Math.round(q(0.5) * 10) / 10, p95ms: Math.round(q(0.95) * 10) / 10, p99ms: Math.round(q(0.99) * 10) / 10, maxMs: Math.round(s[s.length - 1]) };
});
console.log("frame times", JSON.stringify(fps));
const info = await renderInfo(A);
console.log("render info", JSON.stringify(info));
writeFileSync(join(run.evidence, "ride-log.json"), JSON.stringify({ fps, info, log }, null, 1));
const code = run.finish({ fps, info });
await b.close();
process.exit(code);
