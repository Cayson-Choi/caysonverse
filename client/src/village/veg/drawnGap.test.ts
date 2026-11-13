import { describe, expect, it } from "vitest";
import { TriangleGrid, closestOnTriangle, faceNormal, type V3 } from "./drawnGap";
import { simplifyLine, twigMesh, TWIG_SIMPLIFY_TOL } from "./vegGeometry";
import type { Branch } from "./treeSkeleton";

/** The triangles of a twig mesh into a grid (vertex normals as the outward side). */
function gridOf(geo: ReturnType<typeof twigMesh>): TriangleGrid {
  const grid = new TriangleGrid(0.1);
  const pos = geo.getAttribute("position");
  const nrm = geo.getAttribute("normal");
  const idx = geo.index!;
  for (let t = 0; t < idx.count; t += 3) {
    const ids = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    const p = ids.map((i) => [pos.getX(i), pos.getY(i), pos.getZ(i)] as V3);
    const n = ids.reduce<V3>((a, i) => [a[0] + nrm.getX(i), a[1] + nrm.getY(i), a[2] + nrm.getZ(i)], [0, 0, 0]);
    const l = Math.hypot(...n);
    grid.add(p[0]!, p[1]!, p[2]!, [n[0] / l, n[1] / l, n[2] / l]);
  }
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
