import { describe, expect, it } from "vitest";
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial } from "three";
import { TERRAIN_FOOT, buildOuterGround, foothills } from "./outerGround";
import { PARK_FLAT, buildParkTerrain, parkGroundHeight } from "../land/parkTerrain";

/** A flat 100 m square of "baked ground" at height y, centred on the origin. */
function square(y: number): Mesh {
  const g = new BufferGeometry();
  const h = 50;
  g.setAttribute("position", new Float32BufferAttribute([-h, y, -h, h, y, -h, h, y, h, -h, y, h], 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  const m = new Mesh(g, new MeshBasicMaterial());
  m.name = "village_lm_11_8";
  return m;
}

describe("the village's outer ground", () => {
  const ground = buildOuterGround([square(3)]);
  it("lies under the baked ground inside it and meets its rim outside, with no step", () => {
    expect(ground.heightAt(0, 0)).toBeCloseTo(3, 1); // the surface (what trees stand on)
    const rim = ground.heightAt(52.5, 0);
    expect(Math.abs(rim - 3)).toBeLessThan(0.3);
    // the mesh itself sinks under the baked ground inside it
    const pos = ground.geometry.getAttribute("position");
    let underBaked = true;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (Math.abs(x) < 46 && Math.abs(z) < 46 && pos.getY(i) > 3 - 2) underBaked = false;
    }
    expect(underBaked).toBe(true);
  });
  it("eases to the foothills far out and never leaves a hole (finite heights, settled at the ridges' foot)", () => {
    expect(ground.heightAt(180, 0)).toBeGreaterThan(5);
    expect(foothills(230, 0)).toBeCloseTo(TERRAIN_FOOT, 5);
    const pos = ground.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) expect(Number.isFinite(pos.getY(i))).toBe(true);
  });
  it("meshes only the band round the rim, not the buried interior", () => {
    expect(ground.geometry.index!.count / 3).toBeLessThan(40000);
  });
});

describe("케이슨랜드's ground", () => {
  it("is dead flat over the whole flat area and rolls outside it, easing to 0 at the ridges' foot", () => {
    expect(parkGroundHeight(PARK_FLAT.minX, PARK_FLAT.minZ)).toBe(0);
    expect(parkGroundHeight(100, 0)).toBe(0);
    let max = 0;
    for (let x = -700; x <= 900; x += 25) for (let z = -700; z <= 700; z += 25) max = Math.max(max, parkGroundHeight(x, z));
    expect(max).toBeGreaterThan(3);
    expect(max).toBeLessThan(20);
    expect(parkGroundHeight(105 + 400, -63)).toBe(0);
  });
  it("builds a finite single mesh", () => {
    const g = buildParkTerrain();
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) expect(Number.isFinite(pos.getY(i))).toBe(true);
    expect(g.index!.count).toBeGreaterThan(0);
  });
});
