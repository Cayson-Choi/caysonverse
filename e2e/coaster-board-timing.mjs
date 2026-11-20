/**
 * e2e/coaster-board-timing.mjs — owner 2026-11-20: "급행타기 눌러놓으면 열차가 도착하기도 전에 타버리는 문제", "급행이 타 끝나기도 전에 내려버리는 문제".
 *
 * A player presses 타기 while the train is still out on its lap (the 자리 맡기 reservation). Every 150 ms the script logs the village clock's phase, the
 * train's status and distance to its station stop (coasterAt / frameAt on the client), and the rider's seat (the server's Player.rideSeat). Checks:
 *  - no seat is handed out until the train stands at the station (< 0.5 m from the stop, at rest) and the loading phase has begun;
 *  - the card says the seat is reserved and the train has to arrive first;
 *  - once seated the rider stays seated for the whole lap and is put off only after the train has stopped back at the station.
 * Shots (waiting, the train rolling in, seated, the end of the lap) go to --out=<folder>.
 *
 *   CV_CLIENT_URL=http://localhost:5945 node e2e/coaster-board-timing.mjs [--phone] [--out=<folder>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(phone ? "coaster-board-timing-phone" : "coaster-board-timing-desktop");
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });
const NOON = "2026-11-03T12:30";
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

/** Poll `fn` (node side) until it is truthy (waitForFunction does not await an async page function). */
async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}

const sample = (p) =>
  p.page.evaluate(async () => {
    const m = await window.__imp("/land/coasterRide.ts");
    const c = await window.__imp("/land/coaster.ts");
    const sch = await window.__imp("/land/rideSchedule.ts");
    const n = m.coasterNow();
    const tr = c.coasterTrack();
    const f0 = c.frameAt(tr, 0, c.emptyFrame());
    const f = c.frameAt(tr, n.s, c.emptyFrame());
    const card = document.querySelector("[data-testid=ride-countdown]")?.textContent ?? null;
    return { phase: n.phase, status: n.status, s: n.s, toStop: Math.hypot(f.x - f0.x, f.y - f0.y, f.z - f0.z), rideT: (n.phase - c.COASTER_DWELL_MS) / 1000, slot: m.selfRide.slot, skew: sch.rideSchedule.skew, card, duration: tr.duration, length: tr.length };
  });

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: phone ? "A-phone" : "A-pc", device: phone ? PHONE : DESKTOP });
const rows = [];

await run.step("join and walk to the pad", async () => {
  await joinLand(A, "Tb");
  run.check("A goes through the gate door into the park", await enterPark(A), { area: await areaOf(A) });
  await goTo(A, 40, -120, 2);
  await goTo(A, 2, -112, 2);
  await goTo(A, 2, -12, 1.5);
  const at = await pos(A);
  run.check("A stands at the boarding pad", Math.hypot(at.x - 2, at.z + 12) < 6, at);
  const s0 = await sample(A);
  run.check("this page and the server run the same ride timetable", s0.skew === false);
});

await run.step("press early (the train is out) and wait", async () => {
  // wait for a moment when the train is out and has a while to go: the lap's second half
  const t0 = Date.now();
  let st = await sample(A);
  while (!(st.status === "riding" && st.rideT > 20 && st.rideT < 60) && Date.now() - t0 < 200000 * SLOW) {
    await sleep(500);
    st = await sample(A);
  }
  run.check("the train is out on its lap when the button is pressed", st.status === "riding", { status: st.status, rideT: st.rideT, toStop: st.toStop });
  await run.shot(A, "01-before-press.png");
  await A.page.locator("[data-testid=ride-go-coaster]").first().click({ timeout: 8000 }).catch(() => act(A));
  await sleep(900);
  const waiting = await sample(A);
  run.check("pressed early: no seat yet", waiting.slot === -1, { slot: waiting.slot });
  run.check('the card says the seat is held and the train must arrive first ("열차가 도착하면 타요")', /자리 맡음/.test(waiting.card ?? "") && /열차가 도착하면 타요/.test(waiting.card ?? ""), { card: waiting.card });
  await run.shot(A, "02-waiting-on-the-pad.png");
});

let seatedAt = null;
let shotArriving = false;
await run.step("wait for the train and the loading", async () => {
  const t0 = Date.now();
  let early = 0;
  while (Date.now() - t0 < 150000 * SLOW) {
    const st = await sample(A);
    rows.push({ t: Date.now() - t0, phase: Math.round(st.phase), status: st.status, toStop: +st.toStop.toFixed(2), slot: st.slot });
    if (st.slot < 0 && st.status === "riding" && st.toStop < 25 && !shotArriving && st.rideT > st.duration - 12) {
      shotArriving = true;
      await run.shot(A, "03-train-rolling-in.png");
    }
    if (st.slot >= 0) {
      seatedAt = st;
      break;
    }
    if (st.status === "riding" && st.toStop > 0.5) early += 0; // not seated: fine
    await sleep(150);
  }
  run.check("the reservation seated the rider", seatedAt !== null);
  if (!seatedAt) return;
  run.check("seated only in the loading phase", seatedAt.status === "boarding", { status: seatedAt.status, phase: Math.round(seatedAt.phase) });
  run.check("seated only with the train at its stop (< 0.5 m) and at the end of the track", seatedAt.toStop < 0.5 && Math.abs(seatedAt.s) < 0.5, { toStop: seatedAt.toStop, s: seatedAt.s });
  await sleep(1000);
  await run.shot(A, "04-seated-at-the-station.png");
});

await run.step("the lap: seated until the train has stopped back at the station", async () => {
  if (!seatedAt) return;
  const t0 = Date.now();
  let seatedThroughRide = true;
  let offAt = null;
  let sawRiding = false;
  while (Date.now() - t0 < 200000 * SLOW) {
    const st = await sample(A);
    if (st.status === "riding") sawRiding = true;
    if (st.slot < 0) {
      offAt = st;
      break;
    }
    await sleep(150);
  }
  run.check("the rider rode the lap (the train was out)", sawRiding);
  if (!offAt) return run.check("the server put the rider off", false);
  run.check("put off only when the train stands at the station again (< 0.5 m from its stop, unloading phase)", offAt.status === "unloading" && offAt.toStop < 0.5, { status: offAt.status, toStop: offAt.toStop, phase: Math.round(offAt.phase) });
  run.check("... and after the whole track: the ride has run past the track's duration", offAt.status === "unloading", { duration: offAt.duration });
  seatedThroughRide = true;
  void seatedThroughRide;
  await sleep(800);
  await run.shot(A, "05-after-the-lap.png");
});

writeFileSync(join(run.evidence, "timing-log.json"), JSON.stringify(rows, null, 1));
const code = run.finish({});
await b.close();
process.exit(code);
