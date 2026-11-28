import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry, Uint16BufferAttribute } from "three";
import { wornEdges, noise2, clipAtSidewalk, MOUTH_R } from "../../lake/lakeTrailEdge";
import { wearPixels } from "./roadPaint";
import { VILLAGE_LOTS, lotDoorPoint } from "@caysonverse/shared/village/villageLots";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { TRIM_KEEP_FROM, trimMesh } from "../street/streetTrim";
import { Mesh } from "three";
import {
  CONNECTOR_HALF_W,
  CROSSING_ANGLES,
  EDGE_PROFILE,
  LANES,
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
  laneCobble,
  laneShape,
  laneWidth,
  edgingRuns,
  houseSteps,
  polylineDistance,
  smoothPolyline,
  walkUv,
} from "./groundPaths";

describe("lanes", () => {
  it("each ribbon starts on the sidewalk's circle and ends on its lot's line", () => {
    for (const l of LANES) {
      const s = laneShape(l);
      const st = l.start;
      for (const p of [s.left[0], s.right[0]]) {
        if (st) expect(st.a * p.x + st.b * p.z).toBeCloseTo(st.c, 3);
        else expect(Math.hypot(p.x, p.z)).toBeCloseTo(SIDEWALK_OUT_R, 1);
      }
      for (const p of [s.left[s.left.length - 1], s.right[s.right.length - 1]]) expect(l.end.a * p.x + l.end.b * p.z).toBeCloseTo(l.end.c, 3);
      expect(s.left.length).toBe(s.right.length);
    }
  });
  it("the ribbon keeps its width (no pinched or folded rows)", () => {
    for (const l of LANES) {
      const s = laneShape(l);
      s.left.slice(4, -4).forEach((p, i) => {
        const w = Math.hypot(p.x - s.right[i + 4].x, p.z - s.right[i + 4].z);
        expect(w).toBeGreaterThan(laneWidth(l) * 0.8 - 1e-9);
        expect(w).toBeLessThan(laneWidth(l) * 1.25);
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

describe("the trail's mouth at the sidewalk", () => {
  it("cuts the dirt on the stone band's circle: nothing nearer the centre, the uv / colour interpolated, the width kept", () => {
    // a 2.5 m wide strip from x 38.5 to 44 (z -1 .. 1.5), two triangles per cell
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 12; i++) (pos.push(38.5 + i * 0.5, 0.034, j * 2.5 - 1), uv.push(i * 0.5, j), col.push(i * 0.1, 1, 1));
    const idx: number[] = [];
    for (let i = 0; i < 11; i++) idx.push(i, i + 1, 12 + i, i + 1, 13 + i, 12 + i);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
    g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    g.setIndex(idx);
    const c = clipAtSidewalk(g)!;
    const p = c.getAttribute("position");
    let minR = Infinity;
    let minX = Infinity;
    for (let i = 0; i < p.count; i++) {
      if (!c.getIndex()!.array.includes(i)) continue;
      minR = Math.min(minR, Math.hypot(p.getX(i), p.getZ(i)));
      minX = Math.min(minX, p.getX(i));
    }
    expect(minR).toBeGreaterThanOrEqual(MOUTH_R - 0.03); // the cut is linear along each edge: a chord, within 3 cm of the circle
    expect(minR).toBeLessThan(MOUTH_R + 0.05); // cut ON the circle, not a cell short
    // the cut edge keeps the full width (z -1 .. 1.5) and its uv follows the position (uv.x = x - 38.5 on this strip)
    const cutRows = [...Array(p.count).keys()].filter((i) => Math.hypot(p.getX(i), p.getZ(i)) < MOUTH_R + 1e-3 && c.getIndex()!.array.includes(i));
    expect(cutRows.length).toBeGreaterThanOrEqual(2);
    for (const i of cutRows) expect(c.getAttribute("uv").getX(i)).toBeCloseTo(p.getX(i) - 38.5, 3);
    // a geometry wholly outside comes back untouched
    expect(clipAtSidewalk(c)).not.toBeNull();
    const again = clipAtSidewalk(c)!;
    expect(again.getAttribute("position").count).toBe(c.getAttribute("position").count);
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

// owner 2026-11-28, the library: "도서관 문에 맞게 도로가 연결되어야 이쁘지" — its lane met the front 2 m left of the door
describe("every path ends straight on its door", () => {
  /** The cobble's last row: its middle, and the row's direction (unit). */
  const lastRow = (id: string) => {
    const s = laneShape(LANES.find((l) => l.id === id)!);
    const l = s.left[s.left.length - 1];
    const r = s.right[s.right.length - 1];
    const len = Math.hypot(r.x - l.x, r.z - l.z);
    return { mid: { x: (l.x + r.x) / 2, z: (l.z + r.z) / 2 }, dir: { x: (r.x - l.x) / len, z: (r.z - l.z) / len }, len };
  };
  const LOT_LANE: Record<string, string> = { lot_school: "e", lot_chapel: "ne", lot_library: "w", lot_temple: "nw", lot_church: "s" };

  it("each lot's lane ends centred on its main door's line, square to it", () => {
    for (const [lotId, laneId] of Object.entries(LOT_LANE)) {
      const lot = VILLAGE_LOTS.find((l) => l.id === lotId)!;
      const d = lotDoorPoint(lot, lot.doors[0]!);
      const out = { x: d.pad.x - d.centre.x, z: d.pad.z - d.centre.z };
      const n = Math.hypot(out.x, out.z);
      const ux = out.x / n;
      const uz = out.z / n;
      const row = lastRow(laneId);
      // sideways from the door's centre line (along the wall): within 2 cm
      const side = (row.mid.x - d.centre.x) * -uz + (row.mid.z - d.centre.z) * ux;
      expect(Math.abs(side), `${laneId} off ${lotId}'s door`).toBeLessThan(0.02);
      // the last row runs along the wall (square to the way out)
      expect(Math.abs(row.dir.x * ux + row.dir.z * uz), `${laneId} skewed`).toBeLessThan(0.01);
    }
  });

  it("the library's lane runs straight on its door's line for its last 3 m and stops before the topiaries' planters", () => {
    const s = laneShape(LANES.find((l) => l.id === "w")!);
    const mids = s.left.map((l, i) => ({ x: (l.x + s.right[i].x) / 2, z: (l.z + s.right[i].z) / 2 }));
    for (const m of mids.filter((p) => p.x <= -49.4)) expect(m.z).toBeCloseTo(15, 2);
    expect(Math.max(...mids.map((m) => -m.x))).toBeCloseTo(52.4, 3);
  });

  it("every house (and the café) has a front walk, centred on its door, no wider than its steps, tucked under the bottom tread", () => {
    for (const h of VILLAGE_LAYOUT.sceneryHouses.filter((x) => x.kind === "house")) {
      const id = `walk_${h.id}`;
      expect(LANES.some((l) => l.id === id), `${h.id} has no walk`).toBe(true);
      const { step, out, half } = houseSteps(h.id);
      const row = lastRow(id);
      const side = (row.mid.x - step.x) * -out.z + (row.mid.z - step.z) * out.x;
      const along = (row.mid.x - step.x) * out.x + (row.mid.z - step.z) * out.z;
      expect(Math.abs(side), `${id} off the door`).toBeLessThan(0.02);
      expect(along, `${id} end`).toBeCloseTo(-0.03, 3); // 3 cm under the tread
      expect(row.len / 2).toBeLessThanOrEqual(half + 1e-9);
      expect(Math.abs(row.dir.x * out.x + row.dir.z * out.z)).toBeLessThan(0.01);
    }
    expect(LANES.some((l) => l.id === "walk_cafe")).toBe(true);
  });

  it("no walk's cobble or edging runs over a solid (a wall, a bed, a trunk, a lamp post) between its start and its door", () => {
    const near = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number) => Math.abs((b.minX + b.maxX) / 2 - x) < 0.1 && Math.abs((b.minZ + b.maxZ) / 2 - z) < 0.1;
    const allowed = (id: string, b: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean =>
      id === "bridge" || // (its own story: the footbridge's railing posts at its foot)
      // the library's two clipped bay topiaries: the planters stand behind the lane's end (x -52.45..-52.95), the clipped crowns'
      // boxes (0.9 m) overhang its last 15 cm at the corners
      (id === "w" && (near(b, -52.7, 16.7) || near(b, -52.7, 13.3))) ||
      // the gate's queue stanchions stand on the paving through the arch
      (id === "gate_s" && near(b, -24, 94.2));
    const bad: string[] = [];
    for (const l of LANES) {
      const { mid, half } = laneCobble(l);
      for (const b of villageGeometry.obstacles) {
        // the box's own points, every 10 cm (the obstacles near a walk are small)
        if (b.maxX - b.minX > 40 || b.maxZ - b.minZ > 40) continue;
        let hit = false;
        for (let x = b.minX; x <= b.maxX + 1e-9 && !hit; x += Math.max(0.1, (b.maxX - b.minX) / 20))
          for (let z = b.minZ; z <= b.maxZ + 1e-9 && !hit; z += Math.max(0.1, (b.maxZ - b.minZ) / 20)) {
            // beyond the end line (the building the walk leads into) is the door's business, before the start the other paving's
            if (l.end.a * x + l.end.b * z > l.end.c) continue;
            if (l.start && l.start.a * x + l.start.b * z < l.start.c) continue;
            if (!l.start && Math.hypot(x, z) < SIDEWALK_OUT_R) continue;
            if (polylineDistance(mid, x, z) < half + EDGE_PROFILE[EDGE_PROFILE.length - 1][0]) hit = true;
          }
        if (hit && !allowed(l.id, b)) bad.push(`${l.id}: ${JSON.stringify(b)}`);
      }
    }
    expect(bad).toEqual([]);
  }, 30_000);

  it("a walk that joins another paving has no kerb across the join, and the paving it joins has none across its mouth", () => {
    const cobbles = LANES.map((l) => ({ id: l.id, c: laneCobble(l) }));
    for (const l of LANES.filter((x) => x.start)) {
      const own = cobbles.find((c) => c.id === l.id)!.c;
      const s = laneShape(l);
      const others = cobbles.filter((c) => c.id !== l.id).map((c) => c.c);
      for (const run of [...edgingRuns(s.edgeLeft, others), ...edgingRuns(s.edgeRight, others)])
        for (const p of run) for (const o of others) expect(polylineDistance(o.mid, p.x, p.z)).toBeGreaterThanOrEqual(o.half + 0.08 - 1e-9);
      // the joined paving's edging, cut where this walk's cobble meets it
      for (const other of LANES.filter((x) => x !== l)) {
        const os = laneShape(other);
        for (const run of [...edgingRuns(os.edgeLeft, [own]), ...edgingRuns(os.edgeRight, [own])])
          for (const p of run) expect(polylineDistance(own.mid, p.x, p.z)).toBeGreaterThanOrEqual(own.half + 0.08 - 1e-9);
      }
    }
  });

  it("the new edging survives the old houses' trim (its triangles are kept past TRIM_KEEP_FROM)", () => {
    // two triangles, both inside a footprint that takes anything above 1 cm; the second is marked as new
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array([0, 0.05, 0, 1, 0.05, 0, 0, 0.05, 1, 0, 0.05, 0, 1, 0.05, 0, 0, 0.05, 1]), 3));
    g.setIndex(new Uint16BufferAttribute([0, 1, 2, 3, 4, 5], 1));
    g.userData[TRIM_KEEP_FROM] = 1;
    const mesh = new Mesh(g);
    mesh.updateMatrixWorld();
    const foot = { minX: -5, maxX: 5, minZ: -5, maxZ: 5, maxY: 1, minTop: 0.01, inside: () => true };
    const t = trimMesh(mesh, [foot])!;
    expect(t.removed).toBe(1);
    expect(t.geometry.getIndex()!.count).toBe(3);
    expect(t.geometry.userData[TRIM_KEEP_FROM]).toBe(0);
  });
});
