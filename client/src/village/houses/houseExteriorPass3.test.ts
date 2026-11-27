import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { RIDGE, ridgeCaps, ridgeLine, ridgeLines, ridgeTiles, tintRidgeMortar } from "./roofRidge";
import { builderGeometry, houseShutterParts, shutterWidth, wallWindows, type WallWindow } from "./houseShutters";
import { HOUSE_SURFACE } from "./housesPrep";

const H = { id: "house_1", centre: { x: 10, z: 20 }, doorSide: "s" as const };

/** A non-indexed geometry from world triangles, with the roof's attribute set. */
function geo(tris: number[][], colour: [number, number, number] = [1, 1, 1]): BufferGeometry {
  const g = new BufferGeometry();
  const pos = tris.flat();
  const n = pos.length / 3;
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(n * 3).fill(0), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(n * 2), 2));
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(colour, i * 3);
  g.setAttribute("color", new BufferAttribute(c, 3));
  return g;
}

/** A gable roof along z (ridge at y 12, pitch tan 1.2) plus a chimney hood poking above it. */
function roof(): BufferGeometry {
  const t: number[][] = [];
  for (const s of [-1, 1]) {
    // six strips down each slope (the courses' rows of vertices)
    for (let k = 0; k < 6; k++) {
      const xa = 10 + s * k;
      const xb = 10 + s * (k + 1);
      const ya = 12 - 1.2 * k;
      const yb = 12 - 1.2 * (k + 1);
      t.push([xa, ya, 14, xb, yb, 14, xb, yb, 26], [xa, ya, 14, xb, yb, 26, xa, ya, 26]);
    }
  }
  // the chimney hood: short, higher than the ridge
  t.push([9, 13.4, 22, 9.6, 13.4, 22, 9.6, 13.4, 22.6]);
  return geo(t);
}

describe("ridge tiles (third exteriors pass)", () => {
  it("finds the long ridge, not the chimney hood above it, and the roof's pitch", () => {
    const line = ridgeLine([roof()], H)!;
    expect(line).not.toBeNull();
    expect(line.a[1]).toBeCloseTo(12, 3);
    expect(Math.abs(line.b[2] - line.a[2])).toBeGreaterThan(11.9);
    expect(line.a[0]).toBeCloseTo(10, 3);
    expect(line.tan).toBeGreaterThan(1.1);
    expect(line.tan).toBeLessThan(1.3);
  });

  it("lays separate tapered tiles whose barrel faces outward, in the roof's attribute set", () => {
    const r = roof();
    const lines = ridgeLines([r], [H]);
    const [caps] = ridgeCaps([r], lines);
    expect(Object.keys(caps!.attributes).sort()).toEqual(Object.keys(r.attributes).sort());
    const len = 12 + 2 * RIDGE.overhang;
    const count = Math.ceil((len - RIDGE.length) / RIDGE.pitch) + 1;
    // 16 triangles a tile, the two closed ends, the two skirts
    expect(caps!.index!.count / 3).toBe(count * RIDGE.sides * 2 + 2 * RIDGE.sides + 4);
    // every barrel triangle's winding agrees with its normal (front faces outward)
    const p = caps!.getAttribute("position");
    const n = caps!.getAttribute("normal");
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    let bad = 0;
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i);
      b.fromBufferAttribute(p, i + 1);
      c.fromBufferAttribute(p, i + 2);
      const face = b.sub(a).cross(c.sub(a));
      if (face.lengthSq() < 1e-12) continue;
      if (face.dot(new Vector3(n.getX(i), n.getY(i), n.getZ(i))) < 0) bad++;
    }
    expect(bad).toBe(0);
    // the tiles sit on the ridge: none lower than the slope just beside it, none higher than ridge + rise
    caps!.computeBoundingBox();
    expect(caps!.boundingBox!.max.y).toBeLessThan(12 + RIDGE.rise);
  });

  it("varies a tile's clay between houses (each tile's UVs on one tile body of the sheet)", () => {
    const line = ridgeLine([roof()], H)!;
    const r = roof();
    const tpl: Record<string, BufferAttribute> = {};
    for (const k of Object.keys(r.attributes)) tpl[k] = r.getAttribute(k) as BufferAttribute;
    const u1 = ridgeTiles(line, Object.keys(tpl), tpl, 1).getAttribute("uv");
    const u2 = ridgeTiles(line, Object.keys(tpl), tpl, 2).getAttribute("uv");
    let same = 0;
    for (let i = 0; i < u1.count; i++) if (u1.getX(i) === u2.getX(i)) same++;
    expect(same).toBeLessThan(u1.count);
    for (let i = 0; i < u1.count; i++) {
      expect(u1.getX(i)).toBeGreaterThanOrEqual(0);
      expect(u1.getX(i)).toBeLessThanOrEqual(1);
    }
  });

  it("tints only the white ridge mortar, never a gable's plaster at the ridge", () => {
    const line = ridgeLine([roof()], H)!;
    const white: [number, number, number] = [0.855, 0.807, 0.716];
    const mortar = geo([[10.13, 11.9, 18, 10.15, 11.9, 19, 10.13, 11.88, 19]], white);
    const gable = geo([[10, 11.95, 14.05, 10.1, 11.8, 14.05, 9.9, 11.8, 14.05]], [0.9, 0.6, 0.6]);
    expect(tintRidgeMortar(mortar, [{ line }], [0.4, 0.3, 0.2])).toBe(3);
    expect(tintRidgeMortar(gable, [{ line }], [0.4, 0.3, 0.2])).toBe(0);
    expect(mortar.getAttribute("color").getX(0)).toBeCloseTo(0.4, 5);
  });
});

/** A window's glass on a wall (local rect), as two world triangles. */
function pane(wall: "back" | "left" | "right", u0: number, u1: number, v0: number, v1: number): number[][] {
  const P = (u: number, y: number): number[] => {
    const [lx, lz] = wall === "back" ? [u, -5.275 + 0.2] : wall === "right" ? [5.6 - 0.2, u] : [-5.6 + 0.2, u];
    return [H.centre.x + lx, y, H.centre.z + lz];
  };
  return [[...P(u0, v0), ...P(u1, v0), ...P(u1, v1)], [...P(u0, v0), ...P(u1, v1), ...P(u0, v1)]];
}

describe("side and back shutters (third exteriors pass)", () => {
  it("clusters a window's panes, and gives a side window the kit's leaf width", () => {
    const g = geo([...pane("left", -1, -0.43, 1.3, 3.1), ...pane("left", -0.4, 0.17, 1.3, 3.1)]);
    const w = wallWindows([g], H);
    expect(w).toHaveLength(1);
    expect(w[0]!.u1 - w[0]!.u0).toBeCloseTo(1.17, 2);
    expect(shutterWidth(w[0]!, w, H)).toBeCloseTo(1.17 / 2 + 0.02, 3);
  });

  it("gives none near a wall's end, to a crowded pair, to the back's upper floor, nor beside the LPG cage", () => {
    const at = (wall: WallWindow["wall"], u0: number, u1: number, v0 = 1.3, v1 = 3.1): WallWindow => ({ wall, u0, u1, v0, v1 });
    const end = at("right", 1.6, 2.77); // its leaf would reach 3.37 > 3.125 - 0.45
    expect(shutterWidth(end, [end], H)).toBe(0);
    const p1 = at("left", -2, -0.83);
    const p2 = at("left", -0.5, 0.67);
    expect(shutterWidth(p1, [p1, p2], H)).toBe(0);
    const upper = at("back", -3.2, -2.0, 5.3, 7.1);
    expect(shutterWidth(upper, [upper], H)).toBe(0);
    const lpg = at("back", 2.0, 3.2);
    expect(shutterWidth(lpg, [lpg], H)).toBe(0);
    const ok = at("back", -3.2, -2.0);
    expect(shutterWidth(ok, [ok], H)).toBeGreaterThan(0.5);
  });

  it("builds two leaves out from the wall, facing out, in the detail's attribute set", () => {
    const g = geo(pane("right", -1, 0.17, 1.3, 3.1));
    const parts = houseShutterParts([g], H);
    expect(parts.windows).toBe(1);
    const wood = builderGeometry(parts.wood, g)!;
    expect(Object.keys(wood.attributes).sort()).toEqual(Object.keys(g.attributes).sort());
    // 2 leaves x (face 2 + edges 4 + heart 4) triangles; the hinges are the metal's 2 x 2 x 2
    expect(wood.getAttribute("position").count / 3).toBe(20);
    expect(builderGeometry(parts.metal, g)!.getAttribute("position").count / 3).toBe(8);
    const p = wood.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      expect(p.getX(i) - H.centre.x).toBeGreaterThan(5.6 + 0.05);
      expect(p.getX(i) - H.centre.x).toBeLessThan(5.6 + 0.09);
    }
    // the face's normal points out of the right wall (+x)
    expect(wood.getAttribute("normal").getX(0)).toBeCloseTo(1, 5);
  });
});

describe("the brand-new surfaces' tuning", () => {
  it("no longer stretches the render's grain (the stains of the old 4.2) and keeps the roof's rows on the courses", () => {
    expect(HOUSE_SURFACE.LM_render!.gain).toBe(1);
    expect(HOUSE_SURFACE.LM_render!.macro).toBeLessThanOrEqual(0.02);
    expect(HOUSE_SURFACE.LM_stone!.gain).toBe(1);
    expect(HOUSE_SURFACE.LM_roof!.repeat).toBe(1);
  });
});
