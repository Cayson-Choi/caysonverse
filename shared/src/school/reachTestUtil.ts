/**
 * Test-only helpers for the school map tests (hub + counselling room): a grid
 * flood fill ("where can a player body walk to from here?") and a few AABB/point
 * predicates. Nothing in production imports this file.
 *
 * The flood fill runs on a 0.25 m grid anchored AT the start point (so the start,
 * e.g. a spawn, is exactly a grid node), over the map bounds PLUS `margin` metres
 * on every side. The margin is what makes a "sealed" test meaningful: a leak in a
 * wall would let the fill escape into the strip beyond the bounds, where a plain
 * bounds-clipped fill would silently stop and report a false "sealed".
 */

import { isBlocked } from "../collision";
import type { AABB } from "../collision";
import { PLAYER_RADIUS } from "../worldMap";
import type { MapGeometry } from "./geometry";

export interface Pt {
  x: number;
  z: number;
}

/** Flood-fill grid step (m). */
export const GRID_STEP = 0.25;

/** How far past the map bounds the flood fill keeps going (m). */
export const OUTSIDE_MARGIN = 1.5;

const EPS = 1e-9;

/** Point in box, edges included. */
export function inside(box: AABB, p: Pt): boolean {
  return (
    p.x >= box.minX - EPS && p.x <= box.maxX + EPS && p.z >= box.minZ - EPS && p.z <= box.maxZ + EPS
  );
}

export function centre(box: AABB): Pt {
  return { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
}

/** True when some point of `points` lies within `tol` metres of `target`. */
export function hasNear(points: readonly Pt[], target: Pt, tol: number): boolean {
  for (const p of points) {
    if (Math.hypot(p.x - target.x, p.z - target.z) <= tol + EPS) return true;
  }
  return false;
}

/** True when the two boxes share more than an edge (positive overlap area). */
export function overlaps(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

/**
 * Every grid point a player body (radius PLAYER_RADIUS) can reach from `start` in
 * `geo`, walking 4-connected. The start itself must be free (asserted loudly, so a
 * blocked spawn fails the test instead of yielding an empty "sealed" set).
 */
export function reachable(
  geo: MapGeometry,
  start: Pt,
  step: number = GRID_STEP,
  margin: number = OUTSIDE_MARGIN,
): Pt[] {
  if (isBlocked(start.x, start.z, PLAYER_RADIUS, geo.obstacles)) {
    throw new Error(`reachable(): start (${start.x}, ${start.z}) is blocked in ${geo.id}`);
  }
  const b = geo.bounds;
  const iLo = Math.ceil((b.minX - margin - start.x) / step - EPS);
  const iHi = Math.floor((b.maxX + margin - start.x) / step + EPS);
  const jLo = Math.ceil((b.minZ - margin - start.z) / step - EPS);
  const jHi = Math.floor((b.maxZ + margin - start.z) / step + EPS);
  const cols = iHi - iLo + 1;
  const rows = jHi - jLo + 1;
  const seen = new Uint8Array(cols * rows);
  const idxOf = (i: number, j: number) => i - iLo + (j - jLo) * cols;

  const out: Pt[] = [];
  const stack: Array<[number, number]> = [[0, 0]];
  seen[idxOf(0, 0)] = 1;
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    out.push({ x: start.x + i * step, z: start.z + j * step });
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < iLo || ni > iHi || nj < jLo || nj > jHi) continue;
      const k = idxOf(ni, nj);
      if (seen[k]) continue;
      seen[k] = 1; // visited whether free or blocked: each cell is tested once
      if (!isBlocked(start.x + ni * step, start.z + nj * step, PLAYER_RADIUS, geo.obstacles)) {
        stack.push([ni, nj]);
      }
    }
  }
  return out;
}
