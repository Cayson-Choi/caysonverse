import { describe, expect, it } from "vitest";
import { PLAZA_BEDS, SPACING, SPECIES, bedAt, placeFlowers, speciesFor, type Plant } from "./flowerPlacement";
import type { Card } from "./vegCards";

let nextId = 0;
/** A flower card standing at (x, z), centred, 0.6 m wide along x. */
function card(x: number, z: number, row: number, floor = 0, light = 0.9): Card {
  return { id: nextId++, x, y: floor + 0.18, z, ax: x - 0.3, az: z, bx: x + 0.3, bz: z, floor, h: 0.35, u: 0.3, v: row * 0.25 + 0.125, light, tris: [nextId * 2, nextId * 2 + 1] };
}

/** Cards scattered as flower_patch does (seeded). */
function scatter(n: number, inside: (x: number, z: number) => boolean, box: [number, number, number, number], rows: number[], floor = 0): Card[] {
  let s = 12345;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out: Card[] = [];
  while (out.length < n) {
    const x = box[0] + (box[1] - box[0]) * r();
    const z = box[2] + (box[3] - box[2]) * r();
    if (inside(x, z)) out.push(card(x, z, rows[out.length % rows.length]!, floor));
  }
  return out;
}

const minGap = (plants: Plant[]) => {
  let worst = Infinity;
  for (let i = 0; i < plants.length; i++)
    for (let j = i + 1; j < plants.length; j++) {
      const a = plants[i]!;
      const b = plants[j]!;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      const need = Math.min(SPACING[a.species], SPACING[b.species]);
      worst = Math.min(worst, d / need);
    }
  return worst;
};

describe("placeFlowers", () => {
  // the cherry planter at -16 deg (parts_trees.planter: cards 0.3 < r < 1.25 round it, floor 0.38)
  const ring = PLAZA_BEDS[2]!;
  if (ring.kind !== "ring") throw new Error("bed 2 is a ring");
  const ringCards = scatter(45, (x, z) => {
    const r = Math.hypot(x - ring.x, z - ring.z);
    return r > 0.3 && r < 1.25;
  }, [ring.x - 1.5, ring.x + 1.5, ring.z - 1.5, ring.z + 1.5], [2, 1], 0.38);

  it("plants a stone planter full, on its soil only (between the trunk and the rim)", () => {
    const { plants, replaced } = placeFlowers(ringCards);
    expect(replaced).toHaveLength(45);
    const area = Math.PI * (ring.rMax ** 2 - ring.rMin ** 2);
    expect(plants.length / area).toBeGreaterThan(25); // gardeners' spacing: 25-45 plants per m2
    for (const p of plants) {
      const r = Math.hypot(p.x - ring.x, p.z - ring.z);
      expect(r).toBeGreaterThanOrEqual(ring.rMin - 1e-9);
      expect(r).toBeLessThanOrEqual(ring.rMax + 1e-9);
      expect(p.y).toBeCloseTo(0.38);
    }
  });

  it("keeps each species' planting distance", () => {
    const { plants } = placeFlowers(ringCards);
    expect(minGap(plants)).toBeGreaterThanOrEqual(0.999);
  });

  it("leans the plants on the rim out over it", () => {
    const { plants } = placeFlowers(ringCards);
    const rim = plants.filter((p) => Math.hypot(p.x - ring.x, p.z - ring.z) > 1.1);
    expect(rim.length).toBeGreaterThan(5);
    for (const p of rim) {
      // the lean's top direction (leanZ about z tips toward -x for positive, leanX about x tips toward +z)
      const tipX = -Math.sin(p.leanZ);
      const tipZ = Math.sin(p.leanX);
      const outX = (p.x - ring.x) / Math.hypot(p.x - ring.x, p.z - ring.z);
      const outZ = (p.z - ring.z) / Math.hypot(p.x - ring.x, p.z - ring.z);
      expect(tipX * outX + tipZ * outZ).toBeGreaterThan(0);
    }
  });

  it("follows the card rows: pink -> petunias, yellow -> pansies, purple spikes -> muscari, violas, tulips", () => {
    expect(speciesFor(0, 3, 3).species).toBe(SPECIES.petunia);
    expect(speciesFor(1, 3, 3).species).toBe(SPECIES.pansy);
    const seen = new Set<number>();
    for (let x = 0; x < 30; x += 0.37) seen.add(speciesFor(2, x, x * 0.7).species);
    expect(seen).toEqual(new Set([SPECIES.muscari, SPECIES.pansy, SPECIES.tulip]));
  });

  it("grows a house border round the card centres, not far from them", () => {
    const cards = scatter(60, (x, z) => !(x > 1 && x < 9 && z > 1 && z < 7), [0.3, 9.7, 0.3, 7.7], [0, 1, 2]);
    const { plants } = placeFlowers(cards);
    expect(plants.length).toBeGreaterThan(60);
    for (const p of plants) {
      const near = Math.min(...cards.map((c) => Math.hypot(c.x - p.x, c.z - p.z)));
      expect(near).toBeLessThanOrEqual(0.24 + 0.31);
    }
  });

  it("leaves the flower cards of the meadow's grass tufts to the old cards", () => {
    const tuft = [card(50, 50, 3), card(50.6, 50.2, 3), card(50.3, 50.5, 0)];
    const { replaced, kept, plants } = placeFlowers(tuft);
    expect(replaced).toHaveLength(0);
    expect(kept).toHaveLength(1);
    expect(plants).toHaveLength(0);
  });

  it("is deterministic", () => {
    const a = placeFlowers(ringCards).plants;
    const b = placeFlowers(ringCards).plants;
    expect(b).toEqual(a);
  });

  it("knows the plaza's raised beds", () => {
    expect(bedAt(PLAZA_BEDS, 0, 0)).toBeNull(); // the fountain
    expect(bedAt(PLAZA_BEDS, 5.5, 5.5)?.ok).toBe(true); // a fountain corner bed
    expect(bedAt(PLAZA_BEDS, ring.x, ring.z)?.ok).toBe(false); // the cherry's trunk
  });
});
