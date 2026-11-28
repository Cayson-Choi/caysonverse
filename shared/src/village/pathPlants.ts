/**
 * Plants the baked village.glb stands ON a path (owner 2026-11-21: "절로 가는 입구에 나무가 왜 도로에 있는거야 꽃들도 그렇고").
 * The model's street trees and shrubs were placed along the old straight lanes; the ground paths later redrew the lanes
 * (client/src/village/ground/groundPaths.ts) and two lane trees and a sidewalk cherry stayed where the paving is now.
 * They are moved here, at runtime, to the nearest grass: the game grows the trees at the new spots
 * (client veg/villageVegetation.ts reads `pathPlantShift`) and plays on the moved colliders (`stagePathPlants`), the same way
 * a8Staging.ts hands the A8 houses' moved trees over until the model is rebuilt. Once the model holds a moved box, the swap
 * leaves it alone. The sweeps that found them: client/src/village/veg/vegOffPaths.test.ts.
 *
 * (The four shrubs the model has on the two lanes' cobbles, col__shrub_1 / 3 / 14 / 16, are not grown at all since the lanes were
 * redrawn; only their BOXES were left, invisible, on the temple's and the chapel's lanes. They are not moved: the boxes go with the
 * other plant boxes nothing is drawn in, generated/villageVegColliders.ts VILLAGE_VEG_GHOSTS.)
 */

import type { AABB, CameraBox } from "../collision";

export interface PathPlantMove {
  /** The model's node (col__<id>). */
  id: string;
  kind: "tree" | "shrub";
  /** The collider box's centre in the model. */
  from: { x: number; z: number };
  /** Where it stands now: >= 1 m (trees) / 0.8 m (shrubs) off any paving. */
  to: { x: number; z: number };
  /** The model's collider box (exact, from generated/villageColliders.ts). */
  box: AABB;
}

export const PATH_PLANT_MOVES: ReadonlyArray<PathPlantMove> = Object.freeze([
  // the nw lane to the temple (lane_plot_nw): the tree in the middle of the cobbles and the two shrubs on its edge. 2026-11-28: on
  // between the lane and house 9's front walk (x -31), which leaves the lane there (>= 1.4 m off both)
  { id: "tree_44", kind: "tree", from: { x: -31.37, z: -30.39 }, to: { x: -28.3, z: -34.5 }, box: { minX: -31.62, maxX: -31.12, minZ: -30.64, maxZ: -30.14 } },
  // the ne lane (lane_plot_ne) to the chapel: its mirror (house 7's walk, x 31)
  { id: "tree_37", kind: "tree", from: { x: 31.37, z: -30.39 }, to: { x: 28.3, z: -34.5 }, box: { minX: 31.12, maxX: 31.62, minZ: -30.64, maxZ: -30.14 } },
  // the sidewalk's outer edge by the bridge lane: the cherry whose trunk stood 35 cm inside the paving
  { id: "tree_11", kind: "tree", from: { x: -13.5, z: 36 }, to: { x: -14.15, z: 37.74 }, box: { minX: -13.75, maxX: -13.25, minZ: 35.75, maxZ: 36.25 } },
]);

const r2 = (v: number): number => Math.round(v * 100) / 100;
const same = (a: AABB, b: AABB): boolean => a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;

/** The moved plant's box at its new centre (the model's size). */
export function movedBox(m: PathPlantMove): AABB {
  const dx = m.to.x - m.from.x;
  const dz = m.to.z - m.from.z;
  return { minX: r2(m.box.minX + dx), maxX: r2(m.box.maxX + dx), minZ: r2(m.box.minZ + dz), maxZ: r2(m.box.maxZ + dz) };
}

/** The shift (m) of the plant that stands at (x, z) in the model (within 6 cm), or null. */
export function pathPlantShift(x: number, z: number, kind?: PathPlantMove["kind"]): { dx: number; dz: number } | null {
  for (const m of PATH_PLANT_MOVES) {
    if (kind && m.kind !== kind) continue;
    if (Math.abs(m.from.x - x) < 0.06 && Math.abs(m.from.z - z) < 0.06) return { dx: m.to.x - m.from.x, dz: m.to.z - m.from.z };
  }
  return null;
}

/** The colliders with each plant's box swapped for its moved one (a box the model does not have is not added). */
export function stagePathPlants<G extends { obstacles: readonly AABB[]; cameraBoxes: readonly CameraBox[] }>(g: G): G {
  const swap = new Map<AABB, AABB>();
  for (const m of PATH_PLANT_MOVES) {
    const old = g.obstacles.find((b) => same(b, m.box));
    if (old) swap.set(old, movedBox(m));
  }
  if (swap.size === 0) return g;
  return { ...g, obstacles: g.obstacles.map((b) => swap.get(b) ?? b) };
}
