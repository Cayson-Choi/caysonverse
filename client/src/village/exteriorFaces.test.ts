import { describe, expect, it } from "vitest";
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from "three";
import { CAFE_SHELL_BOX, DRESS_RULES, MEMORIAL_BAYS, MEMORIAL_BLIND, MEMORIAL_SHELL, SURFACES, boxUv, findSplits, geometryWithout, memorialBlindWindows, memorialTrimBoxes, onShell, outward, selectFaces, takeFaces, trimGeometry, type FaceRule, type TriView } from "./exteriorFaces";
import { terraceParasol } from "./cafe/terraceParasol";
import { cullBeyondZ } from "./lots/lotsPrep";
import { pbrIdsOf } from "./exteriorFacesTestUtil";

/** Two upward quads (4 triangles): one at the origin, one 20 m east; each with a distinct uv and a vertex colour. */
function quads(): Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  [
    [0, 5.5, [0.352, 0.508], [1, 1, 1]],
    [20, 5.5, [0.7, 0.2], [0.5, 0.25, 0.14]],
  ].forEach(([x, y, u, c], q) => {
    const X = x as number;
    const Y = y as number;
    pos.push(X, Y, 0, X + 2, Y, 0, X + 2, Y, 2, X, Y, 2);
    for (let i = 0; i < 4; i++) {
      uv.push((u as number[])[0]!, (u as number[])[1]!);
      col.push(...(c as number[]));
    }
    const b = q * 4;
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new Mesh(g, new MeshBasicMaterial({ name: "LM_atlas" }));
  (m.material as MeshBasicMaterial).name = "LM_atlas";
  m.updateMatrixWorld(true);
  return m;
}

const rule = (over: Partial<FaceRule> = {}): FaceRule => ({ id: "t", material: "LM_atlas", box: [-1, 0, -1, 5, 10, 5], surface: "oak", ...over });

describe("exteriorFaces", () => {
  it("selects the faces whose centre is in the box and that pass the test", () => {
    const m = quads();
    expect(selectFaces(m, rule())).toEqual([0, 3]);
    expect(selectFaces(m, rule({ box: [15, 0, -1, 30, 10, 5] }))).toEqual([6, 9]);
    expect(selectFaces(m, rule({ test: (t) => t.u > 0.5 }))).toEqual([]);
    expect(selectFaces(m, rule({ box: [-1, 0, -1, 30, 10, 5], test: (t) => !!t.color && t.color[0] < 0.6 }))).toEqual([6, 9]);
    expect(selectFaces(m, rule({ test: (t) => t.ny > 0.9 && t.area > 1.9 }))).toEqual([0, 3]);
  });

  it("geometryWithout drops exactly the taken triangles and shares the attributes", () => {
    const m = quads();
    const g = geometryWithout(m.geometry, new Set([0, 3]));
    expect(g.index!.count).toBe(6);
    expect(g.getAttribute("position")).toBe(m.geometry.getAttribute("position"));
    expect([...g.index!.array].every((i) => i >= 4)).toBe(true);
  });

  it("takeFaces gives an unindexed world geometry with the asked UVs", () => {
    const m = quads();
    m.position.set(1, 2, 3);
    m.updateMatrixWorld(true);
    const keep = takeFaces(m, [0, 3], { mode: "keep", unit: 2 }, 4);
    expect(keep.triangles).toBe(2);
    const pos = keep.geometry.getAttribute("position");
    expect(pos.count).toBe(6);
    expect(pos.getX(0)).toBeCloseTo(1);
    expect(pos.getY(0)).toBeCloseTo(7.5);
    expect(keep.geometry.getAttribute("uv").getX(0)).toBeCloseTo(0.352 * 0.5);
    const box = takeFaces(m, [0], { mode: "box" }, 2);
    // a top face is projected on the ground plane in metres / tile
    expect(box.geometry.getAttribute("uv").getX(1)).toBeCloseTo(boxUv(3, 7.5, 3, 0, 1, 0, 2)[0]);
    expect(keep.geometry.boundingSphere!.radius).toBeGreaterThan(0);
  });

  it("fits the ribbed cloth to the baked pole and keeps the hem above head height", () => {
    // Draco can rotate a triangle's first vertex. The peak is determined by its height.
    const panel = new BufferGeometry();
    panel.setAttribute("position", new Float32BufferAttribute([43.8, 2.95, -20.1, 42.3, 3.6, -20.1, 43.361, 2.95, -19.039], 3));
    const g = terraceParasol(panel);
    expect(g.boundingBox!.min.y).toBeGreaterThan(2.75);
    expect(g.boundingBox!.min.y).toBeLessThan(2.875);
    expect(g.boundingBox!.max.y).toBeCloseTo(3.641, 3);
    expect(g.boundingBox!.max.x).toBeCloseTo(43.8, 1);
    expect(g.getAttribute("position").count / 3).toBeLessThan(180);
    expect([...g.getAttribute("normal").array].every(Number.isFinite)).toBe(true);
  });

  it("every rule names a known surface, and every surface's library set exists", () => {
    for (const r of DRESS_RULES) expect(Object.keys(SURFACES)).toContain(r.surface);
    for (const id of pbrIdsOf(SURFACES)) expect(id).toBeTruthy();
  });

  it("findSplits only takes meshes of the rule's material", () => {
    const g = new Group();
    g.add(quads());
    const other = quads();
    (other.material as MeshBasicMaterial).name = "LM_grass";
    g.add(other);
    const found = findSplits(g, [rule()]);
    expect(found).toHaveLength(1);
    expect(found[0]!.taken).toEqual([0, 3]);
  });

  it("cullBeyondZ removes the decoys' triangles past the gate and keeps the rest", () => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([0, 0, 90, 1, 0, 90, 0, 1, 90, 0, 0, 120, 1, 0, 120, 0, 1, 120], 3));
    g.setIndex([0, 1, 2, 3, 4, 5]);
    const m = new Mesh(g, new MeshBasicMaterial());
    const root = new Group();
    root.add(m);
    const r = cullBeyondZ(root, 104);
    expect(r.removed).toBe(1);
    expect(m.geometry.index!.count).toBe(3);
  });
});

describe("#13 exteriors: cafe siding, memorial stone order", () => {
  const tri = (cx: number, cy: number, cz: number, nx: number, ny: number, nz: number): TriView => ({ cx, cy, cz, nx, ny, nz, area: 1, u: 0, v: 0, color: [0.9, 0.68, 0.43] });
  it("takes only the cafe shell's outward faces on its planes", () => {
    expect(onShell(tri(46.6, 3, -15, -1, 0, 0), CAFE_SHELL_BOX)).toBe(true); // front wall, facing out
    expect(onShell(tri(46.9, 3, -15, 1, 0, 0), CAFE_SHELL_BOX)).toBe(false); // its inner face
    expect(onShell(tri(53, 3, -15, -1, 0, 0), CAFE_SHELL_BOX)).toBe(false); // a partition inside
    expect(onShell(tri(53, 3, -22.2, 0, 0, -1), CAFE_SHELL_BOX)).toBe(true);
    expect(onShell(tri(53, 0.5, -22.2, 0, 1, 0), CAFE_SHELL_BOX)).toBe(false); // a floor / deck
    expect(outward(tri(51, 2, -4, 1, 0, 0), [48, 0, -6, 51, 4, -2])).toBe(true);
    expect(outward(tri(48.2, 2, -4, 1, 0, 0), [48, 0, -6, 51, 4, -2])).toBe(false);
  });
  it("every new surface names a library set or a made material", () => {
    for (const k of ["siding", "sidingDark", "trimGranite", "trimAshlar", "trimPanel"]) expect(SURFACES[k]).toBeTruthy();
    for (const r of DRESS_RULES) expect(SURFACES[r.surface]).toBeTruthy();
  });
  it("the memorial's pilasters, plinth and cornice stand on its three blank walls, not in front of the entrance", () => {
    const { granite, ashlar, panel } = memorialTrimBoxes();
    const { x0, x1, zb, zf } = MEMORIAL_SHELL;
    expect(panel).toHaveLength(MEMORIAL_BAYS.side.length * 2 + MEMORIAL_BAYS.back.length);
    for (const b of [...granite, ...ashlar, ...panel]) {
      expect(b[0]).toBeLessThan(b[3]);
      expect(b[1]).toBeLessThan(b[4]);
      expect(b[2]).toBeLessThan(b[5]);
      // within 0.2 m of the shell's outside and never past the entrance front
      expect(b[0]).toBeGreaterThanOrEqual(x0 - 0.2);
      expect(b[3]).toBeLessThanOrEqual(x1 + 0.2);
      expect(b[2]).toBeGreaterThanOrEqual(zb - 0.2);
      expect(b[5]).toBeLessThanOrEqual(zf + 1e-9);
      // touching a wall: its box reaches the wall's plane
      const onWall = b[0] <= x0 || b[3] >= x1 || b[2] <= zb;
      expect(onWall).toBe(true);
    }
    expect(ashlar.length).toBeGreaterThanOrEqual(3 + 4 + 6 + 4);
    const g = trimGeometry(ashlar, 3);
    // five faces of two triangles a box: under a thousand triangles in all (one draw call per surface)
    expect(g.getAttribute("position").count / 3).toBe(ashlar.length * 10);
    expect(g.getAttribute("position").count / 3).toBeLessThan(800);
  });
  it("puts a blind window in every bay, between the pilasters and between the plinth and the cornice", () => {
    const wins = memorialBlindWindows();
    expect(wins).toHaveLength(MEMORIAL_BAYS.side.length * 2 + MEMORIAL_BAYS.back.length);
    const { ashlar } = memorialTrimBoxes();
    const pilasters = ashlar.filter((b) => b[1] < 1 && b[4] > 5); // the full-height ones
    for (const w of wins) {
      for (const b of [...w.granite, ...w.ashlar]) {
        expect(b[1]).toBeGreaterThan(0.75);
        expect(b[4]).toBeLessThan(5.62);
        // no box of a window overlaps a pilaster (in plan, on the same wall)
        for (const p of pilasters) {
          const overlap = b[0] < p[3] - 1e-6 && b[3] > p[0] + 1e-6 && b[2] < p[5] - 1e-6 && b[5] > p[2] + 1e-6;
          expect(overlap).toBe(false);
        }
      }
      // the panel sits inside its surround, recessed behind it
      expect(MEMORIAL_BLIND.panelProud).toBeLessThan(MEMORIAL_BLIND.proud);
    }
  });
});
