import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { VILLAGE_LOTS, lotLocalToWorld } from "@caysonverse/shared/village/villageLots";
import { clearEntranceBeds, makeEntranceGarden, plantExistingBoxes } from "./entranceGardens";
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
