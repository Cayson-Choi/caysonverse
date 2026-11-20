/**
 * e2e/window-view-shots.mjs — side-by-side evidence for the rooms' windows (client/src/village/lots/windowView.ts):
 *  (a) inside the room, the photo camera looking out of a window; (b) the same eye and direction in the real village, the
 *  building's own walls clipped away (the wall as glass): day and night. One room a run.
 *   CV_CLIENT_URL=http://localhost:5495 CV_E2E_SLOW=6 node e2e/window-view-shots.mjs --room=lot_school_class --out=<dir>
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, createRun, launchBrowser, openPlayer, pos, sleep } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const ROOM = opt("room", "lot_school_class");
const OUT = opt("out", "window-view-shots");
const DATE = "2026-11-16";
const TIMES = { day: "12:30", night: "22:30" };
mkdirSync(OUT, { recursive: true });

/** Views in the room's frame: [eye x, y, z, target x, y, z, fov]. */
const VIEWS = {
  lot_school_class: {
    back: [7.7, 1.6, 4.2, 7.7, 1.7, 7.4, 60], // the three sunny back windows
    right: [11.2, 1.6, 5.0, 15.4, 1.8, 5.0, 60], // the wide pair on the right wall
    clerestory: [4.0, 1.5, 3.6, 4.0, 2.8, -0.3, 60], // over the lockers, toward the yard
  },
  lot_library_reading: {
    bay: [2.6, 1.55, 4.2, 2.6, 1.3, -0.6, 60], // the left bay window nook
    bay_r: [10.8, 1.55, 4.2, 10.8, 1.3, -0.6, 60],
    tall: [9.4, 1.6, 1.6, 13.4, 1.9, 1.5, 60], // the tall window on the right wall
    clerestory: [4.0, 1.6, 6.0, 0.0, 4.3, 7.0, 60], // the arched clerestories on the left wall
  },
}[ROOM];

const run = createRun("window-view-shots");
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: "pc", device: DESKTOP, settings: { graphics: "high" } });
const until = async (fn, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(200);
  }
  return false;
};
async function goTo(x, z, tol = 0.8) {
  for (let a = 0; a < 4; a++) {
    await P.page.evaluate(async ([x, z]) => {
      const plan = await window.__imp("/src/game/clickPlan.ts");
      const move = await window.__imp("/src/game/clickMove.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const at = window.__cv.getPos();
      const via = plan.findDetour(at.x, at.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
      move.setClickTarget(x, z, 0, via ?? undefined);
    }, [x, z]);
    await sleep(400);
    await until(async () => (await P.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 120000);
    const at = await pos(P);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(P);
}
async function setTime(hhmm) {
  await P.page.evaluate(async (t) => {
    const { villageClock, pinFromSearch } = await window.__imp("/src/village/villageClock.ts");
    villageClock.pin(pinFromSearch("?time=" + t));
    (await window.__imp("/src/village/dayNightDriver.ts")).dayNight.reset();
  }, `${DATE}T${hhmm}`);
}
async function shot(name, s, wait = 2500) {
  await P.page.evaluate((s) => (window.__cvShot = { x: s[0], y: s[1], z: s[2], tx: s[3], ty: s[4], tz: s[5], fov: s[6] }), s);
  await sleep(wait);
  await P.page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`progress: ${name}`);
}

try {
  await joinVillage(P, "창비교", `${DATE}T12:30`);
  await P.page.waitForFunction(() => !!window.__cvThree && !!window.__cvLots?.()?.ready, null, { timeout: 180000 });
  const info = await P.page.evaluate(async (unit) => {
    const L = await window.__imp("/shared/src/village/villageLots.ts");
    const W = await window.__imp("/src/village/lots/windowView.ts");
    const room = L.LOT_ROOMS.find((r) => r.unit.id === unit);
    const d = L.lotDoorPoint(room.lot, room.door);
    return { frame: W.windowViewFrame(room), pad: d.pad, area: room.area, origin: room.origin };
  }, ROOM);
  const { m, t, clip } = info.frame;
  const toVillage = (x, z) => [m[0] * x + m[1] * z + t[0], m[2] * x + m[3] * z + t[1]];
  await goTo(info.pad.x, info.pad.z);
  // (b) outside: the same eye and direction in the village, the building's walls and roof clipped away
  await P.page.addStyleTag({ content: "body * {visibility:hidden!important} body canvas {visibility:visible!important}" });
  await P.page.evaluate(async (clip) => {
    const THREE = await window.__imp("/deps/three.js");
    const { scene, gl } = window.__cvThree();
    gl.localClippingEnabled = true;
    const box = new THREE.Box3(new THREE.Vector3(...clip.min), new THREE.Vector3(...clip.max));
    const planes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -box.max.x), new THREE.Plane(new THREE.Vector3(-1, 0, 0), box.min.x),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -box.max.y), new THREE.Plane(new THREE.Vector3(0, -1, 0), box.min.y),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -box.max.z), new THREE.Plane(new THREE.Vector3(0, 0, -1), box.min.z),
    ];
    const tmp = new THREE.Box3();
    const touched = new Map(), hidden = [];
    scene.traverse((o) => {
      if (o.isSkinnedMesh) {
        if (o.visible) hidden.push(o);
        return;
      }
      if (!o.isMesh) return;
      tmp.setFromObject(o);
      if (tmp.isEmpty() || !tmp.intersectsBox(box)) return;
      for (const mt of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!mt || touched.has(mt) || (mt.isShaderMaterial && !mt.clipping)) continue;
        touched.set(mt, [mt.clippingPlanes, mt.clipIntersection]);
        mt.clippingPlanes = planes;
        mt.clipIntersection = true;
        mt.needsUpdate = true;
      }
    });
    for (const o of hidden) o.visible = false;
    window.__wvRestore = () => {
      for (const [mt, [p, i]] of touched) {
        mt.clippingPlanes = p;
        mt.clipIntersection = i;
        mt.needsUpdate = true;
      }
      for (const o of hidden) o.visible = true;
    };
  }, clip);
  for (const [key, time] of Object.entries(TIMES)) {
    await setTime(time);
    await sleep(2500);
    for (const [name, v] of Object.entries(VIEWS)) {
      const [ex, ez] = toVillage(v[0], v[2]), [tx, tz] = toVillage(v[3], v[5]);
      await shot(`${ROOM}_${name}_${key}_b_outside`, [ex, v[1], ez, tx, v[4], tz, v[6]], name === Object.keys(VIEWS)[0] ? 6000 : 2500);
    }
  }
  await P.page.evaluate(() => {
    window.__wvRestore();
    window.__cvShot = null;
  });
  await setTime(TIMES.day);
  await sleep(1500);
  // (a) inside: through the door, then the same views in the room's frame
  await act(P);
  const inside = await P.page.waitForFunction(async (area) => (await window.__imp("/src/village/villageArea.ts")).localArea() === area, info.area, { timeout: 30000 }).then(() => true, () => false);
  run.check(`in ${ROOM}`, inside);
  await P.page.waitForFunction(() => !!window.__cvLotRoom, null, { timeout: 90000 }).catch(() => {});
  await P.page.waitForFunction(() => document.querySelector(".cv-house-cover")?.getAttribute("data-phase") !== "loading", null, { timeout: 60000 }).catch(() => {});
  await sleep(4000);
  for (const [key, time] of Object.entries(TIMES)) {
    await setTime(time);
    await sleep(2500);
    for (const [name, v] of Object.entries(VIEWS)) {
      const o = info.origin;
      await shot(`${ROOM}_${name}_${key}_a_inside`, [o.x + v[0], v[1], o.z + v[2], o.x + v[3], v[4], o.z + v[5], v[6]], 2500);
    }
  }
  const errs = run.errors.filter((e) => !/THREE\.Clock/.test(JSON.stringify(e)));
  if (errs.length) console.log(`console/page errors: ${JSON.stringify(errs.slice(0, 8), null, 1)}`);
} finally {
  await browser.close();
}
process.exit(0);
