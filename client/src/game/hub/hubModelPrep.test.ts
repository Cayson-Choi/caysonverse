import { describe, expect, it } from "vitest";
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, SRGBColorSpace, Texture } from "three";
import {
  COLLIDER_PREFIX,
  LIGHTMAP_CHANNEL,
  LIGHTMAP_INTENSITY,
  LIGHTMAP_MATERIAL_PREFIX,
  configureLightmap,
  isMesh,
  lightmapMaterial,
  materialsOf,
} from "./hubModelPrep";

const lightmap = (): Texture => new Texture();

function mat(name: string): MeshBasicMaterial {
  const m = new MeshBasicMaterial();
  m.name = name;
  return m;
}

describe("configureLightmap", () => {
  it("sets flipY false, sRGB and channel 1, and flags one upload", () => {
    const t = lightmap();
    const v0 = t.version;
    configureLightmap(t);
    expect(t.flipY).toBe(false);
    expect(t.colorSpace).toBe(SRGBColorSpace);
    expect(t.channel).toBe(LIGHTMAP_CHANNEL);
    expect(t.version).toBe(v0 + 1);
  });

  it("is idempotent: a texture that is already right is not uploaded again", () => {
    const t = configureLightmap(lightmap());
    const v = t.version;
    configureLightmap(t);
    configureLightmap(t);
    expect(t.version).toBe(v);
  });

  it("pins the recipe's numbers: channel 1 and intensity 1.6π", () => {
    expect(LIGHTMAP_CHANNEL).toBe(1);
    expect(LIGHTMAP_INTENSITY).toBeCloseTo(1.6 * Math.PI, 12);
    expect(LIGHTMAP_MATERIAL_PREFIX).toBe("LM_");
    expect(COLLIDER_PREFIX).toBe("col__");
  });
});

describe("lightmapMaterial", () => {
  it("sets the light map and its intensity once; the same material twice is harmless", () => {
    const m = mat("LM_palette");
    const t = lightmap();
    lightmapMaterial(m, t);
    expect(m.lightMap).toBe(t);
    expect(m.lightMapIntensity).toBe(LIGHTMAP_INTENSITY);
    const v = m.version;
    lightmapMaterial(m, t);
    expect(m.version).toBe(v);
  });
});

describe("isMesh / materialsOf", () => {
  it("tells a mesh from another node and lists one or several materials", () => {
    const a = mat("A");
    const b = mat("B");
    const single = new Mesh(new BoxGeometry(1, 1, 1), a);
    const multi = new Mesh(new BoxGeometry(1, 1, 1), [a, b]);
    expect(isMesh(single)).toBe(true);
    expect(isMesh(new Object3D())).toBe(false);
    expect(materialsOf(single)).toEqual([a]);
    expect(materialsOf(multi)).toEqual([a, b]);
  });
});
