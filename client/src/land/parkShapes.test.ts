import { describe, expect, it } from "vitest";
import { GeoBuilder } from "./geoBuilder";
import { addBellRoof, addHedge, addLathe, valueNoise } from "./parkShapes";
import { parkFountainWater } from "./parkFountain";

/** Share of triangles whose face normal points away from `centreOf(centroid)` (the solid's own inside). */
function outwardShare(b: GeoBuilder, centreOf: (x: number, y: number, z: number) => [number, number, number]): number {
  let good = 0;
  let total = 0;
  for (let i = 0; i < b.idx.length; i += 3) {
    const p = [0, 1, 2].map((k) => {
      const v = b.idx[i + k]!;
      return [b.pos[3 * v]!, b.pos[3 * v + 1]!, b.pos[3 * v + 2]!];
    });
    const e1 = [p[1]![0]! - p[0]![0]!, p[1]![1]! - p[0]![1]!, p[1]![2]! - p[0]![2]!];
    const e2 = [p[2]![0]! - p[0]![0]!, p[2]![1]! - p[0]![1]!, p[2]![2]! - p[0]![2]!];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    if (Math.hypot(n[0]!, n[1]!, n[2]!) < 1e-9) continue;
    const c = [(p[0]![0]! + p[1]![0]! + p[2]![0]!) / 3, (p[0]![1]! + p[1]![1]! + p[2]![1]!) / 3, (p[0]![2]! + p[1]![2]! + p[2]![2]!) / 3];
    const o = centreOf(c[0]!, c[1]!, c[2]!);
    total++;
    if (n[0]! * (c[0]! - o[0]) + n[1]! * (c[1]! - o[1]) + n[2]! * (c[2]! - o[2]) > 0) good++;
  }
  return total ? good / total : 0;
}

describe("parkShapes", () => {
  it("carries each fountain stream above the stone lip and back into the lower basin", () => {
    const g = parkFountainWater(), p = g.getAttribute("position");
    const high = new Array(8).fill(false), low = new Array(8).fill(false), crest = new Array(8).fill(false);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = p.getY(i), r = Math.hypot(x, z);
      const jet = (Math.round(Math.atan2(z, x) * 4 / Math.PI) + 8) % 8;
      if (r > 1.37 && r < 1.47 && y < 2.77 && y > 2.70) high[jet] = true;
      if (r > 1.75 && r < 2.05 && y > 2.88) crest[jet] = true;
      if (r > 3.25 && r < 3.39 && y < 0.94) low[jet] = true;
    }
    expect([...high, ...crest, ...low].every(Boolean)).toBe(true);
    expect(g.index!.count / 3).toBeLessThan(2000);
    g.dispose();
  });

  it("value noise is deterministic and in 0..1", () => {
    for (let i = 0; i < 50; i++) {
      const n = valueNoise(i * 0.37, i * 1.1, 0.5, 4);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
      expect(valueNoise(i * 0.37, i * 1.1, 0.5, 4)).toBe(n);
    }
  });

  it("a hedge is a rounded, bumpy solid of the asked size with its faces out", () => {
    const b = new GeoBuilder();
    addHedge(b, 10, 0, 10, 20, { width: 1.2, height: 1.1 }, () => [0.2, 0.4, 0.2]);
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < b.pos.length; i += 3) {
      minX = Math.min(minX, b.pos[i]!);
      maxX = Math.max(maxX, b.pos[i]!);
      maxY = Math.max(maxY, b.pos[i + 1]!);
    }
    expect(maxX - minX).toBeGreaterThan(1.1);
    expect(maxX - minX).toBeLessThan(1.45);
    expect(maxY).toBeGreaterThan(1.0);
    expect(maxY).toBeLessThan(1.25);
    expect(b.vertices).toBeGreaterThan(500);
    // not a flat-faced box: the surface heights vary
    const tops = new Set<number>();
    for (let i = 0; i < b.pos.length; i += 3) if (b.pos[i + 1]! > 0.9) tops.add(Math.round(b.pos[i + 1]! * 200));
    expect(tops.size).toBeGreaterThan(20);
    expect(outwardShare(b, (_x, _y, z) => [10, 0.5, z])).toBeGreaterThan(0.9);
  });

  it("a bell roof rises to a point above its eave and faces out", () => {
    const b = new GeoBuilder();
    addBellRoof(b, 5, 10, 7, 2, 3.5, 5, [1, 1, 1]);
    let top = -Infinity;
    for (let i = 1; i < b.pos.length; i += 3) top = Math.max(top, b.pos[i]!);
    expect(top).toBeCloseTo(15, 3);
    expect(outwardShare(b, () => [5, 11, 7])).toBeGreaterThan(0.95);
  });

  it("a lathe's faces point out", () => {
    const b = new GeoBuilder();
    addLathe(b, 0, 0, [[0.5, 0], [1.2, 0.2], [1.2, 0.8], [0.8, 1.0]], [1, 1, 1]);
    expect(outwardShare(b, (_x, y) => [0, y, 0])).toBeGreaterThan(0.6);
  });
});
