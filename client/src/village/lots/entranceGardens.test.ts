import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { VILLAGE_LOTS, lotLocalToWorld } from "@caysonverse/shared/village/villageLots";
import { clearEntranceBeds, makeEntranceGarden, plantExistingBoxes, plantFountainRing, plantRoseArch } from "./entranceGardens";
import { visibleLoad } from "./lotsPrep";

const materials = { plants: new MeshStandardMaterial(), soil: new MeshStandardMaterial(), kerb: new MeshStandardMaterial() };

describe("entrance gardens", () => {
  it.each(["lot_chapel", "lot_church"] as const)("%s keeps the path clear and roots both species in the soil at either tier", (id) => {
    const costs = [false, true].map((low) => {
      const garden = makeEntranceGarden(id, low, materials);
      const surface = (garden.children[0] as Mesh).geometry;
      surface.computeBoundingBox();
      const y = surface.boundingBox!.max.y;
      const plants = garden.children.filter((n): n is InstancedMesh => n instanceof InstancedMesh);
      expect(plants).toHaveLength(2);
      for (const batch of plants) {
        const p = new Vector3(), matrix = new Matrix4();
        const sides = new Set<number>();
        for (let i = 0; i < batch.count; i++) {
          batch.getMatrixAt(i, matrix);
          p.setFromMatrixPosition(matrix);
          sides.add(Math.sign(p.x));
          expect(Math.abs(p.x)).toBeGreaterThan(id === "lot_chapel" ? 1.88 : 2.55);
          expect(p.y).toBeCloseTo(y - 0.003, 4);
        }
        expect(sides.size).toBe(2);
        const uv = batch.geometry.getAttribute("uv");
        for (let i = 0; i < uv.count; i++) {
          expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
          expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
          expect(uv.getX(i)).toBeLessThanOrEqual(1);
          expect(uv.getY(i)).toBeLessThanOrEqual(1);
        }
      }
      const { triangles, draws } = visibleLoad(garden);
      expect(draws).toBe(4);
      return triangles;
    });
    expect(costs[1]!).toBeLessThan(costs[0]! / 2);
    expect(costs[1]!).toBeLessThan(1500);
  });

  it("removes only the forecourt entries from a chapel instancer shared with the fountain garden", () => {
    const lot = VILLAGE_LOTS.find((l) => l.id === "lot_chapel")!;
    const root = new Group(), mesh = new InstancedMesh(new BoxGeometry(), materials.plants, 3);
    mesh.name = "lotinst__lot_chapel_flower_w";
    const positions = [[3, 6.4], [6, -3.1], [-3, 6.6]].map(([x, z]) => lotLocalToWorld(lot, x!, z!));
    positions.forEach((p, i) => mesh.setMatrixAt(i, new Matrix4().makeTranslation(p.x, 0, p.z)));
    root.add(mesh);
    clearEntranceBeds(root, lot, "lot_chapel");
    expect(mesh.count).toBe(1);
    const kept = new Matrix4();
    mesh.getMatrixAt(0, kept);
    expect(kept.elements[12]).toBeCloseTo(positions[1]!.x);
    expect(kept.elements[14]).toBeCloseTo(positions[1]!.z);
  });

  it.each([false, true])("roots the climbing rose on both iron posts and leaves its passage open (low %s)", (low) => {
    const goods = new Group(), garden = new Group();
    for (const kind of ["rose_clump", "rose_clump_s", "rose_bush"]) {
      const old = new Mesh(new BoxGeometry(), materials.plants);
      old.name = "lotinst__lot_chapel_" + kind;
      goods.add(old);
    }
    plantRoseArch(goods, garden, low, materials.plants);
    expect(goods.children.map((o) => o.visible)).toEqual([false, false, true]);
    const vines = garden.getObjectByName("chapel_rose_canes") as Mesh;
    vines.geometry.computeBoundingBox();
    expect(vines.geometry.boundingBox!.min.y).toBeCloseTo(0, 1);
    expect(vines.geometry.boundingBox!.max.y).toBeCloseTo(3.65, 1);
    const sprays = garden.getObjectByName("chapel_climbing_roses") as InstancedMesh;
    const m = new Matrix4(), p = new Vector3();
    const sides = new Set<number>();
    for (let i = 0; i < sprays.count; i++) {
      sprays.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (p.y < 2.2) {
        expect(Math.abs(p.x + 8.2)).toBeCloseTo(1.4, 1);
        sides.add(Math.sign(p.x + 8.2));
      }
      expect(Math.abs(p.z + 1.05)).toBeLessThan(0.08);
    }
    expect(sides.size).toBe(2);
    const { draws, triangles } = visibleLoad(garden);
    expect(draws).toBe(2);
    // The art file drew 27 instances of an 88-triangle cluster.
    if (low) expect(triangles).toBeLessThanOrEqual(27 * 88);
  });

  it.each([false, true])("keeps the fountain boxwood rooted at the original clipping positions in one draw (low %s)", (low) => {
    const root = new Group();
    const old = new InstancedMesh(new BoxGeometry(), materials.plants, 21);
    old.name = "lotinst__lot_chapel_box_ball";
    const placed = new Matrix4().makeTranslation(47, 0, -29);
    old.setMatrixAt(0, placed);
    root.add(old);
    plantFountainRing(root, low, materials.plants);
    const hedge = root.getObjectByName("chapel_fountain_boxwood") as InstancedMesh;
    const matrix = new Matrix4();
    hedge.getMatrixAt(0, matrix);
    expect(matrix.equals(placed)).toBe(true);
    expect(old.visible).toBe(false);
    hedge.geometry.computeBoundingBox();
    const box = hedge.geometry.boundingBox!;
    expect(box.min.y).toBeLessThan(0);
    expect(box.max.y).toBeLessThan(0.37);
    expect(box.max.x - box.min.x).toBeGreaterThan(0.40);
    const { draws, triangles } = visibleLoad(root);
    expect(draws).toBe(1);
    if (low) expect(triangles).toBeLessThanOrEqual(21 * 72);
  });

  it("dresses the library's bay planters without moving the flowers off the narrow sills or changing the pergola", () => {
    const root = new Group();
    for (const [name, x, z] of [["ger_red", -52.3, 19.2], ["ger_pink", -52.32, 19.4], ["lavender", -60, 2.2]] as const) {
      const original = new InstancedMesh(new BoxGeometry(), materials.plants, 1);
      original.name = "lotinst__lot_library_" + name;
      original.setMatrixAt(0, new Matrix4().makeTranslation(x, 3.7, z));
      root.add(original);
    }
    plantExistingBoxes(root, "lot_library", true, materials.plants, materials.soil);
    expect(root.getObjectByName("lotinst__lot_library_ger_red")!.visible).toBe(false);
    expect(root.getObjectByName("lotinst__lot_library_lavender")!.visible).toBe(true);
    const batch = root.getObjectByName("lotinst__lot_library_ger_pink_bloom") as InstancedMesh;
    const at = new Matrix4();
    batch.getMatrixAt(0, at);
    expect(at.elements[12]).toBeCloseTo(-52.32);
    expect(at.elements[13]).toBeCloseTo(3.733);
    expect(at.elements[14]).toBeCloseTo(19.4);
    const surface = root.children.find((m) => m instanceof Mesh && m.material === materials.soil) as Mesh;
    surface.geometry.computeBoundingBox();
    expect(surface.geometry.boundingBox!.max.y).toBeCloseTo(at.elements[13]!);
    expect(surface.geometry.boundingBox!.max.x - surface.geometry.boundingBox!.min.x).toBeLessThan(0.2);
  });
});
