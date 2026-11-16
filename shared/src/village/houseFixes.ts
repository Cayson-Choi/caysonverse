/**
 * Pieces of the finished houses taken out in the game (집 실내 G round 3, integration of HA / HB): each one shut a way a body needs — the
 * stair's pad of house 8 and 9 could not be reached at all, house 6's reading corner was sealed by its furniture — and the art cannot
 * move it without a rebake. Until the builder moves it (listed for the art round), the game drops the piece's collision box, its seat
 * markers, and its triangles (client: houseModelPrep.ts `dressLoadedHouse`). Its baked contact shadow on the floor stays — faint.
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

export const HOUSE_REMOVED_PIECES: readonly HouseRemovedPiece[] = Object.freeze([
  {
    n: 6,
    floor: 1,
    name: "col__h6_1_sidetable",
    box: { minX: 481.89, maxX: 482.51, minZ: -3.76, maxZ: -3.14 },
    seats: [],
    cut: { grow: 0.03, minY: 0.04, maxY: 1.0 },
    why: "the reading corner (two armchairs, an ottoman) was sealed by the side table between the armchair and the ottoman: no way in",
  },
  {
    n: 7,
    floor: 1,
    name: "col__h7_1_side",
    box: { minX: 507.35, maxX: 507.75, minZ: -4.67, maxZ: -4.22 },
    seats: [],
    cut: { grow: 0.03, minY: 0.04, maxY: 1.0 },
    why: "the sofa's side table and the armchair's lamp left a diagonal slit as the only way into the living corner and to the stair's pad: no tap found it",
  },
  {
    n: 8,
    floor: 1,
    name: "col__h8_1_snake",
    box: { minX: 530.85, maxX: 531.25, minZ: -1.9, maxZ: -1.5 },
    seats: [],
    cut: { grow: 0.12, minY: 0.04, maxY: 1.4 },
    why: "the potted snake plant closed the only way to the stair's foot (between the 문갑 and the entrance partition): no way upstairs",
  },
  {
    n: 9,
    floor: 1,
    name: "col__h9_1_dchair8",
    box: { minX: 561.4, maxX: 561.92, minZ: -4.57, maxZ: -4.07 },
    seats: ["h9_1_10"],
    cut: { grow: 0.03, minY: 0.04, maxY: 1.2 },
    why: "the dining table's head chair stood 0.7 m from the wall, the only way to the stair's foot: no way upstairs",
  },
  {
    n: 9,
    floor: 1,
    name: "col__h9_1_dchair5",
    box: { minX: 560.6, maxX: 561.1, minZ: -3.45, maxZ: -2.93 },
    seats: ["h9_1_7"],
    cut: { grow: 0.03, minY: 0.04, maxY: 1.2 },
    why: "the north row's end chair left 0.88 m to the café counter, the way round the table's end to the stair: the walk stuck there",
  },
]);

const same = (a: AABB, b: AABB): boolean => a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;

/** Whether a generated collider box of house N is one taken out (HOUSE_REMOVED_PIECES). */
export function isRemovedHouseBox(n: HouseNumber, box: AABB): boolean {
  return HOUSE_REMOVED_PIECES.some((p) => p.n === n && same(p.box, box));
}

/** Whether a seat marker (`h<N>_<F>_<k>`) sits on a piece taken out. */
export function isRemovedHouseSeat(id: string): boolean {
  return HOUSE_REMOVED_PIECES.some((p) => p.seats.includes(id));
}
