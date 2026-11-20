/**
 * e2e/no-auto-enter.mjs — a building is entered / left ONLY on purpose (owner 2026-11-21: "절에 들어가기 버튼 누르지도 않았는데 들어가버리잖아",
 * "나가기버튼을 누르지도 않았는데 나가버리고").
 *
 *   server:  PORT=3021 npx tsx src/index.ts                                                   (server/)
 *   client:  VITE_SERVER_URL=http://localhost:3021 npx vite --port 5621 --strictPort          (client/)
 *   CV_CLIENT_URL=http://localhost:5621 CV_E2E_SLOW=6 node e2e/no-auto-enter.mjs [--only=pc,phone] [--rooms=lot_temple_hall,…] [--idle=30000]
 *
 * For every lot building's room (school, library, chapel, church, temple, café) on a PC (mouse + keys) and a phone (touch), outside:
 *   - walking into the door by the keys never goes in (the button is offered at the door);
 *   - a click-walk straight at / through the door never goes in;
 *   - a real click / tap on the ground in front of, beside and past the door never goes in;
 *   - standing at the door idle never goes in;
 *   - the button (E / the round button) goes in;
 * and inside, the same for the way out (keys into the inner door, a click-walk at it, a click on the floor in front of it, idle at it never
 * leave), then a tap on the inner door leaves, a tap on the outer door goes in again, and the button leaves.
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, r2, sleep, targets, waitIdle, walkTo } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const ONLY = arg("only", "pc,phone").split(",");
const ROOMS = arg("rooms", "lot_school_class,lot_library_reading,lot_chapel_nave,lot_church_nave,lot_temple_hall,lot_cafe_room").split(",");
const IDLE_MS = Number(arg("idle", "30000"));
const GROUND = Number(arg("ground", "9"));
const run = createRun("no-auto-enter");
mkdirSync(run.evidence, { recursive: true });

const shared = (p, code, a) =>
  p.page.evaluate(new Function("a", `return (async () => { const L = await window.__imp("/shared/src/village/villageLots.ts"); ${code} })()`), a);
const area = (p) => p.page.evaluate(() => window.__noArea());
const setYaw = (p, yaw) =>
  p.page.evaluate(async (yaw) => {
    (await window.__imp("/src/game/viewState.ts")).viewState.orbitGoal = { yaw, pitch: 0.35 };
  }, yaw);

async function walkPlanned(p, x, z, tol = 0.8) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const plan = await p.page.evaluate(async ([x, z]) => {
      const cp = await window.__imp("/src/game/clickPlan.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const map = am.getActiveMap();
      const at = window.__cv.getPos();
      const r = cp.planClickMove(at.x, at.z, { x, y: 0, z, ny: 1 }, map.geometry.obstacles, am.mapBounds(map), false, { furniture: map.furniture ?? [] });
      return r.ok ? { ok: true, pts: [...(r.via ?? []), { x: r.x, z: r.z }] } : { ok: false, why: r.reason };
    }, [x, z]);
    if (!plan.ok) return plan.why === "here";
    for (const w of plan.pts) {
      await walkTo(p, w.x, w.z);
      await sleep(300);
      await waitIdle(p, 25000);
    }
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) <= tol) return true;
  }
  return false;
}

async function walkWay(p, lotId, x, z) {
  const start = await pos(p);
  if (Math.hypot(start.x, start.z - 14) > 25) await walkPlanned(p, 0, 14, 2);
  const here = await pos(p);
  const way = await p.page.evaluate(async ([id, x, z]) => { const m = await window.__imp("/src/village/villagePlaces.ts"); return m.wayTo(m.mapPlace(id), x, z); }, [lotId, here.x, here.z]);
  for (const w of way) await walkPlanned(p, w.x, w.z, 1.2);
  return walkPlanned(p, x, z, 0.9);
}

/** A real tap / click on the screen where the world point (x, y, z) shows. */
async function tapWorld(p, x, y, z) {
  const s = await p.page.evaluate(async ([x, y, z]) => {
    const THREE = await window.__imp("/deps/three.js");
    const { camera, gl } = window.__cvThree();
    camera.updateMatrixWorld();
    const v = new THREE.Vector3(x, y, z).project(camera);
    const r = gl.domElement.getBoundingClientRect();
    return { px: r.left + ((v.x + 1) / 2) * r.width, py: r.top + ((1 - v.y) / 2) * r.height, z: v.z, w: window.innerWidth, h: window.innerHeight };
  }, [x, y, z]);
  if (s.z > 1 || s.px < 0 || s.px > s.w || s.py < 0 || s.py > s.h) return false;
  if (p.touch) await p.page.touchscreen.tap(s.px, s.py);
  else await p.page.mouse.click(s.px, s.py);
  return true;
}

/** Hold W for `ms` with the camera yaw tried each way round until "forward" is toward (tx, tz); returns the yaw that worked, or null. */
async function keysToward(p, tx, tz, yaws, ms) {
  for (const yaw of yaws) {
    await setYaw(p, yaw);
    await sleep(1500);
    const a = await pos(p);
    const d0 = Math.hypot(a.x - tx, a.z - tz);
    await p.page.keyboard.down("KeyW");
    await sleep(500);
    await p.page.keyboard.up("KeyW");
    const b = await pos(p);
    if (Math.hypot(b.x - tx, b.z - tz) < d0 - 0.15) {
      await p.page.keyboard.down("KeyW");
      await sleep(ms);
      await p.page.keyboard.up("KeyW");
      await sleep(600);
      return yaw;
    }
    await sleep(300);
  }
  return null;
}

const waitArea = (p, a, ms = 60000) => p.page.waitForFunction((a) => window.__noArea() === a, a, { timeout: ms }).then(() => true, () => false);
async function settleRoom(p) {
  await p.page.waitForFunction(() => document.querySelector(".cv-house-cover")?.getAttribute("data-phase") !== "loading", null, { timeout: 60000 }).catch(() => {});
  await p.page.waitForFunction(() => !!window.__cvLotRoom?.(), null, { timeout: 120000 }).catch(() => {});
  await sleep(2500);
}

async function oneRoom(p, unit, tag) {
  const info = await shared(
    p,
    `const r = L.LOT_ROOMS.find((x) => x.unit.id === a); const d = L.lotDoorPoint(r.lot, r.door); const dd = L.lotRoomDoor(r);
     return { lot: r.lot.id, area: r.area, door: r.door.id, centre: d.centre, yaw: d.yaw, pad: d.pad, arrival: d.arrival, exit: dd.exitPad, origin: r.origin, maxZ: r.bounds.maxZ };`,
    unit,
  );
  const out = { x: Math.sin(info.yaw), z: Math.cos(info.yaw) };
  const along = { x: Math.cos(info.yaw), z: -Math.sin(info.yaw) };
  const at = (o, a = 0) => ({ x: info.centre.x + out.x * o + along.x * a, z: info.centre.z + out.z * o + along.z * a });
  const L = `${tag} ${unit}`;
  const notIn = async (what) => {
    await sleep(4500);
    const a = await area(p);
    run.check(`${L}: ${what} does NOT go in`, a === "village", a);
  };
  const notOut = async (what) => {
    await sleep(4500);
    const a = await area(p);
    run.check(`${L}: ${what} does NOT leave`, a === info.area, a);
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
  const t1 = await targets(p);
  run.check(`${L}: the door offers its 들어가기 button there`, t1.some((x) => x.id === `lotenter:${info.door}`), t1);
  // 2. click-walk at and through the door
  await walkTo(p, info.centre.x - out.x * 1.5, info.centre.z - out.z * 1.5);
  await waitIdle(p, 20000);
  await notIn("a click-walk straight through the door");
  // 3. real clicks on the ground: in front of, beside and past the door (camera behind the visitor, door ahead)
  const back = at(3.5);
  await walkPlanned(p, back.x, back.z, 1.0);
  await setYaw(p, yawKey ?? info.yaw);
  await sleep(2000);
  for (const [name, o, a] of [["just in front of the door", 0.3, 0], ["the door's foot", 0.1, 0.2], ["right at the wall beside it", 0.3, 1.6], ["the pad", 0.65, 0], ["1.5 m in front of it", 1.5, 0]].slice(0, GROUND)) {
    const q = at(o, a);
    const clicked = await tapWorld(p, q.x, 0, q.z);
    if (clicked) {
      await notIn(`a ${p.touch ? "tap" : "click"} on the ground ${name}`);
      await waitIdle(p, 15000);
    } else run.check(`${L}: ground ${name} is on the screen`, false, q);
    const b = at(3.5);
    const nowAt = await pos(p);
    if (Math.hypot(nowAt.x - b.x, nowAt.z - b.z) > 1.5) await walkPlanned(p, b.x, b.z, 1.0);
  }
  // 4. idle at the door
  const pad = at(0.65);
  await walkPlanned(p, pad.x, pad.z, 0.8);
  await sleep(IDLE_MS);
  await notIn(`standing at the door ${IDLE_MS / 1000} s`);
  // 5. the button goes in
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
  await walkTo(p, info.exit.x, O.z - 1.5);
  await waitIdle(p, 20000);
  await notOut("a click-walk straight through the inner door");
  const far = inAt(3.2);
  await walkPlanned(p, far.x, far.z, 1.0);
  await setYaw(p, yawIn ?? Math.PI);
  await sleep(2000);
  for (const [name, dz, dx] of [["just in front of the inner door", 0.4, 0], ["its foot", 0.15, 0.3], ["the exit pad", 0.7, 0], ["1.5 m from it", 1.5, 0]].slice(0, GROUND)) {
    const q = inAt(dz, dx);
    const clicked = await tapWorld(p, q.x, 0, q.z);
    if (clicked) {
      await notOut(`a ${p.touch ? "tap" : "click"} on the floor ${name}`);
      await waitIdle(p, 15000);
    }
    const b = inAt(3.2);
    const nowAt = await pos(p);
    if (Math.hypot(nowAt.x - b.x, nowAt.z - b.z) > 1.5) await walkPlanned(p, b.x, b.z, 1.0);
  }
  const ex = inAt(0.7);
  await walkPlanned(p, ex.x, ex.z, 0.8);
  await sleep(IDLE_MS);
  await notOut(`standing at the inner door ${IDLE_MS / 1000} s`);
  const t3 = await targets(p);
  run.check(`${L}: the exit button is offered at the inner door`, t3.some((x) => x.id.startsWith("lotexit:")), t3);
  // a tap on the inner door itself leaves (from across the room: the door is shut again, an open door is a doorway one sees through)
  const farthest = inAt(Math.max(3.2, Math.min(7, (info.maxZ - O.z) - 1.2)));
  await walkPlanned(p, farthest.x, farthest.z, 1.0);
  await setYaw(p, yawIn ?? Math.PI);
  await sleep(2000);
  const tappedIn = await tapWorld(p, info.exit.x, 1.3, O.z - 0.12);
  run.check(`${L}: the inner door is on the screen`, tappedIn, null);
  const left = await waitArea(p, "village", 90000);
  run.check(`${L}: a tap on the inner door leaves`, left, await area(p));
  if (!left) {
    await walkPlanned(p, ex.x, ex.z, 0.8);
    await act(p);
    await waitArea(p, "village", 60000);
  }
  await sleep(2500);
  // a tap on the outer door goes in again
  const back2 = at(9);
  await walkPlanned(p, back2.x, back2.z, 1.5);
  await setYaw(p, yawKey ?? info.yaw);
  await sleep(5000);
  const tappedOut = await tapWorld(p, info.centre.x, 1.2, info.centre.z);
  run.check(`${L}: the outer door is on the screen`, tappedOut, null);
  const again = await waitArea(p, info.area, 120000);
  run.check(`${L}: a tap on the door goes in`, again, await area(p));
  if (!again) {
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

async function profile(tag, device) {
  const browser = await launchBrowser();
  try {
    const p = await openPlayer(browser, run, { tag, device, settings: { graphics: tag === "phone" ? "low" : "high" } });
    await joinVillage(p, `na${tag[0]}`, "2026-11-21T12:30");
    await p.page.evaluate(async () => {
      window.__noArea = (await window.__imp("/src/village/villageArea.ts")).localArea;
    });
    await p.page.waitForFunction(() => !!window.__cvLots, null, { timeout: 240000 }).catch(() => {});
    await sleep(3000);
    for (const unit of ROOMS) {
      await run.step(`${tag}: ${unit}`, async () => {
        await oneRoom(p, unit, tag);
      });
    }
  } finally {
    await browser.close();
  }
}

try {
  if (ONLY.includes("pc")) await profile("pc", DESKTOP);
  if (ONLY.includes("phone")) await profile("phone", PHONE);
} finally {
  await run.finish?.();
  const failed = run.results.filter((r) => !r.ok);
  console.log(`\n${run.results.length - failed.length}/${run.results.length} checks passed`);
  for (const f of failed) console.log("FAIL", f.step, "-", f.name, JSON.stringify(f.detail)?.slice(0, 300));
  process.exitCode = failed.length ? 1 : 0;
}
