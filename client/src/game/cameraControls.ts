/**
 * Camera control math (pure — no three.js, no React, no module state).
 *
 * The camera never turns or zooms on its own (owner 2026-11-10): the orbit yaw changes
 * only by a drag, the Z / C keys, or an `orbitGoal` the player asks for (R, a double tap
 * on the right half); the pitch only by a drag; the distance only by the wheel or a pinch.
 * These are the tested building blocks CameraRig wires together each frame:
 *
 *   - held-key turning (`stepKeyYaw`) and the recenter target (`recenterYaw`),
 *   - the glide toward a goal (`stepOrbitToward`),
 *   - the smoothed zoom distance (`smoothToward`: a wheel notch glides, then holds exactly),
 *   - the pinch → zoom delta (`pinchZoomDelta`).
 *
 * The follow point is NOT smoothed: the camera rides rigidly with the body, so its distance
 * to the avatar is the player's zoom while walking, running, stopping and turning alike
 * (a trailing follow point used to stretch the view while moving and settle after a stop).
 *
 * Every "rate" is a per-second exponential rate: one step of `dt` seconds closes
 * the fraction 1 − e^(−rate·dt) of the remaining gap, so the result is the same
 * whatever the frame rate and it never overshoots.
 */

import { CAMERA } from "./constants";
import { normalizeAngle } from "./yaw";
import type { ZoomBand } from "./viewMode";
import type { Orbit } from "./types";

/** Z / C held: how fast the view turns (rad/s). */
export const CAMERA_KEY_YAW_RATE = 2.2;

/**
 * Glide rates (1/s) toward an `OrbitGoal`, and the distance (rad or m) under which
 * a field counts as arrived. `yawRate` is the fast one so a half-turn recenter
 * reads as a quick swing; `pitchRate` is deliberately slow so the camera height
 * settles gently.
 */
export const ORBIT_EASE = { yawRate: 10, pitchRate: 2, distRate: 12, eps: 1e-3 } as const;

/**
 * An exponential glide only ever gets closer, it never arrives, and with a gentle
 * rate the last stretch crawls. So each field also moves at least `rate × ORBIT_TAIL`
 * (rad/s or m/s) — fast enough that a goal always finishes in bounded time (a
 * half-turn recenter in about 0.3 s), slow enough that the tail still reads as
 * easing out.
 */
const ORBIT_TAIL = 0.4;

/** The follow distance is smoothed toward the zoom intent at this rate (1/s). */
export const ZOOM_SMOOTH_RATE = 12;

/** The camera looks this far (m) above the head, so the avatar sits a bit below the middle. */
export const CAMERA_LOOK_LIFT = 0.25;

/** Follow-distance clamp band shared by the wheel and pinch zoom paths. */
export const ZOOM_BAND: Readonly<ZoomBand> = { min: CAMERA.minDistance, max: CAMERA.maxDistance };

/**
 * Turn the view while Z (left) / C (right) is held. Z raises the yaw — the view
 * swings to the LEFT; C lowers it. Both held cancel. Wrapped into [-PI, PI].
 */
export function stepKeyYaw(
  yaw: number,
  left: boolean,
  right: boolean,
  dt: number,
  rate: number = CAMERA_KEY_YAW_RATE,
): number {
  const dir = (left ? 1 : 0) - (right ? 1 : 0);
  if (dir === 0) return yaw;
  return normalizeAngle(yaw + dir * rate * dt);
}

/**
 * The orbit yaw that puts the camera right behind a body facing `bodyYaw`:
 * half a turn from the body's facing, so "forward" on the screen equals where the
 * body looks.
 */
export function recenterYaw(bodyYaw: number): number {
  return normalizeAngle(bodyYaw + Math.PI);
}

/** Where the orbit should glide to. Fields left out are not touched. */
export interface OrbitGoal {
  yaw?: number;
  pitch?: number;
  distance?: number;
}

/**
 * One eased step of a signed `gap` (goal − current): the exponential share
 * `gap · (1 − e^(−rate·dt))`, but never slower than the tail speed, and never
 * past the goal. Returns the signed movement.
 */
function easeStep(gap: number, rate: number, dt: number): number {
  const size = Math.abs(gap);
  const move = Math.min(size, Math.max(size * (1 - Math.exp(-rate * dt)), rate * ORBIT_TAIL * dt));
  return gap < 0 ? -move : move;
}

/**
 * Glide `orbit` toward `goal` by one frame, in place. Yaw takes the shortest arc.
 * Returns true once EVERY field the goal names is within `ORBIT_EASE.eps` (those
 * fields are then set exactly on the goal, so the caller can drop the goal and the
 * orbit stays put). A goal that names nothing is trivially done.
 */
export function stepOrbitToward(orbit: Orbit, goal: OrbitGoal, dt: number): boolean {
  const eps = ORBIT_EASE.eps;
  let done = true;

  if (goal.yaw !== undefined) {
    let gap = normalizeAngle(goal.yaw - orbit.yaw);
    if (Math.abs(gap) > eps) {
      orbit.yaw = normalizeAngle(orbit.yaw + easeStep(gap, ORBIT_EASE.yawRate, dt));
      gap = normalizeAngle(goal.yaw - orbit.yaw);
    }
    if (Math.abs(gap) <= eps) orbit.yaw = normalizeAngle(goal.yaw);
    else done = false;
  }
  if (goal.pitch !== undefined) {
    let gap = goal.pitch - orbit.pitch;
    if (Math.abs(gap) > eps) {
      orbit.pitch += easeStep(gap, ORBIT_EASE.pitchRate, dt);
      gap = goal.pitch - orbit.pitch;
    }
    if (Math.abs(gap) <= eps) orbit.pitch = goal.pitch;
    else done = false;
  }
  if (goal.distance !== undefined) {
    let gap = goal.distance - orbit.distance;
    if (Math.abs(gap) > eps) {
      orbit.distance += easeStep(gap, ORBIT_EASE.distRate, dt);
      gap = goal.distance - orbit.distance;
    }
    if (Math.abs(gap) <= eps) orbit.distance = goal.distance;
    else done = false;
  }
  return done;
}

/**
 * Exponential smoothing: `current` moves toward `target` by 1 − e^(−rate·dt) of
 * the gap. dt ≤ 0 holds still; the result never crosses the target.
 */
export function smoothToward(
  current: number,
  target: number,
  dt: number,
  rate: number = ZOOM_SMOOTH_RATE,
): number {
  if (dt <= 0) return current;
  return target + (current - target) * Math.exp(-rate * dt);
}

/**
 * Follow-distance change (m) for one pinch step: fingers together (spread
 * shrinking) is positive → zoom out; fingers apart is negative → zoom in.
 */
export function pinchZoomDelta(prevSpreadPx: number, currSpreadPx: number): number {
  return (prevSpreadPx - currSpreadPx) * CAMERA.pinchSpeed;
}

/**
 * Third-person camera height kept above the floor (CAMERA.minY), so a low angle never looks up from under the ground.
 * It shapes one frame's camera spot only — the orbit (the player's zoom and tilt) is never written, so the moment the
 * wanted spot is above the floor again the camera is exactly where the player put it.
 */
export function aboveGroundY(y: number): number {
  return Math.max(CAMERA.minY, y);
}
