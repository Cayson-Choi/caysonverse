/**
 * Pieces of the finished houses taken out in the game when one shuts a way a body needs and the art cannot move it without a rebake.
 * Round 3 (G integration) removed five (house 6's side table, house 7's sofa-side table, house 8's snake plant, house 9's two dining end
 * chairs); the art round 2 moved or restored every one of them in the models (houses 6–9 rebaked), so the list is empty now. The
 * machinery stays (collision box, seat markers, triangles — client houseModelPrep.ts `dressLoadedHouse`) for a future piece.
 *
 * The boxes are the generated collider boxes exactly (`generated/houses/house_N_colliders.ts`, the `col__` named in `name`).
 */

import type { AABB } from "../collision";
import type { HouseFloor, HouseNumber } from "./houseAreas";

export interface HouseRemovedPiece {
  n: HouseNumber;
  floor: HouseFloor;
  /** The collider node, for the record. */
  name: string;
  /** Its collision box (exactly as generated). */
  box: AABB;
  /** The seat markers on it (dropped from the seat list). */
  seats: readonly string[];
  /** The model's triangles to cut: those whose centre lies in `box` (grown by `grow`) between these heights (m). */
  cut: { grow: number; minY: number; maxY: number };
  why: string;
}

export const HOUSE_REMOVED_PIECES: readonly HouseRemovedPiece[] = Object.freeze([]);

const same = (a: AABB, b: AABB): boolean => a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;

/** Whether a generated collider box of house N is one taken out (HOUSE_REMOVED_PIECES). */
export function isRemovedHouseBox(n: HouseNumber, box: AABB): boolean {
  return HOUSE_REMOVED_PIECES.some((p) => p.n === n && same(p.box, box));
}

/** Whether a seat marker (`h<N>_<F>_<k>`) sits on a piece taken out. */
export function isRemovedHouseSeat(id: string): boolean {
  return HOUSE_REMOVED_PIECES.some((p) => p.seats.includes(id));
}
