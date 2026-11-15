/**
 * Where riders get off the village bus. The rider's place INSIDE it (seats, hold spots, the aisle, boarding and the
 * walk) lives in busCabin.ts since 2026-11-15 (owner: walk inside, sit or stand, look out every window); this keeps the
 * pavement spot outside the middle door that the server puts a rider on at the stop.
 */

import { TRANSIT, type TransitPose } from "./transit";

/** Where riders step off (m): outside the middle door, on the pavement past the kerb, spread along it by slot. */
const DISMOUNT_RIGHT = 2.55;
const DISMOUNT_AHEAD = [-0.6, 0.4, -1.6, 1.4, -2.6, 2.4] as const;

/** Where the rider in slot `slot` (any integer: it picks a spot along the pavement) is put down on getting off the bus parked at the stop. */
export function busDismountSpot(slot: number, bus: TransitPose = TRANSIT.parked): { x: number; z: number; yaw: number } {
  const n = DISMOUNT_AHEAD.length;
  const ahead = DISMOUNT_AHEAD[((Math.trunc(slot) % n) + n) % n]!;
  const fx = Math.sin(bus.yaw);
  const fz = Math.cos(bus.yaw);
  // facing away from the bus, onto the pad
  return { x: bus.x + fx * ahead - fz * DISMOUNT_RIGHT, z: bus.z + fz * ahead + fx * DISMOUNT_RIGHT, yaw: Math.atan2(-fz, fx) };
}
