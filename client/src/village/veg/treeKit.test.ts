import { describe, expect, it } from "vitest";
import type { BufferGeometry } from "three";
import { crownUv, tallUv } from "./leafAtlas";
import { BUNCHES, TREE_DEFS, bunchGeo, treeGeo, willowGeo } from "./treeKit";

function bounds(g: BufferGeometry) {
  g.computeBoundingBox();
  return g.boundingBox!;
}
function allFinite(g: BufferGeometry): boolean {
  for (const name of Object.keys(g.attributes)) for (const v of g.getAttribute(name).array) if (!Number.isFinite(v)) return false;
  return true;
}
const species = ["birch", "oak", "beech", "pine"] as const;

describe("treeKit trees", () => {
  for (const sp of species) {
    it(`${sp}: a real branching tree, finite, inside its nominal size, deterministic`, () => {
      const def = TREE_DEFS[sp];
      const a = treeGeo(sp, 1, { lod: 0, low: false });
      const b = treeGeo(sp, 1, { lod: 0, low: false });
      expect(Array.from(a.bark.getAttribute("position").array)).toEqual(Array.from(b.bark.getAttribute("position").array));
      expect(allFinite(a.bark)).toBe(true);
      expect(allFinite(a.leaves)).toBe(true);
      // many branches (the leader plus the mains and the side branches), not one stick
      expect(a.bark.getAttribute("position").count).toBeGreaterThan(900);
      const bb = bounds(a.bark);
      expect(bb.min.y).toBeGreaterThan(-0.3);
      expect(bb.max.y).toBeLessThan(def.H * 1.15);
      expect(bb.max.y).toBeGreaterThan(def.H * 0.5);
      const lb = bounds(a.leaves);
      // the leaf cards reach out as far as the crown, and none float far above or beside the wood
      expect(lb.max.y).toBeLessThan(def.H * 1.35);
      expect(Math.max(lb.max.x, -lb.min.x, lb.max.z, -lb.min.z)).toBeGreaterThan(def.R * 0.7);
      expect(Math.max(lb.max.x, -lb.min.x, lb.max.z, -lb.min.z)).toBeLessThan(def.R * 2.1);
      // the trunk really is a trunk: its foot has real thickness
      expect(bb.max.x - bb.min.x).toBeGreaterThan(def.r0 * 1.8);
    });
    it(`${sp}: the far level is much cheaper and as tall`, () => {
      const near = treeGeo(sp, 2, { lod: 0, low: false });
      const far = treeGeo(sp, 2, { lod: 1, low: false });
      expect(far.tris).toBeLessThan(near.tris * 0.55);
      const farLow = treeGeo(sp, 2, { lod: 1, low: true });
      expect(farLow.tris).toBeLessThan(far.tris);
      expect(bounds(far.leaves).max.y).toBeGreaterThan(bounds(near.leaves).max.y * 0.7);
    });
    it(`${sp}: the phone's build is lighter than the PC's`, () => {
      const pc = treeGeo(sp, 3, { lod: 0, low: false });
      const phone = treeGeo(sp, 3, { lod: 0, low: true });
      expect(phone.tris).toBeLessThan(pc.tris);
    });
  }
  it("a card's uv stays inside its cell", () => {
    const g = treeGeo("birch", 4, { lod: 0, low: false }).leaves;
    const [u0, v0, u1, v1] = crownUv("birch");
    const uv = g.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(u0 - 1e-6);
      expect(uv.getX(i)).toBeLessThanOrEqual(u1 + 1e-6);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(v0 - 1e-6);
      expect(uv.getY(i)).toBeLessThanOrEqual(v1 + 1e-6);
    }
  });
  it("different seeds give different trees", () => {
    const a = treeGeo("oak", 1, { lod: 0, low: false }).bark.getAttribute("position").array;
    const b = treeGeo("oak", 2, { lod: 0, low: false }).bark.getAttribute("position").array;
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
  it("a tree stays within the draw budget (triangles)", () => {
    for (const sp of species) {
      expect(treeGeo(sp, 1, { lod: 0, low: false }).tris).toBeLessThan(9000);
      expect(treeGeo(sp, 1, { lod: 1, low: false }).tris).toBeLessThan(2000);
    }
  });
});

describe("treeKit willow and bunches", () => {
  it("the willow hangs strands from limbs and reaches low", () => {
    const w = willowGeo(1, { lod: 0, low: false });
    expect(allFinite(w.leaves)).toBe(true);
    const lb = bounds(w.leaves);
    expect(lb.min.y).toBeLessThan(2.2);
    expect(lb.max.y).toBeGreaterThan(5);
    // dozens of strand cards (4 triangles each, two crossed per hanging point)
    expect(w.leaves.getAttribute("position").count / 6).toBeGreaterThan(60);
    const [u0, , u1] = tallUv("willow");
    const uv = w.leaves.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(u0 - 1e-6);
      expect(uv.getX(i)).toBeLessThanOrEqual(u1 + 1e-6);
    }
    expect(willowGeo(1, { lod: 1, low: false }).tris).toBeLessThan(w.tris * 0.6);
  });
  for (const kind of Object.keys(BUNCHES) as Array<keyof typeof BUNCHES>) {
    it(`${kind} bunch: crossed cards standing on the ground, at the kind's height`, () => {
      const g = bunchGeo(kind, 1);
      expect(allFinite(g)).toBe(true);
      const b = bounds(g);
      expect(b.min.y).toBeGreaterThan(-0.1);
      expect(b.max.y).toBeGreaterThan(BUNCHES[kind].h * 0.7);
      expect(b.max.y).toBeLessThan(BUNCHES[kind].h * 1.6);
      expect(g.getAttribute("position").count).toBe(BUNCHES[kind].cards * 6);
    });
  }
});
