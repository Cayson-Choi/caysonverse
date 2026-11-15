/**
 * Where the riders of the village bus are (owner 2026-11-15: "버스에 탑승했는데 캐릭터는 버스안에 있지 않고 밖에 그대로
 * 서있어" — after boarding the avatar stood on the pad outside, for up to the 3 minutes of boarding and through the lap).
 *
 * A rider gets a place in the bus (`Player.busSeat`, given by the server on boarding): one of the cabin's forward-facing
 * seats (village_bus.glb, art/village/tools/build_bus.py cabin(): `seat(P, xf, X, floor, ...)`), the door side first,
 * then a standing place in the aisle when every seat is taken (28 places; the last riders of a full room of 30 share one). Every client draws the rider there, sitting (or standing)
 * in the bus wherever the bus is (the same synced bus pose for all of them), so the rider moves with the bus and looks
 * the same to everyone. Getting off, the server puts the rider on the pavement outside the middle door
 * (`busDismountSpot`).
 *
 * Frames: build_bus.py measures `xf` back from the bus's nose (0 .. 9 m) and `X` across (+ = the door side, the bus's
 * right), heights from the ground; the glTF bus is built nose north (-z) with its centre at the origin, so a cabin
 * point is at local (X, height, xf - 4.5) and VillageBus turns the model by `yaw + PI`. Here a point is kept as
 * `ahead` (m ahead of the bus's centre: 4.5 - xf) and `right` (m to the door side: X).
 */

import { SIT_POSE, SIT_ROOT_AHEAD } from "../sitPose";
import { TRANSIT, type TransitPose } from "./transit";

export interface BusPlace {
  /** m ahead of the bus's centre (along its heading) where the avatar's root goes */
  ahead: number;
  /** m to the bus's right (the door side) */
  right: number;
  /** the cabin floor's height there (m) */
  floor: number;
  /** a seat (its surface `floor + BUS_SEAT_SURFACE`) or a standing place */
  seated: boolean;
}

/** A seat's surface above its floor (build_bus.py seat(): the cushion's top at 0.432 + 0.02). */
export const BUS_SEAT_SURFACE = 0.452;
/** How far ahead of a seat's base its cushion's front edge is (build_bus.py: cushion at +0.04, 0.37 deep). */
const CUSHION_FRONT = 0.04 + 0.37 / 2;

/** A forward-facing seat at build_bus.py's (xf, X, floor): the root just ahead of the cushion (sitPose.ts SIT_ROOT_AHEAD). */
function seatAt(xf: number, X: number, floor: number): BusPlace {
  return { ahead: TRANSIT.busLengthM / 2 - xf + CUSHION_FRONT + SIT_ROOT_AHEAD, right: X, floor, seated: true };
}

/** A standing place in the low-floor aisle (floor 0.34 m). */
function standAt(xf: number, X: number): BusPlace {
  return { ahead: TRANSIT.busLengthM / 2 - xf, right: X, floor: 0.34, seated: false };
}

/**
 * The riders' places in the order they are given: the door-side seats first (seen from the stop's pad through the
 * windows), then the other side, the back row, then standing places in the low-floor aisle. The toy figure is wider
 * than a bus seat (its hands on its knees reach about 0.5 m to each side of its middle): one rider takes a PAIR of
 * seats, sitting on the inner one, and a single seat by the wall is taken from its inner edge, so no hand or shoe pokes through the bus's side (review: a shoe, then a hand, stood out of the door-side panel).
 */
export const BUS_PLACES: readonly BusPlace[] = [
  seatAt(3.55, 0.6, 0.34),
  seatAt(6.65, 0.6, 0.75),
  seatAt(7.4, 0.6, 0.75),
  seatAt(2.35, 0.68, 0.8),
  seatAt(3.35, -0.6, 0.34),
  seatAt(4.05, -0.6, 0.34),
  seatAt(6.65, -0.6, 0.75),
  seatAt(7.4, -0.6, 0.75),
  seatAt(2.35, -0.68, 0.8),
  seatAt(8.35, 0.0, 0.75),
  seatAt(8.35, -0.55, 0.75),
  seatAt(8.35, 0.55, 0.75),
  standAt(4.6, 0.3),
  standAt(5.25, 0.2),
  standAt(4.6, -0.2),
  standAt(5.25, 0.6),
  standAt(5.6, -0.25),
  standAt(4.1, 0.25),
  standAt(2.95, 0.1),
  standAt(4.2, 0.65),
  standAt(3.5, -0.15),
  standAt(2.4, 0.0),
  standAt(5.7, 0.5),
  standAt(3.95, -0.35),
  standAt(1.9, 0.0),
  standAt(3.45, 0.35),
  standAt(5.0, -0.25),
  standAt(2.6, 0.45),
];

/** The place for rider slot `slot` (a slot past the list shares a place: the bus never refuses a rider). */
export function busPlace(slot: number): BusPlace {
  const n = BUS_PLACES.length;
  return BUS_PLACES[((Math.trunc(slot) % n) + n) % n]!;
}

/** The lowest rider slot nobody holds. */
export function freeBusSlot(taken: Iterable<number>): number {
  const used = new Set<number>();
  for (const t of taken) if (t >= 0) used.add(t);
  let s = 0;
  while (used.has(s)) s++;
  return s;
}

export interface BusRiderPose {
  x: number;
  z: number;
  /** the avatar's facing (the bus's heading) */
  yaw: number;
  /** how high the avatar's root stands (the cabin floor, or the seat's lift for the sit pose) */
  y: number;
  seated: boolean;
}

/** Where a rider in slot `slot` is drawn when the bus stands at `bus` (written into `out`, allocation-free). */
export function busRiderPose(bus: TransitPose, slot: number, out: BusRiderPose = { x: 0, z: 0, yaw: 0, y: 0, seated: true }): BusRiderPose {
  const p = busPlace(slot);
  const fx = Math.sin(bus.yaw);
  const fz = Math.cos(bus.yaw);
  // the bus's right (doors) is its heading turned a quarter clockwise seen from above (transit.ts busFootprint)
  out.x = bus.x + fx * p.ahead - fz * p.right;
  out.z = bus.z + fz * p.ahead + fx * p.right;
  out.yaw = bus.yaw;
  out.y = p.seated ? p.floor + BUS_SEAT_SURFACE - SIT_POSE.contactY : p.floor;
  out.seated = p.seated;
  return out;
}

/** Where riders step off (m): outside the middle door, on the pavement past the kerb, spread along it by slot. */
const DISMOUNT_RIGHT = 2.55;
const DISMOUNT_AHEAD = [-0.6, 0.4, -1.6, 1.4, -2.6, 2.4] as const;

/** Where the rider in slot `slot` is put down on getting off the bus parked at the stop. */
export function busDismountSpot(slot: number, bus: TransitPose = TRANSIT.parked): { x: number; z: number; yaw: number } {
  const n = DISMOUNT_AHEAD.length;
  const ahead = DISMOUNT_AHEAD[((Math.trunc(slot) % n) + n) % n]!;
  const fx = Math.sin(bus.yaw);
  const fz = Math.cos(bus.yaw);
  // facing away from the bus, onto the pad
  return { x: bus.x + fx * ahead - fz * DISMOUNT_RIGHT, z: bus.z + fz * ahead + fx * DISMOUNT_RIGHT, yaw: Math.atan2(-fz, fx) };
}
