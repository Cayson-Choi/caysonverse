import { RepeatWrapping, SRGBColorSpace, Texture } from "three";
import { describe, expect, it } from "vitest";
import { parkMaterial } from "./pbr";

describe("park material texture ownership", () => {
  it("configures the gate's own pending maps without queueing empty uploads", () => {
    const maps = { c: new Texture(), n: new Texture(), r: new Texture() };
    const material = parkMaterial(maps, 2, { ownedMaps: true });
    expect(material.map).toBe(maps.c);
    expect(material.normalMap).toBe(maps.n);
    expect(material.roughnessMap).toBe(maps.r);
    for (const t of Object.values(maps)) {
      expect(t.version).toBe(0);
      expect(t.wrapS).toBe(RepeatWrapping);
      expect(t.repeat.toArray()).toEqual([2, 2]);
      t.image = { width: 1, height: 1 };
      t.needsUpdate = true; // TextureLoader's onLoad
      expect(t.version).toBe(1);
    }
    expect(material.map?.colorSpace).toBe(SRGBColorSpace);
  });

  it("keeps repeats independent on the shared, already loaded park maps", () => {
    const maps = { c: new Texture(), n: new Texture(), r: new Texture() };
    for (const t of Object.values(maps)) t.image = { width: 1, height: 1 };
    const material = parkMaterial(maps, [2, 3]);
    expect(material.map).not.toBe(maps.c);
    expect(material.map?.image).toBe(maps.c.image);
    expect(material.map?.repeat.toArray()).toEqual([2, 3]);
    expect(maps.c.repeat.toArray()).toEqual([1, 1]);
  });
});
