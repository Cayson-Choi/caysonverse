import { describe, expect, it } from "vitest";
import { VEG_TIERS, chooseLod, groupIntoCells, keepThinned, sphereDistance } from "./vegLod";
import { vegModeFrom } from "./vegMode";

const bands = { far: [10, 30, 90], hysteresis: 1.5 };

describe("chooseLod", () => {
  it("picks the level by distance, hidden past the last band", () => {
    expect(chooseLod(-1, 3, bands)).toBe(0);
    expect(chooseLod(-1, 20, bands)).toBe(1);
    expect(chooseLod(-1, 60, bands)).toBe(2);
    expect(chooseLod(-1, 200, bands)).toBe(3);
  });

  it("holds the previous level within the hysteresis band (no flicker on a boundary)", () => {
    expect(chooseLod(0, 11, bands)).toBe(0);
    expect(chooseLod(0, 11.6, bands)).toBe(1);
    expect(chooseLod(1, 8.6, bands)).toBe(1);
    expect(chooseLod(1, 8.4, bands)).toBe(0);
    expect(chooseLod(3, 89, bands)).toBe(3);
    expect(chooseLod(3, 88, bands)).toBe(2);
  });

  it("never uses a level a tier switches off", () => {
    const off = { far: [-1, 30, 600], hysteresis: 2 };
    for (const d of [0, 0.5, 2, 5, 20]) expect(chooseLod(-1, d, off)).toBeGreaterThan(0);
    expect(chooseLod(0, 1, off)).toBe(1);
  });

  it("phones draw the full 3D clusters only round the camera, never a flat sprite or sliver up close", () => {
    for (const k of ["cherry", "green", "bush"] as const) {
      const low = VEG_TIERS.low[k];
      expect(chooseLod(-1, 0, low)).toBe(0);
      expect(chooseLod(-1, 3, low)).toBe(0);
      expect(low.far[0]!).toBeLessThan(VEG_TIERS.high[k].far[0]!);
      expect(chooseLod(-1, 15, low)).toBe(1);
    }
  });

  it("phones get closer, sparser bands than the rich tier", () => {
    expect(VEG_TIERS.low.flowers.far[0]!).toBeLessThan(VEG_TIERS.high.flowers.far[0]!);
    expect(VEG_TIERS.low.flowers.far[1]!).toBeLessThan(VEG_TIERS.high.flowers.far[1]!);
    expect(VEG_TIERS.low.flowers.mid).toBeLessThan(1);
    expect(VEG_TIERS.low.flowers.thin).toBeLessThan(VEG_TIERS.high.flowers.thin);
  });
});

describe("cells", () => {
  const items = [
    { x: 0.5, y: 0, z: 0.5 },
    { x: 7.5, y: 0.4, z: 7.5 },
    { x: 8.5, y: 0, z: 0.5 },
    { x: -0.5, y: 0, z: 0.5 },
  ];

  it("groups items into square cells with bounding spheres that hold them", () => {
    const cells = groupIntoCells(items, 8, 0.5);
    expect(cells).toHaveLength(3);
    for (const c of cells)
      for (const it of c.items) expect(Math.hypot(it.x - c.bounds.x, it.y - c.bounds.y, it.z - c.bounds.z)).toBeLessThanOrEqual(c.bounds.r);
    expect(cells.map((c) => c.items.length).sort()).toEqual([1, 1, 2]);
  });

  it("measures the distance to a sphere's surface", () => {
    expect(sphereDistance(10, 0, 0, { x: 0, y: 0, z: 0, r: 4 })).toBe(6);
    expect(sphereDistance(1, 0, 0, { x: 0, y: 0, z: 0, r: 4 })).toBe(0);
  });

  it("thins by the per-item hash", () => {
    expect(keepThinned(0.2, 0.34)).toBe(true);
    expect(keepThinned(0.5, 0.34)).toBe(false);
  });
});

describe("vegModeFrom (the ?veg= dev flag)", () => {
  it("reads old / new / both in DEV, new otherwise", () => {
    expect(vegModeFrom("?veg=old", true)).toBe("old");
    expect(vegModeFrom("?time=x&veg=both", true)).toBe("both");
    expect(vegModeFrom("", true)).toBe("new");
    expect(vegModeFrom("?veg=old", false)).toBe("new");
  });
});
