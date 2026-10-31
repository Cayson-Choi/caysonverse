/**
 * Name tag sizing and fading maths (controls-ux Task 13, spec §6) — pure, so it is
 * unit-tested without a canvas or a camera.
 *
 * The tag's text must stay readable but never shout: between NAMETAG_TEXT_PX.min and
 * .max projected CSS pixels at every distance. A perspective camera shrinks an object
 * as 1 / depth, so a fixed-size tag would be a speck at 25 m and a banner at 1 m. Here
 * the tag is held at NAMETAG_BASE_HEIGHT_M wherever that already lands in the band,
 * and is shrunk (near) or grown (far) just enough to sit on the band's edge elsewhere.
 *
 * Everything here is allocation-free: it runs per tag per frame.
 */

import {
  NAMETAG_BASE_HEIGHT_M,
  NAMETAG_FADE_END,
  NAMETAG_FADE_RATE,
  NAMETAG_FADE_START,
  NAMETAG_TEXT_FRACTION,
  NAMETAG_TEXT_PX,
} from "./constants";

/** Nearer than this the projection is not worth chasing (the tag is about to clip anyway). */
const MIN_DIST_M = 0.5;

/**
 * World height (m) of the WHOLE tag (capsule included) at `distM` from the camera,
 * for a camera with vertical field of view `fovRad` and a canvas `viewportHpx` CSS
 * pixels tall.
 *
 *   text px = tagHeight · NAMETAG_TEXT_FRACTION · vpH / (2 · d · tan(fov / 2))
 *
 * The natural size (NAMETAG_BASE_HEIGHT_M) is run through that, clamped into
 * NAMETAG_TEXT_PX, and the same formula is read backwards to turn the clamped pixels
 * into metres. `distM` should be the view-space depth (see viewDepth) for the sizes to
 * be exact toward the screen edges; a straight-line distance is only exact on-axis.
 * A degenerate camera or viewport falls back to the base size.
 */
export function nametagWorldHeight(distM: number, fovRad: number, viewportHpx: number): number {
  const d = Math.max(distM, MIN_DIST_M);
  const pxPerMetre = (NAMETAG_TEXT_FRACTION * viewportHpx) / (2 * d * Math.tan(fovRad / 2));
  if (!(pxPerMetre > 0) || !Number.isFinite(pxPerMetre)) return NAMETAG_BASE_HEIGHT_M;
  const naturalPx = NAMETAG_BASE_HEIGHT_M * pxPerMetre;
  if (naturalPx >= NAMETAG_TEXT_PX.min && naturalPx <= NAMETAG_TEXT_PX.max) {
    return NAMETAG_BASE_HEIGHT_M; // already in the band: exactly the designed size
  }
  const clampedPx = naturalPx < NAMETAG_TEXT_PX.min ? NAMETAG_TEXT_PX.min : NAMETAG_TEXT_PX.max;
  return clampedPx / pxPerMetre;
}

/**
 * Target opacity from the camera distance: 1 up to NAMETAG_FADE_START, then a straight
 * line down to 0 at NAMETAG_FADE_END (and beyond).
 */
export function distanceFade(distM: number): number {
  if (distM <= NAMETAG_FADE_START) return 1;
  if (distM >= NAMETAG_FADE_END) return 0;
  return (NAMETAG_FADE_END - distM) / (NAMETAG_FADE_END - NAMETAG_FADE_START);
}

/**
 * Move `current` toward `target` by at most `rate · dt` (opacity per second) and land
 * exactly on it rather than overshoot — so a tag dissolves over ~1/rate seconds instead
 * of popping, whatever the frame time. A zero, negative or NaN `dt` changes nothing.
 */
export function stepOpacity(
  current: number,
  target: number,
  dt: number,
  rate: number = NAMETAG_FADE_RATE,
): number {
  if (!(dt > 0)) return current;
  const step = rate * dt;
  const gap = target - current;
  if (Math.abs(gap) <= step) return target;
  return current + (gap > 0 ? step : -step);
}

/**
 * CSS pixels that one metre of height spans at view depth `depthM`, for a camera with
 * vertical field of view `fovRad` on a canvas `viewportHpx` tall — the factor that turns
 * a tag's world height into its screen height, and (inverted) a stacking lift in px into
 * metres. 0 for a degenerate camera or viewport, so callers can guard on it.
 */
export function pixelsPerMetre(depthM: number, fovRad: number, viewportHpx: number): number {
  const d = Math.max(depthM, MIN_DIST_M);
  const px = viewportHpx / (2 * d * Math.tan(fovRad / 2));
  return px > 0 && Number.isFinite(px) ? px : 0;
}

/**
 * Project the world point (x, y, z) through `m` — the camera's projection × view matrix
 * (`elements`, column-major) — into normalized device coordinates, written to `out`
 * (x right, y up, both −1..1 across the screen). Returns whether the point is in front of
 * the camera (between its near and far planes) and within `margin` of the screen — e.g.
 * 0.1 admits points up to 10 % of the half-screen outside it, so a tag hugging the edge
 * does not blink out. `out` is written only on a true return. Allocation-free.
 */
export function projectPoint(
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  margin: number,
  out: { x: number; y: number },
): boolean {
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (!(cw > 0)) return false;
  const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
  if (cz < -cw || cz > cw) return false;
  const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw;
  const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
  const limit = 1 + margin;
  if (nx < -limit || nx > limit || ny < -limit || ny > limit) return false;
  out.x = nx;
  out.y = ny;
  return true;
}

/**
 * Depth (m) of the world point (x, y, z) along the camera's forward axis, given the
 * camera's `matrixWorld.elements` (column-major; camera looks down its local -Z, so
 * forward = -column 2). Negative behind the camera. This is the number a perspective
 * projection actually divides by: unlike the straight-line distance it does not
 * over-state how far away a tag near the screen edge is.
 */
export function viewDepth(m: ArrayLike<number>, x: number, y: number, z: number): number {
  return -(m[8] * (x - m[12]) + m[9] * (y - m[13]) + m[10] * (z - m[14]));
}
