/**
 * e2e/bus-controls.mjs — the owner's bus control complaints of 2026-11-18 (docs/designs/bus-controls.md), proven in the game:
 *   1. "버스안에서 … 카메라의 각도를 올리고 내리고 하는게 잘 안돼 바닥을 더 보고 싶은데": in the bus a drag tilts the view all the way
 *      down to the floor (about 80 degrees) and up to the ceiling, in first AND third person;
 *   2. "1인칭뷰가 아닐때 … 카메라 각도 바꾸고 이동하는 것도 어렵다": third person in the bus is an over-the-shoulder view — the
 *      lens never sits in the avatar's head, the avatar never fills the screen, the tilt follows the drag, W walks where the view looks;
 *   3. "정류장에서 줌인을 하다보면 … 캐릭터 내부까지 들어가": at the bus stop (the parked bus behind: a wall for the spring arm) the
 *      zoomed-in camera never shows the inside of the head — closer than 0.6 m to the head the body is hidden;
 *   4. walking in the aisle is reliable: the keys (PC) or the stick (phone) walk it end to end, and a tap / click on the aisle floor
 *      walks there.
 * One rider (PC 1280x800, or --phone: 375x812 touch). `--before` records the same numbers and screenshots without the checks of
 * the new rules (the "before" pictures of the old build).
 *
 *   OFF=$(node -e 'const n=Date.now()+240000,s=Math.ceil(n/600000)*600000;console.log(s-n)')
 *   (cd server && CV_DEV_CLOCK_OFFSET_MS=$OFF PORT=3002 npx tsx src/index.ts)
 *   (cd client && VITE_SERVER_URL=http://localhost:3002 npx vite --port 6002 --strictPort)
 *   CV_CLIENT_URL=http://localhost:6002 node e2e/bus-controls.mjs --out=<folder> [--phone] [--before]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, touchDown, touchMoveTo, touchUp, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage, NOON } from "./lib/village.mjs";

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const phone = process.argv.includes("--phone");
const before = process.argv.includes("--before");
/** Only the bus stop (the zoomed-in camera against the parked bus): for a "before" picture of it alone. */
const busstopOnly = process.argv.includes("--busstop-only");
const tag = `${phone ? "phone" : "pc"}-${before ? "before" : "after"}`;
const run = createRun(`bus-controls-${tag}`);
const OUT = arg("out", run.evidence);
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const A = await openPlayer(browser, run, { tag: `A-${tag}`, device: phone ? PHONE : DESKTOP });
const shot = (name) => A.page.screenshot({ path: join(OUT, `${tag}-${name}.png`) });
/** A check of the new rules: recorded in both modes, enforced only after. */
const rule = (label, ok, detail) => (before ? console.log(`INFO  ${label} -> ${ok ? "ok" : "NOT MET"}  ${JSON.stringify(detail).slice(0, 300)}`) : run.check(label, ok, detail));
const numbers = {};
/**
 * The avatar's clipped bounding box may fill at most this share of the screen (a body is a larger share of a narrow portrait screen),
 * and its head at most HEAD_MAX of the screen's height (the owner's screenshot: the head filled half of it).
 */
const MAX_SHARE = phone ? 0.5 : 0.36;
const HEAD_MAX = phone ? 0.35 : 0.4;

async function pollUntil(fn, ms, step = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}
const status = () => A.page.evaluate(async () => { const s = await window.__imp("/src/net/transitSync.ts"); return s.transitTripAt(s.transitNowMs()).status; });
const ride = () =>
  A.page.evaluate(async () => {
    const m = await window.__imp("/src/game/busRide.ts");
    const v = (await window.__imp("/src/game/viewState.ts")).viewState;
    return { slot: m.selfBusRide.slot, walk: { ahead: m.busWalk.ahead, right: m.busWalk.right, valid: m.busWalk.valid }, fp: m.busCamState.firstPerson, arm: m.busCamState.arm, mode: v.mode, fpYaw: v.fpYaw, fpPitch: v.fpPitch, orbit: { ...window.__cv.getOrbit() } };
  });

/**
 * The camera against the own avatar: the head box (the top 1.1 m of the avatar's height, 1.1 m across round its middle: the chibi
 * head and crown), the
 * camera's distance to it (0 inside), whether the body is drawn, the camera's look pitch (deg, + = down), the avatar's share of the
 * screen (its clipped bounding box) and the share of the screen that is floor.
 */
const camInfo = (withFloor = false) =>
  A.page.evaluate(async (withFloor) => {
    const three = await import(/* @vite-ignore */ performance.getEntriesByType("resource").map((r) => r.name).find((n) => n.split("?")[0].endsWith("/deps/three.js")));
    const { scene, camera } = window.__cvThree();
    const g = window.__cvSelfGroup?.();
    camera.updateMatrixWorld();
    const box = new three.Box3();
    let drawn = !!g && g.visible;
    let faded = false;
    if (g) {
      g.updateMatrixWorld(true);
      g.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (mats.some((m) => m && m.opacity < 0.99)) faded = true;
      });
      for (let p = g.parent; p; p = p.parent) if (!p.visible) drawn = false;
      // a skinned mesh's bounding box is its bind pose (arms spread): only its height is kept; across, the chibi is its 1 m head
      const at = new three.Vector3();
      g.getWorldPosition(at);
      box.min.x = at.x - 0.55;
      box.max.x = at.x + 0.55;
      box.min.z = at.z - 0.55;
      box.max.z = at.z + 0.55;
    }
    const head = box.clone();
    head.min.y = Math.max(box.min.y, box.max.y - 1.1);
    const cam = camera.position.clone();
    const headDist = box.isEmpty() ? null : head.distanceToPoint(cam);
    const dir = new three.Vector3();
    camera.getWorldDirection(dir);
    const pitchDeg = (Math.asin(-dir.y) * 180) / Math.PI;
    // the avatar's share of the screen (only when drawn)
    let share = 0;
    let headH = 0;
    if (g && drawn) {
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const v = new three.Vector3(x, y, z).project(camera);
        if (v.z > 1) continue;
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      const cl = (v) => Math.max(-1, Math.min(1, v));
      share = (Math.max(0, cl(x1) - cl(x0)) * Math.max(0, cl(y1) - cl(y0))) / 4;
      // the head's share of the screen's height (the owner: "the head fills half the screen"): the chibi head as a 1.1 m ball under
      // the avatar's top, its angular size against the lens's vertical field of view
      const hc = new three.Vector3((box.min.x + box.max.x) / 2, box.max.y - 0.55, (box.min.z + box.max.z) / 2);
      const d = hc.distanceTo(cam);
      const half = Math.tan(((camera.fov / 2) * Math.PI) / 180);
      headH = d <= 0.55 ? 1 : Math.min(1, Math.tan(Math.asin(0.55 / d)) / half);
    }
    // the share of a ray grid that meets an upward-facing surface below the avatar's knees (the floor)
    const rc = new three.Raycaster();
    rc.far = 12;
    let floorHits = 0;
    let n = 0;
    const skip = (o) => { for (let p = o; p; p = p.parent) if (p === g || p.visible === false) return true; return false; };
    if (withFloor) for (let ix = -0.8; ix <= 0.81; ix += 0.4) for (let iy = -0.8; iy <= 0.81; iy += 0.4) {
      rc.setFromCamera({ x: ix, y: iy }, camera);
      const hit = rc.intersectObjects(scene.children, true).find((h) => h.object.isMesh && !skip(h.object));
      n++;
      if (hit && hit.face && hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y > 0.8 && hit.point.y < box.min.y + 0.4) floorHits++;
    }
    const r = (v) => Math.round(v * 100) / 100;
    return {
      cam: [cam.x, cam.y, cam.z].map(r),
      headTop: r(box.max.y),
      headDist: headDist === null ? null : r(headDist),
      drawn,
      // true first person (fpBody.ts): the body is drawn from the neck down, its head shrunk away: no head in the lens
      headless: !!(await window.__imp("/src/game/fpBody.ts")).fpBody.active,
      faded,
      pitchDeg: r(pitchDeg),
      share: r(share),
      headH: r(headH),
      floor: n ? r(floorHits / n) : null,
    };
  }, withFloor);

/**
 * One look drag: mouse on a PC, one finger on the phone's look half. dy > 0 drags down the screen. The game's drag is "grab the
 * world" (DRAG_SIGN): a drag UP the screen tilts the view DOWN.
 */
async function drag(dx, dy, steps = 10) {
  const vp = A.page.viewportSize();
  const x0 = phone ? vp.width * 0.78 : vp.width / 2;
  const y0 = vp.height * (phone ? 0.42 : 0.5);
  if (phone) {
    await touchDown(A, x0, y0);
    for (let s = 1; s <= steps; s++) { await touchMoveTo(A, x0 + (dx * s) / steps, y0 + (dy * s) / steps); await sleep(16); }
    await touchUp(A);
  } else {
    await A.page.mouse.move(x0, y0);
    await A.page.mouse.down();
    for (let s = 1; s <= steps; s++) { await A.page.mouse.move(x0 + (dx * s) / steps, y0 + (dy * s) / steps); await sleep(16); }
    await A.page.mouse.up();
  }
  await sleep(350);
}
async function toggleV() {
  if (phone) await A.page.getByRole("button", { name: "1인칭/3인칭 전환" }).first().tap();
  else await A.page.keyboard.press("KeyV");
  await sleep(700);
}
async function quickView(name) {
  const b = A.page.locator(`[data-testid=bus-ride-views] button[data-view=${name}]`).first();
  if (phone) await b.tap();
  else await b.click();
  await sleep(1100);
}
/** Hold a walk for `ms`: W on a PC, the stick pushed up on the phone (its zone is the lower left). */
async function holdForward(ms, back = false) {
  if (phone) {
    const vp = A.page.viewportSize();
    const x = vp.width * 0.22;
    const y = vp.height * 0.8;
    await touchDown(A, x, y);
    for (let s = 1; s <= 6; s++) { await touchMoveTo(A, x, y + (back ? 1 : -1) * s * 10); await sleep(16); }
    await sleep(ms);
    await touchUp(A);
  } else {
    const key = back ? "KeyS" : "KeyW";
    await A.page.keyboard.down(key);
    await sleep(ms);
    await A.page.keyboard.up(key);
  }
  await sleep(400);
}

await run.step("join, walk to the bus stop", async () => {
  await joinVillage(A, "버스", NOON);
  await pollUntil(() => A.page.evaluate(async () => (await window.__imp("/src/net/transitSync.ts")).getTransitState().snapshot !== null), 30000);
  await walkAndWait(A, 38.5, -0.5, 40000, 1);
  for (let k = 0; k < 3; k++) {
    await walkAndWait(A, 37.2, -7.0, 30000, 0.5);
    const at = await A.page.evaluate(() => window.__cv.getPos());
    if (Math.hypot(at.x - 37.2, at.z + 7.0) < 0.8) break;
    await walkAndWait(A, 38.3, -4.6, 20000, 0.6);
  }
  const at = await A.page.evaluate(() => window.__cv.getPos());
  run.check("at the bus stop, beside the parked bus", Math.hypot(at.x - 37.2, at.z + 7.0) < 0.8, at);
  const st = await status();
  run.check("the bus is parked at the stop", st === "atStop" || st === "boarding", st);
});

await run.step("3. the bus stop: the zoomed-in camera never shows the inside of the head", async () => {
  // the parked bus is right by the stop: a wall for the spring arm. Zoom all the way in (the third person's least distance) and turn
  // the camera round, at a low, a middle and a high tilt.
  const at = await A.page.evaluate(() => window.__cv.getPos());
  const rows = [];
  let worst = null;
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [0.7, -0.7], [-0.7, 0.7]]) {
    await turnCameraTo(A, at.x + dx * 10, at.z + dz * 10);
    for (const pitch of [0.05, 0.5, 1.1]) {
      await A.page.evaluate((pitch) => { const o = window.__cvOrbitLive(); o.distance = 3.2; o.pitch = pitch; }, pitch);
      await sleep(900);
      const c = await camInfo();
      const o = await A.page.evaluate(() => ({ ...window.__cv.getOrbit(), mode: window.__cv.getView().mode }));
      const row = { dir: [dx, dz], pitch, yaw: Math.round(o.yaw * 100) / 100, mode: o.mode, ...c };
      rows.push(row);
      if (c.headDist !== null && (worst === null || (c.drawn && c.headDist < worst.headDist) || (!worst.drawn && c.drawn))) {
        worst = row;
        await shot("busstop-zoomed-worst");
      }
    }
  }
  numbers.busstop = rows;
  const bad = rows.filter((r) => r.drawn && !r.headless && r.headDist !== null && r.headDist < 0.6);
  console.log("bus stop samples", JSON.stringify(rows.map((r) => [r.dir, r.pitch, r.headDist, r.drawn])));
  rule("bus stop: in no zoomed-in view is the drawn head nearer than 0.6 m to the camera", bad.length === 0, { bad, worst });
  // a zoom-in by the real input as well: the wheel on a PC (a pinch on the phone goes through the same applyZoom)
  if (!phone) {
    const vp = A.page.viewportSize();
    await A.page.mouse.move(vp.width / 2, vp.height / 2);
    for (let i = 0; i < 6; i++) { await A.page.mouse.wheel(0, -120); await sleep(120); }
    await sleep(900);
    const c = await camInfo();
    rule("bus stop, the wheel all the way in: the head is hidden or 0.6 m+ away", !c.drawn || c.headless || c.headDist >= 0.6, c);
    await shot("busstop-wheel-in");
    for (let i = 0; i < 6; i++) { await A.page.mouse.wheel(0, 300); await sleep(100); }
  }
  await A.page.evaluate(() => { const o = window.__cvOrbitLive(); o.distance = 6; o.pitch = 0.35; });
  await sleep(600);
});

if (busstopOnly) {
  writeFileSync(join(OUT, `${tag}-busstop-numbers.json`), JSON.stringify(numbers, null, 2));
  await browser.close();
  process.exit(run.finish({ tag }));
}

await run.step("board the bus", async () => {
  await walkAndWait(A, 37.7, -8.9, 30000, 0.5);
  run.check("boarding opens", await pollUntil(async () => (await status()) === "boarding", 420000, 500), await status());
  await sleep(600);
  let aboard = false;
  for (let k = 0; k < 4 && !aboard; k++) {
    if (k > 0) await walkAndWait(A, 37.7, -8.9, 20000, 0.4);
    await act(A).catch(() => {});
    aboard = await pollUntil(async () => (await ride()).slot === 0, 5000);
  }
  run.check("aboard and free in the aisle", aboard, await ride());
  await sleep(1400);
  const r = await ride();
  run.check("boarding starts in first person", r.mode === "fp" && r.fp === true, r);
  await shot("1-board-fp");
});

await run.step("1. first person: a drag tilts down to the floor and up to the ceiling", async () => {
  await quickView("front");
  for (let i = 0; i < 4; i++) await drag(0, -(phone ? 160 : 220));
  const down = await camInfo(true);
  const rd = await ride();
  numbers.fpDown = { ...down, fpPitch: rd.fpPitch };
  await shot("2-fp-look-down");
  rule("first person: dragged down, the view looks 75 deg+ down", down.pitchDeg >= 75, { ...down, fpPitch: rd.fpPitch });
  rule("first person: looking down, the floor fills a good part of the screen", down.floor >= 0.15, down);
  for (let i = 0; i < 8; i++) await drag(0, phone ? 160 : 220);
  const up = await camInfo();
  numbers.fpUp = up;
  await shot("3-fp-look-up");
  rule("first person: dragged up, the view looks 45 deg+ up (the ceiling)", up.pitchDeg <= -45, up);
  // back to a comfortable aim (a little down the aisle) before the third person takes it over
  await A.page.evaluate(async () => { (await window.__imp("/src/game/viewState.ts")).viewState.fpPitch = 0.3; });
  await sleep(300);
});

await run.step("2. third person: over the shoulder, the tilt follows the drag, never in the head", async () => {
  await quickView("front");
  await toggleV();
  let r = await ride();
  run.check("V / the eye button gives the third person", r.mode === "tp", r);
  await sleep(500);
  const def = await camInfo();
  numbers.tpDefault = { ...def, arm: r.arm };
  await shot("4-tp-default");
  rule("third person (front): the avatar is drawn, the lens 0.6 m+ from the head", def.drawn && def.headDist >= 0.6, def);
  rule(`third person (front): the avatar fills at most ${MAX_SHARE * 100}% of the screen (its clipped bounding box), its head at most ${HEAD_MAX * 100}% of the height`, def.share <= MAX_SHARE && def.headH <= HEAD_MAX, def);
  const tilts = [];
  for (let i = 0; i < 5; i++) {
    await drag(0, -(phone ? 160 : 220));
    tilts.push(await camInfo());
  }
  const down = await camInfo(true);
  numbers.tpDown = tilts;
  await shot("5-tp-look-down");
  rule("third person: dragged down, the view tilts with it to 70 deg+ down", down.pitchDeg >= 70, tilts.map((t) => t.pitchDeg));
  rule("third person: looking down, the floor fills a good part of the screen", down.floor >= 0.15, down);
  rule("third person: looking down, the head is never in the lens (hidden or 0.6 m+)", tilts.every((t) => !t.drawn || t.headDist >= 0.6), tilts);
  const ups = [];
  for (let i = 0; i < 8; i++) {
    await drag(0, phone ? 160 : 220);
    ups.push(await camInfo());
  }
  numbers.tpUp = ups;
  await shot("6-tp-look-up");
  rule("third person: dragged up, the view tilts up 30 deg+ (the ceiling)", ups[ups.length - 1].pitchDeg <= -30, ups.map((t) => t.pitchDeg));
  rule("third person: looking up, the head is never in the lens", ups.every((t) => !t.drawn || t.headDist >= 0.6), ups);
  await A.page.evaluate(() => { window.__cvOrbitLive().pitch = 0.3; }); // back to a comfortable tilt
  await sleep(300);
  // every quick view and a turn by drag: never inside the head
  const views = [];
  for (const v of ["left", "right", "back", "front"]) {
    await quickView(v);
    const c = await camInfo();
    views.push({ v, ...c });
    await shot(`7-tp-${v}`);
  }
  let worstTurn = -1;
  for (let k = 0; k < 8; k++) {
    await drag(phone ? 90 : 120, 0, 6);
    const c = await camInfo();
    views.push({ v: `drag${k}`, ...c });
    // the turn where the drawn body is biggest on the screen: the owner's "the head fills half the screen", if it happens
    if (c.drawn && c.share > worstTurn) {
      worstTurn = c.share;
      await shot("7-tp-turn-biggest");
    }
  }
  numbers.tpViews = views;
  rule("third person, every view and a full turn: the drawn head is never nearer than 0.6 m", views.every((c) => !c.drawn || c.headDist >= 0.6), views);
  rule(`third person, every view: the avatar fills at most ${MAX_SHARE * 100}% of the screen, its head at most ${HEAD_MAX * 100}% of the height`, views.every((c) => c.share <= MAX_SHARE && c.headH <= HEAD_MAX), views.map((c) => [c.v, c.share, c.headH]));
  // the zoom all the way in (to the third person's least distance): never in the head either
  await quickView("front");
  await A.page.evaluate(() => { const o = window.__cvOrbitLive(); o.distance = 3.2; });
  await sleep(700);
  const near = await camInfo();
  numbers.tpNear = near;
  await shot("8-tp-zoomed-in");
  rule("third person zoomed in: the head is hidden or 0.6 m+ away", !near.drawn || near.headDist >= 0.6, near);
  await A.page.evaluate(() => { const o = window.__cvOrbitLive(); o.distance = 6; });
  await sleep(500);
});

await run.step("4. walking the aisle: the keys / the stick go where the view looks", async () => {
  // boarding puts the rider by the front door: down the aisle to the back first, then back up to the front
  await quickView("back");
  const b0 = (await ride()).walk;
  await holdForward(3200);
  const b1 = (await ride()).walk;
  await shot("9-tp-walked-back");
  rule("third person, looking to the back: W / the stick walks down the aisle to the back (2 m+)", b0.ahead - b1.ahead >= 2, { b0, b1 });
  rule("…and stays in the aisle (not in a seat or a wall)", Math.abs(b1.right) < 0.5, b1);
  await quickView("front");
  const a0 = (await ride()).walk;
  await holdForward(3200);
  const a1 = (await ride()).walk;
  rule("third person, looking to the front: W / the stick walks toward the front (+1.5 m)", a1.ahead - a0.ahead >= 1.5, { a0, a1 });
  // looking a little off the aisle's line (a drag of ~25 deg): the walk still runs down the aisle (it slides along the seats)
  await drag(phone ? 70 : 90, 0, 6);
  const c0 = (await ride()).walk;
  await holdForward(1800, true);
  const c1 = (await ride()).walk;
  numbers.walk = { a0, a1, b0, b1, c0, c1 };
  rule("looking off the aisle's line, S / the stick back still walks along the aisle (1 m+)", Math.abs(c1.ahead - c0.ahead) >= 1, { c0, c1 });
  // first person too (the ride panel's own toggle button, new: docs/designs/bus-controls.md)
  const toggle = A.page.locator("[data-testid=bus-ride-view-toggle]");
  if (!before) {
    run.check("the ride panel has the 1인칭 / 3인칭 button", (await toggle.count()) === 1 && /1인칭/.test(await toggle.textContent()), await toggle.count());
    if (phone) await toggle.tap();
    else await toggle.click();
    await sleep(700);
    run.check("the panel button gives the first person", (await ride()).mode === "fp", await ride());
  } else await toggleV();
  await quickView("front");
  const d0 = (await ride()).walk;
  await holdForward(1600);
  const d1 = (await ride()).walk;
  numbers.walk.fp = { d0, d1 };
  rule("first person: W / the stick walks toward the front (+0.8 m)", d1.ahead - d0.ahead >= 0.8, { d0, d1 });
});

await run.step("4b. a tap / click on the aisle floor walks there", async () => {
  // in first person, look a little down the aisle to the back and tap the floor about 2 m away
  await quickView("back");
  await drag(0, -(phone ? 80 : 110));
  const w0 = (await ride()).walk;
  const pt = await A.page.evaluate(async () => {
    const three = await import(/* @vite-ignore */ performance.getEntriesByType("resource").map((r) => r.name).find((n) => n.split("?")[0].endsWith("/deps/three.js")));
    const { camera } = window.__cvThree();
    const sync = await window.__imp("/src/net/transitSync.ts");
    const c = await window.__imp("/shared/src/village/busCabin.ts");
    const w = (await window.__imp("/src/game/busRide.ts")).busWalk;
    const bus = sync.getTransitRenderPose();
    const a = w.ahead - 2.0;
    const fx = Math.sin(bus.yaw), fz = Math.cos(bus.yaw);
    const v = new three.Vector3(bus.x + fx * a, c.cabinFloorAt(a, 0), bus.z + fz * a).project(camera);
    const rect = document.querySelector("canvas").getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, want: a, on: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1 };
  });
  if (phone) {
    await touchDown(A, pt.x, pt.y);
    await sleep(60);
    await touchUp(A);
  } else {
    await A.page.mouse.click(pt.x, pt.y);
  }
  await pollUntil(async () => Math.abs((await ride()).walk.ahead - pt.want) < 0.35, 6000);
  const w1 = (await ride()).walk;
  numbers.tapWalk = { pt, w0, w1 };
  await shot("10-tap-walked");
  rule("a tap / click on the aisle floor 2 m away walks the rider there (within 0.35 m)", pt.on && Math.abs(w1.ahead - pt.want) < 0.35, { pt, w0, w1 });
});

await run.step("seated: third person over the shoulder, look down", async () => {
  const spot = await A.page.evaluate(async () => {
    const c = await window.__imp("/shared/src/village/busCabin.ts");
    const i = c.BUS_SEATS.findIndex((s) => s.id === "L2");
    const ap = c.seatApproachPoint(c.BUS_SEATS[i]);
    return { a: ap.ahead, r: ap.right, i };
  });
  // walk there with the keys from the front view (W = +ahead, D = +right)
  await quickView("front");
  const t0 = Date.now();
  let held = null;
  while (Date.now() - t0 < 14000) {
    const w = (await ride()).walk;
    const da = spot.a - w.ahead;
    const dr = spot.r - w.right;
    if (Math.hypot(da, dr) < 0.15) break;
    const key = Math.abs(da) > Math.abs(dr) ? (da > 0 ? "KeyW" : "KeyS") : dr > 0 ? "KeyD" : "KeyA";
    if (key !== held) {
      if (held) await A.page.keyboard.up(held);
      await A.page.keyboard.down(key);
      held = key;
    }
    await sleep(80);
  }
  if (held) await A.page.keyboard.up(held);
  await sleep(400);
  await act(A);
  const sat = await pollUntil(async () => (await ride()).slot > 0, 5000);
  run.check("seated in L2", sat, await ride());
  await sleep(900);
  const r = await ride();
  if (r.mode === "fp") await toggleV();
  // the aim came over from first person (looking down at the floor for the tap): back to a comfortable tilt first
  await A.page.evaluate(() => { window.__cvOrbitLive().pitch = 0.3; });
  await quickView("front");
  const c = await camInfo();
  numbers.seatedTp = c;
  await shot("11-seated-tp");
  rule(`seated, third person: the avatar is drawn, 0.6 m+ from the lens, at most ${MAX_SHARE * 100}% of the screen, its head at most ${HEAD_MAX * 100}% of the height`, c.drawn && c.headDist >= 0.6 && c.share <= MAX_SHARE && c.headH <= HEAD_MAX, c);
  for (let i = 0; i < 4; i++) await drag(0, -(phone ? 160 : 220));
  const d = await camInfo();
  numbers.seatedTpDown = d;
  await shot("12-seated-tp-down");
  rule("seated, third person: dragged down, the view looks 60 deg+ down", d.pitchDeg >= 60, d);
  await toggleV();
  for (let i = 0; i < 3; i++) await drag(0, -(phone ? 160 : 220));
  const f = await camInfo();
  numbers.seatedFpDown = f;
  await shot("13-seated-fp-down");
  rule("seated, first person: dragged down, the view looks 75 deg+ down", f.pitchDeg >= 75, f);
});

writeFileSync(join(OUT, `${tag}-numbers.json`), JSON.stringify(numbers, null, 2));
await browser.close();
process.exit(run.finish({ tag }));
