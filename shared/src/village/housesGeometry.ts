/**
 * 집 실내의 지형 (집 실내 G, 2026-11-16) — the ten houses' collision as part of the village's ONE geometry (like the memorial hall):
 * every floor of every house is its own room at y = 0 far east of everything else (houseAreas.ts: house N floor 1 at x 360 + 24 (N − 1),
 * z −7.8..0; floor 2 at z 22.2..30), and the server judges every move on `villageGeometry`, which now spans the village, the hall and
 * this block. Browser-safe, no values from villageLayout (it imports THIS file).
 *
 *  - `HOUSES_BLOCK` is the rectangle of all twenty rooms with their 0.3 m walls (x 359.7 .. 586.9, z −8.1 .. 30.3);
 *  - `houseFloorWalls` are the four walls of every floor (a house without a model yet is a sealed empty room nobody can enter);
 *  - `housesBlockers` fills every bit of the geometry's bounds that is not a room — the gaps between the houses, between the two
 *    rows (floor 1 / floor 2), and a `HOUSES_APRON` (5 m, like the hall's) around the block — so a legal step of up to 4.8 m that
 *    clears a wall still ends on solid ground and is dropped;
 *  - `houseColliders` are the generated boxes of the finished houses (generated/houses/index.ts), `houseFloorGeometry` the map of
 *    ONE floor as the client plays on it (walls + that floor's furniture; the room's ceiling slab as a camera box).
 */

import type { AABB, CameraBox } from "../collision";
import { makeGeometry, wallsAround, type Bounds, type MapGeometry } from "../school/geometry";
import { GENERATED_HOUSES } from "./generated/houses";
import { isRemovedHouseBox } from "./houseFixes";
import {
  HOUSE_FLOORS,
  HOUSE_NUMBERS,
  HOUSE_ROOM,
  houseFloorBounds,
  type HouseFloor,
  type HouseNumber,
} from "./houseAreas";

/** Wall thickness of a house floor (m): outside its clear rectangle. */
export const HOUSE_WALL = HOUSE_ROOM.wall;

/** Solid ground kept around the block (m): at least one legal step (4.8 m), like the hall's apron. */
export const HOUSES_APRON = 5;

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** The room plus its walls: the outer rectangle of one floor. */
export function houseFloorOuter(n: HouseNumber, floor: HouseFloor): Bounds {
  const b = houseFloorBounds(n, floor);
  return { minX: r6(b.minX - HOUSE_WALL), maxX: r6(b.maxX + HOUSE_WALL), minZ: r6(b.minZ - HOUSE_WALL), maxZ: r6(b.maxZ + HOUSE_WALL) };
}

/** The rectangle of all twenty rooms with their walls: x 359.7 .. 586.9, z −8.1 .. 30.3. */
export const HOUSES_BLOCK: Readonly<Bounds> = Object.freeze({
  minX: houseFloorOuter(1, 1).minX,
  maxX: houseFloorOuter(10, 1).maxX,
  minZ: houseFloorOuter(1, 1).minZ,
  maxZ: houseFloorOuter(1, 2).maxZ,
});

/** `HOUSES_BLOCK` and its apron: what the village's bounds must cover. */
export const HOUSES_ZONE: Readonly<Bounds> = Object.freeze({
  minX: r6(HOUSES_BLOCK.minX - HOUSES_APRON),
  maxX: r6(HOUSES_BLOCK.maxX + HOUSES_APRON),
  minZ: r6(HOUSES_BLOCK.minZ - HOUSES_APRON),
  maxZ: r6(HOUSES_BLOCK.maxZ + HOUSES_APRON),
});

/** The four walls of one floor, just outside its room (no openings: the doors and the stair are teleport pads). */
export function houseFloorWalls(n: HouseNumber, floor: HouseFloor): AABB[] {
  return wallsAround(houseFloorBounds(n, floor), [], HOUSE_WALL);
}

/** The walls of all twenty floors. */
export function allHouseWalls(): AABB[] {
  return HOUSE_NUMBERS.flatMap((n) => HOUSE_FLOORS.flatMap((f) => houseFloorWalls(n, f)));
}

/**
 * Everything of `bounds` that is neither a house room nor its wall, as invisible solid boxes: the strips north and south of the
 * block (z beyond the floor-1 north walls and the floor-2 south walls), the strip between the two rows, and in each row the ground
 * between neighbouring houses and beyond the first and last. `bounds` is the whole geometry's rectangle (the strips run to its
 * edges, so the block's east side and the apron north / south are covered whatever the bounds are).
 */
export function housesBlockers(bounds: Bounds, fromX: number = HOUSES_ZONE.minX): AABB[] {
  const out: AABB[] = [];
  const push = (b: AABB) => {
    if (b.maxX > b.minX && b.maxZ > b.minZ) out.push({ minX: r6(b.minX), maxX: r6(b.maxX), minZ: r6(b.minZ), maxZ: r6(b.maxZ) });
  };
  const x0 = fromX;
  const x1 = bounds.maxX;
  // rows: [outer minZ, outer maxZ] of floor 1 and floor 2
  const row1 = [houseFloorOuter(1, 1).minZ, houseFloorOuter(1, 1).maxZ] as const;
  const row2 = [houseFloorOuter(1, 2).minZ, houseFloorOuter(1, 2).maxZ] as const;
  push({ minX: x0, maxX: x1, minZ: bounds.minZ, maxZ: row1[0] }); // north of the block
  push({ minX: x0, maxX: x1, minZ: row1[1], maxZ: row2[0] }); // between floor 1 and floor 2
  push({ minX: x0, maxX: x1, minZ: row2[1], maxZ: bounds.maxZ }); // south of the block
  for (const [z0, z1, floor] of [[row1[0], row1[1], 1], [row2[0], row2[1], 2]] as const) {
    let cursor = x0;
    for (const n of HOUSE_NUMBERS) {
      const o = houseFloorOuter(n, floor);
      push({ minX: cursor, maxX: o.minX, minZ: z0, maxZ: z1 });
      cursor = o.maxX;
    }
    push({ minX: cursor, maxX: x1, minZ: z0, maxZ: z1 });
  }
  return out;
}

/** The ceiling of a floor as a camera box over the room and its walls: the camera is stopped under its underside (like the hall's slab). */
export function houseCeilingSlab(n: HouseNumber, floor: HouseFloor, ceiling: number = HOUSE_ROOM.ceiling): CameraBox {
  const o = houseFloorOuter(n, floor);
  return { ...o, minY: r6(ceiling - 0.1), height: r6(ceiling + 0.1) };
}

/** The finished houses' furniture and walls from the model (collision boxes) and the camera boxes (≥ 1.6 m), plus every floor's ceiling slab. */
export function houseColliders(): { obstacles: AABB[]; cameraBoxes: CameraBox[] } {
  const obstacles: AABB[] = [];
  const cameraBoxes: CameraBox[] = [];
  for (const n of HOUSE_NUMBERS) {
    const g = GENERATED_HOUSES[n];
    if (g) {
      obstacles.push(...g.colliders.filter((b) => !isRemovedHouseBox(n, b)));
      cameraBoxes.push(...g.cameraBoxes);
    }
    for (const f of HOUSE_FLOORS) cameraBoxes.push(houseCeilingSlab(n, f));
  }
  return { obstacles, cameraBoxes };
}

/** Whether house N has its interior (a generated seat + collider file in generated/houses): a house without one keeps its door locked. */
export function houseIsReady(n: HouseNumber): boolean {
  return GENERATED_HOUSES[n] !== undefined;
}

/** Does the box lie within a floor's outer rectangle (centre inside)? */
function inOuter(b: AABB, o: Bounds): boolean {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  return cx > o.minX && cx < o.maxX && cz > o.minZ && cz < o.maxZ;
}

const FLOOR_MAPS = new Map<string, MapGeometry>();

/**
 * The map of one house floor as the client plays on it: the four walls (also camera boxes), the house's furniture boxes of that
 * floor, the camera boxes of that floor and its ceiling slab; `bounds` = the room's rectangle. A floor of a house with no model has
 * only the walls and the ceiling. Cached: one object per floor.
 */
export function houseFloorGeometry(n: HouseNumber, floor: HouseFloor): MapGeometry {
  const key = `${n}:${floor}`;
  const cached = FLOOR_MAPS.get(key);
  if (cached) return cached;
  const outer = houseFloorOuter(n, floor);
  const g = GENERATED_HOUSES[n];
  const walls = houseFloorWalls(n, floor);
  const props = g ? g.colliders.filter((b) => inOuter(b, outer) && !isRemovedHouseBox(n, b)) : [];
  const tall = g ? g.cameraBoxes.filter((b) => inOuter(b, outer)) : [];
  const base = makeGeometry("house", houseFloorBounds(n, floor), walls, props, [...tall, houseCeilingSlab(n, floor)]);
  // the model holds its own four walls too; the duplicates add nothing but are harmless (same boxes, same side)
  const geometry = Object.freeze(base);
  FLOOR_MAPS.set(key, geometry);
  return geometry;
}
