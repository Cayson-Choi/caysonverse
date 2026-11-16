/**
 * B1 waterfall, W5: walking at the falls' rest area (폭포 쉼터; docs/designs/waterfall/design.md section 3, 8, 12).
 *
 * The numbers are `VILLAGE_LAYOUT.backdrop.waterfall` (W0's lock). The rest area is a pocket west of the village's walk
 * bounds (x -106..-95, z -90..-68), so everything here is plain boxes the server and the client both read through
 * `villageGeometry` (one collision truth):
 *
 *  - the walk area grows by the pocket (`villageWalkArea`), and the two strips of the pocket's column north and south of
 *    it are solid (`pocketBlockers`, thick enough for one legal step, as `hallSurroundBlockers`);
 *  - the pool cannot be entered: its waterline ellipse grown by the keep-out (0.6 m) is solid, built as a staircase of
 *    0.125 m rows that covers the ellipse from outside (`poolBlockers`), grown by the keep-out less the body radius, so
 *    that the body's centre (one radius off the boxes) keeps the 0.6 m. The four flat rocks (slabs) are the shore's edge stones: ground inside the keep-out that
 *    lies wholly on a slab is open (falls_shape.py `walk_surface_ok`: a standing centre is fine on a slab). The front
 *    one reaches over the water at x ~ -104.5;
 *  - the two stone seats are solid boxes (the seats themselves are in benchSeats.ts);
 *  - the camera keeps out of the rock along the layout's `cameraWall` polyline (`cameraWallBoxes`);
 *  - a click on the pool's water walks to the nearest shore spot (`fallsShoreSpot`).
 *
 * Pure: no THREE, no schema. Imports only types from villageLayout (which imports this file).
 */

import type { AABB, CameraBox } from "../collision";
import type { Bounds } from "../school/geometry";
import type { VillageLayout, WaterfallSlab } from "./villageLayout";
import { PLAYER_RADIUS } from "../worldMap";

/** The staircase's cell (m): the staircase swells the ellipse by up to a cell's diagonal (0.18 m). */
export const POOL_CELL = 0.125;
/** How far past the waterline a click still counts as on the pool (m): the keep-out ring, so the shore's gravel pushes out normally. */
const POOL_CLICK_GROW = 0.6;
/** The camera wall's height (m): over the cliff's top (the plateau, 41 m). */
export const CAMERA_WALL_TOP = 45;
/** How far under the floor the camera wall reaches (m): a low arm (pitch -0.1, 18 m) ends under y = 0 before the floor stop lifts it, so it must not dive under the wall. */
export const CAMERA_WALL_DEPTH = 10;

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** Whether the layout opens the rest area at all. */
export function fallsWalkable(layout: VillageLayout): boolean {
  return layout.backdrop.waterfall.options.walkable;
}

/**
 * The rectangle a player walks in: the village's area plus the waterfall pocket (when walkable). The rest area's
 * column at the village's west edge is x -106..-95, so the union is the village rectangle pushed west to the pocket.
 */
export function villageWalkArea(layout: VillageLayout): Bounds {
  const v = layout.areas.village;
  if (!fallsWalkable(layout)) return { ...v };
  const p = layout.backdrop.waterfall.pocket;
  return { minX: Math.min(v.minX, p.minX), maxX: v.maxX, minZ: v.minZ, maxZ: v.maxZ };
}

/**
 * The rectangle a click may pick ground in: the walk area plus the pool's whole waterline (x past the pocket's west edge),
 * so a click on the far side of the water is seen and walked to the shore instead of being ignored.
 */
export function villagePickArea(layout: VillageLayout): Bounds {
  const area = villageWalkArea(layout);
  if (!fallsWalkable(layout)) return area;
  const { pool } = layout.backdrop.waterfall;
  return { ...area, minX: Math.min(area.minX, round(pool.centre.x - pool.radiusX - 1)) };
}

/** Whether (x, z) is in the pocket, west of the village's walk bounds: the rest area's own ground (HUD name, tests). */
export function inFallsRestArea(layout: VillageLayout, x: number, z: number): boolean {
  if (!fallsWalkable(layout)) return false;
  const p = layout.backdrop.waterfall.pocket;
  return x >= p.minX && x < layout.walkBounds.minX && z >= p.minZ && z <= p.maxZ;
}

/** Normalised radius of the pool's waterline ellipse grown by `grow` (1 = on it). */
export function poolRadius(layout: VillageLayout, x: number, z: number, grow = 0): number {
  const { pool } = layout.backdrop.waterfall;
  return Math.hypot((x - pool.centre.x) / (pool.radiusX + grow), (z - pool.centre.z) / (pool.radiusZ + grow));
}

/** Normalised radius of (x, z) in a slab's own (turned) frame (1 = on the slab's edge). */
export function slabRadius(s: WaterfallSlab, x: number, z: number): number {
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  const dx = x - s.centre.x;
  const dz = z - s.centre.z;
  return Math.hypot((dx * c - dz * sn) / s.radiusX, (dx * sn + dz * c) / s.radiusZ);
}

/** Whether (x, z) lies on one of the flat rocks. */
export function onSlab(layout: VillageLayout, x: number, z: number): boolean {
  return layout.backdrop.waterfall.slabs.some((s) => slabRadius(s, x, z) < 1);
}

/** W0's rule (falls_shape.py walk_surface_ok), without the outlet: may a standing CENTRE be here? */
export function fallsWalkSurfaceOk(layout: VillageLayout, x: number, z: number): boolean {
  const { pocket, pool } = layout.backdrop.waterfall;
  if (!(x >= pocket.minX && x <= pocket.maxX && z >= pocket.minZ && z <= pocket.maxZ)) return false;
  if (onSlab(layout, x, z)) return true;
  return poolRadius(layout, x, z, pool.keepOut) >= 1;
}

/**
 * The solid ground that closes the pocket's column of the village's west edge: north of the pocket (from the area's
 * north edge) and south of it (to the area's south edge). Each is far thicker than one legal step (up to 4.8 m: the
 * server judges only where a step lands), so nobody leaves the pocket along the column. West of the pocket the walk
 * area ends (`villageWalkArea`).
 */
export function pocketBlockers(layout: VillageLayout): AABB[] {
  if (!fallsWalkable(layout)) return [];
  const { pocket } = layout.backdrop.waterfall;
  const v = layout.areas.village;
  const out: AABB[] = [];
  if (v.minZ < pocket.minZ) out.push({ minX: pocket.minX, maxX: pocket.maxX, minZ: v.minZ, maxZ: pocket.minZ });
  if (pocket.maxZ < v.maxZ) out.push({ minX: pocket.minX, maxX: pocket.maxX, minZ: pocket.maxZ, maxZ: v.maxZ });
  return out;
}

/**
 * The pool as solid boxes inside the pocket: every 0.125 m cell the waterline ellipse grown by the keep-out (less the body radius) touches, except
 * a cell lying wholly on a slab (the shore's edge stones stay walkable). The cells of a row join into one box and equal
 * boxes of neighbouring rows join into one (a few dozen boxes). They reach west to 1 m past the pocket's edge; beyond
 * that the walk area ends anyway.
 */
export function poolBlockers(layout: VillageLayout): AABB[] {
  if (!fallsWalkable(layout)) return [];
  const { pocket, pool, slabs } = layout.backdrop.waterfall;
  const c = POOL_CELL;
  // The boxes stand the keep-out less the body radius (and 0.1 m for the staircase and the ellipse's own slack) off the waterline, so
  // a body's CENTRE, one radius off the boxes, stays at least W0's keep-out (0.6 m) from the water: falls_shape.py walk_surface_ok.
  const grow = Math.max(0, pool.keepOut - PLAYER_RADIUS) + 0.1;
  const i0 = Math.floor((pocket.minX - 1) / c);
  const i1 = Math.ceil(pocket.maxX / c);
  const j0 = Math.floor(pocket.minZ / c);
  const j1 = Math.ceil(pocket.maxZ / c);
  const inRing = (x: number, z: number) => poolRadius(layout, x, z, grow) < 1;
  const blocked = (i: number, j: number): boolean => {
    const xs = [i * c, (i + 1) * c];
    const zs = [j * c, (j + 1) * c];
    const pts = [
      [xs[0], zs[0]],
      [xs[1], zs[0]],
      [xs[0], zs[1]],
      [xs[1], zs[1]],
      [(xs[0] + xs[1]) / 2, (zs[0] + zs[1]) / 2],
    ];
    if (!pts.some(([x, z]) => inRing(x, z))) return false;
    // wholly on one slab (all four corners: an ellipse is convex): the shore stone, open
    return !slabs.some((s) => pts.slice(0, 4).every(([x, z]) => slabRadius(s, x, z) < 1));
  };
  const out: AABB[] = [];
  /** The boxes still growing downward (south), by their x run. */
  let open = new Map<string, AABB>();
  for (let j = j0; j < j1; j++) {
    const next = new Map<string, AABB>();
    let i = i0;
    while (i < i1) {
      if (!blocked(i, j)) {
        i++;
        continue;
      }
      const start = i;
      while (i < i1 && blocked(i, j)) i++;
      const key = `${start},${i}`;
      const box = open.get(key);
      if (box) {
        box.maxZ = round((j + 1) * c);
        next.set(key, box);
        open.delete(key);
      } else {
        const fresh: AABB = { minX: round(start * c), maxX: round(i * c), minZ: round(j * c), maxZ: round((j + 1) * c) };
        out.push(fresh);
        next.set(key, fresh);
      }
    }
    open = next;
  }
  return out;
}

/** The two seat stones' boxes (the stones are solid; the seats are on their long sides: benchSeats.ts). */
export function seatStoneBlockers(layout: VillageLayout): AABB[] {
  const { seats, options } = layout.backdrop.waterfall;
  if (!options.seats) return [];
  return seats.map((s) => ({
    minX: round(s.centre.x - s.size.x / 2),
    maxX: round(s.centre.x + s.size.x / 2),
    minZ: round(s.centre.z - s.size.z / 2),
    maxZ: round(s.centre.z + s.size.z / 2),
  }));
}

/** Everything the rest area adds to the village's obstacles (the geometry the server and the client share). */
export function waterfallObstacles(layout: VillageLayout): AABB[] {
  return [...pocketBlockers(layout), ...poolBlockers(layout), ...seatStoneBlockers(layout)];
}

/**
 * The camera wall as boxes: one per leg of the `cameraWall` polyline, from the rock's side (the site's west edge) to the
 * leg's eastmost end, so the camera stops no nearer the rock than the line (a leg's boxes err toward the pocket, never
 * toward the rock). The first leg also covers the site's north end and the last its south end. The camera's spring arm
 * (cameraCollision.ts) is stopped by these as by any wall, so it never ends inside the cliff or the canyon's sides.
 */
export function cameraWallBoxes(layout: VillageLayout): CameraBox[] {
  if (!fallsWalkable(layout)) return [];
  const { cameraWall: w, site, height } = layout.backdrop.waterfall;
  const top = Math.max(CAMERA_WALL_TOP, height + 9);
  const out: CameraBox[] = [];
  for (let i = 1; i < w.length; i++) {
    out.push({
      minX: site.minX,
      maxX: round(Math.max(w[i - 1].x, w[i].x)),
      minZ: i === 1 ? site.minZ : w[i - 1].z,
      maxZ: i === w.length - 1 ? site.maxZ : w[i].z,
      minY: -CAMERA_WALL_DEPTH,
      height: top,
    });
  }
  return out;
}

// ───────────────────────────── a click on the water ─────────────────────────────

/** The grid (m) of the shore search. */
const SHORE_GRID = 0.1;
/** A candidate spot sits this far (m) inside the free region, so it stays free through rounding. */
const SHORE_SLACK = 0.02;
const shoreCache = new WeakMap<VillageLayout, readonly { x: number; z: number }[]>();

/**
 * The standing spots of the rest area that touch what is not free (the pool's solid ring, the stones, the pocket's
 * edge): every grid point a body (PLAYER_RADIUS) stands on that has a neighbour it does not, kept only where it is
 * joined to the entry (the walk from the plaza reaches it). The nearest free spot to a click on the water is one of these.
 */
function shoreSpots(layout: VillageLayout): readonly { x: number; z: number }[] {
  const cached = shoreCache.get(layout);
  if (cached) return cached;
  const { pocket, entry } = layout.backdrop.waterfall;
  const boxes = waterfallObstacles(layout);
  const r = PLAYER_RADIUS + SHORE_SLACK;
  const free = (x: number, z: number): boolean => {
    if (x < pocket.minX + r || x > layout.walkBounds.minX + 2 || z < pocket.minZ + r || z > pocket.maxZ - r) return false;
    for (const b of boxes) if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return false;
    return true;
  };
  const x0 = pocket.minX;
  const z0 = pocket.minZ;
  const nx = Math.ceil((layout.walkBounds.minX + 2 - x0) / SHORE_GRID) + 1;
  const nz = Math.ceil((pocket.maxZ - z0) / SHORE_GRID) + 1;
  const at = (i: number, j: number) => ({ x: round(x0 + i * SHORE_GRID), z: round(z0 + j * SHORE_GRID) });
  const ok = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) ok[i * nz + j] = free(at(i, j).x, at(i, j).z) ? 1 : 0;
  // flood from the entry's middle, 4-connected: the part of the free ground a walk from the village reaches
  const seen = new Uint8Array(nx * nz);
  const ei = Math.round((layout.walkBounds.minX + 0.5 - x0) / SHORE_GRID);
  const ej = Math.round(((entry.minZ + entry.maxZ) / 2 - z0) / SHORE_GRID);
  const stack: number[] = [];
  if (ok[ei * nz + ej]) {
    stack.push(ei * nz + ej);
    seen[ei * nz + ej] = 1;
  }
  while (stack.length) {
    const k = stack.pop()!;
    const i = Math.floor(k / nz);
    const j = k % nz;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const nk = ni * nz + nj;
      if (!ok[nk] || seen[nk]) continue;
      seen[nk] = 1;
      stack.push(nk);
    }
  }
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (!seen[i * nz + j]) continue;
      // the artificial east end of the grid is not a shore
      let edge = false;
      for (let di = -1; di <= 1 && !edge; di++) {
        for (let dj = -1; dj <= 1 && !edge; dj++) {
          const ni = i + di;
          const nj = j + dj;
          if (ni >= nx) continue;
          if (ni < 0 || nj < 0 || nj >= nz || !ok[ni * nz + nj]) edge = true;
        }
      }
      if (edge && at(i, j).x <= layout.walkBounds.minX) out.push(at(i, j));
    }
  }
  shoreCache.set(layout, out);
  return out;
}

/**
 * Where a click on the pool's water goes: the free standing spot nearest the click on the shore (a click on the far
 * side of the water too: it picks the nearest bank the rest area has). Null when the click is not on the water (inside the
 * waterline grown by the keep-out, off the slabs), so the ordinary ground rules apply.
 */
export function fallsShoreSpot(layout: VillageLayout, x: number, z: number): { x: number; z: number } | null {
  if (!fallsWalkable(layout)) return null;
  if (poolRadius(layout, x, z, POOL_CLICK_GROW) >= 1 || onSlab(layout, x, z)) return null;
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (const s of shoreSpots(layout)) {
    const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best ? { x: best.x, z: best.z } : null;
}
