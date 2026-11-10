/**
 * Touch tap gestures for the look half of the screen (pure).
 *
 * On a phone the right half of the screen is the "look" side: dragging turns the
 * view, a single tap walks to that spot, and a DOUBLE tap swings the camera back
 * behind the character. A single tap is therefore held back for DOUBLE_TAP_MS to
 * see whether a second tap follows (CameraRig owns that timer).
 */

import type { ViewMode } from "./viewMode";

/** A second tap within this many ms of the first makes it a double tap. */
export const DOUBLE_TAP_MS = 300;

/** ...and within this many px of the first. */
export const DOUBLE_TAP_PX = 30;

/** A finished tap: when (ms, any steady clock) and where (screen px). */
export interface TapRecord {
  t: number;
  x: number;
  y: number;
}

/**
 * Whether `next` completes a double tap that began with `prev`: no later than
 * DOUBLE_TAP_MS after it and no farther than DOUBLE_TAP_PX from it (both limits
 * inclusive). With no previous tap it is never a double. CameraRig gives `prev` the
 * first tap's lift and `next` the second one's touch-down (the events' own times) —
 * the gap a phone's own double-tap rule measures (Android: first up to second down),
 * so neither the second press's own length nor a busy page's late handling counts
 * against it (round 4 review: a loaded phone's double tap ran past the window).
 */
export function isDoubleTap(prev: TapRecord | null, next: TapRecord): boolean {
  if (!prev) return false;
  const elapsed = next.t - prev.t;
  if (elapsed < 0 || elapsed > DOUBLE_TAP_MS) return false;
  return Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_PX;
}

/**
 * Whether screen x (px) lies in the look half of a viewport `vw` px wide: the
 * right half for right-handed play (x >= vw/2), the left half when `leftHanded`
 * mirrors the layout. The two halves are exact complements; the joystick lives on
 * the other half.
 */
export function isLookHalf(x: number, vw: number, leftHanded: boolean = false): boolean {
  return leftHanded ? x < vw / 2 : x >= vw / 2;
}

/**
 * Whether the held-back single-tap walk may still start when its DOUBLE_TAP_MS timer
 * fires — the world can change during that wait, so it is decided again then:
 *   - the overview map opened (a tap on it is not a walk),
 *   - chat / a panel took the keyboard (`uiCaptured`; the Esc menu captures it while open),
 *   - the player SAT DOWN meanwhile (`seatedNow` but not `seatedAtTap`): a walk target
 *     would stand them straight back up.
 *   - its ring was DROPPED meanwhile (`dropped`: a key, the stick, Esc or a sit cleared it — the player took over):
 *     walking then would bring back a ring that had already gone (round 3 review).
 * A tap made while already seated keeps its meaning — "stand up and go there" — like
 * a mouse click does.
 */
export function canTapWalk(
  mode: ViewMode,
  uiCaptured: boolean,
  seatedAtTap: boolean,
  seatedNow: boolean,
  dropped = false,
): boolean {
  if (mode === "ov" || uiCaptured || dropped) return false;
  return seatedAtTap || !seatedNow;
}
