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
 * A box the third-person camera must not see through: an `AABB` plus how tall it stands (m). A box without
 * `height` is as tall as a wall (the camera's default); a tall prop (a locker bank, a bookcase) states its own,
 * so the camera can look over what is lower than the camera and not through what is higher.
 *
 * `minY` lifts the bottom: the box then spans `minY..height` instead of `0..height`. That is a CEILING slab (the
 * roof of a building seen from inside): a camera under it is stopped short of the underside, so the view never
 * pokes through the roof. Absent (every wall and prop) the box starts at the floor, as before.
 */
export interface CameraBox extends AABB {
  height?: number;
  minY?: number;
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

// ───────────────────────────── a static obstacle list, indexed (the server's drop test) ─────────────────────────────

/** `isBlocked` over one fixed obstacle list, answered from a grid instead of a scan of the whole list. */
export interface ObstacleIndex {
  /** Exactly `isBlocked(px, pz, r, obstacles, slack)`. */
  isBlocked(px: number, pz: number, r: number, slack?: number): boolean;
  /** How many boxes the grid holds per cell at most, and how many are too large for it (scanned each time). */
  readonly stats: { cells: number; maxPerCell: number; large: number };
}

/** The grid's cell (m) and the largest radius it answers (a larger one scans the list). */
const INDEX_CELL = 4;
const INDEX_MAX_R = 1;
/** A box over this many cells is kept in a short list of its own (the area blockers, the banks). */
const INDEX_LARGE_CELLS = 64;

const indexes = new WeakMap<readonly AABB[], ObstacleIndex>();

/**
 * The index of a STATIC obstacle list (a map's own: `MapGeometry.obstacles`, never a list that is refilled each frame), built
 * once on first use. The village map holds about 1,400 boxes and the server tests every move of every player against them
 * (movement.ts): a hundred walkers at 15 moves a second were 2 million box tests a second for an answer that depends on the
 * handful of boxes round the body. With the grid a test reads one cell (2026-11-21, when every lamp post, bench, flowerbed
 * and bush became a box of its own).
 */
export function obstacleIndex(obstacles: readonly AABB[]): ObstacleIndex {
  const known = indexes.get(obstacles);
  if (known) return known;
  const grid = new Map<number, AABB[]>();
  const large: AABB[] = [];
  const key = (ix: number, iz: number): number => (ix + 32768) * 65536 + (iz + 32768);
  let maxPerCell = 0;
  for (const b of obstacles) {
    const x0 = Math.floor((b.minX - INDEX_MAX_R) / INDEX_CELL);
    const x1 = Math.floor((b.maxX + INDEX_MAX_R) / INDEX_CELL);
    const z0 = Math.floor((b.minZ - INDEX_MAX_R) / INDEX_CELL);
    const z1 = Math.floor((b.maxZ + INDEX_MAX_R) / INDEX_CELL);
    if (!Number.isFinite(x0 + x1 + z0 + z1) || (x1 - x0 + 1) * (z1 - z0 + 1) > INDEX_LARGE_CELLS) {
      large.push(b);
      continue;
    }
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(b);
        if (list.length > maxPerCell) maxPerCell = list.length;
      }
    }
  }
  const index: ObstacleIndex = {
    isBlocked(px, pz, r, slack = COLLISION_EPS) {
      if (!(r <= INDEX_MAX_R) || !Number.isFinite(px) || !Number.isFinite(pz)) return isBlocked(px, pz, r, obstacles, slack);
      for (let i = 0; i < large.length; i++) if (circleIntersectsAABB(px, pz, r, large[i]!, slack)) return true;
      const list = grid.get(key(Math.floor(px / INDEX_CELL), Math.floor(pz / INDEX_CELL)));
      if (!list) return false;
      for (let i = 0; i < list.length; i++) if (circleIntersectsAABB(px, pz, r, list[i]!, slack)) return true;
      return false;
    },
    stats: { cells: grid.size, maxPerCell, large: large.length },
  };
  indexes.set(obstacles, index);
  return index;
}
