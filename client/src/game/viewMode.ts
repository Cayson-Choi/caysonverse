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
 *
 * First-person movement is camera-relative off the look yaw (`worldDirection`), like
 * a general 3D game: W/S walk along the look, A/D strafe. The look turns only by
 * explicit input (drag, Z/C keys) — there is no auto look-follow-movement.
 */

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
 * First-person look-pitch clamp (rad). Wider than the TP orbit pitch
 * ([minPitch -0.1, maxPitch 1.2]) so a first-person view can glance up at the
 * ceiling and down at the floor. Negative = look up, positive = look down.
 * Up to -1.5 (86°, 케이슨 마을's night sky): the star finder's reticle reaches
 * the zenith (Vega at 83° on a summer evening), and the look stays 4° short of
 * vertical so `lookAt` never flips.
 */
export const FP_PITCH_MIN = -1.5;
export const FP_PITCH_MAX = 1.2;

/**
 * Blend factor at/after which the OWN avatar group is hidden. Hiding at the
 * halfway point means the body vanishes as the camera dives to the eye and
 * reappears as it pulls back out — never a pop while the head fills the frame.
 */
export const HIDE_BLEND = 0.5;

/**
 * Overview blend factor at/after which the overview-only visuals apply: the self
 * marker shows, and the own avatar counts as third-person (visible even if the FP
 * it was opened from hid it). Gating on the BLEND — not the instant mode flip —
 * keeps both transitions pop-free (the HIDE_BLEND rule, applied to ov): at the
 * halfway point the camera is ~30 m up, so entering ov from FP never flashes the
 * body interior around the eye, and exiting keeps the avatar + marker on screen
 * while the camera is still high, only reverting mid-descent.
 */
export const OV_VIS_BLEND = 0.5;

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
 * `dt` (tab refocus) can't overshoot. Mirrors indoorCamera.stepCapEngage.
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
