import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Texture } from "three";
import { houseFiles } from "@caysonverse/shared/village/houseAreas";
import { applyHouseTextures, disposeHouse, disposeLoadedHouse, dressLoadedHouse, houseSharedTextureNames, houseTextureUrl, houseUrls, houseViewMapping, houseWantsLightmap, houseWantsView, isHouseLightmapMaterial, prepareHouse, solidTriangles, HOUSE_CEILING_MATERIAL, HOUSE_VIEW_MATERIAL } from "./houseModelPrep";
import { houseGltfEntry } from "./houseRelease";
import { houseNightUniform, patchHouseLightmapMaterial, resetHouseNight, houseNightMapUniform } from "./houseNight";

/** A house scene as the file has it: two floor groups with meshes, root-level col__ / ceil__ / seat__ nodes. */
function scene(opts: { lightmapped?: boolean; view?: boolean } = {}): Group {
  const root = new Group();
  const mat = (name: string) => {
    const m = opts.lightmapped && name.startsWith("LM_") ? new MeshBasicMaterial() : new MeshStandardMaterial();
    m.name = name;
    return m;
  };
  const f1 = new Group();
  f1.name = "floor__h1_1";
  f1.add(new Mesh(new BoxGeometry(), mat(opts.lightmapped ? "LM_wall" : "M_wall")));
  const f2 = new Group();
  f2.name = "floor__h1_2";
  f2.add(new Mesh(new BoxGeometry(), mat(opts.lightmapped ? "LM_wall" : "M_wall")));
  if (opts.view) f2.add(new Mesh(new BoxGeometry(), mat(HOUSE_VIEW_MATERIAL)));
  const col = new Mesh(new BoxGeometry(), mat("M_col"));
  col.name = "col__h1_1_sofa";
  const c1 = new Mesh(new BoxGeometry(), mat("M_ceiling"));
  c1.name = "ceil__h1_1";
  const c2 = new Mesh(new BoxGeometry(), mat("M_ceiling"));
  c2.name = "ceil__h1_2";
  const seat = new Group();
  seat.name = "seat__h1_1_0";
  root.add(f1, f2, col, c1, c2, seat);
  return root;
}

const visible = (o: { visible: boolean; parent: unknown }): boolean => {
  for (let n: { visible: boolean; parent: unknown } | null = o; n; n = n.parent as { visible: boolean; parent: unknown } | null) if (!n.visible) return false;
  return true;
};

describe("prepareHouse", () => {
  it("shows one floor: the other floor's group and ceiling are hidden, the collision boxes always", () => {
    const src = scene();
    for (const floor of [1, 2] as const) {
      const { root } = prepareHouse(src, 1, floor, null);
      const named = (n: string) => root.getObjectByName(n)!;
      expect(visible(named(`floor__h1_${floor}`))).toBe(true);
      expect(visible(named(`ceil__h1_${floor}`))).toBe(true);
      expect(visible(named(`floor__h1_${floor === 1 ? 2 : 1}`))).toBe(false);
      expect(visible(named(`ceil__h1_${floor === 1 ? 2 : 1}`))).toBe(false);
      expect(visible(named("col__h1_1_sofa"))).toBe(false);
    }
  });

  it("works on a clone: the cached scene is left as loaded", () => {
    const src = scene();
    prepareHouse(src, 1, 1, null);
    expect(src.getObjectByName("floor__h1_2")!.visible).toBe(true);
    expect(src.getObjectByName("col__h1_1_sofa")!.visible).toBe(true);
  });

  it("a house with only M_* materials (the blockout) wants no light map and gets none", () => {
    const src = scene();
    expect(houseWantsLightmap(src)).toBe(false);
    expect(houseWantsView(src)).toBe(false);
    const n = prepareHouse(src, 1, 1, new Texture());
    expect(n.lightmapped).toEqual([]);
    expect(n.views).toEqual([]);
  });

  it("LM_* materials get the light map; the window view material is found", () => {
    const src = scene({ lightmapped: true, view: true });
    expect(houseWantsLightmap(src)).toBe(true);
    expect(houseWantsView(src)).toBe(true);
    const lm = new Texture();
    const nodes = prepareHouse(src, 1, 2, lm);
    expect(nodes.lightmapped.length).toBeGreaterThan(0);
    for (const m of nodes.lightmapped) expect((m as MeshBasicMaterial).lightMap).toBe(lm);
    expect(lm.channel).toBe(1);
    expect(nodes.views).toHaveLength(1);
    // without a light map yet (still loading) nothing is attached and nothing breaks
    const bare = prepareHouse(src, 1, 1, null);
    expect(bare.lightmapped).toEqual([]);
    disposeHouse(nodes);
  });

  it("solidTriangles lists the visible floor's triangles only (a box = 12), not the hidden floor, the collision boxes or glass", () => {
    const src = scene();
    const glass = new Mesh(new BoxGeometry(), Object.assign(new MeshStandardMaterial(), { transparent: true }));
    src.getObjectByName("floor__h1_1")!.add(glass);
    const { root } = prepareHouse(src, 1, 1, null);
    // floor 1's wall box + the floor-1 ceiling box (12 triangles each, 9 numbers per triangle); glass, floor 2 and col__ are out
    expect(solidTriangles(root).length).toBe(2 * 12 * 9);
  });
});

describe("the files and the night", () => {
  it("houseUrls follow houseFiles: the 1k maps on the light tier", () => {
    const f = houseFiles(3);
    expect(houseUrls(3, "high")).toEqual({ glb: f.glb, lightmapDay: f.lightmapDay, lightmapNight: f.lightmapNight, view: f.view });
    expect(houseUrls(3, "low")).toMatchObject({ lightmapDay: f.lightmapDay1k, lightmapNight: f.lightmapNight1k });
    expect(houseGltfEntry(3).id).toBe("/models/village/houses/house_3.glb");
  });

  it("a light-mapped material blends the night map by the weight (patched once), and a leave resets it to day", () => {
    const m = new MeshBasicMaterial();
    patchHouseLightmapMaterial(m);
    const hook = m.onBeforeCompile;
    patchHouseLightmapMaterial(m); // idempotent
    expect(m.onBeforeCompile).toBe(hook);
    const shader = { uniforms: {} as Record<string, unknown>, fragmentShader: "vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );\nvoid main() {" };
    (m.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
    expect(shader.uniforms.uHouseNight).toBe(houseNightUniform);
    expect(shader.uniforms.uHouseNightMap).toBe(houseNightMapUniform);
    expect(shader.fragmentShader).toContain("uHouseNightMap");
    houseNightUniform.value = 0.7;
    resetHouseNight();
    expect(houseNightUniform.value).toBe(0);
    expect(houseNightMapUniform.value).toBeNull();
  });
});

describe("the builders' files dressed for the game (G round 3)", () => {
  it("both builders' baked materials take the light map; lamps, shades and glass do not", () => {
    expect(isHouseLightmapMaterial("LM_plaster")).toBe(true);
    expect(isHouseLightmapMaterial("E_H_wallpaper")).toBe(true);
    expect(isHouseLightmapMaterial("E_H_hanji")).toBe(true);
    for (const m of ["E_H_lamp", "E_H_shade", "E_H_glass", "M_view", "M_glass"]) expect(isHouseLightmapMaterial(m)).toBe(false);
  });

  it("the window panorama turns to each house's real door: HA's images need no turn, HB's are centred on the north", () => {
    expect(houseViewMapping(1, "s", 1)).toEqual({ uShift: 0, vScale: 1 });
    expect(houseViewMapping(3, "n", 1)).toEqual({ uShift: 0, vScale: 1 });
    expect(houseViewMapping(7, "s", 0.5)).toEqual({ uShift: 0, vScale: 2 });
    expect(houseViewMapping(9, "s", 0.5).uShift).toBe(0);
    expect(houseViewMapping(6, "n", 0.5).uShift).toBeCloseTo(0.5);
    expect(houseViewMapping(8, "e", 0.5).uShift).toBeCloseTo(0.75);
    expect(houseViewMapping(10, "e", 0.5).uShift).toBeCloseTo(0.75);
  });

  it("a wallpaper's high down-facing faces become a plain ceiling group; done once", () => {
    const root = new Group();
    const g = new BufferGeometry();
    // a wall quad (facing +z) and a ceiling quad at 3.7 m facing down
    g.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 2, 0, 0, 3.7, 0, 1, 3.7, 0, 0, 3.7, 1]), 3));
    const m = new MeshBasicMaterial();
    m.name = "LM_plaster";
    root.add(new Mesh(g, m));
    dressLoadedHouse(root, 1);
    const mesh = root.children[0] as Mesh;
    expect(Array.isArray(mesh.material)).toBe(true);
    expect((mesh.material as MeshBasicMaterial[])[1]!.name).toBe(HOUSE_CEILING_MATERIAL);
    expect(g.groups).toEqual([{ start: 0, count: 3, materialIndex: 0 }, { start: 3, count: 3, materialIndex: 1 }]);
    dressLoadedHouse(root, 1);
    expect(g.groups).toHaveLength(2);
  });
});

describe("the shared photo-real albedos (realism pass 2026-11-17)", () => {
  function texturedHouse() {
    const root = new Group();
    const small = new Texture();
    small.name = "T_h_floor_oak";
    small.repeat.set(2, 2);
    const floor = new MeshBasicMaterial({ map: small });
    floor.name = "LM_floor_oak";
    const other = new Texture();
    other.name = "lightmap_or_view";
    const view = new MeshBasicMaterial({ map: other });
    view.name = HOUSE_VIEW_MATERIAL;
    root.add(new Mesh(new BoxGeometry(), floor), new Mesh(new BoxGeometry(), floor), new Mesh(new BoxGeometry(), view));
    return { root, floor, small };
  }

  it("lists the T_h_* albedos a house uses, once each, and builds their URLs by tier", () => {
    const { root } = texturedHouse();
    expect(houseSharedTextureNames(root)).toEqual(["T_h_floor_oak"]);
    expect(houseTextureUrl("T_h_floor_oak", "high")).toBe("/textures/houses/hi/T_h_floor_oak.webp");
    expect(houseTextureUrl("T_h_floor_oak", "low")).toBe("/textures/houses/lo/T_h_floor_oak.webp");
  });

  it("swaps the GLB's small copy for the shared file once, keeping its repeat, and frees the small copy", () => {
    const { root, floor, small } = texturedHouse();
    const freed = vi.spyOn(small, "dispose");
    const full = new Texture();
    expect(applyHouseTextures(root, new Map([["T_h_floor_oak", full]]))).toBe(1);
    expect(floor.map).not.toBe(small);
    expect(floor.map?.source).toBe(full.source);
    expect(floor.map?.repeat.x).toBe(2);
    expect(floor.map?.flipY).toBe(false);
    expect(freed).toHaveBeenCalled();
    expect(applyHouseTextures(root, new Map([["T_h_floor_oak", full]]))).toBe(0);
  });

  it("freeing a house leaves a shared albedo's image for the next house (houseRelease frees it)", () => {
    const { root, floor } = texturedHouse();
    const full = new Texture();
    applyHouseTextures(root, new Map([["T_h_floor_oak", full]]));
    const img = { close: vi.fn() };
    (floor.map as Texture).image = img;
    disposeLoadedHouse(root);
    expect(img.close).not.toHaveBeenCalled();
  });
});

