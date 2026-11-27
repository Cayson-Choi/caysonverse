import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial } from "three";
import { PINE_SEED, TEMPLE_PINES, cutOldPines, inTempleRoof, pineOptions, pineYaw } from "./templePines";
import { crownBalance, pineGeo } from "../veg/pineKit";

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

describe("the four pines' crowns", () => {
  it("are full all round (8 sectors) and centred over their feet, and none reaches into the hall's or pavilion's roof", () => {
    TEMPLE_PINES.forEach((t, i) => {
      for (const low of [false, true]) {
        const g = pineGeo(t.shape, PINE_SEED(i), pineOptions(i, low));
        const b = crownBalance(g.needles, 8);
        expect(b.min, `pine ${i} sectors ${b.sectors.map((v) => v.toFixed(2)).join(" ")}`).toBeGreaterThan(0.4);
        expect(b.offset, `pine ${i}`).toBeLessThan(0.06 * g.R);
        // every needle vertex in the world, outside every roof (with its clearance)
        const pos = g.needles.getAttribute("position");
        const yaw = pineYaw(i);
        const sc = t.H / g.H;
        let inside = 0;
        for (let v = 0; v < pos.count; v++) {
          const x = pos.getX(v);
          const z = pos.getZ(v);
          if (inTempleRoof(t.x + sc * (x * Math.cos(yaw) + z * Math.sin(yaw)), sc * pos.getY(v), t.z + sc * (-x * Math.sin(yaw) + z * Math.cos(yaw)))) inside++;
        }
        expect(inside, `pine ${i}`).toBe(0);
      }
    });
  });

  it("the roofs: in the hall below its eaves, clear above its ridge and away from it", () => {
    expect(inTempleRoof(-60, 5, -37)).toBe(true);
    expect(inTempleRoof(-55.4, 6, -37)).toBe(true);
    expect(inTempleRoof(-60, 11.6, -37)).toBe(false);
    expect(inTempleRoof(-53, 5, -37)).toBe(false);
  });
});
