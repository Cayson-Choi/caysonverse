/**
 * e2e/remote-bus-alight.mjs — a rider who got off the village bus is seen STANDING at the stop by the other players (owner
 * 2026-11-18, live: "한 명은 버스를 한 바퀴 타고 내렸는데, 타지 않은 상대 화면에서는 계속 버스에 앉아 있는 것처럼 보였다").
 *
 * Three clients in one room:
 *   A rides the bus a full lap and gets off, then walks;
 *   B watches from the pad, close (the avatar is a full one);
 *   C watches with A forced to the far stand-in (window.__cvAvatarForce, crowdImpostor.ts: the same code path as >28 m away);
 *   D watches from far away for real (a different corner of the village, the camera well beyond the stand-in threshold).
 * What is checked is what the renderer will draw (`__cv.getRemoteView`: the avatar's node tree matrixWorld, or the stand-in's
 * instance matrix), not only the pose RemotePlayer computes (`getRemoteDrawn`).
 *
 * Start the server with its clock ~150 s before a departure (DEV offset), e.g. in Git Bash:
 *   OFF=$(node -e 'const n=Date.now()+150000,s=Math.ceil(n/600000)*600000;console.log(s-n)')
 *   (cd server && CV_DEV_CLOCK_OFFSET_MS=$OFF PORT=2931 npx tsx src/index.ts)
 *   (cd client && VITE_SERVER_URL=http://localhost:2931 npx vite --port 5931 --strictPort)
 *   CV_CLIENT_URL=http://localhost:5931 node e2e/remote-bus-alight.mjs
 */
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, sleep, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const SIT = process.argv.includes("--sit"); // A sits on a seat for the lap (instead of standing at the entry)
const VIEW_DEVICE = process.argv.includes("--phone-viewers") ? PHONE : DESKTOP; // the watchers on a phone (touch tier: blob shadows, the lite stand-in budget)
const run = createRun(SIT ? "remote-bus-alight-sit" : "remote-bus-alight");
const browser = await launchBrowser();
const A = await openPlayer(browser, run, { tag: "A", device: DESKTOP });
const B = await openPlayer(browser, run, { tag: "B-near", device: VIEW_DEVICE });
const C = await openPlayer(browser, run, { tag: "C-forced-imp", device: VIEW_DEVICE });
const D = await openPlayer(browser, run, { tag: "D-far", device: VIEW_DEVICE });
const E = await openPlayer(browser, run, { tag: "E-far-full", device: VIEW_DEVICE });
const F = await openPlayer(browser, run, { tag: "F-hidden-tab", device: VIEW_DEVICE });
const viewers = [
  { name: "B near", p: B },
  { name: "C stand-in (forced)", p: C },
  { name: "D far (real distance)", p: D },
  { name: "E far, full avatar (forced: the throttled tree refresh)", p: E },
  { name: "F tab hidden for the whole ride (no frames), then shown", p: F },
];
const sid = (p) => p.page.evaluate(() => window.__cv.getSessionId());
const bus = (p) =>
  p.page.evaluate(async () => {
    const sync = await window.__imp("/src/net/transitSync.ts");
    const pose = sync.getTransitRenderPose();
    const now = sync.transitNowMs();
    const trip = sync.transitTripAt(now);
    return { x: pose.x, z: pose.z, yaw: pose.yaw, now, status: trip.status, startMs: trip.startMs, boarded: sync.getTransitState().boarded };
  });
/** What viewer `p` draws of A: the rendered body and the drawn pose, with the far-stand-in kind. */
const view = (p, id) =>
  p.page.evaluate((id) => ({ v: window.__cv.getRemoteView()[id] ?? null, d: window.__cv.getRemoteDrawn()[id] ?? null, t: performance.now() }), id);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

await run.step("join A, B, C, D", async () => {
  await joinVillage(A, "탑승");
  await joinVillage(B, "근처");
  await joinVillage(C, "표지");
  await joinVillage(D, "멀리");
  await joinVillage(E, "먼풀");
  await joinVillage(F, "숨은탭");
  await A.page.waitForFunction(async () => (await window.__imp("/src/net/transitSync.ts")).getTransitState().snapshot !== null, null, { timeout: 30000 });
  const b = await bus(A);
  run.check("boarding is open (server clock set before a departure)", b.status === "boarding", { leftS: Math.round((b.startMs - b.now) / 1000), status: b.status });
});
const sidA = await sid(A);
await C.page.evaluate((id) => { window.__cvAvatarForce = { [id]: "imp" }; }, sidA);
await E.page.evaluate((id) => { window.__cvAvatarForce = { [id]: "full" }; }, sidA);

await run.step("to the stop: A at the doors, B near, D far away", async () => {
  await Promise.all([
    (async () => {
      await walkAndWait(A, 38.5, -0.5, 40000, 1);
      await walkAndWait(A, 36.9, -6.0, 30000, 0.4);
    })(),
    (async () => {
      await walkAndWait(B, 38.5, -0.5, 40000, 1);
      await walkAndWait(B, 37.7, -8.9, 30000, 0.5);
    })(),
    (async () => {
      await walkAndWait(C, 38.5, -0.5, 40000, 1);
      await walkAndWait(C, 36.0, -10.5, 30000, 0.5);
    })(),
    // far: the far side of the village, well over the stand-in distance from the stop
    walkAndWait(D, -30, 30, 90000, 3),
    walkAndWait(E, -30, 28, 90000, 3),
    (async () => {
      await walkAndWait(F, 38.5, -0.5, 40000, 1);
      await walkAndWait(F, 36.0, -10.5, 30000, 0.5);
    })(),
  ]);
  await sleep(1500);
  const dd = await pos(D);
  const rv = await view(D, sidA);
  const d = rv.d ? Math.hypot(dd.x - rv.d.x, dd.z - rv.d.z) : null;
  run.check("D is far from A (beyond the stand-in distance)", d !== null && d > 40, { d, dd });
  const rb = await view(B, sidA);
  run.check("B sees A as a full avatar, C as a stand-in", rb.v?.kind === "full" && (await view(C, sidA)).v?.kind === "imp", { b: rb.v, c: (await view(C, sidA)).v });
  const rd = await view(D, sidA);
  run.check("D sees A as a stand-in", rd.v?.kind === "imp", rd.v);
});

await run.step("A boards: every viewer draws A in the bus", async () => {
  await act(A);
  // (Playwright's waitForFunction does not wait for an async page function's promise: poll from here)
  let ok = false;
  for (let t0 = Date.now(); Date.now() - t0 < 10000 && !ok; ) {
    ok = (await bus(A)).boarded;
    if (!ok) await sleep(200);
  }
  run.check("boarded", ok, await pos(A));
  await sleep(1500);
  if (SIT) {
    for (let i = 0; i < 40 && (await A.page.evaluate(async () => (await window.__imp("/src/game/busRide.ts")).selfBusRide.slot)) <= 0; i++) {
      await A.page.evaluate(async (i) => (await window.__imp("/src/net/transitSync.ts")).sendBusSit("seat", i), i);
      await sleep(250);
    }
    const slot = await A.page.evaluate(async () => (await window.__imp("/src/game/busRide.ts")).selfBusRide.slot);
    run.check("A sits on a seat in the bus", slot > 0, { slot });
    await sleep(1500);
  }
  const b = await bus(A);
  for (const { name, p } of viewers) {
    const r = await view(p, sidA);
    run.check(`${name}: A is drawn in the bus`, r.v && dist(r.v, b) < 5.5 && r.v.y > 0.3, { v: r.v, bus: b });
  }
});

// F's tab is hidden for the whole ride: a browser stops requestAnimationFrame there (an occluded window, a background tab) while the
// network keeps delivering. Simulated by holding the page's frame callbacks back.
const pauseFrames = (p) => p.page.evaluate(() => {
  if (window.__rafHeld) return;
  window.__rafHeld = { orig: window.requestAnimationFrame.bind(window), queue: [] };
  window.requestAnimationFrame = (cb) => { window.__rafHeld.queue.push(cb); return 0; };
});
const resumeFrames = (p) => p.page.evaluate(() => {
  const h = window.__rafHeld;
  if (!h) return;
  window.requestAnimationFrame = h.orig;
  window.__rafHeld = null;
  for (const cb of h.queue) h.orig(cb);
});
await pauseFrames(F);
let alightAt = null;
await run.step("the lap: A rides round the village; every viewer sees A move with the bus", async () => {
  const t0 = Date.now();
  let movedWith = 0;
  let checked = 0;
  while (Date.now() - t0 < 260000) {
    const a = await bus(A);
    if (!a.boarded && a.status !== "inTransit" && Date.now() - t0 > 20000) {
      alightAt = Date.now();
      break;
    }
    if (a.status === "inTransit" && checked < 400) {
      for (const { name, p } of viewers) {
        if (name.startsWith("F ")) continue; // not drawing
        const r = await view(p, sidA);
        const b = await bus(p);
        checked++;
        if (r.v && dist(r.v, b) < 5.5) movedWith++;
      }
    }
    await sleep(700);
  }
  run.check("A got off at the end of the lap", alightAt !== null);
  await sleep(1500); // the stop's end of the lap, with F still not drawing
  await resumeFrames(F);
  alightAt = Date.now();
  run.check("on the road the viewers drew A with the bus", checked > 0 && movedWith / checked > 0.95, { movedWith, checked });
});

await run.step("A is off: every viewer sees A standing at A's real position within 1 s", async () => {
  const t0 = alightAt ?? Date.now();
  const mine = await pos(A);
  const seenAt = {};
  for (const { name } of viewers) seenAt[name] = null;
  const last = {};
  while (Date.now() - t0 < 6000) {
    const me = await pos(A);
    for (const { name, p } of viewers) {
      const r = await view(p, sidA);
      last[name] = { v: r.v, d: r.d, me };
      if (seenAt[name] === null && r.v && r.v.y < 0.3 && dist(r.v, me) < 0.6 && r.d?.mode === "up") seenAt[name] = Date.now() - t0;
    }
    await sleep(100);
  }
  for (const { name } of viewers) {
    run.check(`${name}: A drawn standing at A's position within ~1 s of alighting`, seenAt[name] !== null && seenAt[name] <= 1500, { ms: seenAt[name], last: last[name], mine });
  }
  // and it STAYS there (not drawn in the cabin or moving with the bus any more) for the next seconds
  await sleep(3000);
  const me = await pos(A);
  const b = await bus(A);
  for (const { name, p } of viewers) {
    const r = await view(p, sidA);
    run.check(`${name}: A still stands at the stop 3 s later`, r.v && r.v.y < 0.3 && dist(r.v, me) < 0.6, { v: r.v, me, bus: b });
  }
});

await run.step("A walks on: every viewer sees A walk with A", async () => {
  await walkAndWait(A, 38.4, -0.5, 30000, 1);
  await sleep(1500);
  const me = await pos(A);
  for (const { name, p } of viewers) {
    const r = await view(p, sidA);
    run.check(`${name}: A drawn where A walked to`, r.v && dist(r.v, me) < 0.8 && r.v.y < 0.3, { v: r.v, me });
  }
});

const code = run.finish();
await browser.close();
process.exit(code);
