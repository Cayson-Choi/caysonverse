// Where the angler stands relative to the lake's things — pure (tested): the rental pad, the free fishing chairs, the zone.

import { SEAT_REACH, nearestFreeSeat } from "@caysonverse/shared/worldMap";
import { LAKE_AREA, LAKE_FISHING_SPOTS, LAKE_RENTAL_PAD, lakeSeats, type LakeSeat } from "@caysonverse/shared/village/lakeLayout";
import { LAKE_SEAT_BASE } from "@caysonverse/shared/village/benchSeats";

/** The 30 fishing chairs, in spot order (lakeSeats() puts them first): index = the spot's index = LAKE_SEAT_BASE + index in the room's seat list. */
export const FISHING_CHAIRS: readonly LakeSeat[] = lakeSeats().filter((s) => s.kind === "fishing_chair");

export const inLakeZone = (x: number, z: number): boolean => x >= LAKE_AREA.minX - 1 && x <= LAKE_AREA.maxX && z >= LAKE_AREA.minZ && z <= LAKE_AREA.maxZ;

/** On the rental pad (the yellow circle): the server checks a little wider, the client the visible circle. */
export function onRentalPad(x: number, z: number): boolean {
  return Math.hypot(x - LAKE_RENTAL_PAD.x, z - LAKE_RENTAL_PAD.z) <= LAKE_RENTAL_PAD.radius;
}

/** The nearest free fishing chair that may be offered from (x, z) (in reach, from the side / front only), as a spot index, or -1. */
export function nearestFreeChair(x: number, z: number, occupied: ReadonlySet<number>): number {
  const i = nearestFreeSeat(x, z, (k) => occupied.has(k), SEAT_REACH, FISHING_CHAIRS);
  return i === null ? -1 : i;
}

/** Whether a seat index of the room's list is one of the 30 fishing chairs (and which spot). */
export function chairSpotOfSeat(seatIndex: number): number {
  const i = seatIndex - LAKE_SEAT_BASE;
  return i >= 0 && i < FISHING_CHAIRS.length ? i : -1;
}

export function spotId(i: number): string {
  return LAKE_FISHING_SPOTS[i]?.id ?? "";
}
