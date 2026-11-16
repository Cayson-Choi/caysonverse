/**
 * The inside of the village bus as a place to walk in (owner 2026-11-15: "버스 안에서 캐릭터는 창문의 왼쪽 오른쪽을 다 볼 수
 * 있어야 해 … 의자에 앉을 수도 있고 서있을 수도 있어야 해"). A rider is a person in the bus's own frame: `ahead` (m along
 * the bus's heading from the middle of its footprint), `right` (m towards its doors) and `yaw` (the facing's offset from the
 * bus's heading, the world yaw's sense: 0 = forward, -PI/2 = towards the doors). The server keeps those three on the Player
 * (`busAhead`, `busRight`, `busYaw`), checks every step with the cabin's solids and walls, and every client draws the rider
 * in the bus wherever the bus is.
 *
 * The data (seats, hold spots, poles, walk solids, seat backs, floor steps) is generated from the Blender model
 * (art/village/tools/build_bus.py -> village_bus_cabin.json -> scripts/gen-bus-cabin.mjs -> generated/busCabin.ts): the
 * TypeScript never re-derives the model; server/src/tools/villageBus.test.ts checks the generated poles against the GLB.
 *
 * `Player.busSeat`: -1 = not aboard; 0 = aboard and free (walking or standing in the aisle); 1..SEATS = seated in
 * BUS_SEATS[busSeat - 1]; SEATS + 1 .. SEATS + HOLDS = standing at BUS_HOLDS[busSeat - SEATS - 1], one hand on its pole.
 * `busSeat >= 0` still means "aboard".
 *
 * Sitting rules (owner 2026-11-13): every visible seat is sit-able; a backed seat only from the front, a backless one from
 * either side. All 14 seats of this bus are backed (the folding seats of the wheelchair bay too: their back is the wall).
 */

import {
  GEN_CABIN_BOUNDS,
  GEN_CABIN_CEILING,
  GEN_CABIN_FLOOR,
  GEN_CABIN_HALF_WIDTH,
  GEN_CABIN_HOLDS,
  GEN_CABIN_POLES,
  GEN_CABIN_SEATS,
  GEN_CABIN_SEAT_BACKS,
  GEN_CABIN_SOLIDS,
  GEN_CABIN_STRAPS,
  type GenPole,
  type GenSeatBack,
  type GenSolid,
  type GenStrap,
} from "./generated/busCabin";
import { SIT_POSE, SIT_ROOT_AHEAD } from "../sitPose";
import { TRANSIT, type TransitPose } from "./transit";

export interface BusSeat {
  id: string;
  ahead: number;
  right: number;
  /** the floor's height under the seat (m) */
  floor: number;
  /** the facing's offset from the bus's heading (rad, the world yaw's sense: -PI/2 = towards the doors) */
  yaw: number;
  backed: boolean;
}

export interface BusHold {
  id: string;
  ahead: number;
  right: number;
  floor: number;
  yaw: number;
  /** the stanchion's object name in village_bus.glb */
  pole: string;
}

export const BUS_SEATS: readonly BusSeat[] = GEN_CABIN_SEATS;
export const BUS_HOLDS: readonly BusHold[] = GEN_CABIN_HOLDS;
export const BUS_POLES: readonly GenPole[] = GEN_CABIN_POLES;
export const BUS_STRAPS: readonly GenStrap[] = GEN_CABIN_STRAPS;
export const BUS_SEAT_BACKS: readonly GenSeatBack[] = GEN_CABIN_SEAT_BACKS;
export const BUS_SOLIDS: readonly GenSolid[] = GEN_CABIN_SOLIDS;
export const BUS_CEILING = GEN_CABIN_CEILING;
export const BUS_HALF_WIDTH = GEN_CABIN_HALF_WIDTH;
export const BUS_CABIN_BOUNDS = GEN_CABIN_BOUNDS;

/** How many seats and hold spots the bus has: the `busSeat` numbers 1..SEATS and SEATS+1..SEATS+HOLDS. */
export const BUS_SEAT_COUNT = BUS_SEATS.length;
export const BUS_HOLD_COUNT = BUS_HOLDS.length;

/** A seat's surface above its floor (build_bus.py seat(): the cushion's top at 0.432 + 0.02). */
export const BUS_SEAT_SURFACE = 0.452;

/** The radius (m) the cabin's walls and solids treat a rider as: a little under the village's 0.4 (the aisle is 1.1 m wide). */
export const BUS_WALK_RADIUS = 0.3;

/** How a rider stands in the bus: free (in the aisle), on a seat, or at a hold spot. */
export type BusPlaceKind = "free" | "seat" | "hold";
export interface BusPlaceRef {
  kind: BusPlaceKind;
  /** the index into BUS_SEATS / BUS_HOLDS, -1 when free */
  index: number;
}

/** `Player.busSeat` -> the place it names (free for 0 and anything out of range). */
export function busPlaceOf(busSeat: number): BusPlaceRef {
  if (busSeat >= 1 && busSeat <= BUS_SEAT_COUNT) return { kind: "seat", index: busSeat - 1 };
  const h = busSeat - BUS_SEAT_COUNT - 1;
  if (busSeat > BUS_SEAT_COUNT && h < BUS_HOLD_COUNT) return { kind: "hold", index: h };
  return { kind: "free", index: -1 };
}

/** The `busSeat` of a seat (index into BUS_SEATS). */
export const busSeatNumber = (seatIndex: number): number => seatIndex + 1;
/** The `busSeat` of a hold spot (index into BUS_HOLDS). */
export const busHoldNumber = (holdIndex: number): number => BUS_SEAT_COUNT + 1 + holdIndex;

/** Where a boarding rider stands: just inside the front door, facing back down the aisle (xf 1.05). */
export const BUS_ENTRY = { ahead: 3.45, right: 0.2, yaw: Math.PI } as const;

/**
 * Where boarding riders are put, one after another just inside the front door and down the aisle (the first free one: nobody
 * stands inside another rider's body when two board together). All face back down the aisle.
 */
export const BUS_ENTRIES: ReadonlyArray<{ ahead: number; right: number; yaw: number }> = [
  BUS_ENTRY,
  { ahead: 2.2, right: 0.0, yaw: Math.PI },
  { ahead: 3.2, right: 0.15, yaw: Math.PI },
  { ahead: 1.05, right: 0.0, yaw: Math.PI },
  { ahead: -0.1, right: 0.0, yaw: Math.PI },
  { ahead: -1.35, right: 0.0, yaw: Math.PI },
  { ahead: -2.55, right: 0.0, yaw: Math.PI },
];

/**
 * The first entry spot no other rider is within `apart` m of (the first one when every spot is taken). 1.3 m by default: a
 * chibi avatar's head is 2.2 m up and 0.6 m across, and a rider a step in front of you fills the first-person view.
 */
export function freeBusEntry(others: ReadonlyArray<{ ahead: number; right: number }>, apart = 1.3): { ahead: number; right: number; yaw: number } {
  for (const e of BUS_ENTRIES) {
    if (!others.some((o) => Math.hypot(o.ahead - e.ahead, o.right - e.right) < apart)) return e;
  }
  return BUS_ENTRIES[0]!;
}

/** In front of the middle door (xf 4.35 .. 5.75): the exit zone (a rider here is offered 하차 while the bus stands). */
export const BUS_EXIT_ZONE = { aheadMin: -1.35, aheadMax: 0.25, rightMin: 0.35, rightMax: 1.2 } as const;

export function inExitZone(ahead: number, right: number): boolean {
  const z = BUS_EXIT_ZONE;
  return ahead >= z.aheadMin && ahead <= z.aheadMax && right >= z.rightMin && right <= z.rightMax;
}

/** The cabin floor's height at a bus-local point (m): the low floor, the two steps' treads, the raised rear. */
export function cabinFloorAt(ahead: number, _right = 0): number {
  const xf = TRANSIT.busLengthM / 2 - ahead;
  let h = GEN_CABIN_FLOOR[0]!.h;
  for (const f of GEN_CABIN_FLOOR) if (xf >= f.xf0) h = f.h;
  return h;
}

/** The facing as a unit vector in (ahead, right): yaw 0 = forward, -PI/2 = towards the doors (+right). */
export function facingVector(yaw: number): { ahead: number; right: number } {
  return { ahead: Math.cos(yaw), right: -Math.sin(yaw) };
}

const circleHitsBox = (ahead: number, right: number, r: number, b: GenSolid): boolean => {
  const dx = Math.max(b.minAhead - ahead, 0, ahead - b.maxAhead);
  const dz = Math.max(b.minRight - right, 0, right - b.maxRight);
  return dx * dx + dz * dz < r * r;
};

/**
 * Whether a rider (a circle of radius `r`) at a bus-local point is outside the cabin's walls or in a solid (a seat, a
 * wheel housing, the dashboard, the driver's partition, a fare post). The walls: the inner half width and the two ends.
 */
export function cabinBlocked(ahead: number, right: number, r = BUS_WALK_RADIUS): boolean {
  if (!Number.isFinite(ahead) || !Number.isFinite(right)) return true;
  if (Math.abs(right) > GEN_CABIN_HALF_WIDTH - r) return true;
  if (ahead < GEN_CABIN_BOUNDS.aheadMin + r || ahead > GEN_CABIN_BOUNDS.aheadMax - r) return true;
  for (const s of GEN_CABIN_SOLIDS) if (circleHitsBox(ahead, right, r, s)) return true;
  return false;
}

export interface BusLocalPoint {
  ahead: number;
  right: number;
}

/**
 * How close (m) two riders may walk to each other in the aisle (centre to centre): a body is 0.6 m across but the aisle between
 * the seats is only 0.5 m of walkable width (the walk radius is 0.3), so a rider standing in the middle of it can only be passed at
 * the edge (0.25 m off the axis): two riders squeeze past each other as people do and never stand in one another (no step ends
 * closer than this). The client predicts with this, the server
 * enforces BUS_RIDER_APART_SERVER (a little less: the other rider's point it sees is newer than the one a client draws, so
 * the server never refuses a step the client's own stricter prediction allowed).
 */
export const BUS_RIDER_APART = 0.14;
export const BUS_RIDER_APART_SERVER = 0.11;

/**
 * Whether a step from `from` to `to` walks INTO another rider: ends within `apart` of one and closer than where it started
 * (a rider already overlapping may always walk away).
 */
export function crowdBlocks(from: BusLocalPoint, to: BusLocalPoint, others: ReadonlyArray<BusLocalPoint> | undefined, apart = BUS_RIDER_APART): boolean {
  if (!others) return false;
  for (const o of others) {
    const dNew = Math.hypot(to.ahead - o.ahead, to.right - o.right);
    if (dNew >= apart) continue;
    if (dNew < Math.hypot(from.ahead - o.ahead, from.right - o.right)) return true;
  }
  return false;
}

/**
 * A step in the cabin: from `from` towards `want`, never into a solid or a wall. Slides along what is in the way (each
 * axis on its own), so a walk against a seat's side runs along it. `from` itself is never checked (a rider already
 * overlapping something may walk out of it: the step only refuses to END inside).
 */
export function stepInCabin(
  from: BusLocalPoint,
  want: BusLocalPoint,
  r = BUS_WALK_RADIUS,
  out: BusLocalPoint = { ahead: 0, right: 0 },
  others?: ReadonlyArray<BusLocalPoint>,
): BusLocalPoint {
  const okAt = (a: number, b: number): boolean => !cabinBlocked(a, b, r) && !crowdBlocks(from, { ahead: a, right: b }, others);
  if (okAt(want.ahead, want.right)) {
    out.ahead = want.ahead;
    out.right = want.right;
    return out;
  }
  if (okAt(want.ahead, from.right)) {
    out.ahead = want.ahead;
    out.right = from.right;
    return out;
  }
  if (okAt(from.ahead, want.right)) {
    out.ahead = from.ahead;
    out.right = want.right;
    return out;
  }
  out.ahead = from.ahead;
  out.right = from.right;
  return out;
}

/** The point 0.45 m in front of a seat's cushion (where a rider sits down from). */
export function seatFrontPoint(seat: BusSeat): BusLocalPoint {
  const f = facingVector(seat.yaw);
  return { ahead: seat.ahead + f.ahead * 0.45, right: seat.right + f.right * 0.45 };
}

/** How far (m) from a seat's front a rider may ask to sit, and from a hold spot to take hold. */
export const BUS_SIT_REACH_M = 1.15;
export const BUS_HOLD_REACH_M = 0.8;

/**
 * Whether a rider at (ahead, right) may sit in `seat`: within reach of its front, and in FRONT of it (a backed seat is sat
 * in from the front only; a backless one from either side). Each seat's front is its facing direction.
 */
export function seatApproachOk(seat: BusSeat, ahead: number, right: number): boolean {
  const front = seatFrontPoint(seat);
  if (Math.hypot(ahead - front.ahead, right - front.right) > BUS_SIT_REACH_M) return false;
  if (!seat.backed) return true;
  const f = facingVector(seat.yaw);
  // not BEHIND the backrest's line (a rider in the aisle level with the seat turns in; behind it, the back is in the way)
  return (ahead - seat.ahead) * f.ahead + (right - seat.right) * f.right > -0.12;
}

/** A hold spot is the place to take hold of its pole: standing within this of it offers the hold, not the seat beside it. */
export const BUS_HOLD_OFFER_M = 0.35;
/** Standing this close to a pole's spot, the pole is offered whichever way they face. */
export const BUS_HOLD_AT_M = 0.25;
/** The angle (rad) within which a seat counts as the one the rider faces. */
export const BUS_SEAT_FACE_RAD = (50 * Math.PI) / 180;

/**
 * What the rider can do from where they stand (the approach rules respected): the free hold spot they stand at (within
 * BUS_HOLD_OFFER_M: they walked to that pole, so the pole is what is offered; owner 2026-11-15 follow-up: with the seat first
 * a first-time rider could never take hold), else the nearest free SEAT in reach, else a free hold spot in reach, else null.
 * `riders`: where the others are; a seat or spot with someone standing at it is not offered.
 */
export function nearestFreeSpot(
  ahead: number,
  right: number,
  takenSeats: ReadonlySet<number>,
  takenHolds: ReadonlySet<number>,
  riders?: ReadonlyArray<BusLocalPoint>,
  yaw?: number,
): { kind: "seat" | "hold"; index: number; dist: number } | null {
  const crowded = (a: number, b: number): boolean => !!riders && riders.some((o) => Math.hypot(o.ahead - a, o.right - b) < BUS_RIDER_APART_SERVER);
  let bestHold: { kind: "hold"; index: number; dist: number } | null = null;
  BUS_HOLDS.forEach((h, i) => {
    if (takenHolds.has(i) || crowded(h.ahead, h.right)) return;
    const d = Math.hypot(ahead - h.ahead, right - h.right);
    if (d > BUS_HOLD_REACH_M) return;
    if (bestHold === null || d < bestHold.dist) bestHold = { kind: "hold", index: i, dist: d };
  });
  const hold = bestHold as { kind: "hold"; index: number; dist: number } | null;
  if (hold !== null && hold.dist <= BUS_HOLD_OFFER_M) {
    // Facing a free seat (within BUS_SEAT_FACE_RAD of the way they look, the approach rules respected) and not right at the pole: the seat
    // they turned to is what is offered (review 2026-11-16: a pole's offer radius hid the seats beside it, so L3 / RL1 / RR2 were never offered)
    if (yaw !== undefined && hold.dist > BUS_HOLD_AT_M) {
      const f = facingVector(yaw);
      let faced: { index: number; dist: number } | null = null;
      BUS_SEATS.forEach((s, i) => {
        if (takenSeats.has(i) || !seatApproachOk(s, ahead, right)) return;
        const front = seatFrontPoint(s);
        const da = front.ahead - ahead;
        const dr = front.right - right;
        const d = Math.hypot(da, dr);
        if (d < 1e-6 || d > BUS_HOLD_REACH_M + 0.6) return;
        const cos = (da * f.ahead + dr * f.right) / d;
        if (Math.acos(Math.max(-1, Math.min(1, cos))) > BUS_SEAT_FACE_RAD) return;
        if (faced === null || d < faced.dist) faced = { index: i, dist: d };
      });
      const fs = faced as { index: number; dist: number } | null;
      if (fs !== null) return { kind: "seat", index: fs.index, dist: fs.dist };
    }
    return hold;
  }
  // The seat the rider turns to: with a facing, the one nearest the point half a metre ahead of them (the seat across the
  // aisle is the one they look at, not the one level with them: otherwise the rear row's outer seats, always farther than the
  // middle one from the aisle, could never be offered); without one, the nearest.
  const fx = yaw === undefined ? 0 : facingVector(yaw).ahead * 0.5;
  const fz = yaw === undefined ? 0 : facingVector(yaw).right * 0.5;
  let bestSeat: { kind: "seat"; index: number; dist: number } | null = null;
  let bestScore = Infinity;
  BUS_SEATS.forEach((s, i) => {
    if (takenSeats.has(i) || !seatApproachOk(s, ahead, right)) return;
    const front = seatFrontPoint(s);
    const d = Math.hypot(ahead - front.ahead, right - front.right);
    const score = yaw === undefined ? d : Math.hypot(ahead + fx - front.ahead, right + fz - front.right);
    if (score < bestScore) {
      bestScore = score;
      bestSeat = { kind: "seat", index: i, dist: d };
    }
  });
  return (bestSeat as { kind: "seat"; index: number; dist: number } | null) ?? hold;
}

/** Where a rider stands up to: in front of the cushion or in the aisle beside the seat, the first spot not blocked. */
export function seatStandUpSpot(seat: BusSeat, riders?: ReadonlyArray<BusLocalPoint>): { ahead: number; right: number; yaw: number } {
  const f = facingVector(seat.yaw);
  const candidates: BusLocalPoint[] = [
    { ahead: seat.ahead + f.ahead * 0.62, right: seat.right + f.right * 0.62 },
    { ahead: seat.ahead, right: 0 },
    { ahead: seat.ahead + 0.4, right: 0 },
    { ahead: seat.ahead - 0.4, right: 0 },
    { ahead: seat.ahead + 0.8, right: 0 },
    { ahead: seat.ahead - 0.8, right: 0 },
    { ahead: seat.ahead + 1.2, right: 0 },
    { ahead: seat.ahead - 1.2, right: 0 },
  ];
  const clear = (c: BusLocalPoint): boolean =>
    !cabinBlocked(c.ahead, c.right) && !(riders && riders.some((o) => Math.hypot(o.ahead - c.ahead, o.right - c.right) < BUS_RIDER_APART_SERVER));
  const hit = candidates.find(clear) ?? candidates.find((c) => !cabinBlocked(c.ahead, c.right)) ?? candidates[1]!;
  return { ahead: hit.ahead, right: hit.right, yaw: seat.yaw };
}

/** A bus-local point in the world, for a bus at `bus` (the same math as busBody.busWorld). */
export function busLocalToWorld(bus: Pick<TransitPose, "x" | "z" | "yaw">, ahead: number, right: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  const fx = Math.sin(bus.yaw);
  const fz = Math.cos(bus.yaw);
  out.x = bus.x + fx * ahead - fz * right;
  out.z = bus.z + fz * ahead + fx * right;
  return out;
}

export function normalizeYaw(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export interface BusRiderPoseFull {
  x: number;
  z: number;
  /** the world yaw */
  yaw: number;
  /** how high the avatar's root stands */
  y: number;
  seated: boolean;
  holding: boolean;
}

/**
 * The root of a seated rider relative to its seat: the avatar sits with the root a little ahead of the cushion (sitPose.ts
 * SIT_ROOT_AHEAD on the cushion's front edge). Along the seat's facing.
 */
const CUSHION_FRONT = 0.04 + 0.37 / 2;

/**
 * Seats by the walls: a seated avatar's hands reach 0.5 m from its middle and the seat's middle is 0.86 m from the aisle's
 * axis (0.34 m from the inner wall): sat in the middle, the hands came out through the wall (checker r1: over the side's
 * lettering). Those riders sit at the aisle end of the cushion, so the reach ends inside the wall (what main did too).
 */
export const BUS_WALL_SEAT_SHIFT = 0.25;

/** Where a seated rider's body (the avatar's root) is, bus-local: along the seat's facing, shifted off the wall. */
export function seatBodyPoint(seat: BusSeat): BusLocalPoint {
  const f = facingVector(seat.yaw);
  const a = seat.ahead + f.ahead * (CUSHION_FRONT + SIT_ROOT_AHEAD);
  let r = seat.right + f.right * (CUSHION_FRONT + SIT_ROOT_AHEAD);
  // across the bus the wall seats (|right| > 0.7, facing along the bus) sit towards the aisle
  // (by exactly as much as brings the hand 1.14 m from the axis; the skin is at 1.245, the inner lining at 1.195)
  if (Math.abs(seat.right) > 0.7 && Math.abs(f.right) < 0.5) r -= Math.sign(seat.right) * Math.min(BUS_WALL_SEAT_SHIFT, Math.max(0, Math.abs(seat.right) + 0.5 - 1.14));
  return { ahead: a, right: r };
}

/**
 * Where a rider is drawn (world), from the bus pose and the rider's bus-local place: `busSeat` (the schema) and the local
 * point. A seated rider is put on the seat (the seat's own point, whatever the point says); a holder at the hold spot.
 */
export function busRiderWorldPose(
  bus: Pick<TransitPose, "x" | "z" | "yaw">,
  busSeat: number,
  ahead: number,
  right: number,
  yaw: number,
  out: BusRiderPoseFull = { x: 0, z: 0, yaw: 0, y: 0, seated: false, holding: false },
): BusRiderPoseFull {
  const place = busPlaceOf(busSeat);
  let a = ahead;
  let r = right;
  let yw = yaw;
  let floor = cabinFloorAt(ahead, right);
  out.seated = false;
  out.holding = false;
  if (place.kind === "seat") {
    const s = BUS_SEATS[place.index]!;
    const body = seatBodyPoint(s);
    a = body.ahead;
    r = body.right;
    yw = s.yaw;
    floor = s.floor;
    out.seated = true;
  } else if (place.kind === "hold") {
    const h = BUS_HOLDS[place.index]!;
    a = h.ahead;
    r = h.right;
    yw = h.yaw;
    floor = h.floor;
    out.holding = true;
  }
  busLocalToWorld(bus, a, r, out);
  out.yaw = bus.yaw + yw;
  out.y = out.seated ? floor + BUS_SEAT_SURFACE - SIT_POSE.contactY : floor;
  return out;
}
