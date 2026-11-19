/**
 * e2e/cam-center.mjs — the follow camera inside a lots room, centred behind the head (owner 2026-11-19: "머리 정 가운데 뒤쪽에서
 * 불상을 바라보고 싶은데 무조건 왼쪽이나 오른쪽으로 이동한 카메라만 가능"). Walks into the room, stands at spots (local room coords)
 * facing the far wall, and shoots the follow camera, PC and phone. Asserts the camera sits on the player's view axis where the wall
 * leaves room (the Buddha straight ahead) and still goes to the side where a wall is right behind the head.
 *
 *   server:  PORT=2992 npx tsx src/index.ts                                         (server/)
 *   client:  VITE_SERVER_URL=http://localhost:2992 npx vite --port 5992 --strictPort   (client/)
 *   CV_CLIENT_URL=http://localhost:5992 node e2e/cam-center.mjs --out=<dir> --tag=after [--only=pc,phone] [--unit=lot_temple_hall]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, pos, press, r2, sleep, targets, waitIdle, walkTo } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const run = createRun("cam-center");
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = arg("out") ?? run.evidence;
const TAG = arg("tag") ?? "after";
mkdirSync(OUT, { recursive: true });
const ONLY = (arg("only") ?? "pc,phone").split(",");
const UNIT = arg("unit") ?? "lot_temple_hall";
// spots in the room's local coords (x from minX, z from minZ): [name, x, z] — the Buddha is at (5.7, 6.4) in the 대웅전
const SPOTS = JSON.parse(arg("spots") ?? '[["cushion",5.7,2.6],["front",5.7,1.6],["wall",5.7,1.0],["mid",5.7,4.0]]');
const numbers = {};

let seq = 0;
async function joinRoom(p) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`cc${++seq}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 10));
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 90000 });
  await p.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 30000 });
  await p.page.waitForFunction(() => !!window.__cvLots, null, { timeout: 180000 });
  await sleep(2500);
}
const shared = (p, code, a) => p.page.evaluate(new Function("a", `return (async () => { const L = await window.__imp("/shared/src/village/villageLots.ts"); ${code} })()`), a);

async function walkWay(p, lotId, x, z) {
  const start = await pos(p);
  if (Math.hypot(start.x, start.z - 14) > 25) await walkPlanned(p, 0, 14, 2);
  const here = await pos(p);
  const way = await p.page.evaluate(async ([id, x, z]) => { const m = await window.__imp("/src/village/villagePlaces.ts"); return m.wayTo(m.mapPlace(id), x, z); }, [lotId, here.x, here.z]);
  for (const w of way) await walkPlanned(p, w.x, w.z, 1.2);
  return walkPlanned(p, x, z, 0.8);
}
async function walkPlanned(p, x, z, tol = 0.5) {
  const t0 = Date.now();
  for (let attempt = 0; attempt < 3 && Date.now() - t0 < 90000; attempt++) {
    const plan = await p.page.evaluate(async ([x, z]) => {
      const cp = await window.__imp("/src/game/clickPlan.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const map = am.getActiveMap();
      const at = window.__cv.getPos();
      const r = cp.planClickMove(at.x, at.z, { x, y: 0, z, ny: 1 }, map.geometry.obstacles, am.mapBounds(map), false, { furniture: map.furniture ?? [] });
      return r.ok ? { ok: true, pts: [...(r.via ?? []), { x: r.x, z: r.z }] } : { ok: false, why: r.reason };
    }, [x, z]);
    if (!plan.ok) return { ok: plan.why === "here", at: await pos(p), why: plan.why };
    for (const w of plan.pts) {
      await walkTo(p, w.x, w.z);
      await sleep(300);
      await waitIdle(p, 20000);
    }
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) <= tol) return { ok: true, at };
  }
  const at = await pos(p);
  return { ok: Math.hypot(at.x - x, at.z - z) <= tol, at };
}

/** The camera's state: spot, how far to the side of the player's view axis, where the Buddha / the head land on screen. */
async function camState(p, face) {
  return p.page.evaluate(async (face) => {
    const { camera } = window.__cvThree();
    const at = window.__cv.getPos();
    const o = window.__cv.getOrbit();
    const fx = face.x - at.x, fz = face.z - at.z;
    const fl = Math.hypot(fx, fz);
    const dx = camera.position.x - at.x, dz = camera.position.z - at.z;
    const along = -(dx * fx + dz * fz) / fl; // how far behind the head along the view axis
    const side = (dx * -fz + dz * fx) / fl; // sideways
    const ndc = (x, y, z) => { const v = camera.position.clone().set(x, y, z).project(camera); return { x: +v.x.toFixed(2), y: +v.y.toFixed(2) }; };
    return { cam: { x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2) }, along: +along.toFixed(2), side: +side.toFixed(2), head: ndc(at.x, 1.45, at.z), target: ndc(face.x, face.y, face.z), orbit: o, fov: camera.fov };
  }, face);
}

async function faceOrbit(p, face) {
  const at = await pos(p);
  const yaw = Math.atan2(-(face.x - at.x), -(face.z - at.z));
  await p.page.evaluate(async (yaw) => {
    (await window.__imp("/src/game/viewState.ts")).viewState.orbitGoal = { yaw, pitch: 0.35 };
  }, yaw);
  await sleep(2600);
}

async function roomShots(p, tag) {
  const info = await shared(
    p,
    `const r = L.LOT_ROOMS.find((x) => x.unit.id === a);
     const d = L.lotDoorPoint(r.lot, r.door);
     const inside = L.lotRoomDoor(r);
     return { lot: r.lot.id, area: r.area, door: r.door.id, pad: d.pad, arrival: d.arrival, inside: inside.arrival, bounds: r.bounds, name: r.lot.name };`,
    UNIT,
  );
  await walkWay(p, info.lot, info.arrival.x, info.arrival.z);
  await walkPlanned(p, info.pad.x, info.pad.z, 0.6);
  await p.page.evaluate(async (yaw) => { (await window.__imp("/src/game/viewState.ts")).viewState.orbitGoal = { yaw, pitch: 0.35 }; }, 0);
  await sleep(1500);
  await act(p);
  const inside = await p.page.waitForFunction((a) => window.__imp("/src/village/villageArea.ts").then((m) => m.localArea() === a), info.area, { timeout: 20000 }).then(() => true, () => false);
  run.check(`${tag}: in the room`, inside);
  await p.page.waitForFunction(() => !!window.__cvLotRoom, null, { timeout: 60000 }).catch(() => {});
  await p.page.waitForFunction(() => document.querySelector(".cv-house-cover")?.getAttribute("data-phase") !== "loading", null, { timeout: 30000 }).catch(() => {});
  await sleep(2500);
  const b = info.bounds;
  const temple = UNIT === "lot_temple_hall";
  const face = temple ? { x: b.minX + 5.7, y: 2.4, z: b.minZ + 6.4 } : { x: (b.minX + b.maxX) / 2, y: 1.5, z: (b.minZ + b.maxZ) / 2 }; // the 본존불 / the room's middle
  // other rooms: just inside the door (the wall right behind), and a step in; local coords from the arrival spot
  const spots = temple ? SPOTS : [["arrival", info.inside.x - b.minX, info.inside.z - b.minZ], ["step", info.inside.x - b.minX + (face.x - info.inside.x) * 0.25, info.inside.z - b.minZ + (face.z - info.inside.z) * 0.25]];
  for (const [name, lx, lz] of spots) {
    const w = await walkPlanned(p, b.minX + lx, b.minZ + lz, 0.6);
    await sleep(400);
    await faceOrbit(p, face);
    await sleep(1200);
    const st = await camState(p, face);
    numbers[`${tag}_${name}`] = { spot: r2(lx) + "," + r2(lz), ...st, at: w.at };
    console.log(`   ${tag} ${name}: ${JSON.stringify(numbers[`${tag}_${name}`])}`);
    await p.page.screenshot({ path: join(OUT, `${TAG}_${tag}_${UNIT.replace(/^lot_/, "")}_${name}.png`) });
  }
}

const browser = await launchBrowser();
try {
  for (const dev of ONLY) {
    const p = await openPlayer(browser, run, { tag: dev, device: dev === "phone" ? PHONE : DESKTOP });
    await joinRoom(p);
    await run.step(`${dev}: ${UNIT}`, () => roomShots(p, dev));
    await p.ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `${TAG}_numbers.json`), JSON.stringify(numbers, null, 2));
process.exit(run.finish({ numbers }));
