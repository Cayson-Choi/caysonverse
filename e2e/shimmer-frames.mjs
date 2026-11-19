/**
 * e2e/shimmer-frames.mjs — ride the 하늘 등불 바퀴 and photograph the 별똥별 급행 from a gondola at ~25 m: 4 consecutive frames at yaw YAW (0 = south, toward the track),
 * for the far-rails shimmer check (client/src/land/farSteel.ts). PC, or a phone with --phone.
 *   CV_CLIENT_URL=http://localhost:5988 [YAW=0 ALT=22] node e2e/shimmer-frames.mjs [--phone] --tag=after --out=<folder>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(phone ? "shimmer-phone" : "shimmer-desktop");
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });

const night = process.argv.includes("--night");
const NOON = night ? "2026-11-03T21:30" : "2026-11-03T12:30";
let nickSeq = 0;
async function joinLand(p, prefix) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(NOON)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
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
  await goTo(A, 205, -128.2, 1.5);
  await goTo(B, 214, -129, 2.5);
  const at = await pos(A);
  run.check("A stands at the wheel pad", Math.hypot(at.x - 205, at.z + 128.2) < 5, at);
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
  // the window is 6.5 s every 18.75 s: a press just after it closes is a reservation the next gondola's window seats by itself
  const seated = await until(async () => (await probe(A)).slot >= 0, 30000);
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

await run.step("frames", async () => {
  const tag = (process.argv.find((a) => a.startsWith("--tag=")) || "--tag=x").slice(6);
  const alt0 = Number(process.env.ALT ?? 22);
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < 120000 && !done) {
    const st = await probe(A);
    const alt = st.probe.eye[1];
    if (st.slot >= 0 && alt > alt0) {
      const yaw = Number(process.env.YAW ?? 0); if (process.env.SWEEP) { for (const y of [0, 1.57, 3.14, -1.57]) { await A.page.evaluate(async ([y]) => { const v = await window.__imp("/src/game/viewState.ts"); v.viewState.fpPitch = 0.05; v.viewState.fpYaw = y; }, [y]); await sleep(400); await run.shot(A, `sweep-${y}.png`); } }
      await A.page.evaluate(async ([yaw]) => { const v = await window.__imp("/src/game/viewState.ts"); v.viewState.fpPitch = 0.05; v.viewState.fpYaw = yaw; }, [yaw]);
      await sleep(500);
      for (let k = 0; k < 4; k++) { await run.shot(A, `${tag}-${k}.png`); await sleep(60); }
      console.log("eye", JSON.stringify(st.probe.eye));
      done = true;
    }
    await sleep(300);
  }
});
const code = run.finish({});
await b.close();
process.exit(code);
