import { describe, expect, it } from "vitest";
import { PLAZA_BEDS, SPECIES, type Plant } from "./flowerPlacement";
import { COPING, buildSoil } from "./vegSoil";
import { surfaceRoots } from "./barkGeometry";
import { PLAZA_CHERRY_SPECS, PLAZA_ZELKOVA_SPEC, treeSkeleton } from "./treeSkeleton";

const plant = (x: number, z: number, y: number, wild = false): Plant => ({ x, y, z, species: SPECIES.pansy, yaw: 0, scale: 1, leanX: 0, leanZ: 0, tint: [1, 1, 1], light: 0.8, seed: 0.5, wild });

describe("bed soil (2026-11-16 plants2)", () => {
  const ring = PLAZA_BEDS.find((b) => b.kind === "ring")!;
  const square = PLAZA_BEDS.find((b) => b.kind === "square")!;
  if (ring.kind !== "ring" || square.kind !== "square") throw new Error("beds");
  const plants: Plant[] = [];
  for (let a = 0; a < 6.28; a += 0.4) plants.push(plant(ring.x + Math.cos(a) * 0.8, ring.z + Math.sin(a) * 0.8, 0.38));
  for (const [dx, dz] of [[0.75, 0.75], [-0.75, 0.7], [0.7, -0.75], [-0.7, -0.7]]) plants.push(plant(square.x + dx!, square.z + dz!, 0.52));
  // a house border on the lawn, and a wild flower in the meadow
  for (let i = 0; i < 12; i++) plants.push(plant(40 + i * 0.2, 60, 0.0));
  plants.push(plant(80, 80, 0, true));
  const soil = buildSoil(plants);

  it("fills each planter inside its rim, a few cm under the rim's top, never over it", () => {
    let maxRingR = 0;
    let maxRingY = 0;
    let maxSqY = 0;
    let maxSq = 0;
    for (const a of soil.soil) {
      const p = a.geo.getAttribute("position");
      const c = a.geo.getAttribute("color");
      const idx = a.geo.index!;
      const used = new Set<number>();
      for (let i = 0; i < idx.count; i++) used.add(idx.getX(i));
      for (const i of used) {
        if (c.getW(i) < 0.5) continue; // cut away (outside the soft edge)
        const x = p.getX(i);
        const z = p.getZ(i);
        const y = p.getY(i);
        const rr = Math.hypot(x - ring.x, z - ring.z);
        if (rr < 1.5) {
          maxRingR = Math.max(maxRingR, rr);
          maxRingY = Math.max(maxRingY, y);
        }
        const sq = Math.max(Math.abs(x - square.x), Math.abs(z - square.z));
        if (sq < 1.2) {
          maxSq = Math.max(maxSq, sq);
          maxSqY = Math.max(maxSqY, y);
        }
      }
    }
    // the round planter's inner wall at r 1.3, its rim's top 0.46
    expect(maxRingR).toBeLessThanOrEqual(1.3);
    expect(maxRingY).toBeLessThan(0.46 - 0.03);
    expect(maxRingY).toBeGreaterThan(0.38);
    // the square planter: inside its coping, under the coping's top
    expect(maxSq).toBeLessThanOrEqual(COPING.inner + 1e-6);
    expect(maxSqY).toBeLessThan(COPING.top - 0.025);
    expect(maxSqY).toBeGreaterThan(COPING.bottom);
  });

  it("gives every bed its soil (no wild flower), and sets the plants on it", () => {
    expect(soil.beds).toBe(3);
    expect(soil.heightAt(plants[0]!)).toBeGreaterThan(0.38);
    expect(soil.heightAt(plants[plants.length - 1]!)).toBeNull();
    expect(soil.coping).not.toBeNull();
    expect(soil.tris).toBeLessThan(6000);
  });

  it("old trees show surface roots that run out from the foot and under the ground; the plaza cherries' stay in their planter", () => {
    const cherry = treeSkeleton(PLAZA_CHERRY_SPECS[0]!);
    const roots = surfaceRoots(cherry, false);
    expect(roots.length).toBeGreaterThanOrEqual(4);
    for (const r of roots) {
      const end = r.pts[r.pts.length - 1]!;
      expect(Math.hypot(end[0] - cherry.base[0], end[2] - cherry.base[2])).toBeLessThan(1.2);
      expect(end[1]).toBeLessThan(cherry.base[1]);
    }
    expect(surfaceRoots(treeSkeleton(PLAZA_ZELKOVA_SPEC), false)).toHaveLength(6);
  });
});
