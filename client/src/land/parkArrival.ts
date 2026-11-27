import { PARK_ARRIVAL, PARK_BOUNDS } from "@caysonverse/shared/village/parkArea";

/** The third-person tilt the view settles at on arriving in the park (rad): the promenade and the plaza ahead, a little sky. */
export const PARK_ARRIVAL_PITCH = 0.32;
/** How far from the arrival spot (m) someone can stand and still have just arrived (the server spreads arrivals beside each other). */
export const PARK_ARRIVAL_REACH_M = 8;

/**
 * Whether the park mounting with the local player at (x, z) is an ARRIVAL through the gate (the view turns into the park) or a page that
 * came back deep inside it (the view stays). The pose may still hold the village's coordinates for a frame when the park mounts: those
 * lie outside the park's bounds, which is an arrival too.
 */
export function parkArrivalView(x: number, z: number): boolean {
  const inside = x >= PARK_BOUNDS.minX && x <= PARK_BOUNDS.maxX && z >= PARK_BOUNDS.minZ && z <= PARK_BOUNDS.maxZ;
  if (!inside) return true;
  return Math.hypot(x - PARK_ARRIVAL.x, z - PARK_ARRIVAL.z) <= PARK_ARRIVAL_REACH_M;
}
