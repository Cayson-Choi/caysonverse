import { describe, expect, it } from "vitest";
import type { BufferGeometry } from "three";
import { PLANT_CELL, PLANT_GRID, plantUv } from "./plantCells";
import { BUSH_SPECIES, bushPlant, plantMeshes } from "./vegPlants";
import { SPECIES, SPECIES_COUNT } from "./flowerPlacement";
import { bleedColour } from "./vegPlantAtlas";

const tris = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

describe("plants rebuild (2026-11-16)", () => {
  it("bushes: three levels each, within budget, every vertex in the plant atlas", () => {
    for (const sp of BUSH_SPECIES) {
      const n = [0, 1, 2].map((k) => tris(bushPlant(sp, k as 0 | 1 | 2)));
      // the old bush (flat-coloured 10-15 cm leaves on a ball) was ~7,500 triangles at level 0
      expect(n[0]).toBeLessThan(6500);
      expect(n[1]).toBeLessThan(1000);
      expect(n[2]).toBeLessThan(260);
      expect(n[0]).toBeGreaterThan(n[1]!);
      expect(n[1]).toBeGreaterThan(n[2]!);
      const uv = bushPlant(sp, 0).getAttribute("uv");
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getX(i)).toBeLessThanOrEqual(1);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getY(i)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("bushes: real leaf size (sprig cards 13-25 cm on a 0.94 m ball), on the ground, inside the unit shell", () => {
    const g = bushPlant("boxwood", 0);
    const p = g.getAttribute("position");
    let minY = Infinity;
    let maxR = 0;
    for (let i = 0; i < p.count; i++) {
      minY = Math.min(minY, p.getY(i));
      maxR = Math.max(maxR, Math.hypot(p.getX(i), p.getZ(i)));
    }
    expect(minY).toBeGreaterThan(-0.05);
    expect(maxR).toBeLessThan(1.35);
    // a level-0 card is 6 vertices (left, middle, right at the base, then at the top): its width at r 0.94
    const widths: number[] = [];
    const core = 12 * 8; // the core's vertices come first (level 0: 12 round x 8 rows)
    for (let c = core; c + 5 < p.count; c += 6) widths.push(Math.hypot(p.getX(c + 2) - p.getX(c), p.getY(c + 2) - p.getY(c), p.getZ(c + 2) - p.getZ(c)) * 0.94);
    const mean = widths.reduce((a, b) => a + b, 0) / widths.length;
    expect(mean).toBeGreaterThan(0.13);
    expect(mean).toBeLessThan(0.25);
  });

  it("bedding plants: one mesh pair per species, the full one within budget", () => {
    const m = plantMeshes();
    expect(m).toHaveLength(SPECIES_COUNT);
    const budget: Record<number, number> = { [SPECIES.petunia]: 520, [SPECIES.pansy]: 360, [SPECIES.muscari]: 520, [SPECIES.tulip]: 260, [SPECIES.marigold]: 420 };
    for (const [s, max] of Object.entries(budget)) {
      expect(tris(m[Number(s)]!.lod0), `species ${s}`).toBeLessThanOrEqual(max);
      expect(tris(m[Number(s)]!.lod1)).toBeLessThanOrEqual(tris(m[Number(s)]!.lod0));
    }
  });

  it("the atlas cells map inside the texture, the white cell where untextured", () => {
    const [u, v] = plantUv(PLANT_CELL.solid, 0.5, 0.5);
    expect(Math.floor(u * PLANT_GRID) + Math.floor(v * PLANT_GRID) * PLANT_GRID).toBe(PLANT_CELL.solid);
  });

  it("bleeds the drawn colour into the cut-away texels (no dark fringe), keeping alpha", () => {
    const px = new Uint8ClampedArray(4 * 4 * 4);
    px.set([200, 100, 50, 255], (1 * 4 + 1) * 4);
    bleedColour(px, 4, 4, 2);
    expect([...px.slice(0, 4)]).toEqual([200, 100, 50, 0]);
  });
});
