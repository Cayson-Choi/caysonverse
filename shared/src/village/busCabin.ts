/**
 * The inside of the village bus as a place to walk in (owner 2026-11-15: "버스 안에서 캐릭터는 창문의 왼쪽 오른쪽을 다 볼 수
 * 있어야 해 … 의자에 앉을 수도 있고 서있을 수도 있어야 해"). A rider is a person in the bus's own frame: `ahead` (m along
 * the bus's heading from the middle of its footprint), `right` (m towards its doors) and `yaw` (the facing's offset from the
 * bus's heading, the world yaw's sense: 0 = forward, -PI/2 = towards the doors). The server keeps those three on the Player
 * (`busAhead`, `busRight`, `busYaw`), checks every step with the cabin's solids and walls, and every client draws the rider
 * in the bus wherever the bus is.
 *
 * Bus v3 (owner 2026-11-16: "버스에 손잡이를 없애자 … 좌석을 캐릭터가 앉을 수 있게 좀 크게 … 몇개만 … 탑승 인원수는 니가 버스
 * 사이즈를 보고 결정해"): no poles, rails or straps, so no "hold" place any more; ten large seats sized for the chibi avatar; the
 * standing places (BUS_STANDING_SPOTS) are worked out here from the free floor and a body's footprint, and the capacity is the
 * seats plus the standing places (BUS_CAPACITY), enforced by the server at boarding.
 *
 * The data (seats, walk solids, seat backs, floor steps, the driver's place) is generated from the Blender model
 * (art/village/tools/build_bus.py -> village_bus_cabin.json -> scripts/gen-bus-cabin.mjs -> generated/busCabin.ts).
 *
 * `Player.busSeat`: -1 = not aboard; 0 = aboard and free (walking or standing); 1..SEATS = seated in BUS_SEATS[busSeat - 1].
 *
 * Sitting rules (owner 2026-11-13): every visible seat is sit-able; a backed seat only from the front. All ten are backed.
 */

import {
  GEN_CABIN_BOUNDS,
  GEN_CABIN_CEILING,
  GEN_CABIN_DRIVER,
  GEN_CABIN_FLOOR,
  GEN_CABIN_HALF_WIDTH,
  GEN_CABIN_SEATS,
  GEN_CABIN_SEAT_BACKS,
  GEN_CABIN_SOLIDS,
  type GenSeatBack,
  type GenSolid,
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

export const BUS_SEATS: readonly BusSeat[] = GEN_CABIN_SEATS;
export const BUS_SEAT_BACKS: readonly GenSeatBack[] = GEN_CABIN_SEAT_BACKS;
export const BUS_SOLIDS: readonly GenSolid[] = GEN_CABIN_SOLIDS;
export const BUS_CEILING = GEN_CABIN_CEILING;
export const BUS_HALF_WIDTH = GEN_CABIN_HALF_WIDTH;
export const BUS_CABIN_BOUNDS = GEN_CABIN_BOUNDS;
/** The driver's seat and steering wheel (nodes bus_driver_seat / bus_steering_wheel / bus_driver_sit): no passenger goes there. */
export const BUS_DRIVER = GEN_CABIN_DRIVER;

/** How many seats the bus has: the `busSeat` numbers 1..SEATS. */
export const BUS_SEAT_COUNT = BUS_SEATS.length;

/** A seat's surface above its floor (build_bus.py seat(): the cushion's top at 0.432 + 0.025). */
export const BUS_SEAT_SURFACE = 0.452;

/** The radius (m) the cabin's walls and solids treat a rider as: a body is 0.6 m across. */
export const BUS_WALK_RADIUS = 0.3;

/** How a rider is in the bus: free (walking or standing) or on a seat. */
export type BusPlaceKind = "free" | "seat";
export interface BusPlaceRef {
  kind: BusPlaceKind;
  /** the index into BUS_SEATS, -1 when free */
  index: number;
}

/** `Player.busSeat` -> the place it names (free for 0 and anything out of range). */
export function busPlaceOf(busSeat: number): BusPlaceRef {
  if (busSeat >= 1 && busSeat <= BUS_SEAT_COUNT) return { kind: "seat", index: busSeat - 1 };
  return { kind: "free", index: -1 };
}

/** The `busSeat` of a seat (index into BUS_SEATS). */
export const busSeatNumber = (seatIndex: number): number => seatIndex + 1;

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
 * How close (m) two riders may stand (centre to centre): a body is 0.6 m across; bus v3 (owner: nobody stands inside anybody)
 * allows a shoulder's brush and no more. The client predicts with this, the server enforces BUS_RIDER_APART_SERVER (a little
 * less: the other rider's point it sees is newer than the one a client draws, so the server never refuses a step the client's
 * own stricter prediction allowed). The aisle between the seats is 0.75 m wide: a rider standing in it is not passed, as in a
 * real narrow bus aisle; the wider floor by the doors and over the wheel housings is where people pass.
 */
export const BUS_RIDER_APART = 0.56;
export const BUS_RIDER_APART_SERVER = 0.5;

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
  // Bus v3: the aisle between the seats is only a body wide, so a walk down the bus that meets a seat's corner a few cm off the
  // aisle's middle slides round it towards the middle (by at most the step's own length) instead of stopping dead.
  const step = Math.hypot(want.ahead - from.ahead, want.right - from.right);
  if (Math.abs(want.ahead - from.ahead) > 1e-6 && Math.abs(from.right) > 1e-3) {
    const toward = from.right - Math.sign(from.right) * Math.min(Math.abs(from.right), step);
    if (okAt(want.ahead, toward)) {
      out.ahead = want.ahead;
      out.right = toward;
      return out;
    }
    if (okAt(from.ahead, toward)) {
      out.ahead = from.ahead;
      out.right = toward;
      return out;
    }
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

/** The seat cushion's front edge, ahead of the seat's centre along its facing (build_bus.py: CUSHION_C + CUSHION_D / 2). */
const CUSHION_FRONT = 0.04 + 0.5 / 2;

/** The point a body's half width (0.32 m) in front of a seat's cushion: where a rider standing right in front of it would be. */
export function seatFrontPoint(seat: BusSeat): BusLocalPoint {
  const f = facingVector(seat.yaw);
  const d = CUSHION_FRONT + 0.32;
  return { ahead: seat.ahead + f.ahead * d, right: seat.right + f.right * d };
}

/**
 * Where a rider walks to sit in `seat`: its front point, or (the rows are close: the seat ahead's backrest is in the way) the
 * nearest free point on the line from it towards the aisle's middle. Always on the cabin's free floor.
 */
export function seatApproachPoint(seat: BusSeat): BusLocalPoint {
  const front = seatFrontPoint(seat);
  for (let k = 0; k <= 40; k++) {
    const r = front.right + (0 - front.right) * (k / 40);
    if (!cabinBlocked(front.ahead, r)) return { ahead: front.ahead, right: r };
  }
  for (let k = 1; k <= 20; k++) {
    for (const da of [k * 0.05, -k * 0.05]) {
      if (!cabinBlocked(front.ahead + da, 0)) return { ahead: front.ahead + da, right: 0 };
    }
  }
  return front;
}

/** How far (m) from a seat's front a rider may ask to sit. */
export const BUS_SIT_REACH_M = 1.15;

/**
 * Whether a rider at (ahead, right) may sit in `seat`: within reach of its front, and in FRONT of it (a backed seat is sat
 * in from the front only). Each seat's front is its facing direction.
 */
export function seatApproachOk(seat: BusSeat, ahead: number, right: number): boolean {
  const front = seatFrontPoint(seat);
  if (Math.hypot(ahead - front.ahead, right - front.right) > BUS_SIT_REACH_M) return false;
  if (!seat.backed) return true;
  const f = facingVector(seat.yaw);
  // not BEHIND the backrest's line (a rider in the aisle level with the seat turns in; behind it, the back is in the way)
  return (ahead - seat.ahead) * f.ahead + (right - seat.right) * f.right > -0.12;
}

/**
 * The free seat a rider can sit in from where they stand (the approach rules respected), or null. With a facing (`yaw`), the
 * seat nearest the point half a metre ahead of them (the one they look at); without one, the nearest.
 */
export function nearestFreeSpot(
  ahead: number,
  right: number,
  takenSeats: ReadonlySet<number>,
  yaw?: number,
): { kind: "seat"; index: number; dist: number } | null {
  const fx = yaw === undefined ? 0 : facingVector(yaw).ahead * 0.5;
  const fz = yaw === undefined ? 0 : facingVector(yaw).right * 0.5;
  let best: { kind: "seat"; index: number; dist: number } | null = null;
  let bestScore = Infinity;
  BUS_SEATS.forEach((s, i) => {
    if (takenSeats.has(i) || !seatApproachOk(s, ahead, right)) return;
    const front = seatFrontPoint(s);
    const d = Math.hypot(ahead - front.ahead, right - front.right);
    const score = yaw === undefined ? d : Math.hypot(ahead + fx - front.ahead, right + fz - front.right);
    if (score < bestScore) {
      bestScore = score;
      best = { kind: "seat", index: i, dist: d };
    }
  });
  return best;
}

/** Where a rider stands up to: in front of the cushion or in the aisle beside the seat, the first spot not blocked. */
export function seatStandUpSpot(seat: BusSeat, riders?: ReadonlyArray<BusLocalPoint>): { ahead: number; right: number; yaw: number } {
  const ap = seatApproachPoint(seat);
  const candidates: BusLocalPoint[] = [
    ap,
    { ahead: seat.ahead, right: 0 },
    { ahead: ap.ahead + 0.6, right: 0 },
    { ahead: ap.ahead - 0.6, right: 0 },
    { ahead: ap.ahead + 1.2, right: 0 },
    { ahead: ap.ahead - 1.2, right: 0 },
    { ahead: ap.ahead + 1.8, right: 0 },
    { ahead: ap.ahead - 1.8, right: 0 },
  ];
  const clear = (c: BusLocalPoint): boolean =>
    !cabinBlocked(c.ahead, c.right) && !(riders && riders.some((o) => Math.hypot(o.ahead - c.ahead, o.right - c.right) < BUS_RIDER_APART));
  const hit = candidates.find(clear) ?? candidates.find((c) => !cabinBlocked(c.ahead, c.right)) ?? ap;
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
}

/**
 * Seats by the walls: a seated avatar's hands reach 0.5 m from its middle; sat in the middle of a wall seat the hands would come
 * out through the wall (checker r1: over the side's lettering). Those riders sit towards the aisle end of the cushion, so the
 * reach ends inside the wall.
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
 * The standing places (bus v3): the free floor (the walk radius clear of every seat, housing, post and wall), not on the step
 * between the floors, clear of every seated rider's legs, packed greedily a body apart (BUS_STAND_APART) starting from the
 * front door. Their count is the bus's standing capacity; the server puts a boarding rider on the first one nobody stands on.
 */
export const BUS_STAND_APART = 0.62;
function standingSpots(): BusLocalPoint[] {
  const step = 0.05;
  const door: BusLocalPoint = { ahead: 3.4, right: 0.25 };
  const seated = BUS_SEATS.map(seatBodyPoint);
  const xfOf = (ahead: number) => TRANSIT.busLengthM / 2 - ahead;
  const cand: Array<BusLocalPoint & { d: number }> = [];
  const na = Math.round((GEN_CABIN_BOUNDS.aheadMax - GEN_CABIN_BOUNDS.aheadMin) / step);
  const nr = Math.round((2 * GEN_CABIN_HALF_WIDTH) / step);
  for (let i = 0; i <= na; i++) {
    for (let j = 0; j <= nr; j++) {
      const ahead = Math.round((GEN_CABIN_BOUNDS.aheadMin + i * step) * 1000) / 1000;
      const right = Math.round((-GEN_CABIN_HALF_WIDTH + j * step) * 1000) / 1000;
      if (cabinBlocked(ahead, right)) continue;
      const xf = xfOf(ahead);
      if (xf > 5.8 && xf < 6.2) continue; // the step between the low floor and the raised rear
      if (seated.some((p) => Math.hypot(p.ahead - ahead, p.right - right) < 0.55)) continue;
      cand.push({ ahead, right, d: Math.hypot(ahead - door.ahead, right - door.right) });
    }
  }
  cand.sort((p, q) => p.d - q.d || q.ahead - p.ahead || p.right - q.right);
  const out: BusLocalPoint[] = [];
  for (const c of cand) {
    if (out.every((o) => Math.hypot(o.ahead - c.ahead, o.right - c.right) >= BUS_STAND_APART)) out.push({ ahead: c.ahead, right: c.right });
  }
  return out;
}
export const BUS_STANDING_SPOTS: readonly BusLocalPoint[] = standingSpots();
/** How many may stand, how many ride in all (seated + standing): the server refuses a rider over BUS_CAPACITY at the door. */
export const BUS_STANDING_COUNT = BUS_STANDING_SPOTS.length;
export const BUS_CAPACITY = BUS_SEAT_COUNT + BUS_STANDING_COUNT;

/** Where the first boarding rider stands: the first standing place, just inside the front door, facing back down the aisle. */
export const BUS_ENTRY = { ahead: BUS_STANDING_SPOTS[0]!.ahead, right: BUS_STANDING_SPOTS[0]!.right, yaw: Math.PI } as const;

/**
 * Where a boarding rider is put: the first standing place no other rider stands within a body of (BUS_RIDER_APART), facing
 * back down the aisle; null when every standing place has someone on or beside it (the server then refuses the boarding).
 */
export function freeBusEntry(others: ReadonlyArray<BusLocalPoint>, apart = BUS_RIDER_APART): { ahead: number; right: number; yaw: number } | null {
  for (const e of BUS_STANDING_SPOTS) {
    if (!others.some((o) => Math.hypot(o.ahead - e.ahead, o.right - e.right) < apart)) return { ahead: e.ahead, right: e.right, yaw: Math.PI };
  }
  return null;
}

/**
 * Where a rider is drawn (world), from the bus pose and the rider's bus-local place: `busSeat` (the schema) and the local
 * point. A seated rider is put on the seat (the seat's own point, whatever the point says).
 */
export function busRiderWorldPose(
  bus: Pick<TransitPose, "x" | "z" | "yaw">,
  busSeat: number,
  ahead: number,
  right: number,
  yaw: number,
  out: BusRiderPoseFull = { x: 0, z: 0, yaw: 0, y: 0, seated: false },
): BusRiderPoseFull {
  const place = busPlaceOf(busSeat);
  let a = ahead;
  let r = right;
  let yw = yaw;
  let floor = cabinFloorAt(ahead, right);
  out.seated = false;
  if (place.kind === "seat") {
    const s = BUS_SEATS[place.index]!;
    const body = seatBodyPoint(s);
    a = body.ahead;
    r = body.right;
    yw = s.yaw;
    floor = s.floor;
    out.seated = true;
  }
  busLocalToWorld(bus, a, r, out);
  out.yaw = bus.yaw + yw;
  out.y = out.seated ? floor + BUS_SEAT_SURFACE - SIT_POSE.contactY : floor;
  return out;
}
