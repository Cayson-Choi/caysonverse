import { describe, expect, it } from "vitest";
import { TriangleGrid, closestOnTriangle, faceNormal, openEdges, type V3 } from "./drawnGap";
import { simplifyLine, twigMesh, TWIG_SIMPLIFY_TOL } from "./vegGeometry";
import type { Branch } from "./treeSkeleton";

/** The triangles of a twig mesh into a grid (vertex normals as the outward side). */
function gridOf(geo: ReturnType<typeof twigMesh>): TriangleGrid {
  const grid = new TriangleGrid(0.1);
  const pos = geo.getAttribute("position");
  const nrm = geo.getAttribute("normal");
  const idx = geo.index!;
  const tris: Array<[V3, V3, V3]> = [];
  const normals: V3[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const ids = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    const p = ids.map((i) => [pos.getX(i), pos.getY(i), pos.getZ(i)] as V3);
    const n = ids.reduce<V3>((a, i) => [a[0] + nrm.getX(i), a[1] + nrm.getY(i), a[2] + nrm.getZ(i)], [0, 0, 0]);
    const l = Math.hypot(...n);
    tris.push([p[0]!, p[1]!, p[2]!]);
    normals.push([n[0] / l, n[1] / l, n[2] / l]);
  }
  const open = openEdges(tris);
  tris.forEach(([a, b, c], i) => grid.add(a, b, c, normals[i]!, open[i]!));
  return grid;
}

/** A willow strand: up, a hook over, then hanging down (as growWillow's), many points. */
function hookedStrand(): Branch {
  const pts: V3[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const a = t * Math.PI * 1.2;
    pts.push(t < 0.5 ? [Math.sin(a) * 0.4, Math.cos(a) * 0.3, 0] : [0.4 + (t - 0.5) * 0.1, 0.3 - (t - 0.5) * 2.4, 0.02 * t]);
  }
  return { pts, radii: pts.map((_, i) => 0.006 - i * 0.0002) };
}

describe("closestOnTriangle", () => {
  const a: V3 = [0, 0, 0];
  const b: V3 = [1, 0, 0];
  const c: V3 = [0, 1, 0];
  it("projects onto the face, the edges and the corners", () => {
    closestOnTriangle([0.2, 0.2, 1], a, b, c).forEach((v, i) => expect(v).toBeCloseTo([0.2, 0.2, 0][i]!));
    expect(closestOnTriangle([2, -1, 0], a, b, c)).toEqual(b);
    const e = closestOnTriangle([0.5, -1, 0], a, b, c);
    expect(e[0]).toBeCloseTo(0.5);
    expect(e[1]).toBeCloseTo(0);
  });
  it("faceNormal follows the winding", () => {
    expect(faceNormal(a, b, c)).toEqual([0, 0, 1]);
  });
});

describe("TriangleGrid.gap", () => {
  it("measures the distance in front of a face and 0 behind it (inside)", () => {
    const g = new TriangleGrid(0.25);
    g.add([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    expect(g.gap([0.2, 0.2, 0.3], 1)).toBeCloseTo(0.3);
    expect(g.gap([0.2, 0.2, -0.1], 1)).toBe(0);
    expect(g.gap([0.2, 0.2, 3], 1)).toBe(Infinity);
  });
});

describe("TriangleGrid.gap on an open tube (the twigs, the file's limbs: no end caps)", () => {
  // the reviewer's case (2026-11-13): a twig (0,0,0) -> (0,1,0); points on its axis past either end were 0 (inside)
  const grid = gridOf(twigMesh([{ branch: { pts: [[0, 0, 0], [0, 0.5, 0], [0, 1, 0]], radii: [0.012, 0.01, 0.008] }, light: () => 1 }]));
  it("measures a point past the open end by its distance to the rim", () => {
    for (const y of [1.05, 1.2, 1.4]) expect(grid.gap([0, y, 0], 1)).toBeGreaterThan(y - 1 - 1e-6);
    for (const y of [-0.2, -0.4]) expect(grid.gap([0, y, 0], 1)).toBeGreaterThan(-y - 1e-6);
    expect(grid.gap([0, 1.4, 0], 1)).toBeCloseTo(Math.hypot(0.4, 0.008), 2);
  });
  it("still counts a point inside the tube as touching, and measures one beside it", () => {
    expect(grid.gap([0, 0.5, 0], 1)).toBe(0);
    expect(grid.gap([0, 0.25, 0.001], 1)).toBe(0);
    expect(grid.gap([0.2, 0.5, 0], 1)).toBeCloseTo(0.2 - 0.01, 2);
  });
  it("marks only the rims as open", () => {
    const sq: V3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    // two triangles of a square share the diagonal: it is not open, the four sides are
    expect(openEdges([[sq[0]!, sq[1]!, sq[2]!], [sq[0]!, sq[2]!, sq[3]!]])).toEqual([1 | 2, 2 | 4]);
  });
});

describe("twig simplification (phones)", () => {
  it("simplifyLine keeps a hooked strand within the tolerance and drops points off a straight run", () => {
    const strand = hookedStrand();
    const keep = simplifyLine(strand.pts, TWIG_SIMPLIFY_TOL);
    expect(keep[0]).toBe(0);
    expect(keep[keep.length - 1]).toBe(strand.pts.length - 1);
    expect(keep.length).toBeLessThan(strand.pts.length);
    const straight = simplifyLine([[0, 0, 0], [0, 0.5, 0], [0, 1, 0], [0, 1.5, 0]], 0.01);
    expect(straight).toEqual([0, 3]);
  });

  it("every point of the grown strand (where leaves hang) stays on the phone's drawn twig", () => {
    const strand = hookedStrand();
    for (const coarse of [false, true]) {
      const grid = gridOf(twigMesh([{ branch: strand, light: () => 1 }], coarse));
      // along the full line, every 2 cm: the gap to the drawn tube (0 inside it)
      let worst = 0;
      for (let i = 1; i < strand.pts.length; i++) {
        const p0 = strand.pts[i - 1]!;
        const p1 = strand.pts[i]!;
        for (let k = 0; k < 5; k++) {
          const t = k / 5;
          const p: V3 = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t];
          worst = Math.max(worst, grid.gap(p, 1));
        }
      }
      expect(worst, coarse ? "phone" : "full").toBeLessThan(TWIG_SIMPLIFY_TOL + 0.008);
    }
  });
});
