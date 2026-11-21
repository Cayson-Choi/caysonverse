/**
 * e2e/no-auto-enter.mjs — a building is entered / left ONLY on purpose (owner 2026-11-21: "절에 들어가기 버튼 누르지도 않았는데 들어가버리잖아",
 * "나가기버튼을 누르지도 않았는데 나가버리고").
 *
 *   server:  PORT=3021 npx tsx src/index.ts                                                   (server/)
 *   client:  VITE_SERVER_URL=http://localhost:3021 npx vite --port 5621 --strictPort          (client/)
 *   CV_CLIENT_URL=http://localhost:5621 CV_E2E_SLOW=6 node e2e/no-auto-enter.mjs [--only=pc,phone] [--rooms=lot_temple_hall,…|none] [--hall=0] [--idle=30000] [--negonly=1]
 *
 * For every lot building's room (school, library, chapel, church, temple, café) and the memorial hall, on a PC (mouse + keys) and a phone
 * (touch), outside:
 *   - walking into the door by the keys never goes in (the button is offered at the door);
 *   - a click-walk straight at / through the door never goes in;
 *   - a real click / tap on the ground in front of, beside, at the foot of and past the door never goes in;
 *   - standing at the door idle never goes in;
 *   - the button (E / the round button) goes in;
 * and inside, the same for the way out (keys into the inner door, a click-walk at it, clicks on the floor by it, idle at it never leave), then
 * a tap on the inner door itself leaves, a tap on the outer door goes in again (from near; from far off it only walks to the door), and the
 * button leaves. (The hall's door has no tap: its button only.)  --negonly=1 stops after the "never" checks of each side (the before/after run).
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, r2, sleep, targets, waitIdle, walkAndWait, walkTo } from "./lib/common.mjs";
import { DOOR_ROUTE, act, joinVillage } from "./lib/village.mjs";
import { arg, areaOf as area, finishRun, keysToward, pickInfo, setView, tapDoor, tapWorld, waitArea, walkPlanned } from "./lib/noauto.mjs";

const ONLY = arg("only", "pc,phone").split(",");
const ROOMS = arg("rooms", "lot_school_class,lot_library_reading,lot_chapel_nave,lot_church_nave,lot_temple_hall,lot_cafe_room").split(",").filter((r) => r && r !== "none");
const HALL = arg("hall", "1") !== "0";
const IDLE_MS = Number(arg("idle", "30000"));
const NEG_ONLY = arg("negonly", "0") === "1";
/** --slow=lot_a,lot_b: these rooms' models are held back first (before anything has loaded them): see slowRooms. */
const SLOW_ROOMS = arg("slow", "").split(",").filter(Boolean);
const run = createRun(arg("name", "no-auto-enter"));
mkdirSync(run.evidence, { recursive: true });

const shared = (p, code, a) =>
  p.page.evaluate(new Function("a", `return (async () => { const L = await window.__imp("/shared/src/village/villageLots.ts"); ${code} })()`), a);

async function walkWay(p, lotId, x, z) {
  const start = await pos(p);
  if (Math.hypot(start.x, start.z - 14) > 25) await walkPlanned(p, 0, 14, 2);
  const here = await pos(p);
  // (the café is not one of the map's places: its own way from the plaza, as e2e/cafe-enter.mjs walks it)
  const way = await p.page.evaluate(async ([id, x, z]) => {
    const m = await window.__imp("/src/village/villagePlaces.ts");
    const place = m.mapPlace(id);
    return place ? m.wayTo(place, x, z) : null;
  }, [lotId, here.x, here.z]);
  for (const w of way ?? [{ x: 20, z: -8 }, { x: 36, z: -12 }, { x: 42, z: -15.1 }]) await walkPlanned(p, w.x, w.z, 1.2);
  return walkPlanned(p, x, z, 0.9);
}

async function settleRoom(p) {
  await p.page.waitForFunction(() => document.querySelector(".cv-house-cover")?.getAttribute("data-phase") !== "loading", null, { timeout: 60000 }).catch(() => {});
  await p.page.waitForFunction(() => !!window.__cvLotRoom?.(), null, { timeout: 120000 }).catch(() => {});
  await sleep(2500);
}

/** Tap the ground / floor at each named point from `back` (walked back to between taps); `stay` checks nothing happened. */
async function groundTaps(p, points, back, stay) {
  for (const [name, q] of points) {
    const clicked = await tapWorld(p, q.x, 0, q.z);
    if (clicked) {
      await stay(`a ${p.touch ? "tap" : "click"} on the ${name}`, await pickInfo(p));
      await waitIdle(p, 15000);
    } else console.log(`      (not on the screen: ${name})`);
    const nowAt = await pos(p);
    if (Math.hypot(nowAt.x - back.x, nowAt.z - back.z) > 1.2) await walkPlanned(p, back.x, back.z, 1.0);
  }
}

async function oneRoom(p, unit, tag) {
  const info = await shared(
    p,
    `const r = L.LOT_ROOMS.find((x) => x.unit.id === a); const d = L.lotDoorPoint(r.lot, r.door); const dd = L.lotRoomDoor(r);
     return { lot: r.lot.id, area: r.area, door: r.door.id, width: r.door.width, centre: d.centre, yaw: d.yaw, pad: d.pad, arrival: d.arrival, exit: dd.exitPad, origin: r.origin, maxZ: r.bounds.maxZ };`,
    unit,
  );
  const out = { x: Math.sin(info.yaw), z: Math.cos(info.yaw) };
  const along = { x: Math.cos(info.yaw), z: -Math.sin(info.yaw) };
  const at = (o, a = 0) => ({ x: info.centre.x + out.x * o + along.x * a, z: info.centre.z + out.z * o + along.z * a });
  const L = `${tag} ${unit}`;
  const notIn = async (what, detail) => {
    await sleep(4500);
    const a = await area(p);
    run.check(`${L}: ${what} does NOT go in`, a === "village", detail ? { area: a, pick: detail } : a);
  };
  const notOut = async (what, detail) => {
    await sleep(4500);
    const a = await area(p);
    run.check(`${L}: ${what} does NOT leave`, a === info.area, detail ? { area: a, pick: detail } : a);
  };
  const pad = at(0.65);
  /** Back to the village side's start if a check that must not go in did (the before run): out by the button. */
  const backOut = async () => {
    if ((await area(p)) === "village") return;
    await settleRoom(p);
    await walkPlanned(p, info.exit.x, info.origin.z + 0.7, 0.9);
    await act(p);
    await waitArea(p, "village", 60000);
    await sleep(2500);
  };
  const backIn = async () => {
    if ((await area(p)) === info.area) return;
    await sleep(2500);
    await walkPlanned(p, pad.x, pad.z, 0.8);
    await act(p);
    await waitArea(p, info.area, 120000);
    await settleRoom(p);
  };

  // ── outside ──
  await walkWay(p, info.lot, info.arrival.x, info.arrival.z);
  // 1. keys into the door
  const from = at(3.2);
  await walkPlanned(p, from.x, from.z, 1.0);
  const yawKey = await keysToward(p, info.centre.x, info.centre.z, [info.yaw + Math.PI, info.yaw], 4500);
  const here = await pos(p);
  const dHere = Math.hypot(here.x - info.centre.x, here.z - info.centre.z);
  run.check(`${L}: the keys walked at the door (${r2(dHere)} m from it)`, yawKey !== null && dHere < 2.2, { here, yawKey });
  await notIn("walking into the door by the keys");
  await backOut();
  const t1 = await targets(p);
  run.check(`${L}: the door offers its 들어가기 button there`, t1.some((x) => x.id === `lotenter:${info.door}`), t1);
  // 2. click-walk at and through the door
  await walkTo(p, info.centre.x - out.x * 1.5, info.centre.z - out.z * 1.5);
  await waitIdle(p, 20000);
  await notIn("a click-walk straight through the door");
  await backOut();
  // 3. real clicks on the ground: in front of, beside, at the foot of and past the door (camera behind the visitor, door ahead)
  const back = at(3.5);
  await walkPlanned(p, back.x, back.z, 1.0);
  await setView(p, yawKey ?? info.yaw);
  await sleep(2000);
  const half = info.width / 2;
  for (const [name, o, a] of [
    ["ground just in front of the door", 0.3, 0],
    ["ground at the door's foot", 0.1, 0.2],
    ["ground at the door's foot, its edge", 0.08, half - 0.1],
    ["ground past the door's line", -0.4, 0],
    ["ground right at the wall beside it", 0.3, half + 0.9],
    ["ground on the pad", 0.65, 0],
    ["ground 1.5 m in front of it", 1.5, 0],
  ]) {
    await groundTaps(p, [[name, at(o, a)]], back, notIn);
    if ((await area(p)) !== "village") {
      await backOut();
      await walkPlanned(p, back.x, back.z, 1.0);
      await setView(p, yawKey ?? info.yaw);
      await sleep(2000);
    }
  }
  // 4. idle at the door
  await walkPlanned(p, pad.x, pad.z, 0.8);
  await sleep(IDLE_MS);
  await notIn(`standing at the door ${IDLE_MS / 1000} s`);
  await backOut();
  // 5. the button goes in
  await walkPlanned(p, pad.x, pad.z, 0.8);
  const t2 = await targets(p);
  run.check(`${L}: the button is offered at the pad`, t2.some((x) => x.id === `lotenter:${info.door}`), t2);
  await act(p);
  const inside = await waitArea(p, info.area, 120000);
  run.check(`${L}: the button goes in`, inside, await area(p));
  await settleRoom(p);

  // ── inside ──
  const O = info.origin;
  const inAt = (dz, dx = 0) => ({ x: info.exit.x + dx, z: O.z + dz });
  const away = inAt(3.0);
  await walkPlanned(p, away.x, away.z, 1.0);
  const yawIn = await keysToward(p, info.exit.x, O.z, [Math.PI, 0], 4500);
  const hi = await pos(p);
  run.check(`${L}: inside, the keys walked at the inner door`, yawIn !== null && Math.hypot(hi.x - info.exit.x, hi.z - O.z) < 2.5, { hi, yawIn });
  await notOut("walking into the inner door by the keys");
  await backIn();
  await walkTo(p, info.exit.x, O.z - 1.5);
  await waitIdle(p, 20000);
  await notOut("a click-walk straight through the inner door");
  await backIn();
  const far = inAt(3.2);
  await walkPlanned(p, far.x, far.z, 1.0);
  await setView(p, yawIn ?? Math.PI);
  await sleep(2000);
  for (const [name, dz, dx] of [
    ["floor just in front of the inner door", 0.4, 0],
    ["floor at its foot", 0.15, 0.3],
    ["floor at its very foot", 0.05, 0],
    ["floor on the exit pad", 0.7, 0],
    ["floor 1.5 m from it", 1.5, 0],
  ]) {
    await groundTaps(p, [[name, inAt(dz, dx)]], far, notOut);
    if ((await area(p)) !== info.area) {
      await backIn();
      await walkPlanned(p, far.x, far.z, 1.0);
      await setView(p, yawIn ?? Math.PI);
      await sleep(2000);
    }
  }
  const ex = inAt(0.7);
  await walkPlanned(p, ex.x, ex.z, 0.8);
  await sleep(IDLE_MS);
  await notOut(`standing at the inner door ${IDLE_MS / 1000} s`);
  await backIn();
  await walkPlanned(p, ex.x, ex.z, 0.8);
  const t3 = await targets(p);
  run.check(`${L}: the exit button is offered at the inner door`, t3.some((x) => x.id.startsWith("lotexit:")), t3);
  if (NEG_ONLY) {
    await act(p);
    await waitArea(p, "village", 60000);
    await sleep(2000);
    return;
  }
  // a tap on the inner door itself leaves (from a clear spot a few metres off; an open door is a doorway the ray goes through)
  let leftBy = { ok: false, tries: [] };
  // (straight in front of the door, then from a little to either side: the camera stands 4-5 m behind the visitor, and in the temple's hall
  // that is inside the altar's furniture on the room's middle line, where a click lands on the piece 0.2 m in front of the lens)
  for (const [d, dx] of [[2.4, 0], [2.2, 1.3], [2.2, -1.3], [3.6, 0]]) {
    const stand = inAt(Math.min(d, info.maxZ - O.z - 1.2), dx);
    await walkPlanned(p, stand.x, stand.z, 0.8);
    leftBy = await tapDoor(p, [1.3, 0.7].map((y) => ({ x: info.exit.x, y, z: O.z - 0.12 })), yawIn ?? Math.PI, () => waitArea(p, "village", 25000));
    if (leftBy.ok) break;
  }
  run.check(`${L}: a tap on the inner door leaves`, leftBy.ok, leftBy.tries);
  if (!leftBy.ok) {
    await walkPlanned(p, ex.x, ex.z, 0.8);
    await act(p);
    await waitArea(p, "village", 60000);
  }
  await sleep(2500);
  // a tap on the outer door from far off (past the 12 m of a tap's use) walks to the door and does not go in: the button is there
  const farOut = at(16);
  if (await walkPlanned(p, farOut.x, farOut.z, 2)) {
    await setView(p, yawKey ?? info.yaw, 0.2);
    await sleep(2500);
    if (await tapWorld(p, info.centre.x, 0.9, info.centre.z)) {
      const pk = await pickInfo(p);
      await sleep(1500);
      await waitIdle(p, 30000);
      await sleep(4000);
      const a = await area(p);
      const me = await pos(p);
      run.check(`${L}: a tap on the door from 16 m away does NOT go in (it walks there: ${r2(Math.hypot(me.x - pad.x, me.z - pad.z))} m from the pad)`, a === "village", { area: a, pick: pk });
      await backOut();
    }
  }
  // a tap on the outer door from near goes in again
  let inBy = { ok: false, tries: [] };
  for (const d of [4, 2.6]) {
    const stand = at(d);
    await walkPlanned(p, stand.x, stand.z, 1.2);
    inBy = await tapDoor(p, [0.8, 1.4].map((y) => ({ x: info.centre.x, y, z: info.centre.z })), yawKey ?? info.yaw, () => waitArea(p, info.area, 25000));
    if (inBy.ok) break;
  }
  run.check(`${L}: a tap on the door goes in`, inBy.ok, inBy.tries);
  if (!inBy.ok) {
    await walkPlanned(p, pad.x, pad.z, 0.8);
    await act(p);
    await waitArea(p, info.area, 120000);
  }
  await settleRoom(p);
  // the exit button leaves
  const ex2 = inAt(0.7);
  await walkPlanned(p, ex2.x, ex2.z, 0.9);
  await sleep(600);
  await act(p);
  const out2 = await waitArea(p, "village", 90000);
  run.check(`${L}: the exit button leaves`, out2, await area(p));
  await sleep(2000);
}

/** The memorial hall: its door is the button's only (no tap on it), both ways. */
async function hall(p, tag) {
  const L = `${tag} hall`;
  const lay = await p.page.evaluate(async () => {
    const m = (await window.__imp("/shared/src/village/villageLayout.ts")).VILLAGE_LAYOUT.memorial;
    return { out: m.exterior.doorPad, in: m.interior.doorPad };
  });
  const stay = (want) => async (what, detail) => {
    await sleep(4500);
    const a = await area(p);
    run.check(`${L}: ${what} does NOT ${want === "village" ? "go in" : "leave"}`, a === want, detail ? { area: a, pick: detail } : a);
  };
  const notIn = stay("village");
  const notOut = stay("hall");
  if (Math.hypot((await pos(p)).x, (await pos(p)).z - 14) > 25) await walkPlanned(p, 0, 14, 2);
  for (const [x, z] of DOOR_ROUTE) await walkAndWait(p, x, z, 40000, 1.2);
  const oc = lay.out.centre;
  // the building is north of its pad (-z)
  await walkPlanned(p, oc.x, oc.z + 3, 1.0);
  const yawKey = await keysToward(p, oc.x, oc.z - 3, [Math.PI, 0], 4500);
  run.check(`${L}: the keys walked at the door`, yawKey !== null, await pos(p));
  await notIn("walking into the door by the keys");
  await walkTo(p, oc.x, oc.z - 3);
  await waitIdle(p, 20000);
  await notIn("a click-walk straight through the door");
  const back = { x: oc.x, z: oc.z + 3.5 };
  await walkPlanned(p, back.x, back.z, 1.0);
  await setView(p, yawKey ?? Math.PI);
  await sleep(2000);
  await groundTaps(p, [["ground on the pad", { x: oc.x, z: oc.z }], ["ground at the door's foot", { x: oc.x, z: oc.z - lay.out.radius - 0.2 }], ["ground beside the door", { x: oc.x + 1.6, z: oc.z - 0.6 }], ["ground 2 m in front of it", { x: oc.x, z: oc.z + 2 }]], back, notIn);
  if (await tapWorld(p, oc.x, 1.3, oc.z - lay.out.radius - 0.6)) await notIn("a tap on the door itself (the hall's door is the button's only)", await pickInfo(p));
  await walkPlanned(p, oc.x, oc.z, 0.8);
  await sleep(IDLE_MS);
  await notIn(`standing at the door ${IDLE_MS / 1000} s`);
  const t = await targets(p);
  run.check(`${L}: the 들어가기 button is offered at the door`, t.some((x) => x.id === "memorial_door"), t);
  await act(p);
  const inside = await waitArea(p, "hall", 30000);
  run.check(`${L}: the button goes in`, inside, await area(p));
  await p.page.waitForFunction(() => !!window.__cvHall, null, { timeout: 90000 }).catch(() => {});
  await sleep(3000);
  // inside: the way out is south of its pad (+z)
  const ic = lay.in.centre;
  await walkPlanned(p, ic.x, ic.z - 2.5, 1.0);
  const yawIn = await keysToward(p, ic.x, ic.z + 3, [0, Math.PI], 4500);
  run.check(`${L}: inside, the keys walked at the way out`, yawIn !== null, await pos(p));
  await notOut("walking into the way out by the keys");
  await walkTo(p, ic.x, ic.z + 3);
  await waitIdle(p, 20000);
  await notOut("a click-walk straight through the way out");
  const backIn = { x: ic.x, z: ic.z - 3 };
  await walkPlanned(p, backIn.x, backIn.z, 1.0);
  await setView(p, yawIn ?? 0);
  await sleep(2000);
  await groundTaps(p, [["floor on the exit pad", { x: ic.x, z: ic.z }], ["floor at the door's foot", { x: ic.x, z: ic.z + lay.in.radius }], ["floor beside the pad", { x: ic.x + 1.2, z: ic.z }]], backIn, notOut);
  if (await tapWorld(p, ic.x, 1.3, ic.z + lay.in.radius + 0.5)) await notOut("a tap on the way out's door itself (the button's only)", await pickInfo(p));
  await walkPlanned(p, ic.x, ic.z - 0.5, 0.6);
  await sleep(IDLE_MS);
  await notOut(`standing at the way out ${IDLE_MS / 1000} s`);
  // the desk's guide may be nearer than the door at some spots: press where the button says 나가기
  let out = false;
  let offered = false;
  for (const dz of [-0.6, 0, 0.5]) {
    await walkPlanned(p, ic.x, ic.z + dz, 0.4);
    await sleep(500);
    const tt = await targets(p);
    if (!tt.some((x) => x.id === "memorial_door")) continue;
    offered = true;
    const label = await p.page.evaluate(() => document.querySelector(".cv-action-btn")?.textContent ?? "");
    if (!/나가기/.test(label)) continue;
    await act(p);
    out = await waitArea(p, "village", 20000);
    if (out) break;
  }
  run.check(`${L}: the 나가기 button is offered at the way out`, offered, null);
  run.check(`${L}: the button leaves`, out, await area(p));
  await sleep(2500);
}

/**
 * A room whose model is slow to come (a phone on a weak network): the visitor is NOT sent back out when the wait runs out (it used to be: 20 s,
 * then the door was used for them). The cover says so and shows a "밖으로 나가기" button. Room 1: left alone, the room comes and the cover opens,
 * still inside. Room 2: the cover's button leaves.
 */
async function slowRooms(p, tag, units) {
  for (const [i, unit] of units.entries()) {
    const L = `${tag} slow ${unit}`;
    const info = await shared(p, `const r = L.LOT_ROOMS.find((x) => x.unit.id === a); const d = L.lotDoorPoint(r.lot, r.door); return { lot: r.lot.id, area: r.area, centre: d.centre, yaw: d.yaw, arrival: d.arrival };`, unit);
    const pad = { x: info.centre.x + Math.sin(info.yaw) * 0.65, z: info.centre.z + Math.cos(info.yaw) * 0.65 };
    // held back from before the walk there (the room's files start coming as its door comes near)
    let held = 0;
    let release;
    const released = new Promise((r) => (release = r));
    const pattern = new RegExp(`/models/village/lots/${unit}[^/]*[.]glb`);
    await p.page.route(pattern, async (route) => {
      held++;
      await released;
      await route.continue().catch(() => {});
    });
    await walkWay(p, info.lot, info.arrival.x, info.arrival.z);
    await walkPlanned(p, pad.x, pad.z, 0.8);
    await act(p);
    const inside = await waitArea(p, info.area, 60000);
    run.check(`${L}: the button goes in (the room's model held back)`, inside && held > 0, { area: await area(p), held });
    // past the 20 s wait: still inside, the cover offers the way out as a button
    const leave = p.page.locator("[data-testid=house-cover-leave]");
    const offered = await leave.waitFor({ state: "visible", timeout: 30000 }).then(() => true, () => false);
    await sleep(3000);
    run.check(`${L}: when the wait runs out the visitor is NOT sent out (still inside), and the cover shows 밖으로 나가기`, offered && (await area(p)) === info.area, { area: await area(p), offered });
    if (i === 0) {
      release();
      const opened = await p.page.waitForFunction(() => document.querySelector(".cv-house-cover")?.getAttribute("data-phase") === "ready", null, { timeout: 120000 }).then(() => true, () => false);
      await sleep(2500);
      run.check(`${L}: the room came after all: the cover opened and the visitor is inside`, opened && (await area(p)) === info.area, await area(p));
      await p.page.unroute(pattern);
      const ex = await shared(p, `const r = L.LOT_ROOMS.find((x) => x.unit.id === a); return { x: L.lotRoomDoor(r).exitPad.x, z: r.origin.z + 0.7 };`, unit);
      await walkPlanned(p, ex.x, ex.z, 0.9);
      await act(p);
      run.check(`${L}: out by the room's own button`, await waitArea(p, "village", 60000), await area(p));
    } else {
      await (p.touch ? leave.tap() : leave.click());
      run.check(`${L}: the cover's 밖으로 나가기 button leaves`, await waitArea(p, "village", 15000), await area(p));
      await sleep(1000);
      release();
      await sleep(500);
      await p.page.unroute(pattern);
    }
    await sleep(3000);
  }
}

async function profile(tag, device) {
  const browser = await launchBrowser();
  try {
    const p = await openPlayer(browser, run, { tag, device, settings: { graphics: tag === "phone" ? "low" : "high" } });
    await joinVillage(p, `na${tag[0]}`, "2026-11-21T12:30");
    await p.page.waitForFunction(() => !!window.__cvLots, null, { timeout: 240000 }).catch(() => {});
    await sleep(3000);
    if (SLOW_ROOMS.length) await run.step(`${tag}: slow rooms`, () => slowRooms(p, tag, SLOW_ROOMS));
    if (HALL) await run.step(`${tag}: memorial hall`, () => hall(p, tag));
    for (const unit of ROOMS) await run.step(`${tag}: ${unit}`, () => oneRoom(p, unit, tag));
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
