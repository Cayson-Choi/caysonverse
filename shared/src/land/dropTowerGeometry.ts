/**
 * The 구름 낙하탑's solids as plain numbers (the same ones client/src/land/DropTowerWorld.tsx builds), so a unit test can prove that the car and its riders
 * never touch the tower, the crown or the platform at ANY moment of the ride. Park frame relative to DROP_SITE (x east, y up, z south).
 */
import { DROP_CAR, DROP_DECK_Y, DROP_PLATFORM_INNER, DROP_PLATFORM_R, DROP_SEATS, DROP_TOWER_H, dropSeatCell, dropFaceDir, dropSeatLocal } from "./dropTower";

export type V3 = readonly [number, number, number];
export interface Box {
  min: V3;
  max: V3;
  name: string;
}

/** The tower's column and the cloud crown (clouds above DROP_CROWN_Y). */
export const DROP_COLUMN: Box = { name: "column", min: [-DROP_CAR.towerHalf, 0, -DROP_CAR.towerHalf], max: [DROP_CAR.towerHalf, DROP_TOWER_H - 5, DROP_CAR.towerHalf] };
export const DROP_CROWN_Y = DROP_TOWER_H - 5.5;
export const DROP_CROWN: Box = { name: "crown", min: [-3.2, DROP_CROWN_Y, -3.2], max: [3.2, DROP_TOWER_H + 1.5, 3.2] };

/** The platform deck: a square annulus of slabs round the car's station, flush with the car's floor. */
export const DROP_PLATFORM_BOXES: readonly Box[] = Object.freeze([
  { name: "deck north", min: [-DROP_PLATFORM_R, 0, -DROP_PLATFORM_R], max: [DROP_PLATFORM_R, DROP_DECK_Y, -DROP_PLATFORM_INNER] },
  { name: "deck south", min: [-DROP_PLATFORM_R, 0, DROP_PLATFORM_INNER], max: [DROP_PLATFORM_R, DROP_DECK_Y, DROP_PLATFORM_R] },
  { name: "deck west", min: [-DROP_PLATFORM_R, 0, -DROP_PLATFORM_INNER], max: [-DROP_PLATFORM_INNER, DROP_DECK_Y, DROP_PLATFORM_INNER] },
  { name: "deck east", min: [DROP_PLATFORM_INNER, 0, -DROP_PLATFORM_INNER], max: [DROP_PLATFORM_R, DROP_DECK_Y, DROP_PLATFORM_INNER] },
]);

export function pointBoxDistance(p: V3, b: Box): number {
  const dx = Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]);
  const dy = Math.max(b.min[1] - p[1], 0, p[1] - b.max[1]);
  const dz = Math.max(b.min[2] - p[2], 0, p[2] - b.max[2]);
  return Math.hypot(dx, dy, dz);
}

/** Points of everything that rides at hip height `y`: each rider's back, head, knees and dangling feet, the shoulder harness' top, and the car's floor ring. */
export function dropRidingPoints(y: number): { p: V3; name: string }[] {
  const out: { p: V3; name: string }[] = [];
  const loc: [number, number] = [0, 0];
  for (let s = 0; s < DROP_SEATS; s++) {
    dropSeatLocal(s, loc);
    const { face } = dropSeatCell(s);
    const n = dropFaceDir(face);
    const at = (back: number, dy: number): V3 => [loc[0] + n.x * back, y + dy, loc[1] + n.z * back];
    out.push({ p: at(-0.25, 0.0), name: "back" }, { p: at(-0.2, 1.0), name: "head" }, { p: at(-0.2, 1.45), name: "harness top" }, { p: at(0.45, 0.1), name: "knee" }, { p: at(0.6, -0.55), name: "foot" });
  }
  // the car's floor ring (radius floorInner..floorOuter, 0.5 m under the hips)
  for (let a = 0; a < 48; a++) {
    const t = (a / 48) * Math.PI * 2;
    for (const r of [DROP_CAR.floorInner, DROP_CAR.floorOuter]) out.push({ p: [Math.cos(t) * r, y - DROP_CAR.floorBelow, Math.sin(t) * r], name: "floor" });
  }
  return out;
}

/**
 * The tower's outer frame (design 2026-11-19): four leaning legs at the corners of a square, joined by ring beams, arches and braces, standing OUTSIDE the car's
 * swept cylinder. `d` is the distance from the tower's axis to each face plane of the frame (the legs stand at (±d, ±d)); it tapers from dBase at the deck to dTop
 * at the crown. The car (radius floorOuter + its rim) must always clear every part of the frame: dropFrameReach(y) is the nearest any frame part comes to the axis.
 */
export const DROP_FRAME = Object.freeze({ dBase: 5.1, dTop: 4.4, beamHalf: 0.22, rim: 0.08 });
export function dropFrameD(y: number): number {
  const t = Math.max(0, Math.min(1, y / DROP_CROWN_Y));
  return DROP_FRAME.dBase + (DROP_FRAME.dTop - DROP_FRAME.dBase) * t;
}
/** The nearest any part of the frame comes to the tower's axis at height y (the beams' and arches' inner faces; the legs stand farther out, on the diagonals). */
export function dropFrameReach(y: number): number {
  return dropFrameD(y) - DROP_FRAME.beamHalf;
}
/** The widest the car's frame reaches from the axis (its floor's outer edge and its rim). */
export const DROP_CAR_REACH = DROP_CAR.floorOuter + DROP_FRAME.rim;
