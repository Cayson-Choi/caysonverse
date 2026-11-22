import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { mergeStaticByMaterial } from "./mergeStatic";

describe("mergeStaticByMaterial", () => {
  it("folds meshes sharing a material into one, baking transforms", () => {
    const root = new Group();
    const a = new MeshStandardMaterial();
    const b = new MeshStandardMaterial();
    const sub = new Group();
    sub.position.set(0, 5, 0);
    root.add(sub);
    const m1 = new Mesh(new BoxGeometry(1, 1, 1), a);
    const m2 = new Mesh(new BoxGeometry(1, 1, 1), a);
    m2.position.set(3, 0, 0);
    sub.add(m1, m2);
    root.add(new Mesh(new BoxGeometry(1, 1, 1), b));
    expect(mergeStaticByMaterial(root)).toBe(1);
    const meshes: Mesh[] = [];
    root.traverse((o) => (o as Mesh).isMesh && meshes.push(o as Mesh));
    expect(meshes).toHaveLength(2);
    const merged = meshes.find((m) => m.material === a)!;
    merged.geometry.computeBoundingBox();
    expect(merged.geometry.boundingBox!.min.y).toBeCloseTo(4.5);
    expect(merged.geometry.boundingBox!.max.x).toBeCloseTo(3.5);
    expect(root.children.includes(sub)).toBe(false); // emptied group removed
  });
});
