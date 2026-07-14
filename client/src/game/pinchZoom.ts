/**
 * Two-finger pinch → camera zoom (pure). Maps a change in finger spread (pixels)
 * to a new orbit distance, clamped into the existing zoom band. Spreading fingers
 * apart pulls the camera IN (smaller distance); pinching together pushes it OUT —
 * the familiar map-pinch convention.
 */

/** Tuning + clamp band for a pinch step. */
export interface PinchZoomOptions {
  /** Metres of orbit distance per pixel of spread change. */
  speed: number;
  /** Nearest allowed orbit distance (m). */
  min: number;
  /** Farthest allowed orbit distance (m). */
  max: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Given the current orbit distance and the previous/current finger spreads,
 * return the new clamped orbit distance. A larger current spread ⇒ zoom in.
 */
export function applyPinchZoom(
  distance: number,
  prevSpread: number,
  currSpread: number,
  { speed, min, max }: PinchZoomOptions,
): number {
  const next = distance + (prevSpread - currSpread) * speed;
  return clamp(next, min, max);
}
