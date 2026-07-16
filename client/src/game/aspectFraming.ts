/**
 * Aspect-aware camera framing.
 *
 * three.js `fov` is the VERTICAL field of view, so the horizontal view shrinks
 * with the aspect ratio: hFov = 2·atan(tan(vFov/2)·aspect). On a phone held in
 * portrait (aspect ≈ 0.5) that makes the avatar fill the screen and hides the
 * world around it — exactly what you need to see in a social space.
 *
 * Rather than widening the fov (which fisheyes the scene), we pull the follow
 * camera back on narrow viewports. Landscape/desktop (aspect ≥ 1) is left
 * EXACTLY as-is (scale 1), so this can only affect portrait screens.
 *
 * The compensation is square-root damped and capped: fully compensating the
 * visible width (∝ 1/aspect) would shove the avatar into the distance, so we
 * take the square root and clamp it.
 */

/** Portrait pull-back is capped here (very tall/narrow screens). */
export const PORTRAIT_MAX_SCALE = 1.6;

/**
 * Multiplier applied to the follow distance for a viewport aspect (w/h).
 * Returns 1 for landscape/square and for any invalid input; grows toward
 * PORTRAIT_MAX_SCALE as the viewport gets narrower.
 */
export function aspectDistanceScale(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return 1;
  if (aspect >= 1) return 1;
  return Math.min(Math.sqrt(1 / aspect), PORTRAIT_MAX_SCALE);
}
