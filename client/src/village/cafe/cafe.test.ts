import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { VILLAGE_LAYOUT, solidBox } from "@caysonverse/shared/village/villageLayout";
import { BAKED_FOOTPRINTS, BANQUETTE, CHAIR_DIST, ROOM, SHELF_UNIT, TABLES, TABLE_RADIUS, TILE_MAT, allNewPendants, tableChairs, toWorld, type Rect } from "./cafeLayout";
import { buildCafe, chairGeometry, tableGeometry } from "./cafeBuild";
import { MeshBuilder, lin } from "./meshBuilder";

const overlap = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const disc = (x: number, z: number, r: number): Rect => ({ x0: x - r, x1: x + r, z0: z - r, z1: z + r });

describe("café furniture layout (local frame)", () => {
  const cafe = VILLAGE_LAYOUT.sceneryHouses.find((h) => h.id === "cafe")!;

  it("the room's world rectangle lies inside the café's solid box (it is seen through glass, never entered)", () => {
    const solid = solidBox(cafe);
    const a = toWorld(ROOM.x0, ROOM.zFront);
    const b = toWorld(ROOM.x1, ROOM.zBack);
    expect(Math.min(a.x, b.x)).toBeGreaterThanOrEqual(solid.minX);
    expect(Math.max(a.x, b.x)).toBeLessThanOrEqual(solid.maxX);
    expect(Math.min(a.z, b.z)).toBeGreaterThanOrEqual(solid.minZ);
    expect(Math.max(a.z, b.z)).toBeLessThanOrEqual(solid.maxZ);
  });

  it("every table and chair stands inside the room, clear of the baked furniture and of each other", () => {
    const foot: { name: string; group: number; r: Rect }[] = [];
    for (const [i, t] of TABLES.entries()) {
      foot.push({ name: `table ${i}`, group: i, r: disc(t.x, t.z, TABLE_RADIUS + 0.02) });
      for (const c of tableChairs(t)) foot.push({ name: `chair of table ${i}`, group: i, r: disc(c.x, c.z, 0.21) });
    }
    for (const { name, r } of foot) {
      expect(r.x0, name).toBeGreaterThanOrEqual(ROOM.x0 + 0.1);
      expect(r.x1, name).toBeLessThanOrEqual(ROOM.x1 - 0.1);
      expect(r.z0, name).toBeGreaterThanOrEqual(ROOM.zBack + 0.1);
      expect(r.z1, name).toBeLessThanOrEqual(ROOM.zFront - 0.05);
      for (const b of BAKED_FOOTPRINTS) expect(overlap(r, b), `${name} / ${b.name}`).toBe(false);
    }
    for (let i = 0; i < foot.length; i++) {
      for (let j = i + 1; j < foot.length; j++) {
        // a chair stands by its own table: only different tables' pieces must stay apart
        if (foot[i]!.group === foot[j]!.group) continue;
        expect(overlap(foot[i]!.r, foot[j]!.r), `${foot[i]!.name} / ${foot[j]!.name}`).toBe(false);
      }
    }
    expect(CHAIR_DIST).toBeGreaterThan(TABLE_RADIUS + 0.21 - 0.05);
  });

  it("the banquette, the shelf unit and the tile mat stay clear of the baked furniture and the tables", () => {
    const things: { name: string; r: Rect }[] = [
      { name: "banquette", r: BANQUETTE },
      { name: "shelf unit", r: SHELF_UNIT },
      { name: "tile mat", r: TILE_MAT },
    ];
    for (const { name, r } of things) {
      for (const b of BAKED_FOOTPRINTS) {
        if (name === "shelf unit" && b.name === "kitchen door") continue; // beside it, not over it (checked next)
        expect(overlap(r, b), `${name} / ${b.name}`).toBe(false);
      }
      for (const [i, t] of TABLES.entries()) {
        if (name === "banquette") continue; // the banquette's own tables sit a hand from its edge: checked below
        expect(overlap(r, disc(t.x, t.z, TABLE_RADIUS)), `${name} / table ${i}`).toBe(false);
      }
    }
    expect(SHELF_UNIT.x0).toBeGreaterThan(5.15); // right of the kitchen door's frame
    for (const t of TABLES.filter((q) => q.x < -5)) {
      expect(t.x - TABLE_RADIUS, "banquette tables").toBeGreaterThan(BANQUETTE.x1 + 0.05);
      expect(t.z).toBeGreaterThan(BANQUETTE.z0);
      expect(t.z).toBeLessThan(BANQUETTE.z1);
    }
  });

  it("a chair faces its table: its +z (front) points at the table's centre", () => {
    for (const t of TABLES) {
      for (const c of tableChairs(t)) {
        const front = new Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
        const toTable = new Vector3(t.x - c.x, 0, t.z - c.z).normalize();
        expect(front.dot(toTable)).toBeGreaterThan(0.999);
        expect(Math.hypot(t.x - c.x, t.z - c.z)).toBeCloseTo(CHAIR_DIST, 6);
      }
    }
  });

  it("every table has a pendant over it, and the lamps list matches", () => {
    const lamps = allNewPendants();
    expect(lamps.length).toBe(TABLES.length + 2);
    for (const t of TABLES) expect(lamps.some((l) => l.x === t.x && l.z === t.z)).toBe(true);
  });
});

describe("café furniture geometry", () => {
  const parts = buildCafe();

  it("seats each bread basket on its shelf with a loaf rising above the rim", () => {
    const positions = parts.fixed.getAttribute("position");
    for (const [localX, radius] of [[5.85, 0.13], [6.2, 0.14], [6.52, 0.12]] as const) {
      const centre = toWorld(localX, SHELF_UNIT.z0 + 0.175);
      const heights: number[] = [];
      const rim: number[] = [];
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i);
        const distance = Math.hypot(positions.getX(i) - centre.x, positions.getZ(i) - centre.z);
        if (y > 0.7 || distance > radius * 1.04) continue;
        heights.push(y);
        if (distance >= radius * 0.98) rim.push(y);
      }
      expect(Math.min(...heights)).toBeCloseTo(0.45);
      expect(Math.max(...rim)).toBeCloseTo(0.507);
      expect(Math.max(...heights)).toBeGreaterThan(Math.max(...rim) + 0.012);
    }
  });

  it("builds finite, bounded geometry inside the café's world box", () => {
    const a = toWorld(ROOM.x0, ROOM.zFront);
    const b = toWorld(ROOM.x1, ROOM.zBack);
    const [minX, maxX, minZ, maxZ] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.z, b.z), Math.max(a.z, b.z)];
    for (const g of [parts.fixed, parts.art, parts.blobs, parts.pools]) {
      const pos = g.attributes.position!.array as Float32Array;
      expect(pos.every((v) => Number.isFinite(v))).toBe(true);
      const bb = g.boundingBox!;
      // nothing pokes through the glass front, the side walls or the partition (the room's inner faces)
      expect(bb.min.x).toBeGreaterThanOrEqual(minX - 0.005);
      expect(bb.max.x).toBeLessThanOrEqual(maxX + 0.005);
      expect(bb.min.z).toBeGreaterThanOrEqual(minZ - 0.005);
      expect(bb.max.z).toBeLessThanOrEqual(maxZ + 0.005);
      expect(bb.min.y).toBeGreaterThanOrEqual(0);
      expect(bb.max.y).toBeLessThanOrEqual(ROOM.ceil + 0.01);
    }
  });

  it("stays inside a triangle budget (it is drawn whenever the glass faces it)", () => {
    expect(parts.triangles).toBeLessThan(45000);
    expect(parts.chairMatrices.length).toBe(TABLES.reduce((n, t) => n + t.chairs.length, 0));
    expect(parts.tableMatrices.length).toBe(TABLES.length);
  });

  it("every vertex has a unit normal and a colour; the art quads carry uvs inside the atlas", () => {
    for (const g of [parts.fixed, parts.art, chairGeometry(), tableGeometry()]) {
      const n = g.attributes.normal!.array as Float32Array;
      let worst = 0;
      for (let i = 0; i < n.length; i += 3) worst = Math.max(worst, Math.abs(Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) - 1));
      expect(worst).toBeLessThan(1e-3);
      expect(g.attributes.color!.count).toBe(g.attributes.position!.count);
      expect(g.attributes.aMat!.count).toBe(g.attributes.position!.count);
    }
    const uv = parts.art.attributes.uv!.array as Float32Array;
    expect(uv.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it("the chair is a café chair: seat 0.46 m up, back 0.89 m, footprint about 0.42 m", () => {
    const g = chairGeometry();
    const bb = g.boundingBox!;
    expect(bb.max.y).toBeGreaterThan(0.88);
    expect(bb.max.y).toBeLessThan(0.92);
    expect(bb.max.x - bb.min.x).toBeGreaterThan(0.38);
    expect(bb.max.x - bb.min.x).toBeLessThan(0.46);
  });
});

describe("MeshBuilder winding follows the normal given", () => {
  it("a box's faces all wind outward", () => {
    const b = new MeshBuilder();
    b.box(0, 1, 0, 1, 0, 1, lin("#ffffff"), { glow: 0, gloss: 0 });
    const p = b.p;
    for (let t = 0; t < p.length; t += 9) {
      const a = new Vector3(p[t]!, p[t + 1]!, p[t + 2]!);
      const bb = new Vector3(p[t + 3]!, p[t + 4]!, p[t + 5]!);
      const c = new Vector3(p[t + 6]!, p[t + 7]!, p[t + 8]!);
      const n = new Vector3().crossVectors(bb.clone().sub(a), c.clone().sub(a)).normalize();
      const centre = a.clone().add(bb).add(c).divideScalar(3).sub(new Vector3(0.5, 0.5, 0.5));
      expect(n.dot(centre)).toBeGreaterThan(0);
    }
  });
});
