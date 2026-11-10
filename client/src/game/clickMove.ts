/**
 * 바닥 클릭 자동 이동 (design 29) — pure helpers + the module-mutable target.
 *
 * A short primary-button press on the canvas (under CLICK_MAX_PX of travel — TAP_MAX_PX for a finger — and
 * CLICK_MAX_MS of hold; anything longer/farther is the existing look-drag) becomes the auto-move target. Where it
 * goes is decided from the surface actually under the cursor (clickPick.ts → clickPlan.ts, owner 2026-11-10): ground
 * walks there (round what is in the way when it must: the target's `via` corners), anything else (a wall, a bench,
 * another body, the sky) does nothing, and a walk that cannot get there targets where it will stop — so the
 * destination ring (ClickMarker) is never shown where the avatar will not go; and a walk whose ring the player would
 * not see (under a crown, off the screen) is no walk at all. LocalPlayer's per-frame controller then composes the unit direction toward it
 * into the NORMAL movement intent (dirToIntent → worldDirection → collision →
 * moveSender), so auto-move is not a forked movement path — same speed, same
 * collision slide, same network validation as a key press.
 *
 * Release rules (design 29): arrival (< ARRIVE_DIST), any manual movement input
 * (caller clears — immediate yield), no progress (net displacement below
 * STUCK_MIN_DIST over a STUCK_WINDOW_SEC window — blocked by a wall), a re-click
 * (replaces the target = instant direction change), and sit-confirm / reconnect
 * resets (callers clear). Overview clicks never reach here (CameraRig skips
 * them — no overview click-move, YAGNI) and clicks on DOM UI never hit the
 * canvas handlers at all.
 *
 * Per-frame data is module-mutable (never React state); all tuning constants
 * live HERE — constants.ts is owned by a parallel lane (task briefing) and the
 * shared workspace stays read-only.
 */

import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import type { GroundVec, Intent } from "./input";
import { activeBounds } from "./activeMap";

/**
 * Sign applied by CameraRig to BOTH axes of the look-drag deltas (TP orbit and
 * FP look) at their consumption point — design 29's drag-direction inversion.
 * -1 = inverted relative to the pre-design-29 feel. The overview pan keeps its
 * "grab the map" mapping and pinch zoom is symmetric, so neither sees this.
 */
export const DRAG_SIGN = -1;

/** A press travelling this many px or more (screen distance) is a drag, not a click. */
export const CLICK_MAX_PX = 6;

/**
 * The same for a finger: a fingertip drifts more than a mouse, and the stick half already allowed 10 px
 * (joystick.ts STICK_TAP_MAX_PX), so a tap that drifted 6-10 px on the look half turned the view a hair and walked
 * nowhere. One tolerance for both halves now.
 */
export const TAP_MAX_PX = 10;

/** A press held this many ms or more is a drag/long-press, not a click. */
export const CLICK_MAX_MS = 400;

/** Arrival radius (m): inside this of the target, auto-move stops and clears. */
export const ARRIVE_DIST = 0.35;

/** A way round's corner (ClickTarget.via) counts as passed this close (m): the steer turns to the next one. */
export const VIA_REACH = 0.2;

/** No-progress window (s): net displacement is measured over spans this long. */
export const STUCK_WINDOW_SEC = 0.8;

/**
 * Minimum net displacement (m) per STUCK_WINDOW_SEC to count as progress. Free
 * walking covers MOVE_SPEED×window ≈ 1.6 m; pinned against a wall/corner it is
 * ~0 → the target is released. Halved with the walk (4 → 2 m/s, 2026-11-10) so a
 * wall-slide counts as progress down to the same ~4.5° off the wall's normal as
 * before (1.6·sin 4.5° ≈ 0.125), instead of being dropped below ~9°.
 */
export const STUCK_MIN_DIST = 0.125;

/**
 * One frame counts toward the no-progress window for at most this long (s). A long frame — a GC pause, a texture
 * upload, a busy phone — right after a click used to fill the whole window on the first step, before the avatar could
 * take one: the walk was dropped at once and its ring vanished (round 2, seen in the click sweep). Slow frames
 * still add up; one hitch does not.
 */
export const STUCK_STEP_MAX_SEC = STUCK_WINDOW_SEC / 4;

/** An auto-move destination: the ground point, and the height of the surface clicked there (where the ring lies). */
export interface ClickTarget extends GroundVec {
  y: number;
  /** A way round (clickPlan.ts findDetour): the corners walked by, in order, before the destination. */
  via?: readonly GroundVec[];
}

/** The auto-move state: target + the no-progress measurement window. */
interface ClickMoveState {
  target: ClickTarget | null;
  /** The next of the target's `via` corners not yet passed. */
  viaIndex: number;
  /**
   * Counts every walk set or dropped by the player's own hand (setClickTarget, clearClickTarget — a key, the stick,
   * Esc, a sit, another click), not the walk's own end (arrival, no progress). A tap held back for its double-tap
   * wait reads it at the tap and again when the wait ends: changed, the player took over meanwhile (round 4 review:
   * a tap with no ring showing used to walk over a newer click or a key press).
   */
  generation: number;
  /**
   * A touch tap on the look half waits DOUBLE_TAP_MS for a second tap before it walks (CameraRig); its ring shows at
   * once meanwhile, so the finger sees where it is going. Never walked to — the walk is `target`.
   */
  pending: ClickTarget | null;
  /** Window anchor position; `anchored` false until the first step seeds it. */
  anchorX: number;
  anchorZ: number;
  anchored: boolean;
  /** Seconds accumulated in the current displacement window. */
  windowSec: number;
}

const state: ClickMoveState = {
  target: null,
  viaIndex: 0,
  generation: 0,
  pending: null,
  anchorX: 0,
  anchorZ: 0,
  anchored: false,
  windowSec: 0,
};

declare global {
  interface Window {
    /**
     * Dev/E2E only: the live auto-move target (null when idle). Installed by
     * CameraRig under `import.meta.env.DEV`; absent in production. Kept apart
     * from `__cv` (owned by debug.ts) so this lane never edits that hook.
     */
    __cvClickTarget?: () => ClickTarget | null;
    /** Dev/E2E only: what the last click landed on and what was made of it (CameraRig). */
    __cvClickPick?: () => unknown;
  }
}

/**
 * Click vs drag: true when the pointer travelled less than `maxPx` (CLICK_MAX_PX for a mouse, TAP_MAX_PX for a
 * finger; screen distance from the down point) AND was held under CLICK_MAX_MS. The primary-button /
 * single-pointer requirements are enforced by the caller (CameraRig), which owns the pointer bookkeeping.
 */
export function isClick(dxPx: number, dyPx: number, elapsedMs: number, maxPx: number = CLICK_MAX_PX): boolean {
  return Math.hypot(dxPx, dyPx) < maxPx && elapsedMs < CLICK_MAX_MS;
}

/**
 * The farthest a press has travelled from where it went down (screen px), given the farthest so far and where it is
 * now: CameraRig feeds every move of the press through it and asks isClick of the result, not of the release point
 * alone (round 3 review: a quick 40 px drag that came back to its start turned the camera AND walked).
 */
export function pressTravel(farthest: number, dxPx: number, dyPx: number): number {
  return Math.max(farthest, Math.hypot(dxPx, dyPx));
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Set (or REPLACE — a re-click mid-move is the instant direction change design
 * 29 mandates) the auto-move target; `y` is the height of the surface it lies on (the ring's). A click's target was
 * already checked by clickPlan.ts (inside the area, clear of the colliders, reached by the walk); the clamp into the
 * active map's bounds − PLAYER_RADIUS (the same clamp LocalPlayer applies to the body) stays as the backstop for
 * targets set directly (dev hooks, the E2E). Each new target restarts the no-progress window with a fresh budget
 * and takes over from a pending tap ring. `via`: a way round's corners (clickPlan.ts findDetour), walked by in order.
 */
export function setClickTarget(x: number, z: number, y = 0, via?: readonly GroundVec[]): void {
  const b = activeBounds();
  state.target = {
    x: clamp(x, b.minX + PLAYER_RADIUS, b.maxX - PLAYER_RADIUS),
    z: clamp(z, b.minZ + PLAYER_RADIUS, b.maxZ - PLAYER_RADIUS),
    y,
    ...(via && via.length > 0 ? { via } : {}),
  };
  state.viaIndex = 0;
  state.generation++;
  state.pending = null;
  state.anchored = false;
  state.windowSec = 0;
}

/** See ClickMoveState.generation: read at a held-back tap and again when its wait ends. */
export function clickGeneration(): number {
  return state.generation;
}

/** The live target (a copy), or null while auto-move is idle. */
export function getClickTarget(): ClickTarget | null {
  return state.target ? { ...state.target } : null;
}

/**
 * The live target itself, NOT a copy — for per-frame readers that must not allocate. Read-only: the object is
 * replaced by every setClickTarget and never mutated in place, so holding it is safe but changing it is not.
 */
export function peekClickTarget(): Readonly<ClickTarget> | null {
  return state.target;
}

/**
 * Show a held-back tap's ring at (x, z) on a surface at `y` without walking (see `pending`). Returns it: the tap's
 * timer checks that it is still the pending ring when the wait ends (peekPendingClick) — a key, the stick, Esc or a
 * sit dropped it meanwhile, and then the tap is not walked (tapGesture.ts canTapWalk).
 */
export function setPendingClick(x: number, z: number, y: number): Readonly<ClickTarget> {
  const ring = { x, z, y };
  state.pending = ring;
  return ring;
}

/** The held-back tap's ring (the live object), or null. */
export function peekPendingClick(): Readonly<ClickTarget> | null {
  return state.pending;
}

/** Drop a held-back tap's ring (a double tap, a pinch, the walk refused when the wait ends). */
export function clearPendingClick(): void {
  state.pending = null;
}

/**
 * Where the destination ring is drawn this frame: a held-back tap's (the newest intent: tapped while a walk is under
 * way, its ring shows at once and the walk's own gives way until the tap's walk replaces it — round 2 review), else
 * the walk's target. The live object, never a copy (per-frame, no allocation; read-only like peekClickTarget).
 */
export function peekClickRing(): Readonly<ClickTarget> | null {
  return state.pending ?? state.target;
}

/** Drop the walk's target only (it arrived, or made no progress): a tap waiting out its double-tap wait keeps its ring. */
function endWalk(): void {
  state.target = null;
  state.viaIndex = 0;
  state.anchored = false;
  state.windowSec = 0;
}

/** Drop the target and any pending tap ring (manual-input yield / sit-confirm / Esc — design 29 (b)/(e)). */
export function clearClickTarget(): void {
  endWalk();
  state.generation++;
  state.pending = null;
}

/** Full reset — LocalPlayer mount/unmount (fresh join AND reconnect remount). */
export function resetClickMove(): void {
  clearClickTarget();
}

/** Arrival test: within ARRIVE_DIST of the target on the ground plane. */
export function hasArrived(px: number, pz: number, tx: number, tz: number): boolean {
  return Math.hypot(tx - px, tz - pz) < ARRIVE_DIST;
}

/**
 * Project a world ground-direction onto the camera basis so that
 * `worldDirection(dirToIntent(dir, yaw), yaw) === dir` — the exact inverse of
 * input.ts's rotation (F = (-sinφ, -cosφ), R = (cosφ, -sinφ) are orthonormal,
 * so the inverse is the plain dot-product projection). This is what lets the
 * auto-move steer through the EXISTING intent → worldDirection path without a
 * world-space bypass.
 */
export function dirToIntent(dir: GroundVec, cameraYaw: number): Intent {
  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);
  return {
    forward: dir.x * -sin + dir.z * -cos,
    right: dir.x * cos + dir.z * -sin,
  };
}

/**
 * Per-frame steering. Returns the unit world-direction from (px, pz) toward the
 * target, or null when idle — clearing the target first on arrival or on a
 * no-progress verdict (net displacement under STUCK_MIN_DIST across the last
 * STUCK_WINDOW_SEC — pushing a wall). The caller feeds the direction through
 * dirToIntent so the regular movement path does the actual moving. clickPlan.ts
 * simulateWalk replays exactly this rule to predict where a walk stops.
 */
export function stepClickMove(px: number, pz: number, dt: number): GroundVec | null {
  const target = state.target;
  if (!target) return null;

  // Arrival and the no-progress release end this walk only: a tap made meanwhile is still waiting out its
  // double-tap window, its ring showing (round 3 review: the ring vanished at the arrival and came back 300 ms later).
  if (hasArrived(px, pz, target.x, target.z)) {
    endWalk();
    return null;
  }

  // No-progress window: anchor on the first step after (re)targeting, then
  // compare net displacement once per full window and re-anchor.
  if (!state.anchored) {
    state.anchorX = px;
    state.anchorZ = pz;
    state.anchored = true;
    state.windowSec = 0;
  }
  state.windowSec += Math.min(dt, STUCK_STEP_MAX_SEC);
  if (state.windowSec >= STUCK_WINDOW_SEC) {
    if (Math.hypot(px - state.anchorX, pz - state.anchorZ) < STUCK_MIN_DIST) {
      endWalk(); // blocked (wall/corner) — stop instead of grinding
      return null;
    }
    state.anchorX = px;
    state.anchorZ = pz;
    state.windowSec = 0;
  }

  // A way round: toward its next corner not yet passed (within VIA_REACH), then the target (clickPlan.ts simulateWalk
  // walks the same rule).
  const via = target.via;
  while (via && state.viaIndex < via.length && Math.hypot(via[state.viaIndex].x - px, via[state.viaIndex].z - pz) < VIA_REACH) {
    state.viaIndex++;
  }
  const aim = via && state.viaIndex < via.length ? via[state.viaIndex] : target;
  const dx = aim.x - px;
  const dz = aim.z - pz;
  const len = Math.hypot(dx, dz); // ≥ VIA_REACH or ARRIVE_DIST here, never 0
  return { x: dx / len, z: dz / len };
}
