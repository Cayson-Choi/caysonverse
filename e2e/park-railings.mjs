/**
 * e2e/park-railings.mjs — Caysonland's ride railings, queue fences, steps, decks and name boards are SOLID, and every ride's real way in stays open
 * (owner 2026-11-21: "달배 난간을 캐릭터가 그냥 막 통과해버려", "구름탑에 탑승하기 앞에 난간도 캐릭터가 그냥 통과해버려").
 *
 * One visitor (PC, or a phone with --phone) in the real game:
 *  1. PUSH: walks straight at every barrier, from BOTH sides where there are two (a straight walk, like holding a key or the stick), and must stop
 *     at it; every frame's position is recorded in the page and checked afterwards: no step of the walk may cross a ride solid, and the body's centre
 *     never comes nearer a barrier than the body's own radius.
 *  2. CLICK: taps a point on the far side (the game's own click-to-walk: the detour search round the colliders): the walk goes ROUND the barrier
 *     through the open end and arrives, again without one step across.
 *  3. 타기: from the lawn beside each ride, off the entrance's axis, presses the ride card's 타기 button: the walk reaches the boarding pad between
 *     the fences (nothing in the way of the real entrance) and the rider is seated (or the seat held until the ride loads) and can get off.
 *   CV_CLIENT_URL=http://localhost:5661 CV_E2E_SLOW=6 node e2e/park-railings.mjs [--phone] [--out=<folder>] [--shots] [--skip-board]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const shots = process.argv.includes("--shots");
const skipBoard = process.argv.includes("--skip-board");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(`park-railings-${phone ? "phone" : "pc"}`);
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });
const TIME = "2026-11-03T12:30";
const BODY = 0.4; // PLAYER_RADIUS
const r2 = (v) => Math.round(v * 100) / 100;

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
/** The game's own click-to-walk (the detour search a tap on the ground runs), or a straight walk with `straight`. */
const walkTo = (p, x, z, straight = false) =>
  p.page.evaluate(
    async ([x, z, straight]) => {
      const plan = await window.__imp("/src/game/clickPlan.ts");
      const move = await window.__imp("/src/game/clickMove.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const P = window.__cv.getPos();
      const via = straight ? null : plan.findDetour(P.x, P.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
      move.setClickTarget(x, z, 0, via ?? undefined);
    },
    [x, z, straight],
  );
const walking = (p) => p.page.evaluate(() => (window.__cvClickTarget?.() ?? null) !== null);
const idle = (p, ms = 120000) => until(async () => !(await walking(p)), ms);
async function goTo(p, x, z, tol = 1.2) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await walkTo(p, x, z);
    await sleep(400);
    await idle(p);
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
/** Every frame's position, recorded in the page (a pass-through between two 120 ms samples would be missed). */
const trailStart = (p) =>
  p.page.evaluate(() => {
    window.__trail = [];
    window.__trailOn = true;
    const tick = () => {
      if (!window.__trailOn) return;
      const q = window.__cv.getPos();
      window.__trail.push([q.x, q.z]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const trailStop = (p) =>
  p.page.evaluate(() => {
    window.__trailOn = false;
    return window.__trail;
  });
/** Does the step a-b pass through the box? A thin box (a fence, a board) by its centre line, a block by its inside (2 cm in). */
function crosses(a, b, box) {
  const w = box.maxX - box.minX;
  const d = box.maxZ - box.minZ;
  if (Math.min(w, d) < 0.3) {
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    if (w < d) {
      if ((a[0] - cx) * (b[0] - cx) > 0) return false;
      const t = a[0] === b[0] ? 0 : (cx - a[0]) / (b[0] - a[0]);
      const z = a[1] + (b[1] - a[1]) * t;
      return z > box.minZ && z < box.maxZ;
    }
    if ((a[1] - cz) * (b[1] - cz) > 0) return false;
    const t = a[1] === b[1] ? 0 : (cz - a[1]) / (b[1] - a[1]);
    const x = a[0] + (b[0] - a[0]) * t;
    return x > box.minX && x < box.maxX;
  }
  const s = 0.02;
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - (box.minX + s)], [dx, box.maxX - s - a[0]], [-dz, a[1] - (box.minZ + s)], [dz, box.maxZ - s - a[1]]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
  }
  return t0 < t1;
}
/** The nearest the body's centre comes to any of the boxes along the trail (0 inside one). */
function nearest(trail, boxes) {
  let best = Infinity;
  for (const [x, z] of trail)
    for (const b of boxes) {
      const dx = Math.max(b.minX - x, 0, x - b.maxX);
      const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      best = Math.min(best, Math.hypot(dx, dz));
    }
  return best;
}

// the sites (park-local); the barriers' own numbers are shared/src/village/parkRideSolids.ts
const M = { x: -95, z: -140 };
const D = { x: -75, z: -88 };
const C = { x: 110, z: -135 };
const W = { x: 205, z: -140 };
// [name, from, to, kind]: "two" = a thin barrier with open ground on both sides (pushed from both, clicked across); "block" = a solid block (pushed from outside only)
const CASES = [];
for (const sz of [-1, 1]) {
  const s = sz < 0 ? "north" : "south";
  CASES.push([`달배 queue fence (${s}), by the steps`, [M.x + 13.5, M.z + sz * 4.4], [M.x + 13.5, M.z + sz * 0.6], "two"]);
  CASES.push([`달배 queue fence (${s}), by the pad`, [M.x + 14.6, M.z + sz * 4.4], [M.x + 14.6, M.z + sz * 0.6], "two"]);
  CASES.push([`달배 deck rail (${s})`, [M.x + 5.4, M.z + sz * 7.5], [M.x + 5.4, M.z + sz * 1], "block"]);
  CASES.push([`구름 낙하탑 queue fence (${s}), by the steps`, [D.x + 10.2, D.z + sz * 3.9], [D.x + 10.2, D.z + sz * 0.6], "two"]);
  CASES.push([`구름 낙하탑 queue fence (${s}), by the pad`, [D.x + 13.2, D.z + sz * 3.9], [D.x + 13.2, D.z + sz * 0.6], "two"]);
  CASES.push([`구름 낙하탑 platform rail (${s})`, [D.x + sz * 3, D.z + sz * 11], [D.x + sz * 3, D.z + sz * 2], "block"]);
}
CASES.push(["달배 steps from the pad", [M.x + 12.9, M.z], [M.x + 4.5, M.z], "block"]);
CASES.push(["달배 name board", [M.x + 14.4, M.z - 4.6], [M.x + 11.6, M.z - 4.6], "two"]);
CASES.push(["달배 swing lane from the west", [M.x - 8, M.z + 6], [M.x, M.z + 6], "block"]);
CASES.push(["구름 낙하탑 steps from the pad", [D.x + 14, D.z], [D.x + 4.5, D.z], "block"]);
CASES.push(["구름 낙하탑 platform rail (west)", [D.x - 11, D.z + 2], [D.x - 2, D.z + 2], "block"]);
CASES.push(["구름 낙하탑 platform rail (east, beside the gate)", [D.x + 9.8, D.z - 4.6], [D.x + 2, D.z - 4.6], "block"]);
CASES.push(["구름 낙하탑 name board", [D.x + 12.6, D.z - 4.2], [D.x + 9.6, D.z - 4.2], "two"]);
CASES.push(["회전목마 fence from the east", [C.x + 19, C.z], [C.x, C.z], "block"]);
CASES.push(["회전목마 fence from the north", [C.x, C.z - 19], [C.x, C.z], "block"]);
CASES.push(["회전목마 fence from the north-east", [C.x + 14, C.z - 14], [C.x, C.z], "block"]);
CASES.push(["회전목마 gate from the pad", [C.x, C.z + 16], [C.x, C.z + 6], "block"]);
CASES.push(["바퀴 steps from the pad", [W.x, W.z + 11.8], [W.x, W.z + 6], "block"]);
CASES.push(["바퀴 deck rail (east)", [W.x + 7, W.z + 6.6], [W.x, W.z + 6.6], "block"]);
CASES.push(["바퀴 deck rail (west)", [W.x - 7, W.z + 6.6], [W.x, W.z + 6.6], "block"]);
CASES.push(["바퀴 name board", [W.x + 7.5, W.z + 11.2], [W.x + 7.5, W.z + 8.0], "two"]);
CASES.push(["급행 station steps from the pad", [2, -12], [2, -5], "block"]);
CASES.push(["급행 station platform from the north", [-12, -9.5], [-12, -4], "block"]);

// 타기 from the lawn beside each ride, off the entrance's axis (the walk must come round the fence's end to the pad)
const RIDES = [
  ["moonboat", "달배", { x: -82.1, z: -140 }, [M.x + 10.5, M.z - 9]],
  ["droptower", "구름 낙하탑", { x: -61, z: -88 }, [D.x + 10, D.z + 9]],
  ["carousel", "달빛 회전목마", { x: 110, z: -119 }, [C.x + 17, C.z + 9]],
  ["wheel", "하늘 등불 바퀴", { x: 205, z: -128.2 }, [W.x - 8, W.z + 10]],
  ["coaster", "별똥별 급행", { x: 2, z: -12 }, [-9, -11]],
];

const b = await launchBrowser();
const P = await openPlayer(b, run, { tag: phone ? "phone" : "pc", device: phone ? PHONE : DESKTOP });
const report = [];
let rideBoxes = [];
let allBoxes = [];
await run.step("join", async () => {
  await joinLand(P, "Ra");
  run.check("enters the park", await enterPark(P), { area: await areaOf(P) });
  await sleep(2500);
  rideBoxes = await P.page.evaluate(async () => (await window.__imp("/village/parkRideSolids.ts")).parkRideSolids().map((b) => ({ ...b })));
  allBoxes = await P.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).PARK_SOLIDS.map((b) => ({ ...b })));
  // the coaster's station (parkArea.ts) counts as a ride solid here too
  rideBoxes.push({ minX: -14, maxX: 17, minZ: -6.8, maxZ: -1.4 }, { minX: 2 - 3.6, maxX: 2 + 3.6, minZ: -6.8 - 4.3, maxZ: -6.8 });
  run.check("the rides' solids are loaded", rideBoxes.length > 20, { rideBoxes: rideBoxes.length, all: allBoxes.length });
});

/** One walk with the recorder on: the trail, where it ended, which steps crossed a ride solid, the nearest approach. */
async function recorded(to, straight) {
  await trailStart(P);
  await walkTo(P, to[0], to[1], straight);
  await sleep(350);
  // a straight push leans on the barrier until the walk gives up (no progress): wait until the body has stood still
  let last = await pos(P);
  let still = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000 * SLOW && still < 6) {
    await sleep(150);
    const q = await pos(P);
    still = Math.hypot(q.x - last.x, q.z - last.z) < 0.01 ? still + 1 : 0;
    last = q;
    if (!(await walking(P)) && still >= 2) break;
  }
  const trail = await trailStop(P);
  await P.page.evaluate(async () => (await window.__imp("/src/game/clickMove.ts")).endWalk());
  const crossed = [];
  for (let i = 1; i < trail.length; i++) for (const box of rideBoxes) if (crosses(trail[i - 1], trail[i], box)) crossed.push({ at: trail[i].map(r2), box });
  return { trail, end: [last.x, last.z], crossed, near: nearest(trail, rideBoxes) };
}

await run.step("push: a straight walk into every barrier", async () => {
  for (const [name, from, to, kind] of CASES) {
    for (const dir of kind === "two" ? [0, 1] : [0]) {
      const a = dir === 0 ? from : to;
      const z = dir === 0 ? to : from;
      const label = `${name}${kind === "two" ? (dir === 0 ? " (from outside)" : " (from inside)") : ""}`;
      const at = await goTo(P, a[0], a[1], 0.9);
      const startOk = Math.hypot(at.x - a[0], at.z - a[1]) < 0.9;
      const r = await recorded(z, true);
      const reached = Math.hypot(r.end[0] - z[0], r.end[1] - z[1]) < 0.35;
      report.push({ mode: "push", name: label, start: [at.x, at.z].map(r2), end: r.end.map(r2), steps: r.trail.length, nearest: Math.round(r.near * 1000) / 1000, crossed: r.crossed.length });
      run.check(`push · ${label}: stopped at it, never across`, startOk && r.trail.length > 5 && r.crossed.length === 0 && !reached && r.near > BODY - 0.03, { start: [at.x, at.z].map(r2), end: r.end.map(r2), nearest: Math.round(r.near * 1000) / 1000, crossed: r.crossed.slice(0, 2) });
      if (shots && dir === 0) await run.shot(P, `push-${name.replace(/[^a-z0-9가-힣]+/gi, "-")}.png`);
    }
  }
});

await run.step("click: a tap on the far side goes round, never through", async () => {
  for (const [name, from, to, kind] of CASES) {
    if (kind !== "two") continue;
    for (const dir of [0, 1]) {
      const a = dir === 0 ? from : to;
      const z = dir === 0 ? to : from;
      const label = `${name} (${dir === 0 ? "outside to inside" : "inside to outside"})`;
      const at = await goTo(P, a[0], a[1], 0.9);
      const r = await recorded(z, false);
      const reached = Math.hypot(r.end[0] - z[0], r.end[1] - z[1]) < 0.9;
      report.push({ mode: "click", name: label, start: [at.x, at.z].map(r2), end: r.end.map(r2), steps: r.trail.length, nearest: Math.round(r.near * 1000) / 1000, crossed: r.crossed.length, reached });
      run.check(`click · ${label}: arrives by the open end, never across`, r.crossed.length === 0 && reached && r.near > BODY - 0.03, { end: r.end.map(r2), nearest: Math.round(r.near * 1000) / 1000, crossed: r.crossed.slice(0, 2), steps: r.trail.length });
    }
  }
});

const rideState = (p) =>
  p.page.evaluate(async () => {
    const m = await window.__imp("/land/coasterRide.ts");
    return { slot: m.selfRide.slot, ride: m.selfRide.ride };
  });
if (!skipBoard)
  await run.step("타기: every ride's pad is reached from the lawn and the ride boarded", async () => {
    for (const [key, name, pad, from] of RIDES) {
      const at = await goTo(P, from[0], from[1], 1.2);
      const btn = P.page.locator(`[data-testid=ride-go-${key}]`).first();
      const offered = await btn.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false);
      run.check(`타기 · ${name}: the ride's card offers 타기 from the lawn`, offered, { at: [at.x, at.z].map(r2) });
      if (!offered) continue;
      await trailStart(P);
      await press(P, btn);
      // the walk to the pad (the board is armed), then the seat (at once while the ride loads, else when it next loads: the seat is held)
      const arrived = await until(async () => {
        const q = await pos(P);
        const s = await rideState(P);
        return s.slot >= 0 || (Math.hypot(q.x - pad.x, q.z - pad.z) < 3.2 && !(await walking(P)));
      }, 90000 * SLOW);
      const trail = await trailStop(P);
      const crossed = [];
      const walked = [trail[0] ?? [at.x, at.z]];
      for (let i = 1; i < trail.length; i++) {
        // the moment of boarding the body is lifted from the pad into the seat: that jump is not a walk
        if (Math.hypot(trail[i][0] - trail[i - 1][0], trail[i][1] - trail[i - 1][1]) > 1.5) break;
        walked.push(trail[i]);
        for (const box of rideBoxes) if (crosses(trail[i - 1], trail[i], box)) crossed.push({ at: trail[i].map(r2), box });
      }
      const lastWalk = walked[walked.length - 1];
      const atPad = Math.hypot(lastWalk[0] - pad.x, lastWalk[1] - pad.z) < 6.2;
      run.check(`타기 · ${name}: walked to the pad round the fences, never through one`, arrived && atPad && crossed.length === 0 && nearest(walked, rideBoxes) > BODY - 0.03, { from: [at.x, at.z].map(r2), lastWalk: lastWalk.map(r2), steps: trail.length, crossed: crossed.slice(0, 2) });
      const seated = await until(async () => (await rideState(P)).slot >= 0, 200000 * SLOW);
      run.check(`타기 · ${name}: seated on the ride`, seated, await rideState(P));
      report.push({ mode: "board", name, from: [at.x, at.z].map(r2), lastWalk: lastWalk.map(r2), steps: trail.length, crossed: crossed.length, seated });
      if (shots && seated) await run.shot(P, `board-${key}.png`);
      if (seated) {
        // off again as soon as the ride lets me (its own button; a ride under way lets me off when it is back)
        const leave = P.page.locator("[data-testid=coaster-leave]");
        const off = await until(async () => {
          if ((await rideState(P)).slot < 0) return true;
          if ((await leave.count()) && (await leave.isEnabled().catch(() => false))) await press(P, leave).catch(() => {});
          await sleep(400);
          return (await rideState(P)).slot < 0;
        }, 260000 * SLOW);
        run.check(`타기 · ${name}: got off`, off, await rideState(P));
        await sleep(1500);
        const q = await pos(P);
        run.check(`타기 · ${name}: put down on open ground (not inside a solid)`, nearest([[q.x, q.z]], allBoxes) > BODY - 0.03, { at: [q.x, q.z].map(r2) });
      }
    }
  });

await b.close();
writeFileSync(join(run.evidence, "railings-report.json"), JSON.stringify(report, null, 1));
process.exit(run.finish({}));
