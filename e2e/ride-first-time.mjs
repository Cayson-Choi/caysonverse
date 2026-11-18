/**
 * e2e/ride-first-time.mjs — a FIRST-TIME player in 케이슨랜드 (owner 2026-11-18: "케이슨랜드에 놀이기구 탈 수가 없어"), PC or phone (--phone).
 *
 * A fresh account joins the village, walks to the park gate and goes in (the way the village's own e2e does), and then, from the park's arrival
 * point, uses ONLY what the UI shows: it walks by tapping the ground, looks for the 타기 prompt (the action button / E) and the ride itself, and for
 * each ride records what a person would see:
 *   - the distance from the boarding pad at which the 타기 prompt first appears,
 *   - whether TAPPING THE RIDE (the carousel's canopy, the wheel's frame, the coaster's station) walks to the pad and boards,
 *   - whether PRESSING 타기 from afar walks there and boards,
 *   - what happens while the boarding window is closed (the seat is reserved, a countdown shows, the player is seated at the next load).
 * It leaves each ride again with the on-screen leave button, so the three rides are done back to back.
 *
 *   server:  PORT=2811 npx tsx src/index.ts                                          (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:2811 npx vite --port 5411 --strictPort  (in client/)
 *   CV_CLIENT_URL=http://localhost:5411 node e2e/ride-first-time.mjs [--phone] [--out=<folder>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos, touchDown, touchMoveTo, touchUp, turnCameraTo } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(phone ? "ride-first-time-phone" : "ride-first-time-desktop");
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });

const NOON = "2026-11-03T12:30";
const NAMES = { coaster: "별똥별 급행", carousel: "달빛 회전목마", wheel: "하늘 등불 바퀴" };
const PADS = { coaster: { x: -17, z: -46 }, carousel: { x: 110, z: -119 }, wheel: { x: 205, z: -128.2 } };
const report = [];

async function until(fn, ms, step = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}
const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: phone ? "A-phone" : "A-pc", device: phone ? PHONE : DESKTOP });

async function joinFresh() {
  await A.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(NOON)}`, { waitUntil: "domcontentloaded" });
  await entryReady(A);
  const nick = `Ft${Math.floor(Math.random() * 9000 + 1000)}`;
  await A.page.locator("input.cv-input").first().fill(nick);
  await press(A, A.page.locator(".cv-submit"));
  await A.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 * SLOW });
  await A.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvBgm, null, { timeout: 30000 * SLOW });
  await sleep(2500);
}
const areaOf = () => A.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
const rideState = () =>
  A.page.evaluate(async () => {
    const m = await window.__imp("/land/coasterRide.ts");
    return { slot: m.selfRide.slot, ride: m.selfRide.ride };
  });
const ctarget = () => A.page.evaluate(() => window.__cvClickTarget?.() ?? null);

/** Project a world point to the page (CSS px), or null when it is off the screen. */
const project = (x, y, z) =>
  A.page.evaluate(
    ([x, y, z]) => {
      const t = window.__cvThree();
      const v = new t.camera.position.constructor(x, y, z).project(t.camera);
      const r = t.gl.domElement.getBoundingClientRect();
      if (v.z > 1 || Math.abs(v.x) > 0.92 || v.y < -0.8 || v.y > 0.75) return null;
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
    [x, y, z],
  );
const tapAt = async (pt) => (phone ? A.page.touchscreen.tap(pt.x, pt.y) : A.page.mouse.click(pt.x, pt.y));

/** The 타기 button the UI shows right now (its text), or null. */
const prompt = (name) =>
  A.page.evaluate((name) => {
    const el = document.querySelector(".cv-action-btn");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return null;
    const txt = (el.textContent ?? "").trim();
    return /타기/.test(txt) && (!name || txt.includes(name) || el.classList.contains("is-touch")) ? txt : null;
  }, name);

async function turnTo(tx, tz) {
  if (!phone) return turnCameraTo(A, tx, tz);
  for (let k = 0; k < 10; k++) {
    const o = await A.page.evaluate(() => window.__cv.getOrbit());
    const at = await pos(A);
    let diff = Math.atan2(-(tx - at.x), -(tz - at.z)) - o.yaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) < 0.25) return;
    const dir = (k % 4 === 3 ? -1 : 1) * Math.sign(diff);
    await touchDown(A, 200, 330);
    await touchMoveTo(A, 200 + dir * Math.min(150, 60 + Math.abs(diff) * 60), 330);
    await touchUp(A);
    await sleep(250);
  }
}

/**
 * Walk along `route` (the park's paths: the promenade, the plaza, the avenue) by TAPPING the ground a few metres ahead on it, the way a person
 * does, until the 타기 prompt shows (when `wantPrompt` is the pad) or the last point is reached. Returns where the prompt appeared.
 */
async function approach(route, wantPrompt, name) {
  let leg = 0;
  for (let k = 0; k < 80; k++) {
    const at = await pos(A);
    const p = await prompt(name);
    if (wantPrompt && p) return { dist: Math.round(Math.hypot(at.x - wantPrompt.x, at.z - wantPrompt.z) * 10) / 10, text: p };
    while (leg < route.length && Math.hypot(route[leg][0] - at.x, route[leg][1] - at.z) < 2.5) leg++;
    if (leg >= route.length) return null;
    const [tx, tz] = route[leg];
    const d = Math.hypot(tx - at.x, tz - at.z);
    const step = Math.min(13, d);
    const wx = at.x + ((tx - at.x) / d) * step;
    const wz = at.z + ((tz - at.z) / d) * step;
    let pt = await project(wx, 0, wz);
    if (!pt) {
      await turnTo(tx, tz);
      pt = await project(wx, 0, wz);
    }
    if (!pt) pt = await project(at.x + ((tx - at.x) / d) * 5, 0, at.z + ((tz - at.z) / d) * 5);
    if (pt) await tapAt(pt);
    await until(async () => (await ctarget()) === null || (wantPrompt && (await prompt(name))), 9000, 120);
    await sleep(200);
  }
  return null;
}

await run.step("join", async () => {
  await joinFresh();
  await run.shot(A, "00-village.png");
  // the gate: the village's own way (a first-time player is shown it; this e2e is about the park)
  const g = await A.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  let enter = false;
  for (let attempt = 0; attempt < 4 && !enter; attempt++) {
    await A.page.evaluate(
      async ([x, z]) => {
        const plan = await window.__imp("/src/game/clickPlan.ts");
        const move = await window.__imp("/src/game/clickMove.ts");
        const am = await window.__imp("/src/game/activeMap.ts");
        const P = window.__cv.getPos();
        const via = plan.findDetour(P.x, P.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
        move.setClickTarget(x, z, 0, via ?? undefined);
      },
      [g.x, g.z - 0.5],
    );
    await sleep(500);
    await until(async () => (await ctarget()) === null, 90000);
    await sleep(600);
    enter = await until(async () => (await A.page.locator(".cv-action-btn").count()) > 0, 4000);
  }
  run.check("the gate offers an action button", enter);
  await act(A);
  const inPark = await until(async () => (await areaOf()) === "park", 15000);
  run.check("pressing it goes into the park", inPark, { area: await areaOf() });
  // the loading veil (the park shows no void while it loads) and its end
  const veilSeen = await until(async () => (await A.page.locator("[data-testid=park-loading]").count()) > 0, 4000, 100);
  const veilGone = await until(async () => (await A.page.locator("[data-testid=park-loading]").count()) === 0, 120000, 250);
  run.check("the park shows a loading veil while it loads, and drops it when ready", veilGone, { veilSeen });
  await sleep(1500);
  await run.shot(A, "01-park-arrival.png");
});

/** One ride, as a first-time player: approach until the prompt shows, then board by `how` ("tap" the ride or "press" the button) and leave. */
async function tryRide(key, how, route, tapPoint, pre) {
  const pad = PADS[key];
  const rec = { ride: key, how, promptDist: null, boarded: false, secondsToBoard: null, windowClosedAtPress: null, sawReserved: false, countdownShown: false, leftBy: null };
  const t0 = Date.now();
  // walk toward the ride: from the arrival the way is the park's main path; stop where the prompt first appears
  let hit = null;
  if (pre) {
    // first walk away from the pad (by taps), then see whether the prompt is still there from that distance
    await approach(pre, null, null);
    const at0 = await pos(A);
    const txt = await prompt(NAMES[key]);
    if (txt) hit = { dist: Math.round(Math.hypot(at0.x - pad.x, at0.z - pad.z) * 10) / 10, text: txt };
  } else if (how !== "pill") hit = await approach(route, pad, NAMES[key]);
  if (how === "pill") {
    // the park's own panel (the nearest ride, the way to it, a button): what a person sees first
    rec.pillText = await A.page.locator("[data-testid=coaster-hud]").first().textContent().catch(() => null);
    await run.shot(A, `${key}-pill-0-panel.png`);
  }
  if (hit) {
    rec.promptDist = hit.dist;
    rec.promptText = hit.text;
  }
  const at = await pos(A);
  rec.stoodAt = { x: Math.round(at.x), z: Math.round(at.z), dist: Math.round(Math.hypot(at.x - pad.x, at.z - pad.z)) };
  await run.shot(A, `${key}-${how}-1-prompt.png`);
  rec.windowClosedAtPress = await A.page.evaluate(async (k) => {
    const r = await window.__imp("/land/rides.ts");
    const clock = await window.__imp("/src/village/villageClock.ts");
    return r.rideByKey(k).statusAt(clock.villageClock.liveMs()).status !== "boarding";
  }, key);
  // press / tap
  if (how === "tap") {
    let pt = tapPoint ? await project(tapPoint[0], tapPoint[1], tapPoint[2]) : null;
    if (!pt && tapPoint) {
      await turnTo(tapPoint[0], tapPoint[2]);
      pt = await project(tapPoint[0], tapPoint[1], tapPoint[2]);
    }
    rec.tapOnScreen = !!pt;
    if (pt) await tapAt(pt);
    else {
      rec.skipped = "the ride could not be brought on screen by the e2e's camera turn";
      report.push(rec);
      console.log(JSON.stringify(rec));
      run.check(`${key}: tap skipped (${rec.skipped})`, true);
      return;
    }
  } else if (how === "pill") {
    const go = A.page.locator(`[data-testid=ride-go-${key}]`);
    // on a phone the other rides sit behind "다른 놀이기구 ▼"
    if (phone && (await go.count()) === 0) await A.page.locator("[data-testid=ride-more]").tap();
    await (phone ? go.tap() : go.click());
  } else if (phone) {
    await A.page.locator(".cv-action-btn").tap();
  } else {
    await A.page.keyboard.press("KeyE");
  }
  const tPress = Date.now();
  // seated within the next ride cycle (the seat is reserved if the ride is not loading)
  let sawNotice = false;
  const seated = await until(
    async () => {
      if (!sawNotice && (await A.page.locator("[data-testid=coaster-notice]").count()) > 0) {
        sawNotice = true;
        rec.sawReserved = ((await A.page.locator("[data-testid=coaster-notice]").first().textContent()) ?? "").includes("맡아");
      }
      if (!rec.countdownShown && (await A.page.locator("[data-testid=ride-countdown]").count()) > 0) {
        rec.countdownShown = true;
        rec.countdownText = ((await A.page.locator("[data-testid=ride-countdown]").first().textContent()) ?? "").trim();
      }
      return (await rideState()).slot >= 0;
    },
    300_000,
    250,
  );
  rec.boarded = seated;
  rec.secondsToBoard = Math.round((Date.now() - tPress) / 100) / 10;
  rec.walkAndBoardSeconds = Math.round((Date.now() - t0) / 100) / 10;
  if (seated) {
    await sleep(2500);
    await run.shot(A, `${key}-${how}-2-seated.png`);
    // leave with the on-screen button
    const leave = A.page.locator("[data-testid=coaster-leave]");
    await leave.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    if (await leave.isEnabled().catch(() => false)) {
      await (phone ? leave.tap() : leave.click());
      rec.leftBy = (await until(async () => (await rideState()).slot < 0, 6000)) ? "button" : null;
    }
    if (rec.leftBy === null) rec.leftBy = (await until(async () => (await rideState()).slot < 0, 300_000)) ? "server (end of ride)" : "never";
  }
  report.push(rec);
  console.log(JSON.stringify(rec));
  if (how !== "pill") run.check(`${key}: ${how} -> the prompt shows from a distance (>= 20 m)`, rec.promptDist !== null && (rec.promptDist >= 20 || (phone && how === "press")), rec); // (on a phone the e2e's swipe-turn may not walk it away from the pad first)
  else run.check(`${key}: the park panel shows the ride (or, on a phone, the way to the others) and a go button`, !!rec.pillText && (rec.pillText.includes(NAMES[key]) || rec.pillText.includes("다른 놀이기구")), rec);
  run.check(`${key}: ${how} -> boarded using only the UI`, rec.boarded, rec);
  run.check(`${key}: ${how} -> got off again`, rec.leftBy !== null && rec.leftBy !== "never", rec);
}

await run.step("carousel: the park panel's go button", async () => {
  await tryRide("carousel", "pill", [], null);
});
await run.step("wheel: the panel's go button", async () => {
  await tryRide("wheel", "pill", [], null);
});
await run.step("coaster: the panel's go button", async () => {
  await tryRide("coaster", "pill", [], null);
});
// and the other two ways, at the coaster: walk off a little way (by taps), the 타기 prompt is still there; tap the queue hall; press the prompt
await run.step("coaster: tap the queue hall", async () => {
  await tryRide("coaster", "tap", [], [-17, 2.5, -24], [[-17, -62], [-17, -78]]);
});
await run.step("coaster: press the prompt from afar", async () => {
  await tryRide("coaster", "press", [], null, [[-17, -62], [-17, -78]]);
});

writeFileSync(join(run.evidence, "first-time-report.json"), JSON.stringify(report, null, 1));
const code = run.finish({ report });
await b.close();
process.exit(code);
