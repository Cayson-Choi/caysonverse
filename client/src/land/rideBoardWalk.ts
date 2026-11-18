/**
 * Pressing a ride's 타기: close enough, the board is sent at once (the server seats me, or reserves the seat when the ride is not loading);
 * farther away, I WALK to the pad (the game's own detour search round the colliders, as a tap on the ground would) and the board is armed:
 * VillageScene sends it on arrival (rideBoard.ts takeArmedRide).
 */
import { rideByKey, type RideKey } from "@caysonverse/shared/land/rides";
import { sendRideBoard } from "../net/connection";
import { findDetour } from "../game/clickPlan";
import { getActiveMap, activeBounds } from "../game/activeMap";
import { setClickTarget } from "../game/clickMove";
import { RIDE_ARRIVE_M, armRide } from "./rideBoard";

export function boardRide(key: RideKey, x: number, z: number): void {
  const def = rideByKey(key);
  if (!def) return;
  if (Math.hypot(x - def.pad.x, z - def.pad.z) <= def.pad.radius + RIDE_ARRIVE_M) {
    armRide(null);
    sendRideBoard(key);
    return;
  }
  armRide(key);
  const via = findDetour(x, z, def.pad.x, def.pad.z, getActiveMap().geometry.obstacles, activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
  setClickTarget(def.pad.x, def.pad.z, 0, via ?? undefined);
}
