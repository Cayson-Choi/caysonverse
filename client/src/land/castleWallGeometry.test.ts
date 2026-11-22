import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { PARK_WALL_PLAN, VILLAGE_GATE_PASSAGE, VILLAGE_WALL_PLAN, WALL } from "@caysonverse/shared/village/parkWall";
import {
  bannerGeometry,
  lanternGeometry,
  roofGeometry,
  towerGeometry,
  trianglesOf,
  trimGeometry,
  SLIT,
  wallEndGeometry,
  wallInstances,
  wallModuleGeometry,
} from "./castleWallGeometry";

describe("castle wall geometry", () => {
  const parts = (tier: "high" | "low") => [wallModuleGeometry(tier), towerGeometry(tier), roofGeometry(tier), trimGeometry(tier), bannerGeometry(), lanternGeometry()];

  it("has finite positions, unit normals and metre uvs on every part", () => {
    for (const g of parts("high")) {
      for (const v of g.getAttribute("position").array) expect(Number.isFinite(v)).toBe(true);
      const n = g.getAttribute("normal");
      for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
      expect(g.getAttribute("uv")).toBeDefined();
    }
  });

  it("stands the wall at its height: footing buried, merlons at the top, a module 6 m long and 2.6 m thick", () => {
    const m = wallModuleGeometry("high");
    const b = m.boundingBox!;
    expect(b.min.y).toBeLessThan(-3);
    expect(b.max.y).toBeCloseTo(WALL.top, 5);
    expect(b.max.x - b.min.x).toBeCloseTo(WALL.module, 5);
    expect(b.max.z).toBeCloseTo(WALL.halfThickness + WALL.parapetOut + 0.08, 5); // the merlons' cap stones overhang
    expect(towerGeometry("high").boundingBox!.max.y).toBeCloseTo(WALL.towerTop, 5);
    expect(roofGeometry("high").boundingBox!.max.y).toBeCloseTo(WALL.roofApex, 5);
  });

  it("faces every triangle outward (the module's winding agrees with its normals)", () => {
    for (const g of [wallModuleGeometry("high"), towerGeometry("high"), roofGeometry("high")]) {
      const p = g.getAttribute("position");
      const n = g.getAttribute("normal");
      const idx = g.index!;
      const a = new Vector3();
      const b = new Vector3();
      const c = new Vector3();
      let bad = 0;
      for (let t = 0; t < idx.count; t += 3) {
        a.fromBufferAttribute(p, idx.getX(t));
        b.fromBufferAttribute(p, idx.getX(t + 1));
        c.fromBufferAttribute(p, idx.getX(t + 2));
        const face = b.clone().sub(a).cross(c.clone().sub(a));
        if (face.lengthSq() < 1e-10) continue;
        const nv = new Vector3().fromBufferAttribute(n, idx.getX(t));
        if (face.dot(nv) <= 0) bad++;
      }
      expect(bad).toBe(0);
    }
  });

  it("stays light: a module under 240 triangles, a tower with its roof under 1010 (its three slit windows each in a stone surround, +120), the phone tier lighter", () => {
    expect(trianglesOf(wallModuleGeometry("high"))).toBeLessThan(240);
    expect(trianglesOf(wallModuleGeometry("low"))).toBeLessThan(trianglesOf(wallModuleGeometry("high")));
    expect(trianglesOf(towerGeometry("high")) + trianglesOf(roofGeometry("high"))).toBeLessThan(1010);
    expect(trianglesOf(towerGeometry("low"))).toBeLessThan(trianglesOf(towerGeometry("high")));
  });

  it("the lantern has two groups (the iron, the glass)", () => {
    const g = lanternGeometry();
    expect(g.groups.map((x) => x.materialIndex)).toEqual([0, 1]);
  });
});

describe("placing the wall", () => {
  it("covers each run end to end with whole modules and puts a body of stone on every tower", () => {
    const flat = () => 0;
    const inst = wallInstances(PARK_WALL_PLAN, flat, "inner");
    const expected = PARK_WALL_PLAN.runs.reduce((n, r) => n + Math.max(1, Math.round(Math.hypot(r.bx - r.ax, r.bz - r.az) / WALL.module)), 0);
    expect(inst.modules).toHaveLength(expected);
    expect(inst.towers).toHaveLength(PARK_WALL_PLAN.towers.length);
    // stretched by no more than 10 %
    const s = new Vector3();
    for (const m of inst.modules) {
      s.setFromMatrixScale(m);
      expect(Math.abs(s.x - 1)).toBeLessThan(0.1);
    }
    expect(inst.lanterns.length).toBeGreaterThan(PARK_WALL_PLAN.towers.length * 2);
    expect(inst.glows).toHaveLength(inst.lanterns.length);
  });

  it("cuts the arrow slit INTO the outer face (nothing dark stands proud of the stone) and closes the village runs' ends at the gateway", () => {
    const g = wallModuleGeometry("high");
    const pos = g.getAttribute("position");
    const col = g.getAttribute("color");
    const H = WALL.halfThickness;
    let darkBack = 0;
    for (let i = 0; i < pos.count; i++) {
      if (col.getX(i) > 0.2) continue; // the slot's dark back
      darkBack++;
      expect(pos.getZ(i)).toBeCloseTo(H - SLIT.depth, 5);
      expect(Math.abs(pos.getX(i))).toBeCloseTo(SLIT.back, 5);
    }
    expect(darkBack).toBe(4);
    const flat = () => 0;
    expect(wallInstances(PARK_WALL_PLAN, flat, "inner").ends).toHaveLength(0); // the park's runs end inside the gate's towers
    const ends = wallInstances(VILLAGE_WALL_PLAN, flat, "outer").ends;
    expect(ends).toHaveLength(2);
    const p = new Vector3();
    expect(ends.map((m) => p.setFromMatrixPosition(m).x).sort((a, b) => a - b)).toEqual([VILLAGE_GATE_PASSAGE.minX, VILLAGE_GATE_PASSAGE.maxX]);
    const end = wallEndGeometry();
    end.computeBoundingBox();
    expect(end.boundingBox!.max.x - end.boundingBox!.min.x).toBeCloseTo(0, 6);
    expect(end.boundingBox!.max.y).toBeCloseTo(10.07, 5);
  });

  it("turns each module's outer face out of the enclosure", () => {
    const inst = wallInstances(VILLAGE_WALL_PLAN, () => 0, "outer");
    let k = 0;
    for (const r of VILLAGE_WALL_PLAN.runs) {
      const n = Math.max(1, Math.round(Math.hypot(r.bx - r.ax, r.bz - r.az) / WALL.module));
      for (let i = 0; i < n; i++, k++) {
        const out = new Vector3(0, 0, 1).transformDirection(inst.modules[k]!);
        expect(out.x).toBeCloseTo(r.out[0], 5);
        expect(out.z).toBeCloseTo(r.out[1], 5);
      }
    }
  });

  it("follows the ground: each module stands at the lowest ground under it", () => {
    const slope = (x: number, z: number) => 0.05 * z + 0.01 * x;
    const inst = wallInstances(VILLAGE_WALL_PLAN, slope, "outer");
    const p = new Vector3();
    for (const m of inst.modules) {
      p.setFromMatrixPosition(m);
      expect(p.y).toBeLessThanOrEqual(slope(p.x, p.z) + 0.01);
      expect(p.y).toBeGreaterThan(slope(p.x, p.z) - 0.6);
    }
  });
});
