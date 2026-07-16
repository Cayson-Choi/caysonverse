/**
 * First-person / third-person view-mode math (pure, no three.js, no state).
 *
 * caysonverse has ONE follow rig with TWO modes and ONE blend factor (design 19):
 *   - `tp` (third-person orbit) — the default; camera orbits the player.
 *   - `fp` (first-person) — camera at the player's eye, own avatar hidden.
 * A 0..1 `blend` factor eased over ~BLEND_SEC drives a no-teleport transition
 * between the two poses. These helpers are the tested, injected-dt core; the
 * mutable runtime state and the three.js camera work live in viewState.ts /
 * CameraRig.tsx.
 */

import { normalizeAngle, stepYaw } from "./yaw";

/**
 * The three view modes (design 19 + design 20):
 *   - `tp` (third-person orbit) — the default; camera orbits the player.
 *   - `fp` (first-person) — camera at the player's eye, own avatar hidden.
 *   - `ov` (overview) — a top-down bird's-eye of the WHOLE map (pan/zoom, self
 *     marker). Overlaid ON TOP of whichever mode was active; exiting restores it.
 */
export type ViewMode = "tp" | "fp" | "ov";

/** Seconds to ease the TP<->FP blend factor across a full toggle (design 19). */
export const BLEND_SEC = 0.25;

/**
 * Seconds to ease the overview enter/exit blend (design 20). Its own factor
 * (`ovBlend`), separate from the TP<->FP blend, so an overview toggle blends the
 * camera from whatever mode was active to the top-down pose and back — reversal-
 * safe (a mid-blend re-toggle continues, never snaps). Mirrors stepBlend usage.
 */
export const OV_BLEND_SEC = 0.3;

/**
 * First-person look-follows-movement turn rate (rad/s, design 20). When a
 * movement intent is active in FP the look yaw eases toward the WORLD direction
 * of travel at this rate — gentle enough (~2.5 rad/s) that holding a strafe reads
 * as a natural curved turn, not a snap. Drag look-control pauses it (see
 * `stepFollowYaw`), so the two inputs never fight.
 */
export const FP_FOLLOW_RATE = 2.5;

/**
 * First-person look-pitch clamp (rad). Wider than the TP orbit pitch
 * ([minPitch -0.1, maxPitch 1.2]) so a first-person view can glance up at the
 * ceiling and down at the floor. Negative = look up, positive = look down.
 */
export const FP_PITCH_MIN = -1.1;
export const FP_PITCH_MAX = 1.2;

/**
 * Blend factor at/after which the OWN avatar group is hidden. Hiding at the
 * halfway point means the body vanishes as the camera dives to the eye and
 * reappears as it pulls back out — never a pop while the head fills the frame.
 */
export const HIDE_BLEND = 0.5;

/** Follow-distance clamp band (metres). */
export interface ZoomBand {
  min: number;
  max: number;
}

/** Result of one zoom step: the resulting mode/distance and whether it toggled. */
export interface ZoomStep {
  mode: ViewMode;
  distance: number;
  toggled: boolean;
}

/** A distance this close to `min` counts as "at min" for the FP threshold. */
const AT_MIN_EPS = 1e-6;

/**
 * Advance a 0..1 blend factor toward `target` (0 = TP, 1 = FP) at a constant
 * 1/`duration` per second. Linear here (the eye-easing is applied at read time by
 * `easeBlend`) so a mid-blend reversal — flip the target — CONTINUES from the
 * current value instead of restarting or snapping. Clamped to [0,1]; a large
 * `dt` (tab refocus) can't overshoot. Mirrors mazeCamera.stepMazeCapEngage.
 */
export function stepBlend(current: number, target: number, dt: number, duration = BLEND_SEC): number {
  const step = duration > 0 ? dt / duration : 1;
  if (current < target) return Math.min(target, current + step);
  if (current > target) return Math.max(target, current - step);
  return current;
}

/**
 * Smoothstep ease for the blend factor: flat at both ends so the camera glides
 * out of TP and settles into FP (and back) without a velocity discontinuity.
 * Input is clamped to [0,1].
 */
export function easeBlend(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Clamp a first-person look pitch into the wider FP range. */
export function clampFpPitch(pitch: number): number {
  return pitch < FP_PITCH_MIN ? FP_PITCH_MIN : pitch > FP_PITCH_MAX ? FP_PITCH_MAX : pitch;
}

/** A ground-plane direction (XZ), as produced by `worldDirection`. */
interface Dir2 {
  x: number;
  z: number;
}

/**
 * The FP look yaw that points ALONG a world ground direction `(dx, dz)`.
 *
 * The FP forward look for yaw `y` is `(-sin y, -cos y)` (CameraRig), so a yaw that
 * looks toward `(dx, dz)` is `atan2(-dx, -dz)` — the exact inverse. Returns
 * `fallback` (normalized-safe caller yaw) for a zero-length vector so a stationary
 * frame never produces NaN.
 */
export function lookYawForDir(dx: number, dz: number, fallback: number): number {
  if (Math.hypot(dx, dz) < 1e-9) return fallback;
  return normalizeAngle(Math.atan2(-dx, -dz));
}

/**
 * One frame of first-person look-follows-movement (design 20). Eases the look
 * yaw toward the WORLD movement direction along the shortest arc at
 * `rate` rad/s, wrap-safe. Key properties:
 *   - Moving straight forward (W) → target == current look → ZERO rotation.
 *   - Strafing left (A) → the look swings left; because movement is camera-
 *     relative, the target stays ~π/2 ahead, yielding a smooth curved turn.
 *   - `dragging` (a one-finger look drag in progress) PAUSES the follow so the
 *     manual look and the auto-follow never fight; it resumes on release.
 *   - Zero movement holds the current yaw (never NaN).
 *
 * Pure and dt-injected; the mutable fp yaw lives in viewState, the drag flag is
 * set by CameraRig's pointer handlers.
 */
export function stepFollowYaw(
  fpYaw: number,
  moveDir: Dir2,
  dt: number,
  dragging: boolean,
  rate = FP_FOLLOW_RATE,
): number {
  if (dragging) return fpYaw; // drag priority — auto-follow steps aside
  const target = lookYawForDir(moveDir.x, moveDir.z, fpYaw);
  return stepYaw(fpYaw, target, rate * dt);
}

/**
 * One unified zoom step for BOTH the wheel and the pinch (they differ only in how
 * they derive `delta`). `delta` is the signed metres to add to the follow
 * distance: negative = zoom IN (toward min), positive = zoom OUT (toward max).
 *
 * Threshold semantics (design 19):
 *   - TP, already AT min, one more inward notch → cross into FP (distance kept).
 *   - TP otherwise → clamp the distance into the band, stay TP (an inward notch
 *     that merely REACHES min does not toggle; the NEXT inward notch does).
 *   - FP, any outward notch → back to TP. The distance is returned UNCHANGED, so
 *     the TP zoom the user had before entering FP is preserved across the round-
 *     trip (a wheel-entered FP was at min, so it lands back at min).
 *   - FP, inward / no motion → no-op (FP has no follow distance to change).
 */
export function stepZoomMode(
  mode: ViewMode,
  distance: number,
  delta: number,
  { min, max }: ZoomBand,
): ZoomStep {
  if (mode === "fp") {
    if (delta > 0) return { mode: "tp", distance, toggled: true }; // outward exits FP
    return { mode: "fp", distance, toggled: false }; // FP ignores zoom
  }
  const atMin = distance <= min + AT_MIN_EPS;
  if (delta < 0 && atMin) return { mode: "fp", distance, toggled: true }; // one notch past min
  const next = distance + delta;
  const clamped = next < min ? min : next > max ? max : next;
  return { mode: "tp", distance: clamped, toggled: false };
}
