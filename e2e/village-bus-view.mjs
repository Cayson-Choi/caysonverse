/**
 * e2e/village-bus-view.mjs — the owner's three complaints of 2026-11-16 about the bus view, proven in the game:
 *   1. structures never overlap the avatar: bus v3 has no pole / strap / rail at all (checked on the loaded scene), and in the third
 *      person the lens stays inside the cabin with no near body part filling the screen;
 *   2. both side windows can be looked out of: the left / right quick view, and a drag (mouse on a PC, touch on a phone), turn the
 *      view to each side (the look yaw ends on the side), screenshots show the outside;
 *   3. first person works in the bus, seated and standing: boarding starts in it, V / the eye button toggle it both ways, and
 *      the avatar is hidden in it.
 * One rider (PC 1280x800, or --phone: iPhone 13 375x812 touch). --time picks day (default) or night.
 *
 *   OFF=$(node -e 'const n=Date.now()+170000,s=Math.ceil(n/600000)*600000;console.log(s-n)')
 *   (cd server && CV_DEV_CLOCK_OFFSET_MS=$OFF PORT=2851 npx tsx src/index.ts)
 *   CV_CLIENT_URL=http://localhost:5451 node e2e/village-bus-view.mjs --out=<folder> [--phone] [--time=2026-11-03T21:30]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, touchDown, touchMoveTo, touchUp, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage, NOON } from "./lib/village.mjs";

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const phone = process.argv.includes("--phone");
const TIME = arg("time", NOON);
const tag = `${phone ? "phone" : "pc"}-${TIME === NOON ? "day" : "night"}`;
const run = createRun(`village-bus-view-${tag}`);
const OUT = arg("out", run.evidence);
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const A = await openPlayer(browser, run, { tag: `A-${tag}`, device: phone ? PHONE : DESKTOP });
const shot = (name) => A.page.screenshot({ path: join(OUT, `${tag}-${name}.png`) });
const state = () =>
  A.page.evaluate(async () => {
    const b = await window.__imp("/src/game/busRide.ts");
    const v = await window.__imp("/src/game/viewState.ts");
    const s = await window.__imp("/src/net/transitSync.ts");
    return { slot: b.selfBusRide.slot, walk: { ahead: b.busWalk.ahead, right: b.busWalk.right }, fp: b.busCamState.firstPerson, arm: b.busCamState.arm, mode: v.viewState.mode, fpYaw: v.viewState.fpYaw, orbitYaw: null, boarded: s.getTransitState().boarded };
  });
async function pollUntil(fn, ms, step = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}
const view = async (name) => {
  const b = A.page.locator(`[data-testid=bus-ride-views] button[data-view=${name}]`).first();
  await (phone ? b.tap() : b.click());
  await sleep(1300);
};
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const eyeButton = async () => {
  const b = A.page.getByRole("button", { name: "1인칭/3인칭 전환" }).first();
  await (phone ? b.tap() : b.click());
  await sleep(1200);
};
const toggleV = async () => {
  if (phone) await eyeButton();
  else {
    await A.page.keyboard.press("KeyV");
    await sleep(1200);
  }
};
async function walkBus(ahead, right, tol = 0.25, ms = 12000) {
  await view("front");
  const t0 = Date.now();
  let held = null;
  const release = async () => { if (held) await A.page.keyboard.up(held); held = null; };
  while (Date.now() - t0 < ms) {
    const r = await state();
    const da = ahead - r.walk.ahead;
    const dr = right - r.walk.right;
    if (Math.hypot(da, dr) < tol) break;
    const key = Math.abs(da) > Math.abs(dr) ? (da > 0 ? "KeyW" : "KeyS") : dr > 0 ? "KeyD" : "KeyA";
    if (key !== held) { await release(); await A.page.keyboard.down(key); held = key; }
    await sleep(70);
  }
  await release();
  await sleep(250);
}
// the avatar's share of the screen: the projected corners of every mesh's bounding box, as one box clipped to the screen (a bound: the silhouette is smaller)
const avatarShare = () =>
  A.page.evaluate(async () => {
    const m = await window.__imp("/src/game/busRide.ts");
    const { camera } = window.__cvThree();
    const g = m.busCamState.avatar;
    if (!g) return { share: null };
    camera.updateMatrixWorld();
    let x0 = 9, x1 = -9, y0 = 9, y1 = -9, n = 0;
    g.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        const v = b.min.clone().set(x, y, z).applyMatrix4(o.matrixWorld).project(camera);
        if (v.z > 1) continue;
        n++;
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
    });
    const cl = (v) => Math.max(-1, Math.min(1, v));
    const w = Math.max(0, cl(x1) - cl(x0));
    const h = Math.max(0, cl(y1) - cl(y0));
    return { share: (w * h) / 4, wShare: w / 2, hShare: h / 2, corners: n };
  });
// What blocks the picture other than the avatar: a grid of rays through the screen against everything in the scene but the avatar (glass and other
// transparent panes let the light through, they are skipped); the share of rays that meet something within NEAR_M is the share of the screen a near
// body part (a door leaf, a window frame, a pole) fills. Also: the eye is inside the cabin shell (the same box as the unit sweep).
const NEAR_M = 0.75;
const MAX_BLOCK = 0.25;
const screenBlock = () =>
  A.page.evaluate(async (NEAR) => {
    const m = await window.__imp("/src/game/busRide.ts");
    const tc = await window.__imp("/src/village/transitCamera.ts");
    const { scene, camera } = window.__cvThree();
    const three = await import(/* @vite-ignore */ performance.getEntriesByType("resource").map((r) => r.name).find((n) => n.split("?")[0].endsWith("/deps/three.js")));
    const rc = new three.Raycaster();
    rc.far = NEAR;
    camera.updateMatrixWorld();
    const avatar = m.busCamState.avatar;
    const skip = (o) => {
      for (let p = o; p; p = p.parent) if (p === avatar) return true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      return mats.some((mt) => mt && (mt.transparent || mt.opacity < 1 || mt.visible === false)) || o.visible === false;
    };
    let hit = 0;
    let n = 0;
    for (let ix = -0.9; ix <= 0.91; ix += 0.15) for (let iy = -0.9; iy <= 0.91; iy += 0.15) {
      rc.setFromCamera({ x: ix, y: iy }, camera);
      const hits = rc.intersectObjects(scene.children, true).filter((h) => h.object.isMesh && !skip(h.object) && h.object.layers.test(camera.layers) && !(h.face && Math.abs(h.face.normal.clone().transformDirection(h.object.matrixWorld).y) > 0.8)); // the ceiling and the floor are no body part in the way
      n++;
      if (hits.length) hit++;
    }
    const e = m.busCamState.eye;
    const S = tc.BUS_SHELL;
    return { block: hit / n, eye: [...e], inShell: e[0] >= S.aheadMin - 1e-3 && e[0] <= S.aheadMax + 1e-3 && Math.abs(e[1]) <= S.right + 1e-3 && e[2] <= S.top + 1e-3 && e[2] > 0.3 };
  }, NEAR_M);
const MAX_SHARE = 0.36; // of the screen, the clipped BOUNDING BOX of the avatar (a bound: its silhouette is about half of it, 15-20% by eye in the screenshots)
async function tpShares(label, tagName) {
  let k = 0;
  for (const v of ["front", "back", "left", "right"]) {
    await view(v);
    await sleep(500);
    await shot(`${tagName}-tp-${v}`);
    const r = await avatarShare();
    run.check(`1. ${label}, third person, ${v} view: the avatar fills at most ${MAX_SHARE * 100}% of the screen (bounding box, clipped)`, r.share !== null && r.share <= MAX_SHARE, r);
    const b = await screenBlock();
    run.check(`1. ${label}, third person, ${v} view: the lens is inside the cabin shell and no near body part (door, frame, pole) fills ${MAX_BLOCK * 100}% of the screen`, b.inShell && b.block < MAX_BLOCK, b);
    k++;
  }
}
const checkFade = async (label) => {
  const c = await A.page.evaluate(async () => {
    const m = await window.__imp("/src/game/busRide.ts");
    const cs = m.busCamState;
    const { scene } = window.__cvThree();
    const handles = [];
    const hidden = [];
    scene.traverse((o) => {
      if (/^(pole|strap|rail)_/.test(o.name)) handles.push(o.name);
      if (/^(stop_btn_|bus_driver_seat|bus_steering_wheel)/.test(o.name) && !o.visible) hidden.push(o.name);
    });
    return { fp: cs.firstPerson, arm: cs.arm, handles, hidden };
  });
  // bus v3 (owner 2026-11-16): no pole, rail or strap at all; nothing in the cabin is hidden or faded ("반투명하게 보이게 하지 마")
  run.check(`1. ${label}: third person, no pole / rail / strap in the cabin, nothing hidden near the lens`, c.fp === false && c.handles.length === 0 && c.hidden.length === 0, c);
};
await run.step("join, board", async () => {
  await joinVillage(A, "뷰", TIME);
  await pollUntil(() => A.page.evaluate(async () => (await window.__imp("/src/net/transitSync.ts")).getTransitState().snapshot !== null), 30000);
  await walkAndWait(A, 38.5, -0.5, 40000, 1);
  await walkAndWait(A, 37.7, -8.9, 30000, 0.5);
  await pollUntil(async () => (await A.page.evaluate(async () => { const s = await window.__imp("/src/net/transitSync.ts"); return s.transitTripAt(s.transitNowMs()).status; })) === "boarding", 420000, 500); // the server may be started before the window opens
  await sleep(600);
  await act(A);
  run.check("aboard and free", await pollUntil(async () => { const s = await state(); return s.slot === 0 && s.boarded; }, 8000), await state());
  await sleep(1200);
});

await run.step("3. first person is the start in the bus, and V / the eye button toggle it", async () => {
  let s = await state();
  run.check("boarding starts in first person (mode fp, camera in the eye, avatar hidden)", s.mode === "fp" && s.fp === true && s.arm === 0, s);
  run.check("bus v3 QA: boarding looks forward (the windscreen and both side rows), not at the rear seats", angDiff(s.fpYaw, Math.PI) < 0.2, s);
  if (phone) {
    const sizes = await A.page.evaluate(() => [...document.querySelectorAll("[data-testid=bus-ride-hud] button")].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; }));
    run.check("bus v3 QA: every ride-panel button is a 48 px tap target on the phone", sizes.length >= 4 && sizes.every((b) => b.w >= 48 && b.h >= 48), sizes);
  }
  await shot("1-board-fp");
  await toggleV();
  s = await state();
  run.check("toggle: third person (mode tp, an arm out)", s.mode === "tp" && s.arm > 0.3, s);
  await shot("2-board-tp");
  await toggleV();
  s = await state();
  run.check("toggle again: first person", s.mode === "fp" && s.fp === true, s);
});

await run.step("2. look out of the left and right windows (quick views and a drag), first person", async () => {
  const half = Math.PI / 2;
  await view("left");
  let s = await state();
  run.check("left view: the look yaw faces the left windows (-90 deg)", angDiff(s.fpYaw, -half) < 0.15, s);
  await shot("3-fp-left");
  await view("right");
  s = await state();
  run.check("right view: the look yaw faces the right windows (+90 deg)", angDiff(s.fpYaw, half) < 0.15, s);
  await shot("4-fp-right");
  await view("front");
  const f = await state();
  // a drag turns the view
  const cx = phone ? 330 : 640; // phone: the lower-left quarter is the joystick, so drag on the right
  const dirx = phone ? -1 : 1;
  const cy = phone ? 500 : 420;
  if (phone) {
    await touchDown(A, cx, cy);
    for (let k = 1; k <= 12; k++) { await touchMoveTo(A, cx + dirx * k * 14, cy); await sleep(20); }
    await touchUp(A);
  } else {
    await A.page.mouse.move(cx, cy);
    await A.page.mouse.down();
    for (let k = 1; k <= 12; k++) { await A.page.mouse.move(cx + dirx * k * 14, cy, { steps: 2 }); await sleep(20); }
    await A.page.mouse.up();
  }
  await sleep(500);
  const d = await state();
  run.check("a drag turns the first-person view", angDiff(d.fpYaw, f.fpYaw) > 0.25, { before: f.fpYaw, after: d.fpYaw });
  await shot("5-fp-dragged");
  await view("back");
  await shot("6-fp-back");
});

await run.step("3b. first person while seated, and standing in the aisle", async () => {
  // sit: walk to L2's approach point (the shared rule) and take the seat the UI offers there
  const spot = await A.page.evaluate(async () => {
    const c = await window.__imp("/shared/src/village/busCabin.ts");
    const i = c.BUS_SEATS.findIndex((s) => s.id === "L2");
    const ap = c.seatApproachPoint(c.BUS_SEATS[i]);
    return { a: ap.ahead, r: ap.right, i };
  });
  await walkBus(spot.a, spot.r, 0.15);
  await act(A);
  run.check("seated (the E / button offered a seat)", await pollUntil(async () => { const s = await state(); return s.slot >= 1 && s.slot <= 10; }, 5000), await state());
  await sleep(800);
  let s = await state();
  run.check("seated: first person (mode fp, avatar hidden)", s.mode === "fp" && s.fp === true, s);
  await shot("7-seated-fp-front");
  await view("left");
  await shot("8-seated-fp-left");
  await view("right");
  await shot("9-seated-fp-right");
  await toggleV();
  s = await state();
  run.check("seated: V gives the third person", s.mode === "tp" && s.arm > 0.3, s);
  await tpShares("seated", "10-seated");
  await view("front");
  await checkFade("seated");
  await toggleV();
  s = await state();
  run.check("seated: V back to first person", s.mode === "fp", s);
  // stand up (E / the button) and stand in the aisle by the middle door (bus v3: no poles to hold, people just stand)
  await act(A);
  run.check("stood up", await pollUntil(async () => (await state()).slot === 0, 4000), await state());
  await walkBus(-0.4, 0.26, 0.2);
  await sleep(800);
  s = await state();
  run.check("standing in the aisle: first person", s.mode === "fp" && s.fp === true && s.slot === 0, s);
  await shot("13-stand-fp-front");
  await view("left");
  await shot("14-stand-fp-left");
  await view("right");
  await shot("15-stand-fp-right");
  await toggleV();
  s = await state();
  run.check("standing: V gives the third person", s.mode === "tp" && s.arm > 0.3, s);
  await tpShares("standing", "16-stand");
  await view("front");
  await checkFade("standing");
});

await browser.close();
process.exit(run.finish({ tag }));
