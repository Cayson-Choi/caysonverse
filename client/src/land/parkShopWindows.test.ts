import { PARK_SHOPS } from "@caysonverse/shared/village/parkArea";
import { describe, expect, it } from "vitest";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { GeoBuilder } from "./geoBuilder";
import { addShopWindow, SHOP_WINDOW_BEDS, windowBed } from "./parkShopWindows";
import { shopWindows, WINDOW_BOX } from "@caysonverse/shared/village/parkShopWindowLayout";

describe("the promenade shop fronts", () => {
  it("puts each window's display behind the glazing and in front of the structural timbers", () => {
    const material = new MeshBasicMaterial();
    for (const s of PARK_SHOPS) {
      for (const w of shopWindows(s)) {
        const wood = new GeoBuilder(), goods = new GeoBuilder(), glass = new GeoBuilder();
        addShopWindow(w, s.id, wood, goods, glass, [0.2, 0.42, 0.3]);
        const meshes = [wood, goods, glass].map(b => new Mesh(b.build(), material));
        const [nx, , nz] = w.out;
        // Front-side rays through both upper corners hit the pane before the folded fabric.
        for (const across of [-0.62, 0.62]) {
          const eye = new Vector3(w.x + 2 * nx - across * nz, 2.45, w.z + 2 * nz + across * nx);
          const ray = new Raycaster(eye, new Vector3(-nx, 0, -nz));
          const hits = ray.intersectObjects(meshes);
          expect(hits[0]?.object).toBe(meshes[2]);
          const curtain = hits.find(hit => hit.object === meshes[1])!;
          expect(curtain.distance - hits[0]!.distance).toBeGreaterThan(0.1);
          expect(curtain.distance).toBeLessThan(2 - 0.21);
        }
        expect(wood.triangles + glass.triangles + goods.triangles).toBeLessThan(1050);
        for (const mesh of meshes) mesh.geometry.dispose();
      }
    }
    material.dispose();
  });

  it("plants the soil inside the rim of each shop window, facing away from its wall", () => {
    expect(SHOP_WINDOW_BEDS).toHaveLength(PARK_SHOPS.length * 6);
    for (const s of PARK_SHOPS) for (const w of shopWindows(s)) {
      const bed = windowBed(w);
      const [nx, , nz] = w.out;
      expect(bed.soilProvided).toBe(true);
      expect(bed.out).toEqual([nx, nz]);
      for (const x of [bed.x0, bed.x1]) for (const z of [bed.z0, bed.z1]) {
        const d = (x - w.x) * nx + (z - w.z) * nz;
        const l = -(x - w.x) * nz + (z - w.z) * nx;
        expect(Math.abs(d - WINDOW_BOX.offset)).toBeLessThan(WINDOW_BOX.depth / 2 - WINDOW_BOX.side);
        expect(Math.abs(l)).toBeLessThan(WINDOW_BOX.width / 2 - WINDOW_BOX.side);
      }
    }
  });
});
