/**
 * Where an arriving player is put in 케이슨 마을 so nobody appears inside someone else (fix/arrival-spread; the owner:
 * "추모관에 두명의 캐릭터가 동시에 들어갈경우 처음에 겹쳐져있는 상태가 발생"). Pure, clock-free and browser-safe, so it is
 * unit-testable and the server and any client tool read the same rule.
 *
 * Every arrival has a nominal spot (the hall's inside spawn, the door's outside arrival, a random point of the plaza's
 * spawn disk) and a facing. `findFreeSpot` keeps the nominal spot when it is free; otherwise it takes the nearest free
 * spot of a fixed hex lattice around it — a person who comes in behind someone steps beside them, as people do in a
 * doorway. A spot is free when:
 *  - its body (PLAYER_RADIUS) is inside the area's walkable rectangle and touches no collider;
 *  - its centre is at least `DOOR_PAD_CLEARANCE_M` outside every door pad of the area (an arrival never stands on a door);
 *  - the straight line from the nominal spot to it crosses no collider (no spot behind a sofa or through a wall);
 *  - every player already in the area is at least `ARRIVAL_SPACING_M` away (centre to centre).
 * The lattice is spaced `ARRIVAL_SPACING_M`, so arrivals that fill it in turn are that far apart from each other too.
 * Its rows run across the facing: the first spots tried after the nominal one are right beside it (right, then left),
 * then diagonally ahead, so the newcomer stands next to the one already there, not in front of their face.
 *
 * A room so full that no spot is free still gets an answer (`free: false`): the valid spot farthest from its nearest
 * neighbour — the least crowded place, never a collider or a door pad.
 */

import { isBlocked, type AABB } from "../collision";
import type { Bounds } from "../school/geometry";
import { PLAYER_RADIUS } from "../worldMap";
import {
  VILLAGE_LAYOUT,
  houseInteriorGeometry,
  isHouseArea,
  villageGeometry,
  type Disc,
  type Point2,
} from "./villageLayout";

/** Air between two arrivals' bodies (m), on top of their two radii. */
export const ARRIVAL_GAP_M = 0.6;
/** Least centre-to-centre distance between a new arrival and anyone already in the area: 2 x 0.4 + 0.6 = 1.4 m (arms-out idle pose: hands do not cross). */
export const ARRIVAL_SPACING_M = 2 * PLAYER_RADIUS + ARRIVAL_GAP_M;
/**
 * How far outside a door pad's edge an arrival's centre stays (m). The layout's own arrivals sit exactly this far out
 * (the hall's spawn 1.6 m from its 1.4 m pad, the outside arrival 2.2 m from its 2.0 m pad).
 */
export const DOOR_PAD_CLEARANCE_M = 0.2;
/** Lattice rings around the nominal spot: ring k is about k spacings out, so 8 rings reach 11.2 m (217 spots). */
export const ARRIVAL_RINGS = 8;
/** Random draws a jittered spawn tries before it falls back to the lattice around the spawn point. */
export const SPAWN_TRIES = 12;
/**
 * Slack (m) on the spacing test: positions travel as float32 (about 3e-5 m at x = 300), so two lattice spots exactly
 * one spacing apart may read a hair closer once synced. Far below anything visible.
 */
export const SPACING_SLACK_M = 1e-3;

/** A place and a facing (yaw: the game's `atan2(dirX, dirZ)`, 0 faces +z). */
export interface ArrivalPose {
  x: number;
  z: number;
  yaw: number;
}

export interface ArrivalSpot extends ArrivalPose {
  /** false only when no free spot was left (a full room): then this is the least crowded valid spot. */
  free: boolean;
}

/** The geometry an arrival must respect in one area. */
export interface ArrivalArea {
  /** The area's walkable rectangle: an arrival's whole body stays inside it. */
  bounds: Bounds;
  /** The colliders (only those that can touch the rectangle). */
  obstacles: readonly AABB[];
  /** The area's door pads: an arrival's centre stays `DOOR_PAD_CLEARANCE_M` outside each. */
  pads: readonly Disc[];
}

/** An area from its rectangle, the map's colliders (kept: only those within a body of the rectangle) and its pads. */
export function makeArrivalArea(bounds: Bounds, obstacles: readonly AABB[], pads: readonly Disc[]): ArrivalArea {
  const m = PLAYER_RADIUS + 0.01;
  const near = obstacles.filter((b) => b.maxX > bounds.minX - m && b.minX < bounds.maxX + m && b.maxZ > bounds.minZ - m && b.minZ < bounds.maxZ + m);
  return Object.freeze({ bounds: { ...bounds }, obstacles: Object.freeze(near), pads: Object.freeze(pads.map((p) => ({ centre: { ...p.centre }, radius: p.radius }))) });
}

const L = VILLAGE_LAYOUT;
const VILLAGE_AREA = makeArrivalArea(L.areas.village, villageGeometry.obstacles, [L.memorial.exterior.doorPad]);
const HALL_AREA = makeArrivalArea(L.areas.hall, villageGeometry.obstacles, [L.memorial.interior.doorPad]);
/** A house interior (paused on the client): the hall's room footprint, its own geometry, the way out at the same pad. */
const HOUSE_AREA = makeArrivalArea(L.areas.hall, houseInteriorGeometry.obstacles, [L.memorial.interior.doorPad]);

/** The arrival geometry of a 케이슨 마을 area: the village, the memorial hall, or a house interior. */
export function arrivalArea(area: string): ArrivalArea {
  if (area === "hall") return HALL_AREA;
  if (isHouseArea(area)) return HOUSE_AREA;
  return VILLAGE_AREA;
}

/** One lattice spot relative to the nominal pose: `side` along the right-hand side, `fwd` along the facing (m). */
interface Offset {
  side: number;
  fwd: number;
  d: number;
}

const offsetCache = new Map<string, readonly Offset[]>();

/**
 * The hex lattice of `spacing` around the origin, out to `rings` spacings, nearest first. Ties (a ring's equal
 * distances) go to the spot most across the facing (beside before diagonal), then ahead before behind, then right
 * before left. Its rows are across the facing, so the first ring holds the two spots right beside the nominal one.
 */
function latticeOffsets(spacing: number, rings: number): readonly Offset[] {
  const key = `${spacing}:${rings}`;
  const cached = offsetCache.get(key);
  if (cached) return cached;
  const rowGap = (spacing * Math.sqrt(3)) / 2;
  const reach = rings * spacing + 1e-9;
  const rows = Math.ceil(reach / rowGap);
  const out: Offset[] = [];
  for (let j = -rows; j <= rows; j++) {
    const shift = Math.abs(j) % 2 === 1 ? 0.5 : 0;
    for (let i = -(rings + 1); i <= rings + 1; i++) {
      const side = (i + shift) * spacing;
      const fwd = j * rowGap;
      const d = Math.hypot(side, fwd);
      if (d <= reach) out.push({ side, fwd, d });
    }
  }
  const q = (n: number) => Math.round(n * 1e6);
  out.sort((a, b) => q(a.d) - q(b.d) || q(Math.abs(a.fwd)) - q(Math.abs(b.fwd)) || q(b.fwd) - q(a.fwd) || q(b.side) - q(a.side));
  const frozen = Object.freeze(out);
  offsetCache.set(key, frozen);
  return frozen;
}

/** Facing and right-hand side of a yaw on the ground plane (y up: looking along +z, the right hand is -x). */
function axes(yaw: number): { fx: number; fz: number; rx: number; rz: number } {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  return { fx, fz, rx: -fz, rz: fx };
}

/** The lattice spots around `nominal`, in the order they are tried (the nominal spot first). */
export function arrivalCandidates(nominal: ArrivalPose, spacing = ARRIVAL_SPACING_M, rings = ARRIVAL_RINGS): Point2[] {
  const { fx, fz, rx, rz } = axes(nominal.yaw);
  return latticeOffsets(spacing, rings).map((o) => ({ x: nominal.x + o.side * rx + o.fwd * fx, z: nominal.z + o.side * rz + o.fwd * fz }));
}

/** A body at (x, z) fits the area: inside its rectangle, on no collider, and not on a door pad. Occupants aside. */
export function isValidSpot(p: Point2, area: ArrivalArea): boolean {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
  const { bounds } = area;
  const e = 1e-9;
  if (p.x < bounds.minX + PLAYER_RADIUS - e || p.x > bounds.maxX - PLAYER_RADIUS + e) return false;
  if (p.z < bounds.minZ + PLAYER_RADIUS - e || p.z > bounds.maxZ - PLAYER_RADIUS + e) return false;
  if (isBlocked(p.x, p.z, PLAYER_RADIUS, area.obstacles, 0)) return false;
  for (const pad of area.pads) {
    if (Math.hypot(p.x - pad.centre.x, p.z - pad.centre.z) < pad.radius + DOOR_PAD_CLEARANCE_M - 1e-6) return false;
  }
  return true;
}

/** Does the segment a→b pass through `box` grown by `r` (square corners: a little strict at the corners, never lax)? */
function segmentHitsGrownBox(ax: number, az: number, bx: number, bz: number, box: AABB, r: number): boolean {
  const lo = [box.minX - r, box.minZ - r];
  const hi = [box.maxX + r, box.maxZ + r];
  const p = [ax, az];
  const d = [bx - ax, bz - az];
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 2; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (p[k] <= lo[k] || p[k] >= hi[k]) return false;
      continue;
    }
    let ta = (lo[k] - p[k]) / d[k];
    let tb = (hi[k] - p[k]) / d[k];
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 >= t1) return false;
  }
  return true;
}

/** A body could step straight from `a` to `b` without touching a collider (a hair of slack for a spot flush on a face). */
export function pathClear(a: Point2, b: Point2, obstacles: readonly AABB[]): boolean {
  const r = PLAYER_RADIUS - 0.01;
  for (const box of obstacles) if (segmentHitsGrownBox(a.x, a.z, b.x, b.z, box, r)) return false;
  return true;
}

/** Distance from `p` to the nearest of `others` (Infinity when there is nobody). */
function nearestGap(p: Point2, others: readonly Point2[]): number {
  let best = Infinity;
  for (const o of others) {
    const d = Math.hypot(p.x - o.x, p.z - o.z);
    if (d < best) best = d;
  }
  return best;
}

/** Nobody of `others` is closer than the spacing (less the float32 slack). */
function roomy(p: Point2, others: readonly Point2[], spacing: number): boolean {
  return nearestGap(p, others) >= spacing - SPACING_SLACK_M;
}

/**
 * Where a player arriving at `nominal` stands, given who is already in the area (`occupants`, the arriving player
 * left out): the nominal spot if it is free, else the first free lattice spot (see the file header). The facing is
 * always the nominal one. Deterministic: the same inputs give the same spot.
 */
export function findFreeSpot(
  nominal: ArrivalPose,
  area: ArrivalArea,
  occupants: Iterable<Point2>,
  spacing = ARRIVAL_SPACING_M,
  rings = ARRIVAL_RINGS,
): ArrivalSpot {
  const others = Array.from(occupants, (o) => ({ x: o.x, z: o.z }));
  // The straight-line rule needs a clear start; a nominal spot inside a collider (never the layout's) skips it.
  const fromNominal = !isBlocked(nominal.x, nominal.z, PLAYER_RADIUS, area.obstacles, 0);
  let fallback: Point2 | null = null;
  let fallbackGap = -1;
  for (const c of arrivalCandidates(nominal, spacing, rings)) {
    if (!isValidSpot(c, area)) continue;
    if (fromNominal && (c.x !== nominal.x || c.z !== nominal.z) && !pathClear(nominal, c, area.obstacles)) continue;
    const gap = nearestGap(c, others);
    if (gap >= spacing - SPACING_SLACK_M) return { x: c.x, z: c.z, yaw: nominal.yaw, free: true };
    if (gap > fallbackGap + 1e-9) {
      fallback = c;
      fallbackGap = gap;
    }
  }
  if (fallback) return { x: fallback.x, z: fallback.z, yaw: nominal.yaw, free: false };
  return { x: nominal.x, z: nominal.z, yaw: nominal.yaw, free: false };
}

/**
 * A spawn with a random jitter (the plaza's disk): up to `tries` draws, the first free one wins (valid and roomy, as
 * above), so the plaza keeps its natural spread; when every draw lands on someone, the lattice around the disk's
 * centre (`nominal`) decides. `draw` is the room's random point in the disk (already clamped into bounds).
 */
export function freeSpawnSpot(
  draw: () => Point2,
  nominal: ArrivalPose,
  area: ArrivalArea,
  occupants: Iterable<Point2>,
  tries = SPAWN_TRIES,
  spacing = ARRIVAL_SPACING_M,
): ArrivalSpot {
  const others = Array.from(occupants, (o) => ({ x: o.x, z: o.z }));
  for (let i = 0; i < tries; i++) {
    const p = draw();
    if (isValidSpot(p, area) && roomy(p, others, spacing)) return { x: p.x, z: p.z, yaw: nominal.yaw, free: true };
  }
  return findFreeSpot(nominal, area, others, spacing);
}

/** `findFreeSpot` in a 케이슨 마을 area by name ("village", "hall" or "house:<id>"). */
export function spreadArrival(area: string, nominal: ArrivalPose, occupants: Iterable<Point2>): ArrivalSpot {
  return findFreeSpot(nominal, arrivalArea(area), occupants);
}
