import { describe, expect, it } from "vitest";
import { PARK_KIOSK, PARK_SHOPS } from "@caysonverse/shared/village/parkArea";
import { PARK_WALL_SOLIDS } from "@caysonverse/shared/village/parkWall";
import { VILLAGE_WALL_SOLIDS } from "@caysonverse/shared/village/parkWall";
import { villageGeometry } from "@caysonverse/shared/village/villageLayout";
import type { AABB } from "@caysonverse/shared/collision";
import { LOT_TREE_SPECS, VILLAGE_TREE_SPECS } from "../village/veg/treeSkeleton";
import { parkTreeSpecs } from "./ParkVegetation";

/** A circle (x, z, r) overlaps a box by more than `slop` m. */
function hits(x: number, z: number, r: number, b: AABB, slop = 0): boolean {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz) < r - slop;
}
const TRUNK = 0.3;

describe("plants stay out of walls and buildings", () => {
  it("park: no shrub body and no trunk inside a solid (shop, kiosk, gate tower, castle wall)", () => {
    const { trees, bushes } = parkTreeSpecs();
    const bad: string[] = [];
    const PARK_BUILT: AABB[] = [...PARK_WALL_SOLIDS.obstacles, ...PARK_SHOPS.map((s) => ({ minX: s.x - s.d / 2, maxX: s.x + s.d / 2, minZ: s.z - s.w / 2, maxZ: s.z + s.w / 2 })), { minX: PARK_KIOSK.x - PARK_KIOSK.w / 2, maxX: PARK_KIOSK.x + PARK_KIOSK.w / 2, minZ: PARK_KIOSK.z - PARK_KIOSK.d / 2, maxZ: PARK_KIOSK.z + PARK_KIOSK.d / 2 }];
    for (const t of trees) for (const b of PARK_BUILT) if (hits(t.x, t.z, TRUNK, b)) bad.push(`tree ${t.x.toFixed(1)},${t.z.toFixed(1)}`);
    for (const s of bushes) for (const b of PARK_BUILT) if (hits(s.x, s.z, s.r * 0.8, b)) bad.push(`bush ${s.x.toFixed(1)},${s.z.toFixed(1)} r${s.r.toFixed(2)}`);
    expect(bad).toEqual([]);
  });
  it("village: no trunk inside a building, lot, house or the castle wall", () => {
    const solids = [...VILLAGE_WALL_SOLIDS.obstacles, ...villageGeometry.obstacles.filter((b) => Math.min(b.maxX - b.minX, b.maxZ - b.minZ) >= 6)];
    const bad: string[] = [];
    for (const t of [...VILLAGE_TREE_SPECS, ...LOT_TREE_SPECS]) for (const b of solids) if (hits(t.x, t.z, TRUNK, b)) bad.push(`tree ${t.x.toFixed(1)},${t.z.toFixed(1)} in box ${b.minX.toFixed(1)}..${b.maxX.toFixed(1)} x ${b.minZ.toFixed(1)}..${b.maxZ.toFixed(1)}`);
    expect(bad).toEqual([]);
  });
});
