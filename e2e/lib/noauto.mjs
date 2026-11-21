// Helpers of the "nothing happens by itself" e2e scripts (e2e/no-auto-enter.mjs, no-auto-houses.mjs, no-auto-board.mjs; owner 2026-11-21):
// walking by the game's own planner, real clicks / taps on a world point, the keys, the camera's view, and what the last click landed on.
import { pos, sleep, waitIdle, walkTo } from "./common.mjs";

export const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
export const areaOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
/** Poll `fn` (an async check run from here: the page's own waitForFunction does not wait for an async predicate) until it is true or `ms` pass. */
export async function until(fn, ms = 60000, every = 200) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(every);
  }
}
export const waitArea = (p, a, ms = 60000) => until(async () => (await areaOf(p)) === a, ms);

/** The follow camera's yaw and pitch (its goal: it turns there within a second or so). */
export const setView = (p, yaw, pitch = 0.35) =>
  p.page.evaluate(async ([yaw, pitch]) => {
    (await window.__imp("/src/game/viewState.ts")).viewState.orbitGoal = { yaw, pitch };
  }, [yaw, pitch]);

/** Walk to (x, z) the way a click on the ground there would (the planner's way round colliders), by waypoints; true when within `tol`. */
export async function walkPlanned(p, x, z, tol = 0.8) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const plan = await p.page.evaluate(async ([x, z]) => {
      const cp = await window.__imp("/src/game/clickPlan.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const map = am.getActiveMap();
      const at = window.__cv.getPos();
      const r = cp.planClickMove(at.x, at.z, { x, y: 0, z, ny: 1 }, map.geometry.obstacles, am.mapBounds(map), false, { furniture: map.furniture ?? [] });
      return r.ok ? { ok: true, pts: [...(r.via ?? []), { x: r.x, z: r.z }] } : { ok: false, why: r.reason };
    }, [x, z]);
    if (!plan.ok) {
      const at = await pos(p);
      return plan.why === "here" || Math.hypot(at.x - x, at.z - z) <= tol;
    }
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

/** A long walk (across the park, round a house's furniture): the detour search with wide limits, halving the way when it gives up. */
export async function walkFar(p, x, z, tol = 1.5, depth = 0) {
  for (let i = 0; i < 3; i++) {
    await p.page.evaluate(async ([x, z]) => {
      const am = await window.__imp("/src/game/activeMap.ts");
      const cp = await window.__imp("/src/game/clickPlan.ts");
      const cm = await window.__imp("/src/game/clickMove.ts");
      const map = am.getActiveMap();
      const me = window.__cv.getPos();
      const via = cp.findDetour(me.x, me.z, x, z, map.geometry.obstacles, am.mapBounds(map), undefined, { ratio: 6, slack: 40, margin: 40 });
      cm.setClickTarget(x, z, 0, via ?? undefined);
    }, [x, z]);
    await sleep(300);
    await waitIdle(p, 120000);
    await sleep(200);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) <= tol) return true;
  }
  const r = await pos(p);
  if (depth >= 3 || Math.hypot(r.x - x, r.z - z) < 4) return Math.hypot(r.x - x, r.z - z) <= tol;
  await walkFar(p, (r.x + x) / 2, (r.z + z) / 2, 2, depth + 1);
  return walkFar(p, x, z, tol, depth + 1);
}

/** Where the world point (x, y, z) shows on the screen now, or null when it is off it or behind the camera. */
export async function screenOfWorld(p, x, y, z) {
  const s = await p.page.evaluate(async ([x, y, z]) => {
    const THREE = await window.__imp("/deps/three.js");
    const { camera, gl } = window.__cvThree();
    camera.updateMatrixWorld();
    const v = new THREE.Vector3(x, y, z).project(camera);
    const r = gl.domElement.getBoundingClientRect();
    return { px: r.left + ((v.x + 1) / 2) * r.width, py: r.top + ((1 - v.y) / 2) * r.height, z: v.z, w: window.innerWidth, h: window.innerHeight };
  }, [x, y, z]);
  if (s.z > 1 || s.px < 2 || s.px > s.w - 2 || s.py < 2 || s.py > s.h - 2) return null;
  return s;
}

/** Whether the canvas itself is what a press at (px, py) lands on (not a HUD button or panel lying over it). */
export const canvasAt = (p, px, py) => p.page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === "CANVAS", [px, py]);

/** A real tap / click on the screen at (px, py). */
export async function tapScreen(p, px, py) {
  if (p.touch) await p.page.touchscreen.tap(px, py);
  else await p.page.mouse.click(px, py);
}

/** A real tap / click on the screen where the world point (x, y, z) shows; false when it is off the screen or under the HUD. */
export async function tapWorld(p, x, y, z) {
  const s = await screenOfWorld(p, x, y, z);
  if (!s || !(await canvasAt(p, s.px, s.py))) return false;
  await tapScreen(p, s.px, s.py);
  return true;
}

/** Hold W for `ms` with the camera yaw tried each way round until "forward" is toward (tx, tz); returns the yaw that worked, or null. */
export async function keysToward(p, tx, tz, yaws, ms) {
  for (const yaw of yaws) {
    await setView(p, yaw);
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

/** The camera yaw (of the four axis ones and `extra`) that puts the world point nearest the middle of the screen; the view is left there. */
export async function faceWorld(p, x, y, z, pitch = 0.35, extra = []) {
  let best = null;
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, ...extra]) {
    await setView(p, yaw, pitch);
    await sleep(1400);
    const s = await screenOfWorld(p, x, y, z);
    if (!s) continue;
    const off = Math.hypot(s.px - s.w / 2, s.py - s.h / 2);
    if (!best || off < best.off) best = { yaw, off };
  }
  if (best) {
    await setView(p, best.yaw, pitch);
    await sleep(1400);
  }
  return best ? best.yaw : null;
}

/** What the last click / tap landed on and what was planned of it (the dev hook), short. */
export const pickInfo = async (p) => {
  await sleep(700);
  return pickNow(p);
};
const pickNow = (p) =>
  p.page.evaluate(() => {
    const c = window.__cvClickPick?.();
    const k = c?.pick;
    return k ? { x: +k.x.toFixed(2), y: +k.y.toFixed(2), z: +k.z.toFixed(2), ny: +k.ny.toFixed(2), dist: +k.distance.toFixed(2), name: k.name, plan: c.plan && { ok: c.plan.ok, reason: c.plan.reason } } : null;
  });

/**
 * Tap a door's leaf until `done()` (waits for the area to change) says it worked: the points are tried in turn at each camera pitch (an eave
 * or a sign may hide the leaf's upper part from the default view). Returns how it went.
 */
export async function tapDoor(p, points, yaw, done, pitches = [0.35, 0.12]) {
  const tries = [];
  for (const pitch of pitches) {
    await setView(p, yaw, pitch);
    await sleep(2000);
    for (const q of points) {
      const tapped = await tapWorld(p, q.x, q.y, q.z);
      if (!tapped) {
        tries.push({ pitch, y: q.y, tapped });
        continue;
      }
      const ok = await done();
      tries.push({ pitch, y: q.y, tapped, ok, pick: ok ? undefined : await pickInfo(p) });
      if (ok) return { ok: true, tries };
      await waitIdle(p, 15000);
    }
  }
  return { ok: false, tries };
}

/** The usual end of a script: the totals, the failures again, the exit code. */
export function finishRun(run) {
  run.finish?.();
  const failed = run.results.filter((r) => !r.ok);
  console.log(`\n${run.results.length - failed.length}/${run.results.length} checks passed`);
  for (const f of failed) console.log("FAIL", f.step, "-", f.name, JSON.stringify(f.detail)?.slice(0, 300));
  process.exitCode = failed.length ? 1 : 0;
}
