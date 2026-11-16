/**
 * The map's "내 위치" marker — the pure part. The marker is drawn in the world but sized for the screen: from 200 m up a
 * 2 m ring would be a speck, so its radius is a fixed number of screen pixels turned into metres at the camera's
 * height. It blinks and breathes so the eye finds it.
 */

/** Screen radius (px) of the marker's outer ring on a normal screen. */
export const MARKER_RING_PX = 30;
/** Never smaller than this on screen, whatever the viewport. */
export const MARKER_MIN_RING_PX = 22;
/** One blink (bright, dim, bright) every this many seconds. */
export const MARKER_BLINK_SEC = 0.9;

/** Metres of ground one screen pixel covers, looking straight down from `height` with a vertical fov of `fovRad`. */
export function metresPerPixel(height: number, fovRad: number, viewportHeightPx: number): number {
  if (!(viewportHeightPx > 0) || !(height > 0) || !(fovRad > 0)) return 0;
  return (2 * height * Math.tan(fovRad / 2)) / viewportHeightPx;
}

/** The marker's ring radius in metres for a camera height: `ringPx` screen pixels, never below the pre-map 1.75 m. */
export function markerRadiusMetres(height: number, fovRad: number, viewportHeightPx: number, ringPx = MARKER_RING_PX): number {
  const px = Math.max(ringPx, MARKER_MIN_RING_PX);
  return Math.max(1.75, metresPerPixel(height, fovRad, viewportHeightPx) * px);
}

/** Blink: opacity 0.35 (dim) .. 1 (bright), a smooth square-ish pulse of period MARKER_BLINK_SEC. */
export function blinkOpacity(seconds: number): number {
  const s = Math.sin((seconds / MARKER_BLINK_SEC) * Math.PI * 2);
  // squash the sine toward the extremes so it reads as a blink, not a slow fade
  const k = Math.tanh(s * 2.2) / Math.tanh(2.2);
  return 0.675 + 0.325 * k;
}

/** The expanding ripple ring: 0..1 progress of a ring that grows from the marker and fades, period 1.6 s. */
export function ripplePhase(seconds: number): number {
  const t = (seconds / 1.6) % 1;
  return t < 0 ? t + 1 : t;
}
