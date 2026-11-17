/**
 * The A8 hand-over (X0 → X4): village.glb is rebuilt with the A8 houses only after the vrb2 rebuild is on main (design 5.2), but
 * the contract is fixed now. Until then the game plays on the OLD model's colliders (generated/villageColliders.ts) with the
 * A7 houses' boxes swapped for the A8 contract's (`stageA8Colliders`): the old house bodies, porch pieces and gardens and the
 * trees the deeper houses displace are dropped by their exact rectangles (`A7_MODEL_HOUSE_BOXES`), and the A8 boxes — the
 * greybox houses with their porches, LPG cages and gardens, and the moved trees (`A8_TREE_MOVES`) — are added. Once the
 * rebuilt model holds every A8 house box, the swap is a no-op (the model wins), and X4 deletes this file.
 *
 * Seats the same way: the old porch benches' markers are replaced, in place (seat indices stay), by the A8 ones (seatTop 0.75).
 */

import type { AABB, CameraBox } from "../collision";
import type { VillageSeatMarker } from "./benchSeats";
import type { SceneryHouse } from "./villageLayout";
import { HOUSE_A8, houseExteriorColliders, housePorchSeatMarker, houseSolidBox, porchKind } from "./houseExterior";

/** village.glb's (A7, 2026-11-15) house bodies, porch pieces, gardens and the seven plants A8 moves: names and exact boxes. */
export const A7_MODEL_HOUSE_BOXES: ReadonlyArray<{ id: string; box: AABB }> = Object.freeze([
  { id: "bush_15", box: { minX: -45.9, maxX: -44.9, minZ: 19.5, maxZ: 20.5 } },
  { id: "garden_house_1", box: { minX: 18, maxX: 24, minZ: -49.2, maxZ: -46.6 } },
  { id: "garden_house_2", box: { minX: -24, maxX: -18, minZ: -49.2, maxZ: -46.6 } },
  { id: "garden_house_3", box: { minX: 26, maxX: 32, minZ: 42.2, maxZ: 44.8 } },
  { id: "garden_house_4", box: { minX: -34.6, maxX: -28.6, minZ: 44, maxZ: 46.6 } },
  { id: "garden_house_5", box: { minX: -55.6, maxX: -53, minZ: -11, maxZ: -5 } },
  { id: "garden_house_6", box: { minX: 39, maxX: 45, minZ: 47.1, maxZ: 49.7 } },
  { id: "garden_house_7", box: { minX: 28, maxX: 34, minZ: -63.2, maxZ: -60.6 } },
  { id: "garden_house_8", box: { minX: -58.6, maxX: -56, minZ: 37, maxZ: 43 } },
  { id: "garden_house_9", box: { minX: -34, maxX: -28, minZ: -63.2, maxZ: -60.6 } },
  { id: "garden_house_10", box: { minX: -49.2, maxX: -46.6, minZ: 24, maxZ: 30 } },
  { id: "house_1_porch_1", box: { minX: 15.4, maxX: 18.74, minZ: -40.05, maxZ: -37.8 } },
  { id: "house_1_porch_2", box: { minX: 23.26, maxX: 26.6, minZ: -40.05, maxZ: -37.8 } },
  { id: "house_1", box: { minX: 15.4, maxX: 26.6, minZ: -46.2, maxZ: -40.05 } },
  { id: "house_2_porch_1", box: { minX: -26.6, maxX: -24.01, minZ: -40.05, maxZ: -37.8 } },
  { id: "house_2_porch_2", box: { minX: -22.72, maxX: -22.48, minZ: -38.2, maxZ: -37.96 } },
  { id: "house_2_porch_3", box: { minX: -17.99, maxX: -15.4, minZ: -40.05, maxZ: -37.8 } },
  { id: "house_2_porch_4", box: { minX: -19.52, maxX: -19.28, minZ: -38.2, maxZ: -37.96 } },
  { id: "house_2_porch_5", box: { minX: -24.05, maxX: -22.85, minZ: -38.6, maxZ: -38.1 } },
  { id: "house_2_porch_6", box: { minX: -19.49, maxX: -18.07, minZ: -39.27, maxZ: -38.63 } },
  { id: "house_2", box: { minX: -26.6, maxX: -15.4, minZ: -46.2, maxZ: -40.05 } },
  { id: "house_3_porch_1", box: { minX: 30.6, maxX: 34.6, minZ: 33.4, maxZ: 35.65 } },
  { id: "house_3_porch_2", box: { minX: 23.4, maxX: 27.4, minZ: 33.4, maxZ: 35.65 } },
  { id: "house_3", box: { minX: 23.4, maxX: 34.6, minZ: 35.65, maxZ: 41.8 } },
  { id: "house_4_porch_1", box: { minX: -30, maxX: -26, minZ: 35.2, maxZ: 37.45 } },
  { id: "house_4_porch_2", box: { minX: -37.2, maxX: -33.2, minZ: 35.2, maxZ: 37.45 } },
  { id: "house_4", box: { minX: -37.2, maxX: -26, minZ: 37.45, maxZ: 43.6 } },
  { id: "house_5_porch_1", box: { minX: -43.65, maxX: -41.4, minZ: -6.64, maxZ: -3.8 } },
  { id: "house_5_porch_2", box: { minX: -43.65, maxX: -41.4, minZ: -12.2, maxZ: -9.36 } },
  { id: "house_5", box: { minX: -52.6, maxX: -43.65, minZ: -12.2, maxZ: -3.8 } },
  { id: "house_6_porch_1", box: { minX: 44.26, maxX: 47.6, minZ: 38.3, maxZ: 40.55 } },
  { id: "house_6_porch_2", box: { minX: 36.4, maxX: 39.74, minZ: 38.3, maxZ: 40.55 } },
  { id: "house_6", box: { minX: 36.4, maxX: 47.6, minZ: 40.55, maxZ: 46.7 } },
  { id: "house_7_porch_1", box: { minX: 25.4, maxX: 28.74, minZ: -54.05, maxZ: -51.8 } },
  { id: "house_7_porch_2", box: { minX: 33.26, maxX: 36.6, minZ: -54.05, maxZ: -51.8 } },
  { id: "house_7", box: { minX: 25.4, maxX: 36.6, minZ: -60.2, maxZ: -54.05 } },
  { id: "house_8_porch_1", box: { minX: -46.65, maxX: -44.4, minZ: 41.6, maxZ: 44.2 } },
  { id: "house_8_porch_2", box: { minX: -46.65, maxX: -44.4, minZ: 35.8, maxZ: 38.4 } },
  { id: "house_8", box: { minX: -55.6, maxX: -46.65, minZ: 35.8, maxZ: 44.2 } },
  { id: "house_9_porch_1", box: { minX: -36.6, maxX: -34.01, minZ: -54.05, maxZ: -51.8 } },
  { id: "house_9_porch_2", box: { minX: -32.72, maxX: -32.48, minZ: -52.2, maxZ: -51.96 } },
  { id: "house_9_porch_3", box: { minX: -27.99, maxX: -25.4, minZ: -54.05, maxZ: -51.8 } },
  { id: "house_9_porch_4", box: { minX: -29.52, maxX: -29.28, minZ: -52.2, maxZ: -51.96 } },
  { id: "house_9_porch_5", box: { minX: -34.05, maxX: -32.85, minZ: -52.6, maxZ: -52.1 } },
  { id: "house_9", box: { minX: -36.6, maxX: -25.4, minZ: -60.2, maxZ: -54.05 } },
  { id: "house_10_porch_1", box: { minX: -37.25, maxX: -35, minZ: 29.31, maxZ: 31.2 } },
  { id: "house_10_porch_2", box: { minX: -37.25, maxX: -35, minZ: 22.8, maxZ: 24.69 } },
  { id: "house_10_porch_3", box: { minX: -35.8, maxX: -35.3, minZ: 28.2, maxZ: 29.2 } },
  { id: "house_10", box: { minX: -46.2, maxX: -37.25, minZ: 22.8, maxZ: 31.2 } },
  { id: "tree_15", box: { minX: 32.25, maxX: 32.75, minZ: 46.45, maxZ: 46.95 } },
  { id: "tree_16", box: { minX: 24.87, maxX: 25.37, minZ: 44.37, maxZ: 44.87 } },
  { id: "tree_17", box: { minX: -38.25, maxX: -37.75, minZ: 46.95, maxZ: 47.45 } },
  { id: "tree_19", box: { minX: -50.3, maxX: -49.8, minZ: -0.86, maxZ: -0.36 } },
  { id: "tree_26", box: { minX: 27.63, maxX: 28.13, minZ: -64.37, maxZ: -63.87 } },
  { id: "tree_27", box: { minX: -32.37, maxX: -31.87, minZ: -64.37, maxZ: -63.87 } },
]);

/**
 * The plants the A8 houses displace (design 3.2; each within 1.5 m of a trunk or touching a new box), their new centres. The
 * model's box size is kept (trunks 0.5, bushes 1.0). X4 moves them in art/village/tools/parts_fill.py to the same spots.
 */
export const A8_TREE_MOVES: ReadonlyArray<{ id: string; to: { x: number; z: number } }> = Object.freeze([
  { id: "tree_15", to: { x: 34.0, z: 49.0 } },
  { id: "tree_16", to: { x: 21.5, z: 46.5 } },
  { id: "tree_17", to: { x: -39.8, z: 48.5 } },
  { id: "tree_19", to: { x: -50.05, z: 0.4 } },
  { id: "tree_26", to: { x: 23.0, z: -66.0 } },
  { id: "tree_27", to: { x: -38.5, z: -66.0 } },
  { id: "bush_15", to: { x: -45.4, z: 18.6 } },
]);

const same = (a: AABB, b: AABB) => a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The moved plants' boxes at their new centres. */
export function a8MovedPlantBoxes(): Array<{ id: string; box: AABB }> {
  return A8_TREE_MOVES.map((m) => {
    const old = A7_MODEL_HOUSE_BOXES.find((b) => b.id === m.id);
    if (!old) throw new Error(`no A7 box for ${m.id}`);
    const hx = (old.box.maxX - old.box.minX) / 2;
    const hz = (old.box.maxZ - old.box.minZ) / 2;
    return { id: m.id, box: { minX: r2(m.to.x - hx), maxX: r2(m.to.x + hx), minZ: r2(m.to.z - hz), maxZ: r2(m.to.z + hz) } };
  });
}

type House = Pick<SceneryHouse, "id" | "kind" | "centre" | "doorSide">;

/** True when the model already holds every A8 house body (X4 has rebuilt village.glb). */
export function modelHasA8Houses(obstacles: readonly AABB[], houses: readonly House[]): boolean {
  return houses.filter((h) => h.kind === "house").every((h) => obstacles.some((o) => same(o, houseSolidBox(h))));
}

/** The generated colliders with the A7 houses swapped for the A8 contract's (identity once the model has the A8 houses). */
export function stageA8Colliders(
  g: { obstacles: readonly AABB[]; cameraBoxes: readonly CameraBox[] },
  houses: readonly House[],
): { obstacles: readonly AABB[]; cameraBoxes: readonly CameraBox[] } {
  if (modelHasA8Houses(g.obstacles, houses)) return g;
  const legacy = A7_MODEL_HOUSE_BOXES.map((b) => b.box);
  const keep = (b: AABB) => !legacy.some((l) => same(l, b));
  const hs = houses.filter((h) => h.kind === "house");
  const solids = hs.map((h) => houseSolidBox(h));
  const added = [...solids, ...hs.flatMap((h) => houseExteriorColliders(h).map((c) => c.box)), ...a8MovedPlantBoxes().map((p) => p.box)];
  return {
    obstacles: [...g.obstacles.filter(keep), ...added],
    cameraBoxes: [...g.cameraBoxes.filter(keep), ...solids.map((b) => ({ ...b, height: HOUSE_A8.cameraHeight }))],
  };
}

/** The art's seat markers with the A7 porch benches replaced in place by the A8 ones (same ids, same order). */
export function stageA8SeatMarkers(markers: readonly VillageSeatMarker[], houses: readonly House[]): VillageSeatMarker[] {
  return markers.map((m) => {
    const id = /^(house_\d+)_porch$/.exec(m.id)?.[1];
    const h = id ? houses.find((x) => x.id === id) : undefined;
    if (!h || porchKind(h.id) !== "deck") return m;
    return housePorchSeatMarker(h) ?? m;
  });
}
