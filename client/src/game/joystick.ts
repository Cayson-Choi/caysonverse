/**
 * Dynamic virtual-joystick math (pure). The stick appears wherever the thumb
 * lands in the lower-left quarter of the screen (lower-right for left-handers),
 * so everything here is measured from that press point, in DOM pixels:
 *
 *   stickDown → stickMove* → stickUp   (one owning pointer at a time)
 *
 * A reading is a unit direction vector plus a 0..1 force. `joystickIntent` turns
 * it into the SAME local `Intent` the keyboard's `readIntent` produces, so touch
 * and keys feed one camera-relative movement path (see `worldDirection`). Force
 * never scales speed continuously: it gates the dead zone and picks one of two
 * gaits — a light push walks, a push to the rim runs (`stickGait`).
 */

import type { Gait } from "./gait";
import type { Intent, MoveInput } from "./input";

/** A direction on the stick: `x` is screen-right (+), `y` is up (+). */
export interface JoystickVector {
  x: number;
  y: number;
}

/**
 * Below this force (fraction of the joystick radius, 0 at centre → 1 at edge) the
 * stick reads as centred and produces no movement. Prevents drift from a resting
 * thumb.
 */
export const JOYSTICK_DEAD_ZONE = 0.15;

/**
 * Map a joystick reading to a local movement intent. Inside the dead-zone the
 * intent is zero; otherwise the vector's `y` becomes forward (into the screen)
 * and `x` becomes screen-right — the axes `readIntent` uses. `worldDirection`
 * later normalizes, so a partial push still moves at the full gait speed.
 */
export function joystickIntent(
  vector: JoystickVector,
  force: number,
  deadZone: number = JOYSTICK_DEAD_ZONE,
): Intent {
  if (force < deadZone) return { forward: 0, right: 0 };
  return { forward: vector.y, right: vector.x };
}

/** Presses this close to the screen's outer edge are the OS back gesture, not ours. */
export const STICK_EDGE_PX = 24;

/** Thumb travel (px) from the press point that counts as a full push (force 1). */
export const STICK_RADIUS_PX = 56;

/** Pushing to at least this force runs. */
export const STICK_RUN_FORCE = 0.9;

/** While running, the force must fall BELOW this to go back to walking (anti-flicker). */
export const STICK_RUN_RELEASE = 0.8;

/** A press that travels under this many px and lasts under STICK_TAP_MAX_MS is a tap. */
export const STICK_TAP_MAX_PX = 10;

/**
 * See STICK_TAP_MAX_PX. The look half's limit (clickMove.ts CLICK_MAX_MS): a 250-400 ms tap walked there and not
 * here, so the same finger tap did different things on the two halves.
 */
export const STICK_TAP_MAX_MS = 400;

/**
 * Where a press starts a stick: the lower-left quarter, minus the left edge
 * strip. `leftHanded` mirrors it to the lower-right quarter minus the right edge
 * strip. Takes the live viewport size so a rotated phone is handled.
 */
export function isStickZone(
  x: number,
  y: number,
  vw: number,
  vh: number,
  leftHanded: boolean = false,
): boolean {
  if (y < vh / 2) return false;
  return leftHanded ? x >= vw / 2 && x < vw - STICK_EDGE_PX : x >= STICK_EDGE_PX && x < vw / 2;
}

/**
 * Read the stick from its press point (ox, oy) and the thumb (x, y), both in DOM
 * pixels (y grows DOWN). Returns the unit direction with y flipped to up-is-+,
 * and force = min(1, distance / radius). No distance → zero vector, zero force.
 */
export function stickReading(
  ox: number,
  oy: number,
  x: number,
  y: number,
  radiusPx: number = STICK_RADIUS_PX,
): { vector: JoystickVector; force: number } {
  const dx = x - ox;
  const dy = y - oy;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { vector: { x: 0, y: 0 }, force: 0 };
  return { vector: { x: dx / dist, y: -dy / dist }, force: Math.min(1, dist / radiusPx) };
}

/**
 * The gait a force asks for: idle in the dead zone, walk up to STICK_RUN_FORCE,
 * run from there. A stick that is already running keeps running until the force
 * drops below STICK_RUN_RELEASE, so a thumb hovering near the threshold cannot
 * flip between walk and run on every move event.
 */
export function stickGait(force: number, wasRunning: boolean): Gait {
  if (force < JOYSTICK_DEAD_ZONE) return "idle";
  if (force >= STICK_RUN_FORCE) return "run";
  if (wasRunning && force >= STICK_RUN_RELEASE) return "run";
  return "walk";
}

/** The one pointer that owns the stick, where it was pressed, and its run latch. */
export interface StickState {
  pointerId: number | null;
  ox: number;
  oy: number;
  running: boolean;
}

export function createStickState(): StickState {
  return { pointerId: null, ox: 0, oy: 0, running: false };
}

/**
 * A pointer went down at (x, y). Starts the stick there and returns true when
 * nobody owns it yet and the press is inside the zone; otherwise (a second
 * finger, the edge strip, outside the quarter) returns false and changes nothing.
 */
export function stickDown(
  s: StickState,
  id: number,
  x: number,
  y: number,
  vw: number,
  vh: number,
  leftHanded: boolean,
): boolean {
  if (s.pointerId !== null) return false;
  if (!isStickZone(x, y, vw, vh, leftHanded)) return false;
  s.pointerId = id;
  s.ox = x;
  s.oy = y;
  s.running = false;
  return true;
}

/**
 * The owning pointer moved to (x, y): the movement input it asks for (direction
 * from the press point, run from the gait bands), or null for any other pointer.
 */
export function stickMove(s: StickState, id: number, x: number, y: number): MoveInput | null {
  if (s.pointerId !== id) return null;
  const { vector, force } = stickReading(s.ox, s.oy, x, y);
  s.running = stickGait(force, s.running) === "run";
  const intent = joystickIntent(vector, force);
  return { forward: intent.forward, right: intent.right, run: s.running };
}

/** The owning pointer lifted (or was cancelled): release the stick and return true. */
export function stickUp(s: StickState, id: number): boolean {
  if (s.pointerId !== id) return false;
  s.pointerId = null;
  s.running = false;
  return true;
}

/**
 * A press released after travelling (dxPx, dyPx) in elapsedMs was a TAP — too
 * short and still to be a stick drag — so it is passed on to the ground as a
 * normal click-move tap instead of being swallowed by the stick zone.
 */
export function isStickTap(dxPx: number, dyPx: number, elapsedMs: number): boolean {
  return Math.hypot(dxPx, dyPx) < STICK_TAP_MAX_PX && elapsedMs < STICK_TAP_MAX_MS;
}
