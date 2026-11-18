import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial } from "three";
import { TEMPLE_PINES, cutOldPines } from "./templePines";

function mesh(material: string, tris: Array<[number, number, number]>): Mesh {
  // one triangle per entry, every vertex at the entry's (x, y, z)
  const pos: number[] = [];
  const idx: number[] = [];
  tris.forEach(([x, y, z], i) => {
    pos.push(x, y, z, x + 0.1, y, z, x, y + 0.1, z);
    idx.push(i * 3, i * 3 + 1, i * 3 + 2);
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  const m = new MeshBasicMaterial();
  m.name = material;
  return new Mesh(g, m);
}

describe("cutOldPines", () => {
  const p = TEMPLE_PINES[0]!;
  it("drops the green plates above 3.4 m and keeps the low greens", () => {
    const m = mesh("LM_temple_green", [
      [p.x, 5, p.z],
      [p.x + 1, 6.5, p.z - 1],
      [-50, 0.4, -30],
    ]);
    const cut = cutOldPines(m)!;
    expect(cut.index!.count).toBe(3);
    // the original (the loader's cache) is untouched
    expect(m.geometry.index!.count).toBe(9);
    expect(cut.getAttribute("position")).toBe(m.geometry.getAttribute("position"));
  });
  it("drops the trunk triangles at a pine's place from the rock mesh, keeps the rocks elsewhere", () => {
    const m = mesh("LM_temple_rock", [
      [p.x + 0.3, 2, p.z],
      [p.x - 0.2, 5, p.z + 0.4],
      [-46, 0.5, -44], // the pond's rocks
    ]);
    expect(cutOldPines(m)!.index!.count).toBe(3);
  });
  it("leaves other materials alone", () => {
    expect(cutOldPines(mesh("LM_temple_granite", [[p.x, 5, p.z]]))).toBeNull();
    expect(cutOldPines(mesh("LM_temple_green", [[-50, 1, -30]]))).toBeNull();
  });
});
