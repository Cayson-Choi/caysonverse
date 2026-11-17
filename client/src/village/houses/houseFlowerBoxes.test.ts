import { describe, expect, it } from "vitest";
import { PALETTES, SPECIES, linearHex, placeFlowers, type Bed } from "../veg/flowerPlacement";
import type { Card } from "../veg/vegCards";
import { houseFlowerBoxBeds } from "./houseFlowerBoxes";

let nextId = 1;
function card(x: number, z: number, floor: number): Card {
  return { id: nextId++, x, y: floor + 0.15, z, ax: x - 0.13, az: z, bx: x + 0.13, bz: z, floor, h: 0.3, u: 0.3, v: 0.125, light: 0.9, tris: [0, 1] };
}

describe("the Colmar houses' window boxes (3D geraniums)", () => {
  it("lists the boxes of all ten houses, level soil above the ground", () => {
    const beds = houseFlowerBoxBeds();
    expect(beds.length).toBeGreaterThan(30);
    for (const b of beds) {
      expect(b.kind).toBe("box");
      if (b.kind !== "box") continue;
      expect(b.x1).toBeGreaterThan(b.x0);
      expect(b.z1).toBeGreaterThan(b.z0);
      expect(b.y).toBeGreaterThan(0.5);
    }
  });

  it("fills a box with geraniums at its own height only, inside its soil, in the geranium colours", () => {
    // two boxes one over the other (ground floor and upper floor), a card in each
    const lo: Bed = { kind: "box", x0: 0, x1: 1.5, z0: 0, z1: 0.2, y: 0.9 };
    const hi: Bed = { kind: "box", x0: 0, x1: 1.5, z0: 0, z1: 0.2, y: 4.9 };
    const cards = [card(0.4, 0.1, 0.9), card(1.1, 0.1, 0.9), card(0.75, 0.1, 4.9)];
    const { plants, replaced } = placeFlowers(cards, [lo, hi]);
    expect(replaced).toHaveLength(3);
    expect(plants.length).toBeGreaterThan(10);
    const reds = new Set(PALETTES.geranium.map(([h]) => linearHex(h).join(",")));
    let atLo = 0;
    let atHi = 0;
    for (const p of plants) {
      expect(p.species).toBe(SPECIES.petunia);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1.5);
      expect(p.z).toBeGreaterThanOrEqual(0);
      expect(p.z).toBeLessThanOrEqual(0.2);
      if (Math.abs(p.y - 0.9) < 1e-6) atLo++;
      else if (Math.abs(p.y - 4.9) < 1e-6) atHi++;
      else throw new Error(`a plant at y ${p.y}`);
      // the tint is a geranium colour (times the brightness jitter)
      const near = [...reds].some((s) => {
        const c = s.split(",").map(Number);
        const k = p.tint[0] / Math.max(1e-6, c[0]!);
        return k > 0.85 && k < 1.12;
      });
      expect(near).toBe(true);
    }
    expect(atLo).toBeGreaterThan(4);
    expect(atHi).toBeGreaterThan(4);
  });
});
