/**
 * 동서남북 compass — the pure part. The world's north is -Z (the overview map has north at the top, east on the right),
 * east is +X. The heading is where the CAMERA looks, in degrees clockwise from north: 0 north, 90 east, 180 south,
 * 270 west. `compassState` is the one shared mutable value (a camera probe writes it each frame, the HUD dial reads
 * it each frame): never React state.
 */

/** The four named directions and their heading. */
export const CARDINALS = [
  { key: "N", label: "북", heading: 0 },
  { key: "E", label: "동", heading: 90 },
  { key: "S", label: "남", heading: 180 },
  { key: "W", label: "서", heading: 270 },
] as const;

/** Where the camera looks now (deg clockwise from north), written by CompassProbe, read by the HUD dial. */
export const compassState = { heading: 0 };

/** Wrap any angle (deg) into [0, 360). */
export function wrapDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const w = deg % 360;
  return w < 0 ? w + 360 : w;
}

/** Heading (deg, [0, 360)) of a horizontal look direction (dx east, dz south). 0 when there is no horizontal part. */
export function headingFromDirection(dx: number, dz: number): number {
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return 0;
  return wrapDeg((Math.atan2(dx, -dz) * 180) / Math.PI);
}

/** Heading of the follow camera's orbit yaw (the camera sits at +(sin yaw, cos yaw) from the player and looks back). */
export function headingFromYaw(yaw: number): number {
  return wrapDeg((-yaw * 180) / Math.PI);
}

const EIGHT = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"] as const;

/** The nearest of the eight named directions ("북", "북동", "동", ...) for a heading. */
export function directionName(heading: number): (typeof EIGHT)[number] {
  return EIGHT[Math.round(wrapDeg(heading) / 45) % 8];
}

/** The nearest of 동서남북 only (the dial's letter under the pointer). */
export function nearestCardinal(heading: number): (typeof CARDINALS)[number] {
  return CARDINALS[Math.round(wrapDeg(heading) / 90) % 4];
}

/** The dial turns the opposite way to the camera: rotation (deg) of the ring for a heading. */
export function ringRotation(heading: number): number {
  return -wrapDeg(heading);
}

/** Smallest change (deg) worth redrawing the dial for. */
export const COMPASS_EPSILON_DEG = 0.25;

/** True when the dial must be redrawn: it moved by more than the epsilon (wrapping at 0/360). */
export function headingChanged(prev: number, next: number): boolean {
  const d = Math.abs(wrapDeg(next - prev + 180) - 180);
  return d > COMPASS_EPSILON_DEG;
}
