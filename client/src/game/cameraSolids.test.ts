import { describe, expect, it } from "vitest";
import { buildSolidIndex } from "../village/hallSolidIndex";
import { HUNG, LENS, shapeAgainstSolids, type SolidSpot } from "./cameraSolids";

function boxTris(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const p = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const f = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]];
  const out: number[] = [];
  for (const [a, b, c, d] of f) out.push(...p[a]!, ...p[b]!, ...p[c]!, ...p[a]!, ...p[c]!, ...p[d]!);
  return out;
}

// the lounge's louvres (3.88..4.0 m over x 292.95..296.97, z 1.2..5.55), a sofa back, a floor and the ceiling
const X0 = 292.5;
const tris: number[] = [];
for (let i = 0; i < 24; i++) tris.push(...boxTris(X0 + 0.45 + i * 0.17, 3.88, 1.2, X0 + 0.51 + i * 0.17, 4.0, 5.55));
tris.push(...boxTris(296, 0, 6, 298, 1.0, 6.3)); // a high sofa back
tris.push(...boxTris(292.5, -0.01, -6, 307.5, 0, 7)); // floor
tris.push(...boxTris(292.5, 4.5, -6, 307.5, 4.51, 7)); // ceiling
const solid = buildSolidIndex(Float32Array.from(tris), 291.5, 308.5, -7, 8);
const out: SolidSpot = { x: 0, y: 0, z: 0, clear: 0 };
const HEAD = 1.55;

describe("the follow camera against the hall's solids (round 8 review: up among the louvres)", () => {
  it("a camera wanted at 4.1 m over the lounge is held under the louvres' underside, never among them", () => {
    // reviewer's case: body at (300, 1.0) looking east, pitch 0.5 → camera (294.81, 4.1, 2.2)
    const s = shapeAgainstSolids(solid, 300, HEAD, 1.0, 294.81, 4.1, 2.2, Infinity, out);
    expect(s.y).toBeLessThanOrEqual(3.88 - HUNG.clear + 1e-6);
    expect(solid.nearSolid(s.x, s.y, s.z, 0.2)).toBe(false);
    // and the line from the head to it is clear
    expect(solid.segmentBlocked(300, HEAD, 1.0, s.x, s.y, s.z, 0)).toBe(false);
  });

  it("away from the louvres the camera keeps its spot (the ceiling's own limit is 4.1)", () => {
    const s = shapeAgainstSolids(solid, 303, HEAD, -2, 305, 4.0, -4, Infinity, out);
    expect([s.x, s.y, s.z]).toEqual([305, 4.0, -4]);
    expect(s.clear).toBe(Infinity);
  });

  it("a solid between the head and the spot pulls the camera in to LENS short of it", () => {
    // the head at (297, 1.55, 4.5), the camera wanted behind the sofa back low down: (297, 0.3, 7)
    const s = shapeAgainstSolids(solid, 297, HEAD, 4.5, 297, 0.3, 7, Infinity, out);
    const hit = solid.segmentHit(297, HEAD, 4.5, 297, 0.3, 7);
    expect(hit).toBeLessThan(2);
    expect(Math.hypot(s.x - 297, s.y - HEAD, s.z - 4.5)).toBeLessThanOrEqual(hit - LENS + 1e-6);
    expect(s.clear).toBeLessThan(2);
  });

  it("an eased limit shorter than the clear line holds the spot in (the arm eases back out)", () => {
    const s = shapeAgainstSolids(solid, 303, HEAD, -2, 303, HEAD, -6, 1.5, out);
    expect(Math.hypot(s.x - 303, s.z + 2)).toBeCloseTo(1.5, 6);
    expect(s.clear).toBe(Infinity);
  });

  it("sweeps 7 hall spots × 8 yaws × pitch 0.2-1.0 at 5 m: never inside or up among a solid", () => {
    const spots = [[300, 1.0], [298.5, 2.8], [297.0, 1.6], [296.5, -1.8], [302.5, 2.5], [300, -3.0], [303.8, -1.5]] as const;
    let n = 0;
    for (const [x, z] of spots)
      for (let k = 0; k < 8; k++)
        for (const pitch of [0.2, 0.35, 0.5, 0.7, 0.9, 1.0]) {
          const yaw = (k * Math.PI) / 4;
          const h = 5 * Math.cos(pitch);
          const wy = Math.min(4.1, HEAD + 5 * Math.sin(pitch));
          const s = shapeAgainstSolids(solid, x, HEAD, z, x + h * Math.sin(yaw), wy, z + h * Math.cos(yaw), Infinity, out);
          expect(solid.nearSolid(s.x, s.y, s.z, 0.19)).toBe(false);
          expect(solid.underHung(s.x, s.y, s.z, 3.5, 0.4, 0.35)).toBe(false);
          n++;
        }
    expect(n).toBe(7 * 8 * 6);
  });
});
