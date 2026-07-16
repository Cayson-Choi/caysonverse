/**
 * 바닥 클릭 자동 이동 (design 29) — pure helpers + the module-mutable target.
 *
 * A short primary-button press on the canvas (under CLICK_MAX_PX of travel and
 * CLICK_MAX_MS of hold — anything longer/farther is the existing look-drag) is
 * raycast onto the y=0 floor plane and stored here as the auto-move target.
 * LocalPlayer's per-frame controller then composes the unit direction toward it
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

import { WORLD_BOUNDS } from "@caysonverse/shared/constants";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import type { GroundVec, Intent } from "./input";

/**
 * Sign applied by CameraRig to BOTH axes of the look-drag deltas (TP orbit and
 * FP look) at their consumption point — design 29's drag-direction inversion.
 * -1 = inverted relative to the pre-design-29 feel. The overview pan keeps its
 * "grab the map" mapping and pinch zoom is symmetric, so neither sees this.
 */
export const DRAG_SIGN = -1;

/** A press travelling this many px or more (screen distance) is a drag, not a click. */
export const CLICK_MAX_PX = 6;

/** A press held this many ms or more is a drag/long-press, not a click. */
export const CLICK_MAX_MS = 400;

/** Arrival radius (m): inside this of the target, auto-move stops and clears. */
export const ARRIVE_DIST = 0.35;

/** No-progress window (s): net displacement is measured over spans this long. */
export const STUCK_WINDOW_SEC = 0.8;

/**
 * Minimum net displacement (m) per STUCK_WINDOW_SEC to count as progress. Free
 * walking covers MOVE_SPEED×window ≈ 3.2 m and even a shallow wall-slide well
 * over this; pinned against a wall/corner it is ~0 → the target is released.
 */
export const STUCK_MIN_DIST = 0.25;

/** The auto-move state: target + the no-progress measurement window. */
interface ClickMoveState {
  target: GroundVec | null;
  /** Window anchor position; `anchored` false until the first step seeds it. */
  anchorX: number;
  anchorZ: number;
  anchored: boolean;
  /** Seconds accumulated in the current displacement window. */
  windowSec: number;
}

const state: ClickMoveState = {
  target: null,
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
    __cvClickTarget?: () => GroundVec | null;
  }
}

/**
 * Click vs drag: true when the pointer travelled less than CLICK_MAX_PX (screen
 * distance from the down point) AND was held under CLICK_MAX_MS. The primary-
 * button / single-pointer requirements are enforced by the caller (CameraRig),
 * which owns the pointer bookkeeping.
 */
export function isClick(dxPx: number, dyPx: number, elapsedMs: number): boolean {
  return Math.hypot(dxPx, dyPx) < CLICK_MAX_PX && elapsedMs < CLICK_MAX_MS;
}

/**
 * Intersect a ray (origin `o`, direction `d` — normalization not required) with
 * the y=0 floor plane. Returns the ground point, or null when the ray points
 * level or upward (a click on the sky never produces a target).
 */
export function groundPoint(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): GroundVec | null {
  if (dy >= -1e-9) return null; // level or upward: no floor ahead
  const t = -oy / dy;
  if (t < 0) return null; // origin already below the floor (never in practice)
  return { x: ox + dx * t, z: oz + dz * t };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Set (or REPLACE — a re-click mid-move is the instant direction change design
 * 29 mandates) the auto-move target. The point is clamped into the reachable
 * band (WORLD_BOUNDS − PLAYER_RADIUS, the same clamp LocalPlayer applies to the
 * body) so an out-of-bounds click still ARRIVES at the wall instead of grinding
 * the stuck detector against an unreachable point. Each new target restarts the
 * no-progress window with a fresh budget.
 */
export function setClickTarget(x: number, z: number): void {
  state.target = {
    x: clamp(x, WORLD_BOUNDS.minX + PLAYER_RADIUS, WORLD_BOUNDS.maxX - PLAYER_RADIUS),
    z: clamp(z, WORLD_BOUNDS.minZ + PLAYER_RADIUS, WORLD_BOUNDS.maxZ - PLAYER_RADIUS),
  };
  state.anchored = false;
  state.windowSec = 0;
}

/** The live target (a copy), or null while auto-move is idle. */
export function getClickTarget(): GroundVec | null {
  return state.target ? { ...state.target } : null;
}

/** Drop the target (manual-input yield / sit-confirm — design 29 (b)/(e)). */
export function clearClickTarget(): void {
  state.target = null;
  state.anchored = false;
  state.windowSec = 0;
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
 * dirToIntent so the regular movement path does the actual moving.
 */
export function stepClickMove(px: number, pz: number, dt: number): GroundVec | null {
  const target = state.target;
  if (!target) return null;

  if (hasArrived(px, pz, target.x, target.z)) {
    clearClickTarget();
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
  state.windowSec += dt;
  if (state.windowSec >= STUCK_WINDOW_SEC) {
    if (Math.hypot(px - state.anchorX, pz - state.anchorZ) < STUCK_MIN_DIST) {
      clearClickTarget(); // blocked (wall/corner) — stop instead of grinding
      return null;
    }
    state.anchorX = px;
    state.anchorZ = pz;
    state.windowSec = 0;
  }

  const dx = target.x - px;
  const dz = target.z - pz;
  const len = Math.hypot(dx, dz); // ≥ ARRIVE_DIST here, never 0
  return { x: dx / len, z: dz / len };
}
