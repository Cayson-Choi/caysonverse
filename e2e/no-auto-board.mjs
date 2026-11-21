/**
 * e2e/no-auto-board.mjs — a ride (and the bus) is boarded ONLY by its 타기 button / E (owner 2026-11-21: "모든 놀이기구에 타기 버튼을 눌러야만 타도록"),
 * left only by its 내리기 button or the ride's own end, and nothing throws a rider off on the way.
 *
 *   CV_CLIENT_URL=http://localhost:5621 CV_E2E_SLOW=6 node e2e/no-auto-board.mjs [--only=pc,phone] [--rides=coaster,carousel,wheel,moonboat,droptower|none]
 *        [--bus=1] [--gate=1] [--idle=30000] [--negonly=1] [--name=…]
 *
 * The park's gate (both sides): the keys into it, clicks on the ground by it and standing at it never go through; its button does.
 * Each ride: walking through its boarding pad by the keys, a click / tap on the ground at the pad, on the way to the ride, under the ride, on
 * the ride's own body (its frame, seats, cars) and on a grid of screen points over it, and standing at the pad idle never board, never
 * reserve a seat and never arm a board; the 타기 button boards (at once, or the seat is kept and taken when the ride loads). Riding: sampled
 * twice a second until the ride's own end, with taps, a look-drag and E on the way — never off before the ride is over. Then the button boards
 * again and the 내리기 button gets off.
 * The bus (--bus=1): in its boarding area, clicks on the ground and on the bus and standing there never board; its button does.
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, r2, sleep, targets, waitIdle, walkTo } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";
import { arg, areaOf as area, canvasAt, faceWorld, finishRun, inStep, keysToward, pickInfo, setView, tapScreen, tapWorld, until, waitArea, walkFar, walkPlanned } from "./lib/noauto.mjs";

const ONLY = arg("only", "pc,phone").split(",");
const RIDES_ = arg("rides", "coaster,carousel,wheel,moonboat,droptower").split(",").filter((r) => r && r !== "none");
const BUS = arg("bus", "1") !== "0";
const GATE = arg("gate", "1") !== "0";
const IDLE_MS = Number(arg("idle", "30000"));
const NEG_ONLY = arg("negonly", "0") === "1";
const run = createRun(arg("name", "no-auto-board"));
mkdirSync(run.evidence, { recursive: true });

/** The middle of each ride (where its body stands), for the camera and the taps. */
const CENTRE = { coaster: { x: 1.5, z: -4.1 }, carousel: { x: 110, z: -135 }, wheel: { x: 205, z: -140 }, moonboat: { x: -95, z: -140 }, droptower: { x: -75, z: -88 } };

const rideState = (p, key) =>
  p.page.evaluate(async (key) => {
    const R = await window.__imp("/src/land/coasterRide.ts");
    const B = await window.__imp("/src/land/rideBoard.ts");
    const D = await window.__imp("/shared/src/land/rides.ts");
    const C = await window.__imp("/src/village/villageClock.ts");
    const def = key ? D.rideByKey(key) : null;
    const st = def ? def.statusAt(C.villageClock.liveMs()) : null;
    return { slot: R.selfRide.slot, ride: R.selfRide.ride, reserved: R.rideReserved.key, armed: B.armedRide(), status: st?.status ?? null, cycle: st?.cycle ?? null, cycleSoon: def ? def.statusAt(C.villageClock.liveMs() + 2000).cycle : null };
  }, key ?? null);
const isFree = (s) => s.slot < 0 && s.reserved === null && s.armed === null;
/** Off the ride / out of the reservation, whatever it takes (after a check that found us boarded: the before run). */
async function recover(p, key) {
  for (let i = 0; i < 400; i++) {
    const s = await rideState(p, key);
    if (isFree(s)) return;
    await p.page.evaluate(async () => {
      (await window.__imp("/src/land/rideBoard.ts")).armRide(null);
      (await window.__imp("/src/net/connection.ts")).sendRideLeave();
      (await window.__imp("/src/land/coasterRide.ts")).rideReserved.key = null;
    });
    await sleep(1500);
  }
}

async function gate(p, tag) {
  const L = `${tag} park gate`;
  const g = await p.page.evaluate(async () => {
    const d = (await window.__imp("/shared/src/village/parkArea.ts")).parkGateDoor();
    return { pad: d.pad, centre: d.centre, yaw: d.yaw };
  });
  const out = { x: Math.sin(g.yaw), z: Math.cos(g.yaw) };
  const at = (o, a = 0) => ({ x: g.centre.x + out.x * o + out.z * a, z: g.centre.z + out.z * o - out.x * a });
  const notIn = async (what, detail) => {
    await sleep(4500);
    const a = await area(p);
    run.check(`${L}: ${what} does NOT go in`, a === "village", detail ? { area: a, pick: detail } : a);
  };
  await walkFar(p, at(4).x, at(4).z, 1.5);
  const yawKey = await keysToward(p, g.centre.x, g.centre.z, [g.yaw + Math.PI, g.yaw], 4500);
  run.check(`${L}: the keys walked at the gate`, yawKey !== null, await pos(p));
  await notIn("walking into the gate by the keys");
  await walkTo(p, at(-2).x, at(-2).z);
  await waitIdle(p, 20000);
  await notIn("a click-walk straight through the gate");
  const back = at(4);
  await walkPlanned(p, back.x, back.z, 1.2);
  await setView(p, yawKey ?? g.yaw);
  await sleep(2000);
  for (const [name, o, a] of [["on the pad", 0.65, 0], ["at the gate's foot", 0.1, 0], ["past the gate's line", -0.6, 0], ["beside the gate", 0.4, 2.5]]) {
    const q = at(o, a);
    if (await tapWorld(p, q.x, 0, q.z)) {
      await notIn(`a ${p.touch ? "tap" : "click"} on the ground ${name}`, await pickInfo(p));
      await waitIdle(p, 15000);
    }
    const me = await pos(p);
    if (Math.hypot(me.x - back.x, me.z - back.z) > 1.2) await walkPlanned(p, back.x, back.z, 1.2);
  }
  if (await tapWorld(p, g.centre.x, 1.5, g.centre.z)) {
    await notIn("a tap on the gate itself (the gate is its button's only)", await pickInfo(p));
    await waitIdle(p, 15000);
  }
  await walkPlanned(p, g.pad.x, g.pad.z, 1.0);
  await sleep(IDLE_MS);
  await notIn(`standing at the gate ${IDLE_MS / 1000} s`);
  const t = await targets(p);
  run.check(`${L}: the 들어가기 button is offered at the gate`, t.some((x) => x.id === "park_door"), t);
  await inStep(p, "before the gate's button");
  await act(p);
  const ok = await waitArea(p, "park", 60000);
  run.check(`${L}: the button goes into the park`, ok, await area(p));
  await p.page.waitForFunction(() => document.querySelectorAll("[data-testid=park-loading]").length === 0, null, { timeout: 240000 }).catch(() => {});
  await sleep(3000);
}

async function gateOut(p, tag) {
  const L = `${tag} park exit`;
  const ex = { x: 40, z: -181 };
  const notOut = async (what, detail) => {
    await sleep(4500);
    const a = await area(p);
    run.check(`${L}: ${what} does NOT leave`, a === "park", detail ? { area: a, pick: detail } : a);
  };
  await walkFar(p, ex.x, ex.z + 6, 1.5);
  const yawKey = await keysToward(p, ex.x, ex.z - 4, [0, Math.PI], 4500);
  run.check(`${L}: the keys walked at the way out`, yawKey !== null, await pos(p));
  await notOut("walking into the way out by the keys");
  const back = { x: ex.x, z: ex.z + 5 };
  await walkPlanned(p, back.x, back.z, 1.2);
  await setView(p, yawKey ?? 0);
  await sleep(2000);
  for (const [name, dz] of [["on the exit pad", 0], ["past the pad", -1.5], ["2 m before it", 2]]) {
    if (await tapWorld(p, ex.x, 0, ex.z + dz)) {
      await notOut(`a ${p.touch ? "tap" : "click"} on the ground ${name}`, await pickInfo(p));
      await waitIdle(p, 15000);
    }
    const me = await pos(p);
    if (Math.hypot(me.x - back.x, me.z - back.z) > 1.2) await walkPlanned(p, back.x, back.z, 1.2);
  }
  await walkPlanned(p, ex.x, ex.z, 1.0);
  await sleep(IDLE_MS);
  await notOut(`standing at the way out ${IDLE_MS / 1000} s`);
  await inStep(p, "before the way out's button");
  await act(p);
  const ok = await waitArea(p, "village", 60000);
  run.check(`${L}: the 나가기 button leaves the park`, ok, await area(p));
  await sleep(4000);
}

async function oneRide(p, key, tag) {
  const d = await p.page.evaluate(async (k) => {
    const def = (await window.__imp("/shared/src/land/rides.ts")).rideByKey(k);
    return { pad: def.pad, cycles: def.rideCycles ?? 1 };
  }, key);
  const c = CENTRE[key];
  const L = `${tag} ${key}`;
  const len = Math.hypot(d.pad.x - c.x, d.pad.z - c.z) || 1;
  const dir = { x: (d.pad.x - c.x) / len, z: (d.pad.z - c.z) / len }; // from the ride out through its pad
  const off = (m) => ({ x: d.pad.x + dir.x * m, z: d.pad.z + dir.z * m });
  const free = async (what, detail) => {
    await sleep(3500);
    const s = await rideState(p, key);
    run.check(`${L}: ${what} does NOT board`, isFree(s), detail ? { ...s, pick: detail } : s);
    if (!isFree(s)) {
      await recover(p, key);
      await sleep(1500);
    }
  };
  // 1. the keys: from 7 m out, straight through the pad towards the ride
  await walkFar(p, off(7).x, off(7).z, 2);
  const yawKey = await keysToward(p, c.x, c.z, [0, Math.PI / 2, Math.PI, -Math.PI / 2], 3500);
  run.check(`${L}: the keys walked through the boarding pad`, yawKey !== null, await pos(p));
  await free("walking through the boarding pad by the keys");
  // 2. clicks / taps: from 2 m outside the pad's middle (within a tap's old "arrived" reach), the ride ahead
  const stand = off(2);
  const toStand = async () => {
    const me = await pos(p);
    if (Math.hypot(me.x - stand.x, me.z - stand.z) > 1.5) {
      await walkFar(p, stand.x, stand.z, 1.2);
      await waitIdle(p, 10000);
    }
  };
  await toStand();
  const yaw = (await faceWorld(p, c.x, 2, c.z)) ?? yawKey ?? 0;
  const mid = (f) => ({ x: d.pad.x + (c.x - d.pad.x) * f, z: d.pad.z + (c.z - d.pad.z) * f });
  const side = (m) => ({ x: c.x - dir.z * m, z: c.z + dir.x * m });
  const worldTaps = [
    ["the ground at the pad", d.pad.x, 0, d.pad.z],
    ["the ground 2 m before the pad", off(1).x, 0, off(1).z],
    ["the ground a third of the way to the ride (the queue / the steps)", mid(0.33).x, 0, mid(0.33).z],
    ["the ground two thirds of the way to the ride (the platform)", mid(0.66).x, 0, mid(0.66).z],
    ["the floor under the ride's middle", c.x, 0, c.z],
    ["the ride's body 1.2 m up (a seat / a car)", c.x, 1.2, c.z],
    ["the ride's body 2.5 m up", c.x, 2.5, c.z],
    ["the ride's body 6 m up (its frame / canopy)", c.x, 6, c.z],
    ["the ride's body 3 m to one side", side(3).x, 1.5, side(3).z],
    ["the ride's body 3 m to the other side", side(-3).x, 1.5, side(-3).z],
    ["the platform's edge by the ride", mid(0.85).x, 0.8, mid(0.85).z],
  ];
  for (const [name, x, y, z] of worldTaps) {
    if (await tapWorld(p, x, y, z)) {
      await free(`a ${p.touch ? "tap" : "click"} on ${name}`, await pickInfo(p));
      await waitIdle(p, 20000);
      await toStand();
      await setView(p, yaw);
      await sleep(1500);
    } else console.log(`      (not on the screen: ${name})`);
  }
  // a grid of screen points over the ride (whatever is there: cars, seats, the frame, the queue's rails, the lawn beyond)
  const vp = p.page.viewportSize();
  let grid = 0;
  for (const fy of [0.22, 0.36, 0.5]) {
    for (const fx of [0.25, 0.5, 0.75]) {
      const px = vp.width * fx;
      const py = vp.height * fy;
      if (!(await canvasAt(p, px, py))) continue;
      await tapScreen(p, px, py);
      grid++;
      await free(`a ${p.touch ? "tap" : "click"} on the screen at ${Math.round(fx * 100)}% / ${Math.round(fy * 100)}%`, await pickInfo(p));
      await waitIdle(p, 20000);
      await toStand();
      await setView(p, yaw);
      await sleep(1500);
    }
  }
  run.check(`${L}: the screen grid over the ride was tapped (${grid} points)`, grid >= 4, grid);
  // 3. standing at the pad idle
  await walkFar(p, d.pad.x, d.pad.z, 1.5);
  await sleep(IDLE_MS);
  await free(`standing at the pad ${IDLE_MS / 1000} s`);
  const t = await targets(p);
  run.check(`${L}: the 타기 button is offered at the pad`, t.some((x) => x.id === `ride_board:${key}`), t);
  if (NEG_ONLY) return;

  // 4. the button boards
  const boardByButton = async () => {
    await walkFar(p, d.pad.x, d.pad.z, 1.5);
    await sleep(600);
    // the button says this ride's 타기 (the nearest target): press it
    const tt = await targets(p);
    if (!tt.some((x) => x.id === `ride_board:${key}`)) return false;
    await inStep(p, "before the 타기 button");
    await act(p);
    return until(async () => (await rideState(p, key)).slot >= 0, 400000, 400);
  };
  const boarded = await boardByButton();
  const b0 = await rideState(p, key);
  run.check(`${L}: the 타기 button boards (at once, or the seat is kept and taken when the ride loads)`, boarded, b0);
  if (!boarded) return;
  // 5. the whole ride: never off before its own end
  // (the server puts riders off when the cycle after the ride's last begins; our clock may be a moment behind its: 2 s of grace, and one
  // step for the wheel, whose seat may have been given a step before we first saw it)
  const endCycle = b0.cycle + d.cycles - (d.cycles > 1 ? 1 : 0);
  let thrown = null;
  let samples = 0;
  let pokes = 0;
  const t0 = Date.now();
  let lastPoke = Date.now();
  let sawRiding = false;
  for (;;) {
    const s = await rideState(p, key);
    samples++;
    if (s.status === "riding") sawRiding = true;
    if (s.slot < 0) {
      if (s.cycleSoon < endCycle) thrown = { ...s, afterS: r2((Date.now() - t0) / 1000) };
      break;
    }
    if (Date.now() - t0 > 420000) {
      thrown = { ...s, afterS: r2((Date.now() - t0) / 1000), why: "still seated after 7 min" };
      break;
    }
    if (Date.now() - lastPoke > 7000) {
      lastPoke = Date.now();
      pokes++;
      // what a rider's hands do: a tap on the view, a look-drag, E, the walk keys
      const px = vp.width * (0.3 + 0.1 * (pokes % 4));
      const py = vp.height * (0.3 + 0.08 * (pokes % 3));
      if (await canvasAt(p, px, py)) {
        if (pokes % 3 === 0 && !p.touch) {
          await p.page.mouse.move(px, py);
          await p.page.mouse.down();
          await p.page.mouse.move(px + 120, py + 20, { steps: 6 });
          await p.page.mouse.up();
        } else await tapScreen(p, px, py);
      }
      if (!p.touch) {
        if (pokes % 2 === 0) await p.page.keyboard.press("KeyE");
        await p.page.keyboard.down("KeyW");
        await sleep(250);
        await p.page.keyboard.up("KeyW");
      } else if (pokes % 2 === 0) {
        const btn = p.page.locator(".cv-action-btn");
        if (await btn.isVisible().catch(() => false)) {
          console.log(`      (riding: the action button shows "${await btn.textContent()}")`);
          await btn.tap().catch(() => {});
        }
      }
    }
    await sleep(500);
  }
  run.check(`${L}: rode to the ride's own end, never put off on the way (${samples} samples, ${pokes} taps / drags / keys, ${r2((Date.now() - t0) / 1000)} s)`, thrown === null && sawRiding, thrown ?? { sawRiding });
  await sleep(3000);
  const after = await pos(p);
  run.check(`${L}: put down by the ride (${r2(Math.hypot(after.x - d.pad.x, after.z - d.pad.z))} m from its pad), free to walk`, isFree(await rideState(p, key)), after);
  // 6. the button boards again, the 내리기 button gets off
  const again = await boardByButton();
  run.check(`${L}: the 타기 button boards again`, again, await rideState(p, key));
  if (again) {
    const leave = p.page.locator("[data-testid=coaster-leave]");
    await leave.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    let off = false;
    for (let i = 0; i < 500 && !off; i++) {
      if (await leave.isEnabled().catch(() => false)) {
        await (p.touch ? leave.tap() : leave.click()).catch(() => {});
        off = await until(async () => (await rideState(p, key)).slot < 0, 4000);
      } else await sleep(500);
      if ((await rideState(p, key)).slot < 0) break;
    }
    run.check(`${L}: the 내리기 button gets off`, off, await rideState(p, key));
    if (!off) await recover(p, key);
  }
  await sleep(2000);
}

async function bus(p, tag) {
  const L = `${tag} bus`;
  const a = await p.page.evaluate(async () => {
    const V = await window.__imp("/shared/src/village/villageLayout.ts");
    return V.busBoardingArea();
  });
  const mid = { x: (a.minX + a.maxX) / 2, z: (a.minZ + a.maxZ) / 2 };
  const aboard = () => p.page.evaluate(async () => (await window.__imp("/src/game/busRide.ts")).selfBusRide.slot >= 0);
  const notOn = async (what, detail) => {
    await sleep(3500);
    const on = await aboard();
    run.check(`${L}: ${what} does NOT board`, !on, detail ?? null);
  };
  if (Math.hypot((await pos(p)).x, (await pos(p)).z - 14) > 25) await walkFar(p, 0, 14, 2);
  // the pad's road half (clear of the shelter's bench): the east part of the area
  const stand = { x: a.maxX - 1.2, z: mid.z };
  await walkFar(p, stand.x, stand.z, 1.5);
  await notOn("walking into the boarding area");
  // wait for the boarding window (3 min before each departure, every 10 min), idle
  const open = await until(async () => (await targets(p)).some((t) => t.id === "village_bus_board"), 9 * 60000, 1000);
  run.check(`${L}: the 버스 타기 button is offered while the bus takes riders`, open, await targets(p));
  await notOn("standing in the boarding area until the bus takes riders");
  if (!open) return;
  await faceWorld(p, a.minX, 1.5, mid.z);
  for (const [name, x, y, z] of [["the ground by the doors", a.minX + 2.6, 0, mid.z], ["the bus's side", a.minX + 1.2, 1.4, mid.z], ["the bus's doors", a.minX + 1.3, 1.0, mid.z + 1.5], ["the ground at my feet", stand.x - 0.8, 0, stand.z]]) {
    if (await tapWorld(p, x, y, z)) {
      await notOn(`a ${p.touch ? "tap" : "click"} on ${name}`, await pickInfo(p));
      await waitIdle(p, 15000);
    }
  }
  await sleep(Math.min(IDLE_MS, 20000));
  await notOn(`standing by the open bus ${Math.min(IDLE_MS, 20000) / 1000} s`);
  // the button boards (walk to where the button has the key: no free bench in reach)
  let on = false;
  for (const q of [{ x: a.minX + 2.4, z: mid.z }, stand, { x: a.minX + 2.4, z: mid.z + 1.5 }]) {
    await walkFar(p, q.x, q.z, 1.0);
    await sleep(600);
    const label = await p.page.evaluate(() => document.querySelector(".cv-action-btn")?.textContent ?? "");
    if (!/버스 타기|탑승/.test(label)) continue;
    await act(p);
    on = await until(aboard, 8000);
    if (on) break;
  }
  run.check(`${L}: the 버스 타기 button boards`, on, await targets(p));
  if (!on) return;
  // aboard: taps on the cabin never put the rider off
  const vp = p.page.viewportSize();
  for (const [fx, fy] of [[0.5, 0.55], [0.35, 0.6], [0.65, 0.5], [0.5, 0.4]]) {
    if (await canvasAt(p, vp.width * fx, vp.height * fy)) await tapScreen(p, vp.width * fx, vp.height * fy);
    await sleep(2500);
  }
  run.check(`${L}: taps inside the bus do not put the rider off`, await aboard(), null);
}

async function profile(tag, device) {
  const browser = await launchBrowser();
  try {
    const p = await openPlayer(browser, run, { tag, device, settings: { graphics: tag === "phone" ? "low" : "high" } });
    await joinVillage(p, `nb${tag[0]}`, "2026-11-21T12:30");
    await sleep(3000);
    if (GATE || RIDES_.length) {
      if (GATE) await run.step(`${tag}: the park gate`, () => gate(p, tag));
      else
        await run.step(`${tag}: into the park`, async () => {
          const g = await p.page.evaluate(async () => (await window.__imp("/shared/src/village/parkArea.ts")).parkGateDoor().pad);
          await walkFar(p, g.x, g.z, 1.0);
          await sleep(1000);
          await act(p);
          run.check("the gate's button goes into the park", await waitArea(p, "park", 60000), await area(p));
          await p.page.waitForFunction(() => document.querySelectorAll("[data-testid=park-loading]").length === 0, null, { timeout: 240000 }).catch(() => {});
          await sleep(3000);
        });
      const inPark = (await area(p)) === "park";
      if (RIDES_.length) run.check(`${tag}: in the park for the rides`, inPark, await area(p));
      if (inPark) for (const k of RIDES_) await run.step(`${tag}: ${k}`, () => oneRide(p, k, tag));
      if (GATE && inPark) await run.step(`${tag}: the park's way out`, () => gateOut(p, tag));
    }
    if (BUS && (await area(p)) === "village") await run.step(`${tag}: the bus`, () => bus(p, tag));
  } finally {
    await browser.close();
  }
}

try {
  if (ONLY.includes("pc")) await profile("pc", DESKTOP);
  if (ONLY.includes("phone")) await profile("phone", PHONE);
} finally {
  finishRun(run);
}
