import { describe, expect, it } from "vitest";
import { PALETTES, SPECIES, linearHex, placeFlowers, type Bed } from "../veg/flowerPlacement";
import type { Card } from "../veg/vegCards";
import { houseFlowerBoxBeds } from "./houseFlowerBoxes";

let nextId = 1;
function card(x: number, z: number, floor: number): Card {
  return { id: nextId++, x, y: floor + 0.15, z, ax: x - 0.13, az: z, bx: x + 0.13, bz: z, floor, h: 0.3, u: 0.3, v: 0.125, light: 0.9, tris: [0, 1] };
}

describe("the Colmar houses' window boxes (3D geraniums)", () => {
  it("lists every house's window boxes, pots, baskets and front borders", () => {
    const beds = houseFlowerBoxBeds();
    const kinds = { window: 0, pot: 0, border: 0 };
    for (const b of beds) {
      expect(b.kind).toBe("box");
      if (b.kind !== "box") continue;
      expect(b.x1).toBeGreaterThan(b.x0);
      expect(b.z1).toBeGreaterThan(b.z0);
      kinds[b.plant ?? "window"]++;
      // window boxes stand under sills and face out of their wall; borders lie on the lawn
      if (b.plant === "window") {
        expect(b.y).toBeGreaterThan(0.5);
        expect(Math.hypot(b.out![0], b.out![1])).toBeCloseTo(1, 3);
      }
      if (b.plant === "border") expect(b.y).toBeLessThan(0.05);
    }
    expect(kinds.window).toBeGreaterThan(40);
    expect(kinds.pot).toBeGreaterThan(30); // baskets by the doors and corners, terracotta pots by the steps
    expect(kinds.border).toBe(20); // two each side of the steps, ten houses
  });

  it("plants a window box densely and lets the outer rim trail over the edge", () => {
    const bed: Bed = { kind: "box", x0: 0, x1: 1.4, z0: 0, z1: 0.2, y: 1.0, out: [0, 1], plant: "window" };
    const cards = [card(0.3, 0.1, 1.0), card(0.7, 0.1, 1.0), card(1.1, 0.1, 1.0)];
    const { plants } = placeFlowers(cards, [bed]);
    // 1.4 x 0.2 m (+4 cm over the rim) at 11 cm: well over a dozen plants (a bed's spacing would give a handful)
    expect(plants.length).toBeGreaterThan(14);
    const outer = plants.filter((p) => p.z > 0.16);
    const inner = plants.filter((p) => p.z < 0.04);
    const lean = (ps: typeof plants) => ps.reduce((a, p) => a + p.leanX, 0) / Math.max(1, ps.length);
    // leaning toward +z (out of the wall) is a positive rotation about x; the outer rim's plants lean out the most
    expect(outer.length).toBeGreaterThan(0);
    expect(lean(outer)).toBeGreaterThan(lean(inner) + 0.2);
  });

  it("fills a box with geraniums at its own height only, inside its soil, in the geranium colours", () => {
    // two boxes one over the other (ground floor and upper floor), a card in each
    const lo: Bed = { kind: "box", x0: 0, x1: 1.5, z0: 0, z1: 0.2, y: 0.9 };
    const hi: Bed = { kind: "box", x0: 0, x1: 1.5, z0: 0, z1: 0.2, y: 4.9 };
    const cards = [card(0.4, 0.1, 0.9), card(1.1, 0.1, 0.9), card(0.75, 0.1, 4.9)];
    const { plants, replaced } = placeFlowers(cards, [lo, hi]);
    expect(replaced).toHaveLength(3);
    expect(plants.length).toBeGreaterThan(10);
    const reds = new Set([...PALETTES.geranium, ...PALETTES.trailing].map(([h]) => linearHex(h).join(",")));
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
      // the tint is a geranium or trailing-petunia colour (times the brightness jitter)
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
