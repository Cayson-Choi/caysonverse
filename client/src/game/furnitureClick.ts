/**
 * A click or a tap on a piece of furniture (round 8 review, 2026-11-15; round 9: by the click's ray).
 *
 * The walk takes floor only (clickPlan.ts rule 1): a click on a sofa's cushion, an armchair, a letter chair, a bench — or on
 * the floor behind one, hidden by it on screen — met the furniture's face and was "not-ground": nothing happened, no walk and no
 * "앉기". A first-time visitor taps the seat to sit. So here, for a click that is not ground:
 *   - on a seat (the click's ray enters its cushion's or backrest's volume: seatRayEntry): the walk goes to that seat's
 *     approach — its dismount spot, which is in front of a sofa or an armchair, beside a chair at a table, and for a backless
 *     bench on the side nearer the player (its two facings are two seats of one group) — and the seat is named so the walk can
 *     sit on arrival;
 *   - on other furniture (a table, a cabinet, a sofa's end, a bench's leg): the floor the ray goes on to behind it (or under
 *     the click), which the plan then moves out to the nearest spot the body can stand (FURNITURE_MAX_PUSH, as for a bench's
 *     box).
 * Pure: no three.js; CameraRig looks the floor's height up.
 */

import { approachesSeat, seatDistance, SEAT_REACH, type Seat } from "@caysonverse/shared/worldMap";
import type { SurfacePoint } from "./clickPlan";

/** Furniture is no higher than this (m): a click higher up (a wall, a shelf, the louvres) is still nothing. */
export const FURNITURE_TOP = 1.3;

/*
 * A seat's click volume (round 9 review): the box of its cushion — and of its backrest, for a backed seat — in the seat's own
 * frame. A click is on a seat when the click's ray enters that box no later than it meets the furniture it hit
 * (SEAT_HIT_EPS): a hit on a bench's leg or the frame below its cushion is no click on the bench (the visitor aimed at the
 * floor behind it, and that floor is walked to — round 9 review: the floor past a front bench sat the visitor on it). A ray
 * that meets a table top first may still go on into a chair's box just past the table's edge (SEAT_BEHIND): the letter
 * chairs, seen from the aisle, are half hidden by the table, and a tap on them hit the table top (y 0.76) — the chair is meant.
 */
/** How far below the seat's surface (m) its volume starts: the cushion's front rail. */
const SEAT_BELOW = 0.12;
/** How far above the seat's surface (m) a backless seat's volume goes (the board) and a backed seat's (its backrest). */
const SEAT_ABOVE_BACKLESS = 0.1;
const SEAT_ABOVE_BACKED = 0.5;
/** How deep (m, back from the front edge) the volume is: a backless bench's board, a backed seat's cushion and backrest. */
const SEAT_DEPTH_BACKLESS = 0.42;
const SEAT_DEPTH_BACKED = 0.62;
/** Half its width (m): a chair's own (`sideHalf`) and a little; one of a row (a sofa's, a bench's) half the way to the next. */
const SEAT_HALF_DEFAULT = 0.42;
const SEAT_HALF_ROW_MAX = 0.7;
const SEAT_ROW_SPAN = 1.5;
const SEAT_SIDE_PAD = 0.05;
/** A ray entering a seat's volume this little (m) past the furniture it hit still clicks the seat (a face of the seat itself). */
const SEAT_HIT_EPS = 0.05;
/** ...and this far past a hit high up (a table top, at least SEAT_BEHIND_MIN_Y): a chair half hidden behind the table's edge. */
export const SEAT_BEHIND = 1.4;
const SEAT_BEHIND_MIN_Y = 0.6;
/** A hit on furniture that is no seat: the floor the ray goes on to is walked to when it lies this near the hit (m, across). */
const FLOOR_BEYOND_MAX = 6;

/** A click's ray: from the camera (`o`), along the unit direction `d`. */
export interface ClickRay {
  o: { x: number; y: number; z: number };
  d: { x: number; y: number; z: number };
}

/** What a furniture click becomes: the floor point to walk to, and the seat to sit on there (or null). */
export interface FurnitureClick {
  surface: SurfacePoint;
  seatIndex: number | null;
}

/** Half the width (m) of seat `i`'s click volume (see SEAT_HALF_DEFAULT). */
function seatHalf(seats: readonly Seat[], i: number): number {
  const s = seats[i]!;
  if (s.sideHalf !== undefined) return s.sideHalf + SEAT_SIDE_PAD;
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  let half = SEAT_HALF_DEFAULT;
  for (let k = 0; k < seats.length; k++) {
    const o = seats[k]!;
    if (k === i || Math.abs(Math.sin(o.yaw - s.yaw)) > 0.1 || Math.cos(o.yaw - s.yaw) < 0) continue;
    const dx = o.x - s.x;
    const dz = o.z - s.z;
    if (Math.abs(dx * fx + dz * fz) > 0.2) continue; // not in the same row
    const across = Math.abs(dx * fz - dz * fx);
    if (across > 0.05 && across < SEAT_ROW_SPAN) half = Math.max(half, Math.min(SEAT_HALF_ROW_MAX, across / 2));
  }
  return half;
}

/** Where (the ray's t, m) `ray` enters seat `i`'s click volume, or Infinity when it misses it. */
export function seatRayEntry(ray: ClickRay, seats: readonly Seat[], i: number): number {
  const s = seats[i]!;
  const backed = (s.lean ?? 0) > 0;
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  const fe = s.frontEdge ?? 0;
  const depth = backed ? SEAT_DEPTH_BACKED : SEAT_DEPTH_BACKLESS;
  const half = seatHalf(seats, i);
  // the seat's frame from its spot: across (right of its facing), ahead (its facing), up
  const ox = ray.o.x - s.x;
  const oz = ray.o.z - s.z;
  const slabs = [
    { o: ox * fz - oz * fx, d: ray.d.x * fz - ray.d.z * fx, lo: -half, hi: half },
    { o: ox * fx + oz * fz, d: ray.d.x * fx + ray.d.z * fz, lo: -fe - depth, hi: -fe },
    { o: ray.o.y - (s.seatY ?? 0.45), d: ray.d.y, lo: -SEAT_BELOW, hi: backed ? SEAT_ABOVE_BACKED : SEAT_ABOVE_BACKLESS },
  ];
  let t0 = 0;
  let t1 = Infinity;
  for (const { o, d, lo, hi } of slabs) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
      continue;
    }
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/**
 * For a click on `pick` that is no ground (the caller checked): the seat it is on, or the floor beyond it. `ray` is the click's
 * ray (`pick.distance` along it); `seats` the active map's whole list (an index is the server's); `area` the player's area
 * (only its seats count); `taken(i)` a seat someone sits on (then the click is just furniture); `from` where the walk starts;
 * `floorY` the floor's height.
 */
export function furnitureClick(
  pick: { x: number; y: number; z: number; distance?: number } | null,
  ray: ClickRay | null,
  seats: readonly Seat[],
  area: string | undefined,
  taken: (index: number) => boolean,
  from: { x: number; z: number },
  floorY: number,
  /** Whether a click on furniture that is no seat walks next to it (the hall); otherwise it stays nothing. */
  otherFurniture: boolean,
): FurnitureClick | null {
  if (!pick || pick.y > FURNITURE_TOP) return null;
  const areaOf = (s: Seat) => (s as { area?: string }).area;
  const inArea = (s: Seat) => area === undefined || areaOf(s) === undefined || areaOf(s) === area;
  const offered = (i: number): boolean => {
    const s = seats[i]!;
    if (!inArea(s) || taken(i)) return false;
    // its approach must offer it (a chair's side spot, a sofa's front) — never a spot behind a backrest
    return approachesSeat(s, s.standX, s.standZ) && seatDistance(s, s.standX, s.standZ) <= SEAT_REACH;
  };
  const hitT = ray ? (pick.distance ?? Math.hypot(pick.x - ray.o.x, pick.y - ray.o.y, pick.z - ray.o.z)) : 0;
  // the seat whose volume the ray enters first, up to the furniture it hit (or a little past a table top's edge)
  let best = -1;
  if (ray) {
    let bestT = hitT + (pick.y >= SEAT_BEHIND_MIN_Y ? SEAT_BEHIND : SEAT_HIT_EPS);
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i]!;
      if (!inArea(s) || Math.hypot(s.x - pick.x, s.z - pick.z) > 3) continue;
      const t = seatRayEntry(ray, seats, i);
      if (t <= bestT && offered(i)) {
        best = i;
        bestT = t;
      }
    }
  }
  // of the facings of one backless seat (one group), the one whose approach is nearer the player: sat from either side
  if (best >= 0 && seats[best]!.group !== undefined) {
    const g = seats[best]!.group;
    let bestFrom = Infinity;
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i]!;
      if (s.group !== g || !offered(i)) continue;
      const fromD = Math.hypot(s.standX - from.x, s.standZ - from.z);
      if (fromD < bestFrom) {
        bestFrom = fromD;
        best = i;
      }
    }
  }
  if (best >= 0) {
    const s = seats[best]!;
    return { surface: { x: s.standX, y: floorY, z: s.standZ, ny: 1 }, seatIndex: best };
  }
  if (!otherFurniture) return null;
  // The floor the ray goes on to past the furniture — what the visitor aimed at, hidden behind a bench or under a table's
  // edge — else the floor under the hit.
  if (ray && ray.d.y < -0.05) {
    const t = (floorY - ray.o.y) / ray.d.y;
    const x = ray.o.x + ray.d.x * t;
    const z = ray.o.z + ray.d.z * t;
    if (t > hitT && Math.hypot(x - pick.x, z - pick.z) <= FLOOR_BEYOND_MAX) return { surface: { x, y: floorY, z, ny: 1 }, seatIndex: null };
  }
  return { surface: { x: pick.x, y: floorY, z: pick.z, ny: 1 }, seatIndex: null };
}
