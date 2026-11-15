/**
 * The follow camera against the solid model of the place the player is in (round 8 review, 2026-11-15).
 *
 * The spring arm (cameraCollision.ts) casts against the map's wall boxes, and the place's limit (indoorCamera.ts) holds the
 * camera under the hall's ceiling at 4.1 m — but the family lounge's oak louvres hang under that ceiling down to 3.88 m, and a
 * player who dragged the view up near the lounge had the camera up among the slats: 70-96 % of the screen was wood. Nothing
 * there is a wall box. Here the camera spot is shaped one frame at a time against the place's real triangles (a SolidIndex,
 * hallSolidIndex.ts, that the hall registers while it is mounted):
 *   1. under anything hung from the ceiling the spot is held `HUNG.clear` below its underside — easing back up away from it
 *      (`HUNG.slope`), so walking out from under the louvres the camera rises smoothly, never steps;
 *   2. a solid triangle between the head and the spot pulls the spot in along that line to `LENS` short of it (a sofa's back, a
 *      louvre's end, a cubby bank's edge), eased back out like the spring arm;
 *   3. never nearer than `LENS_NEAR` to a surface: the spot steps in toward the head until it is clear.
 * Like every arm change it shapes the frame only — the player's orbit is never written — and with no index registered (outdoors,
 * the tests) nothing changes.
 */

/** What the follow camera asks of the place's solid model (hallSolidIndex.ts SolidIndex is one). */
export interface CameraSolidModel {
  segmentHit(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number;
  nearSolid(x: number, y: number, z: number, r: number): boolean;
  hungCap(x: number, z: number, from: number, clear: number, near: number, slope: number): number;
}

/** Things hung from the ceiling: flat faces at least `from` m up; the lens stays `clear` under them, rising `slope` per metre out past `near`. */
export const HUNG = { from: 3.5, clear: 0.4, near: 0.4, slope: 1.2 } as const;
/** The lens's own radius (m): never nearer than this to a surface. */
export const LENS = 0.3;
/** …and the spot never within this of one (m): a little under the wall boxes' own pad, so the two never fight. */
export const LENS_NEAR = 0.2;
/** Never pulled nearer the head than this (m). */
export const SOLID_MIN_DIST = 0.6;

let model: CameraSolidModel | null = null;

/** Register (or clear) the solid model; returns the unregister for that one model. */
export function setCameraSolids(m: CameraSolidModel | null): () => void {
  model = m;
  return () => {
    if (model === m) model = null;
  };
}

export function cameraSolids(): CameraSolidModel | null {
  return model;
}

/** A spot shaped against the solids (written into a caller-owned object). */
export interface SolidSpot {
  x: number;
  y: number;
  z: number;
  /** How far (m) the clear line from the head reaches this frame (Infinity: the whole way). */
  clear: number;
}

/**
 * The spot (x, y, z) for a head at (hx, hy, hz), against `m`: held under hung things, then pulled in to the clear part of the
 * line from the head (`limit`: the eased clear length the caller carries, m — the spot is never farther out than it). Writes
 * `out.clear`: the clear length found this frame (the caller eases its limit toward it).
 */
export function shapeAgainstSolids(
  m: CameraSolidModel,
  hx: number,
  hy: number,
  hz: number,
  x: number,
  y: number,
  z: number,
  limit: number,
  out: SolidSpot,
): SolidSpot {
  // 1. under the louvres (and the soffit, the ceiling): held below their underside
  const cap = m.hungCap(x, z, HUNG.from, HUNG.clear, HUNG.near, HUNG.slope);
  if (y > cap) y = Math.max(hy, cap);
  // 2. the line from the head: pulled in to LENS short of the first solid face on it
  let dx = x - hx;
  let dy = y - hy;
  let dz = z - hz;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) {
    out.x = x;
    out.y = y;
    out.z = z;
    out.clear = Infinity;
    return out;
  }
  dx /= len;
  dy /= len;
  dz /= len;
  const hit = m.segmentHit(hx, hy, hz, x, y, z);
  let clear = hit === Infinity ? Infinity : Math.max(SOLID_MIN_DIST, hit - LENS);
  // 3. and the lens itself clear of every surface: in toward the head, 0.1 m at a time
  let d = Math.min(len, clear, limit);
  let pulled = false;
  for (let i = 0; i < 40 && d > SOLID_MIN_DIST && m.nearSolid(hx + dx * d, hy + dy * d, hz + dz * d, LENS_NEAR); i++) {
    d -= 0.1;
    pulled = true;
  }
  d = Math.max(Math.min(len, SOLID_MIN_DIST), d);
  if (pulled) clear = Math.min(clear, d);
  out.x = hx + dx * d;
  out.y = hy + dy * d;
  out.z = hz + dz * d;
  out.clear = clear;
  return out;
}
