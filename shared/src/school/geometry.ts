/**
 * One map's collision truth, packaged: `MapGeometry` is what the server's movement check,
 * the client's slide resolver and the camera spring arm all read for the map a player is
 * standing in (the legacy world, the school hub with its gate open or shut, or a team's
 * room). Browser-safe: it imports only the `AABB` type — no THREE, no schema, no clocks.
 *
 * `wallsAround` builds the wall boxes of a rectangular room; `makeGeometry` bundles walls
 * and props. Same rules as worldMap.ts: the wall boxes are BOTH the collision truth and the
 * render geometry, and every box is an axis-aligned rectangle on the ground plane.
 */

import type { AABB } from "../collision";

/** Playable rectangle of a map (the server clamps moves to it). Same shape as `AABB`. */
export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type GeometryId = "legacy" | "hub-open" | "hub-gated" | "counsel";

export interface MapGeometry {
  id: GeometryId;
  bounds: Bounds;
  /** Everything a player body collides with: walls, then props. */
  obstacles: readonly AABB[];
  /** The tall boxes the third-person camera must not see through: the walls only. */
  cameraBoxes: readonly AABB[];
}

/**
 * A gap in one side of a room's wall. `side` is the compass side — north is -z, so "n"/"s"
 * walls run along X and `from`/`to` are x values; "e"/"w" walls run along Z and `from`/`to`
 * are z values. Order of `from`/`to` does not matter.
 */
export interface Opening {
  side: "n" | "s" | "e" | "w";
  from: number;
  to: number;
}

/** Default wall thickness (m), same as worldMap.ts' WALL_THICKNESS. */
export const DEFAULT_WALL_THICKNESS = 0.5;

/**
 * The part of `[lo, hi]` left after cutting out `cuts`: the wall pieces along one side.
 * Cuts may be unsorted, overlapping, reversed or hang past either end; empty pieces are
 * never returned.
 */
function cutInterval(lo: number, hi: number, cuts: readonly Opening[]): Array<[number, number]> {
  const sorted = cuts
    .map((c): [number, number] => (c.from <= c.to ? [c.from, c.to] : [c.to, c.from]))
    .sort((a, b) => a[0] - b[0]);
  const pieces: Array<[number, number]> = [];
  let cursor = lo;
  for (const [from, to] of sorted) {
    if (from > cursor) pieces.push([cursor, Math.min(from, hi)]);
    if (to > cursor) cursor = to;
    if (cursor >= hi) break;
  }
  if (cursor < hi) pieces.push([cursor, hi]);
  return pieces.filter(([a, b]) => b > a);
}

/**
 * The four walls of `zone`, each `thickness` thick and attached to the OUTSIDE of it (the
 * zone's own rectangle stays completely free), minus the `openings`. Every wall runs
 * `thickness` past both ends of its side, so adjacent walls overlap in the corner squares and
 * the shell is watertight. Output order: north, south, east, west pieces, low to high.
 *
 * A body of radius 0.4 only fits through an opening wider than 0.8 m (the wall boxes are not
 * rounded), so pick doorways of at least ~2 m for comfortable movement.
 */
export function wallsAround(
  zone: AABB,
  openings: readonly Opening[] = [],
  thickness: number = DEFAULT_WALL_THICKNESS,
): AABB[] {
  const t = thickness;
  const forSide = (side: Opening["side"]) => openings.filter((o) => o.side === side);
  const out: AABB[] = [];
  for (const [minX, maxX] of cutInterval(zone.minX - t, zone.maxX + t, forSide("n"))) {
    out.push({ minX, maxX, minZ: zone.minZ - t, maxZ: zone.minZ });
  }
  for (const [minX, maxX] of cutInterval(zone.minX - t, zone.maxX + t, forSide("s"))) {
    out.push({ minX, maxX, minZ: zone.maxZ, maxZ: zone.maxZ + t });
  }
  for (const [minZ, maxZ] of cutInterval(zone.minZ - t, zone.maxZ + t, forSide("e"))) {
    out.push({ minX: zone.maxX, maxX: zone.maxX + t, minZ, maxZ });
  }
  for (const [minZ, maxZ] of cutInterval(zone.minZ - t, zone.maxZ + t, forSide("w"))) {
    out.push({ minX: zone.minX - t, maxX: zone.minX, minZ, maxZ });
  }
  return out;
}

/**
 * Bundle a map: `obstacles` = walls then props, `cameraBoxes` = the walls only (low props
 * are looked over, not through). Both arrays are fresh copies, so later changes to the
 * caller's arrays cannot alter a finished geometry.
 */
export function makeGeometry(
  id: GeometryId,
  bounds: Bounds,
  walls: readonly AABB[],
  props: readonly AABB[],
): MapGeometry {
  return { id, bounds, obstacles: [...walls, ...props], cameraBoxes: [...walls] };
}
