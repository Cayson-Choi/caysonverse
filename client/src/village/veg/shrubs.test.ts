import { describe, expect, it } from "vitest";
import { bushSize, findBushes } from "./shrubs";
import { shrubCards } from "./treeSkeleton";

/** Bushes drawn by the art script's own shrub() (the replay), the way the village's merged leaf meshes hold them. */
function cardsOf(spots: Array<[number, number, number, number, number, number]>) {
  return spots.flatMap(([x, z, H, R, seed, y0]) => shrubCards(x, z, H, R, seed, y0).cards.map((c) => ({ x: c.c[0], y: c.c[1], z: c.c[2], s: c.s })));
}

describe("findBushes", () => {
  it("finds each bush of a planted row 0.95 m apart (the memorial's roof edge) and of the porch corners", () => {
    const row: Array<[number, number, number, number, number, number]> = [];
    for (let i = 0; i < 8; i++) row.push([1 + i * 0.95, -52.7, 0.55, 0.38, 900 + i, 4.82]);
    row.push([20, 0, 0.9, 0.55, 61, 0], [26, 0, 0.9, 0.55, 59, 0]);
    const bushes = findBushes(cardsOf(row));
    expect(bushes).toHaveLength(10);
    for (const b of bushes) expect(b.cards).toHaveLength(12);
    for (const [x, z, , , , y0] of row) {
      const b = bushes.find((q) => Math.hypot(q.x - x, q.z - z) < 0.25);
      expect(b).toBeDefined();
      expect(Math.abs(b!.y - y0)).toBeLessThan(0.12);
    }
  });

  it("keeps a wide bush (the plaza planters' 1.1 x 0.75) whole", () => {
    const bushes = findBushes(cardsOf([[6.4, 23.6, 1.1, 0.75, 1500, 0.5]]));
    expect(bushes).toHaveLength(1);
    expect(bushes[0]!.cards).toHaveLength(12);
  });

  it("draws a bush about as big as the old cards' leafy middle", () => {
    const s = bushSize(0.9, 0.55);
    expect(s.h).toBeGreaterThan(0.9);
    expect(s.r).toBeGreaterThan(0.6);
    expect(s.r).toBeLessThan(0.8);
  });
});
