import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { applyShopExposure, clearGlassMaterial, clearOfficeGlass, prepareShopInterior, SHOP_INTERIOR_URL } from "./LakeShopInterior";

function meshOf(name: string): Mesh {
  return new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name }));
}

describe("the fishing shop's interior (lake_shop_interior.glb)", () => {
  it("the file is in public/models/lake and within the size budget (2.5 MB)", () => {
    const file = resolve(__dirname, "../../public", "." + SHOP_INTERIOR_URL.split("?")[0]);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThan(2.5 * 1024 * 1024);
  });

  it("every lit material becomes an unlit baked-light one: map x COLOR_0 x 2, the atlas cut out, glass see-through, tubes past white", () => {
    const root = new Group();
    const names = ["floor", "wall", "wainscot", "ceiling", "wood", "peg", "atlas", "glass", "emit"];
    for (const n of names) root.add(meshOf(n));
    root.add(meshOf("atlas")); // a second mesh with an equal-named material gets its own copy, still one per source material
    const made = prepareShopInterior(root);
    expect(made.length).toBe(names.length + 1);
    const byName = new Map(root.children.map((c) => [((c as Mesh).material as MeshBasicMaterial).name, (c as Mesh).material as MeshBasicMaterial]));
    for (const m of byName.values()) expect(m).toBeInstanceOf(MeshBasicMaterial);
    const wall = byName.get("shop_wall")!;
    expect(wall.vertexColors).toBe(true);
    expect(wall.color.r).toBeCloseTo(2);
    expect(byName.get("shop_atlas")!.alphaTest).toBe(0.5);
    const glass = byName.get("shop_glass")!;
    expect(glass.transparent && !glass.depthWrite && glass.opacity < 0.3).toBe(true);
    expect(byName.get("shop_emit")!.color.r).toBeGreaterThan(1);
  });

  it("is idempotent per source material (a shared material is swapped once)", () => {
    const shared = new MeshStandardMaterial({ name: "wood" });
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), shared), new Mesh(new BoxGeometry(), shared));
    const made = prepareShopInterior(root);
    expect(made.length).toBe(1);
    expect((root.children[0] as Mesh).material).toBe((root.children[1] as Mesh).material);
  });

  it("preserves printed detail as the outdoor camera adapts to night and restores the daylight bake", () => {
    const root = new Group();
    for (const name of ["atlas", "floor", "emit", "glass"]) root.add(meshOf(name));
    const materials = prepareShopInterior(root);
    const original = materials.map((m) => m.color.clone());
    applyShopExposure(materials, 1.95);
    for (const [i, material] of materials.entries()) {
      if (material.vertexColors) expect(material.color.r * 1.95).toBeCloseTo(2 * .78);
      else expect(material.color.equals(original[i]!)).toBe(true);
    }
    applyShopExposure(materials, .6);
    expect(materials.every((m, i) => m.color.equals(original[i]!))).toBe(true);
  });

  it("clears only the office's window glass: its M_lake_glass mesh gets the clear material, the huts' glass keeps the shared one", () => {
    const shared = new MeshStandardMaterial({ name: "M_lake_glass", transparent: true, opacity: 0.12 });
    const wood = new MeshStandardMaterial({ name: "M_lake_wood" });
    const scene = new Group();
    const office = new Group();
    office.name = "lake_office";
    const officeGlass = new Mesh(new BoxGeometry(), shared);
    const officeWood = new Mesh(new BoxGeometry(), wood);
    office.add(officeGlass, officeWood);
    const hut = new Group();
    hut.name = "lake_hut_a";
    const hutGlass = new Mesh(new BoxGeometry(), shared);
    hut.add(hutGlass);
    scene.add(office, hut);
    const clear = clearGlassMaterial();
    const done = new WeakSet<Mesh>();
    expect(clearOfficeGlass(scene, clear, done)).toBe(1);
    expect(officeGlass.material).toBe(clear);
    expect(officeWood.material).toBe(wood);
    expect(hutGlass.material).toBe(shared);
    expect(clear.opacity).toBeLessThan(0.08);
    expect(clearOfficeGlass(scene, clear, done)).toBe(0); // already done
  });
});
