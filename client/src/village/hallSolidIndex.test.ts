import { describe, expect, it } from "vitest";
import { buildSolidIndex } from "./hallSolidIndex";

/** An axis-aligned box as 12 triangles. */
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

// the lounge's louvres as the hall has them (build_memorial.py slats(): 24 oak slats 0.06 m wide every 0.17 m, 3.88..4.0 m up,
// over z 1.2..5.55) and a table (0.75 m high) in the room, over a floor and under a ceiling at 4.5 m
const X0 = 292.5;
const tris: number[] = [];
for (let i = 0; i < 24; i++) tris.push(...boxTris(X0 + 0.45 + i * 0.17, 3.88, 1.2, X0 + 0.51 + i * 0.17, 4.0, 5.55));
tris.push(...boxTris(298, 0, -1, 300, 0.75, 0));
tris.push(...boxTris(292.5, -0.01, -6, 307.5, 0, 6)); // floor
tris.push(...boxTris(292.5, 4.5, -6, 307.5, 4.51, 6)); // ceiling
const idx = buildSolidIndex(Float32Array.from(tris), 291.5, 308.5, -7, 7);

describe("the hall's solid index (round 7 review: seat framing camera in the louvres)", () => {
  it("a camera spot between two slats, up in the louvres, is up among hung things; one well under them is not", () => {
    const between = X0 + 0.45 + 5 * 0.17 + 0.06 + 0.05; // in a gap
    expect(idx.underHung(between, 4.1, 2.6, 2.6, 0.2, 0.25)).toBe(true);
    expect(idx.underHung(between, 3.95, 2.6, 2.6, 0.2, 0.25)).toBe(true);
    expect(idx.underHung(between, 3.5, 2.6, 2.6, 0.2, 0.25)).toBe(false);
    // the ceiling (4.5 m) does not count until within 0.25 m of it
    expect(idx.underHung(301, 4.1, 0, 2.6, 0.2, 0.25)).toBe(false);
    expect(idx.underHung(301, 4.3, 0, 2.6, 0.2, 0.25)).toBe(true);
    // beside them, level with them, 0.8 m off their east edge: counts within a 1 m margin (the hall's), not within 0.2 m
    const east = X0 + 0.51 + 23 * 0.17 + 0.8;
    expect(idx.underHung(east, 4.0, 3.0, 2.6, 1.0, 0.25)).toBe(true);
    expect(idx.underHung(east, 4.0, 3.0, 2.6, 0.2, 0.25)).toBe(false);
    expect(idx.underHung(east, 3.5, 3.0, 2.6, 1.0, 0.25)).toBe(false);
  });

  it("a sight line straight down through a gap between slats is not blocked — which is why the spot itself is tested", () => {
    const between = X0 + 0.45 + 5 * 0.17 + 0.06 + 0.05;
    expect(idx.segmentBlocked(between, 4.1, 2.6, between, 0.75, 2.6, 0.35)).toBe(false);
    // across the slats it is
    expect(idx.segmentBlocked(X0 + 0.5, 3.95, 2.6, X0 + 3.5, 3.95, 2.6, 0.35)).toBe(true);
  });

  it("a line through the table is blocked; over it, or ending at it (the last 0.35 m), is not", () => {
    expect(idx.segmentBlocked(297, 0.5, -0.5, 301, 0.5, -0.5, 0.35)).toBe(true);
    expect(idx.segmentBlocked(297, 1.2, -0.5, 301, 1.2, -0.5, 0.35)).toBe(false);
    expect(idx.segmentBlocked(299, 2, 3, 299, 0.9, -0.5, 0.35)).toBe(false);
  });

  it("near a surface (within 0.3 m) or inside a thin piece is near solid; in the open it is not", () => {
    expect(idx.nearSolid(299, 0.9, -0.5, 0.3)).toBe(true); // just over the table top
    expect(idx.nearSolid(X0 + 0.48, 3.94, 2.6, 0.3)).toBe(true); // inside a slat
    expect(idx.nearSolid(301, 2.0, 2.0, 0.3)).toBe(false);
  });
});
