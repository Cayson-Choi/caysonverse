/**
 * Overview (top-down whole-map) camera math — pure, no three.js, no state
 * (design 20). The overview mode lifts the camera straight up and looks down so
 * the ENTIRE map fits in one frame (maze + lounge + lecture hall), with drag pan
 * and wheel/pinch zoom. These helpers are the tested core; the mutable pan/zoom
 * state lives in viewState and the three.js camera work in CameraRig.
 *
 * Framing derivation (three.js `fov` is the VERTICAL field of view):
 *   - screen-VERTICAL maps to world Z (the top-down up-vector is -Z ⇒ north up),
 *     visible half-extent on the ground = h·tan(fov/2);
 *   - screen-HORIZONTAL maps to world X, visible half-extent = h·tan(fov/2)·aspect.
 * To fit a `mapW × mapD` map with a small margin we take the higher of the two
 * required heights — so nothing is hardcoded and any aspect fits the whole map.
 */

/** Clamp helper (module-local; keeps this file dependency-free). */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Extra fraction of the map kept as empty margin around the framed overview (~5%). */
export const OV_FIT_MARGIN = 1.05;

/** Lowest the overview camera may zoom to (m) — close enough to read one corridor. */
export const OV_MIN_HEIGHT = 15;

/** Highest zoom-out, as a multiple of the whole-map fit height (a touch past full view). */
export const OV_MAX_HEIGHT_FACTOR = 1.1;

/** An axis-aligned world rectangle (WORLD_BOUNDS shape). */
export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Camera height (m) at which a `mapW × mapD` map fully fits under a `fovRad`
 * vertical FOV at viewport `aspect` (w/h), with `OV_FIT_MARGIN` breathing room.
 * The MAX of the depth-bound and width-bound heights fits BOTH axes.
 */
export function overviewFitHeight(
  mapW: number,
  mapD: number,
  fovRad: number,
  aspect: number,
  margin = OV_FIT_MARGIN,
): number {
  const t = Math.tan(fovRad / 2);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const hForDepth = ((mapD / 2) * margin) / t; // fit world Z in the screen vertical
  const hForWidth = ((mapW / 2) * margin) / (t * safeAspect); // fit world X in the screen horizontal
  return Math.max(hForDepth, hForWidth);
}

/**
 * Clamp the overview camera height into [OV_MIN_HEIGHT, fitHeight·OV_MAX_HEIGHT_FACTOR].
 * `fitHeight` is the current whole-map fit (aspect-dependent), so the ceiling
 * tracks the viewport and the user can never zoom so far the map is a speck nor
 * so close they lose the overview purpose.
 */
export function clampOverviewHeight(height: number, fitHeight: number): number {
  return clamp(height, OV_MIN_HEIGHT, fitHeight * OV_MAX_HEIGHT_FACTOR);
}

/**
 * Keep the pan CENTRE inside the world rectangle (design 20 — the centre never
 * leaves the map). Independent per axis; returns a fresh `{x, z}`.
 */
export function clampOverviewCenter(x: number, z: number, bounds: Bounds): { x: number; z: number } {
  return { x: clamp(x, bounds.minX, bounds.maxX), z: clamp(z, bounds.minZ, bounds.maxZ) };
}

/**
 * Convert a pointer drag (pixels) into a world-space pan of the overview centre,
 * grab-style (the world follows the finger, so the centre moves OPPOSITE the
 * drag). Scaled by the on-ground metres-per-pixel at this camera `height`, so the
 * same drag pans further when zoomed out. Screen X → world X (east +), screen Y
 * down → world Z (south +), matching the -Z-up top-down basis.
 */
export function overviewPanDelta(
  dxPx: number,
  dyPx: number,
  height: number,
  fovRad: number,
  viewportHpx: number,
): { dx: number; dz: number } {
  const worldPerPx = viewportHpx > 0 ? (2 * height * Math.tan(fovRad / 2)) / viewportHpx : 0;
  return { dx: -dxPx * worldPerPx, dz: -dyPx * worldPerPx };
}
