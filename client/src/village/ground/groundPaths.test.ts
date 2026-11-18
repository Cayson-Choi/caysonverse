import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry, Uint16BufferAttribute } from "three";
import { wornEdges, noise2 } from "../../lake/lakeTrailEdge";
import { wearPixels } from "./roadPaint";
import {
  CONNECTOR_HALF_W,
  CROSSING_ANGLES,
  EDGE_PROFILE,
  LANES,
  LANE_WIDTH,
  SIDEWALK_OUT_R,
  TriBuilder,
  addConnector,
  addEdging,
  addRibbon,
  editGeometry,
  inConnectorCut,
  inLaneOpening,
  isOldWalkTri,
  laneClearance,
  laneShape,
  smoothPolyline,
  walkUv,
} from "./groundPaths";

describe("lanes", () => {
  it("each ribbon starts on the sidewalk's circle and ends on its lot's line", () => {
    for (const l of LANES) {
      const s = laneShape(l);
      for (const p of [s.left[0], s.right[0]]) expect(Math.hypot(p.x, p.z)).toBeCloseTo(SIDEWALK_OUT_R, 1);
      for (const p of [s.left[s.left.length - 1], s.right[s.right.length - 1]]) expect(l.end.a * p.x + l.end.b * p.z).toBeCloseTo(l.end.c, 3);
      expect(s.left.length).toBe(s.right.length);
    }
  });
  it("the ribbon keeps its width (no pinched or folded rows)", () => {
    for (const l of LANES) {
      const s = laneShape(l);
      s.left.slice(4, -4).forEach((p, i) => {
        const w = Math.hypot(p.x - s.right[i + 4].x, p.z - s.right[i + 4].z);
        expect(w).toBeGreaterThan(LANE_WIDTH * 0.8);
        expect(w).toBeLessThan(LANE_WIDTH * 1.25);
      });
    }
  });
  it("corners are rounded: no turn between samples sharper than 25 degrees", () => {
    for (const l of LANES) {
      const c = smoothPolyline(l.points, l.trim, 0.5);
      for (let i = 2; i < c.length; i++) {
        const a = Math.atan2(c[i - 1].z - c[i - 2].z, c[i - 1].x - c[i - 2].x);
        const b = Math.atan2(c[i].z - c[i - 1].z, c[i].x - c[i - 1].x);
        let d = Math.abs(b - a);
        if (d > Math.PI) d = 2 * Math.PI - d;
        expect(d).toBeLessThan(0.45);
      }
    }
  });
  it("a spot on a lane is not clear; one 3 m off its edge is", () => {
    expect(laneClearance(0, -42)).toBeLessThan(0);
    expect(laneClearance(6, -42)).toBeGreaterThan(3);
  });
});

describe("the new triangles", () => {
  it("the cobble ribbon faces up and uses the village's planar mapping", () => {
    const b = new TriBuilder();
    addRibbon(b, [{ x: -1.5, z: 0 }, { x: -1.5, z: 2 }], [{ x: 1.5, z: 0 }, { x: 1.5, z: 2 }]);
    expect(b.index.length).toBe(6);
    for (let t = 0; t < b.index.length; t += 3) {
      const [A, B, C] = [0, 1, 2].map((k) => b.verts[b.index[t + k]]);
      expect((B.z - A.z) * (C.x - A.x) - (B.x - A.x) * (C.z - A.z)).toBeGreaterThan(0); // +y
    }
    expect(b.verts[0].u).toBeCloseTo(walkUv(-1.5, 0)[0]);
    expect(b.verts[2].v).toBeCloseTo(walkUv(-1.5, 2)[1]);
  });
  it("the edging's faces point out of the stone (top up, outer wall outward)", () => {
    const b = new TriBuilder();
    addEdging(b, [{ x: 1.5, z: 0 }, { x: 1.5, z: 3 }], 1);
    for (let t = 0; t < b.index.length; t += 3) {
      const [A, B, C] = [0, 1, 2].map((k) => b.verts[b.index[t + k]]);
      const ux = B.x - A.x, uy = B.y - A.y, uz = B.z - A.z, vx = C.x - A.x, vy = C.y - A.y, vz = C.z - A.z;
      const g = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      expect(g[0] * (A.nx + B.nx + C.nx) + g[1] * (A.ny + B.ny + C.ny) + g[2] * (A.nz + B.nz + C.nz)).toBeGreaterThan(0);
    }
    const top = Math.max(...EDGE_PROFILE.map((p) => p[1]));
    expect(Math.max(...b.verts.map((v) => v.y))).toBeCloseTo(top);
  });
  it("a connector is straight along its radius and 4.6 m wide for the 4 m zebra", () => {
    for (const a of CROSSING_ANGLES) {
      const b = new TriBuilder();
      addConnector(b, a);
      const along = b.verts.map((v) => v.x * Math.cos(a) + v.z * Math.sin(a));
      const across = b.verts.map((v) => -v.x * Math.sin(a) + v.z * Math.cos(a));
      expect(Math.max(...across) - Math.min(...across)).toBeCloseTo(CONNECTOR_HALF_W * 2, 3);
      expect(Math.min(...along)).toBeLessThan(29.9);
      expect(Math.max(...along)).toBeGreaterThan(31);
    }
  });
});

describe("what the patch takes out", () => {
  it("old lane and connector triangles by height and radius; the sidewalk's own are kept", () => {
    expect(isOldWalkTri([0.018, 0.018, 0.018], 0, -45)).toBe("lane");
    expect(isOldWalkTri([0.018, 0.018, 0.018], 0, -30.5)).toBe("connector");
    expect(isOldWalkTri([0.01, 0.01, 0.01], 0, -38)).toBeNull();
    expect(isOldWalkTri([0.018, 0.018, 0.018], 38.1, -5.8)).toBeNull(); // the bus stop's own stub
  });
  it("curb triangles in a crossing's cut and a lane's opening, none elsewhere", () => {
    const a = CROSSING_ANGLES[1]; // north: -pi/2
    const at = (x: number, z: number) => [[x, 0.03, z], [x + 0.3, 0.03, z], [x, 0.03, z - 0.3]] as [number, number, number][];
    expect(inConnectorCut(a, at(0.5, -30.3))).toBe(true);
    expect(inConnectorCut(a, at(8, -29.5))).toBe(false);
    expect(inConnectorCut(a, at(0.5, -34))).toBe(false); // the road
    const n = LANES.find((l) => l.id === "n")!;
    expect(inLaneOpening(n, at(0.4, -39))).toBe(true);
    expect(inLaneOpening(n, at(6, -39))).toBe(false);
  });
});

describe("editGeometry", () => {
  const geo = () => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(8), 2));
    g.setAttribute("uv1", new BufferAttribute(new Float32Array([0.1, 0.1, 0.2, 0.1, 0.1, 0.2, 0.2, 0.2]), 2));
    g.setAttribute("color", new BufferAttribute(new Float32Array(12).fill(0.5), 3));
    g.setIndex(new Uint16BufferAttribute([0, 1, 2, 1, 3, 2], 1));
    return g;
  };
  it("drops triangles, appends the new ones, lights them from the old triangles' light map", () => {
    const b = new TriBuilder();
    const i0 = b.add({ x: 0.25, y: 0, z: 0.25, nx: 0, ny: 1, nz: 0, u: 0, v: 0 });
    const i1 = b.add({ x: 0.5, y: 0, z: 0.25, nx: 0, ny: 1, nz: 0, u: 0, v: 0 });
    const i2 = b.add({ x: 0.25, y: 0, z: 0.5, nx: 0, ny: 1, nz: 0, u: 0, v: 0 });
    b.tri(i0, i1, i2);
    const out = editGeometry(geo(), { drop: new Set([3]), sample: { 0: [0, 3] }, add: b });
    expect(out.getIndex()!.count).toBe(3 + 3);
    expect(out.getAttribute("position").count).toBe(7);
    const uv1 = out.getAttribute("uv1");
    expect(uv1.getX(4)).toBeCloseTo(0.1 + 0.25 * 0.1, 5); // inside the first old triangle: barycentric
  });
});

describe("the lake trail's worn edge", () => {
  it("tints the outline toward grass, keeps the centre, and never moves the mouth", () => {
    // a 6 x 3 grid of vertices, 1 m apart, from x 39 to 44 (the mouth is x <= 40.5)
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) (pos.push(39 + i, 0, j - 1.5), col.push(0.8, 0.8, 0.75), uv.push(0, 0));
    const idx: number[] = [];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 5; i++) {
      const a = j * 6 + i;
      idx.push(a, a + 1, a + 6, a + 1, a + 7, a + 6);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    const w = wornEdges(g)!;
    const c = w.getAttribute("color");
    const p = w.getAttribute("position");
    // vertex (x 43, z -1.5) is on the outline; (x 42, z -0.5) is one ring in: the rim is greener and darker than the inside
    expect(c.getX(4)).toBeLessThan(c.getX(1 * 6 + 3));
    expect(c.getY(4) / c.getX(4)).toBeGreaterThan(c.getY(1 * 6 + 3) / c.getX(1 * 6 + 3));
    expect(p.getX(0)).toBeCloseTo(39, 6); // the mouth stays
    expect(p.getZ(4)).not.toBeCloseTo(-1.5, 3); // the rim wanders
    expect(noise2(3.3, 4.4)).toBeGreaterThanOrEqual(0);
  });
});

describe("worn road paint", () => {
  it("dims white paint into an uneven off-white, leaves asphalt and yellow paint alone", () => {
    const w = 64;
    const h = 64;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const [r, g, b] = i % 3 === 0 ? [235, 235, 232] : i % 3 === 1 ? [40, 40, 44] : [220, 170, 30]; // white, asphalt, yellow
      d.set([r, g, b, 255], i * 4);
    }
    wearPixels(d, w, h);
    const whites: number[] = [];
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (i % 3 === 0) whites.push(d[o]);
      else if (i % 3 === 1) expect([d[o], d[o + 1], d[o + 2]]).toEqual([40, 40, 44]);
      else expect([d[o], d[o + 1], d[o + 2]]).toEqual([220, 170, 30]);
    }
    expect(Math.max(...whites)).toBeLessThan(235);
    expect(Math.min(...whites)).toBeLessThan(0.7 * 235); // grit
    expect(new Set(whites).size).toBeGreaterThan(10); // a mottle, not one tint
  });
});
