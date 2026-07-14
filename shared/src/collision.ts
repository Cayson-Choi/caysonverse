/**
 * Pure 2D (ground-plane, XZ) circle-vs-AABB collision. Browser-safe: no THREE,
 * no @colyseus/schema, no clocks — just geometry, so it is unit-testable and
 * shared VERBATIM by both sides of the wire:
 *
 *   - CLIENT integrates motion each frame and calls `resolveCollision` to slide
 *     the player along walls (axis-separated resolution).
 *   - SERVER re-checks the client's reported target with `isBlocked` and DROPS
 *     the move if it lands inside an obstacle (silent-drop policy).
 *
 * Both derive their obstacle list from the SAME `OBSTACLES` in worldMap.ts, so
 * there is exactly one source of collision truth. The two entry points differ
 * only in POLICY (slide vs. drop), never in the obstacle data or the geometry.
 */

/** Axis-aligned bounding box on the ground plane. */
export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Tolerance (m) the server allows before calling a target "inside" an obstacle.
 * A client that slid flush against a wall reports a point ~exactly `r` from the
 * face; floating-point rounding can nudge that a hair inside. This slack keeps
 * such legal wall-hugging targets from being falsely dropped, while any real
 * intrusion (cm-scale) is still rejected.
 */
export const COLLISION_EPS = 0.01;

/**
 * True when a circle (center `px,pz`, radius `r`) overlaps `box` by more than
 * `slack`. Uses the exact closest-point distance, so corners are ROUNDED (a
 * circle grazing a corner along the diagonal is not a hit even when it is within
 * `r` on each axis independently).
 */
export function circleIntersectsAABB(
  px: number,
  pz: number,
  r: number,
  box: AABB,
  slack = 0,
): boolean {
  const cx = px < box.minX ? box.minX : px > box.maxX ? box.maxX : px;
  const cz = pz < box.minZ ? box.minZ : pz > box.maxZ ? box.maxZ : pz;
  const dx = px - cx;
  const dz = pz - cz;
  const eff = r - slack;
  if (eff <= 0) return false;
  return dx * dx + dz * dz < eff * eff;
}

/** True if the circle overlaps ANY obstacle (server drop test). */
export function isBlocked(
  px: number,
  pz: number,
  r: number,
  obstacles: readonly AABB[],
  slack = COLLISION_EPS,
): boolean {
  for (const box of obstacles) {
    if (circleIntersectsAABB(px, pz, r, box, slack)) return true;
  }
  return false;
}

/**
 * Slide a circle of radius `r` from `(x,z)` by the desired delta `(dx,dz)`
 * against `obstacles`, resolving each axis independently.
 *
 * Axis separation is what produces gliding: the blocked axis is clamped to the
 * obstacle face (offset by `r`) while the free axis keeps its full motion, so
 * the player slides along walls and stops dead only in an inner corner (both
 * axes blocked). Because each axis clamps to the NEAR face the moment it would
 * cross it, a fast step cannot tunnel through — the obstacle is effectively
 * grown by `r` on every side (≥ `r` thick even for a zero-thickness wall), which
 * no single legal-speed step can leap.
 *
 * Obstacles are treated as square-cornered when expanded by `r`; this slightly
 * over-blocks the rounded Minkowski corners, which is safe (the returned point
 * never overlaps an obstacle under the exact test `isBlocked` uses) and keeps
 * the client's target acceptable to the server.
 */
export function resolveCollision(
  x: number,
  z: number,
  dx: number,
  dz: number,
  r: number,
  obstacles: readonly AABB[],
): { x: number; z: number } {
  // ── X axis: perpendicular overlap tested against the CURRENT z ──
  let nx = x + dx;
  if (dx !== 0) {
    for (const box of obstacles) {
      if (z <= box.minZ - r || z >= box.maxZ + r) continue; // not in this band
      const nearMin = box.minX - r; // face the +X mover stops at
      const nearMax = box.maxX + r; // face the -X mover stops at
      if (dx > 0 && x <= nearMin && nx > nearMin) nx = nearMin;
      else if (dx < 0 && x >= nearMax && nx < nearMax) nx = nearMax;
    }
  }

  // ── Z axis: perpendicular overlap tested against the RESOLVED x (post-slide) ──
  let nz = z + dz;
  if (dz !== 0) {
    for (const box of obstacles) {
      if (nx <= box.minX - r || nx >= box.maxX + r) continue;
      const nearMin = box.minZ - r;
      const nearMax = box.maxZ + r;
      if (dz > 0 && z <= nearMin && nz > nearMin) nz = nearMin;
      else if (dz < 0 && z >= nearMax && nz < nearMax) nz = nearMax;
    }
  }

  return { x: nx, z: nz };
}
