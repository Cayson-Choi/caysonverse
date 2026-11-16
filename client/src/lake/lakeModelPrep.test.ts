import { describe, expect, it } from "vitest";
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Texture } from "three";
import { LAKE_AREA, LAKE_DECKS, LAKE_LAMPS } from "@caysonverse/shared/village/lakeLayout";
import { DEFAULT_SEAM, cellKey, prepareLakeStructures, seamOf, structureMaterial } from "./lakeModelPrep";
import { lakeShoreField } from "./lakeWater";

const onDeck = (x: number, z: number) => LAKE_DECKS.some((d) => x >= d.box.minX && x <= d.box.maxX && z >= d.box.minZ && z <= d.box.maxZ);

describe("the lake's lamps (D1 put 2-4 in the water; F stands them on the pier, B's model now has them there)", () => {
  it("lamps 2-4 now stand on a deck, inside its edge", () => {
    for (const k of [1, 2, 3]) expect(onDeck(LAKE_LAMPS[k]!.x, LAKE_LAMPS[k]!.z), `lamp ${k + 1}`).toBe(true);
  });
});

describe("the facilities' light-mapped materials", () => {
  const src = (over: Partial<MeshStandardMaterial> = {}) => Object.assign(new MeshStandardMaterial({ name: "M_lake_wood", color: "#aa8855", vertexColors: true }), over);
  it("a lit wood material becomes one light-mapped basic copy (the same copy every time), with B's colour and vertex colours", () => {
    const day = new Texture();
    const m = src();
    const a = structureMaterial(m, day);
    expect(a).toBeInstanceOf(MeshBasicMaterial);
    expect(a.lightMap).toBe(day);
    expect(a.vertexColors).toBe(true);
    expect(a.color.getHex()).toBe(m.color.getHex());
    expect(structureMaterial(m, day)).toBe(a);
  });
  it("prepareLakeStructures: glass and emissive keep their own material; helpers hide; a mesh without UV1 keeps its own", () => {
    const day = new Texture();
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geo.setAttribute("uv1", new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    const wood = src();
    const glass = new MeshStandardMaterial({ name: "M_lake_glass", transparent: true, opacity: 0.4 });
    const bulb = new MeshStandardMaterial({ name: "M_lake_emit", emissive: "#ffeeaa", emissiveIntensity: 2 });
    const root = new Group();
    const mk = (name: string, m: MeshStandardMaterial, g = geo) => {
      const o = new Mesh(g, m);
      o.name = name;
      root.add(o);
      return o;
    };
    const a = mk("lake_pier", wood);
    const b = mk("lake_glass", glass);
    const c = mk("lake_bulb", bulb);
    const noUv = mk("lake_nouv", wood, new BufferGeometry().setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)));
    const helper = mk("col__lake_bench_1", wood);
    const r = prepareLakeStructures(root, day, null);
    expect((a.material as unknown as MeshBasicMaterial).lightMap).toBe(day);
    expect(b.material).toBe(glass);
    expect(c.material).toBe(bulb);
    expect(noUv.material).toBe(wood);
    expect(helper.visible).toBe(false);
    expect(r.glows.map((g) => g.material)).toEqual([bulb]);
  });
});

describe("the seam with the village (lake.glb extras.lake.seam)", () => {
  it("takes the file's rectangles and the ridge's footprint", () => {
    const ridge = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    ridge.geometry.setAttribute("position", new Float32BufferAttribute([200, 5, 10, 201, 5, 11], 3));
    const s = seamOf({ lake: { seam: { groundHole: { minX: 95.5, maxX: 112, minZ: -69.5, maxZ: 45.5 }, backdropHole: { minX: 112, maxX: 190, minZ: -70, maxZ: 49 } } } }, ridge);
    expect(s.holes).toHaveLength(2);
    expect(s.ridgeCells.has(cellKey(200, 10))).toBe(true);
    expect(s.ridgeCells.has(cellKey(0, 0))).toBe(false);
  });
  it("without extras: the lake zone", () => {
    expect(seamOf(undefined, null).holes).toEqual([LAKE_AREA]);
    expect(DEFAULT_SEAM.ridgeCells.size).toBe(0);
  });
});

describe("the water's shore distance field", () => {
  it("is 0 on land and grows toward the middle", () => {
    const f = lakeShoreField();
    const { width, height } = f.texture.image as { width: number; height: number };
    const at = (x: number, z: number) => {
      const i = Math.floor(((x - f.box.minX) / (f.box.maxX - f.box.minX)) * width);
      const j = Math.floor(((z - f.box.minZ) / (f.box.maxZ - f.box.minZ)) * height);
      return (f.texture.image.data as Uint8Array)[(j * width + i) * 4]!;
    };
    expect(at(f.box.minX + 0.5, f.box.minZ + 0.5)).toBe(0);
    expect(at(150, -12)).toBeGreaterThan(at(114, -12));
  });
});
