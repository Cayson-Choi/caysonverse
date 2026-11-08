import { describe, expect, it } from "vitest";
import { MeshBasicMaterial, Texture } from "three";
import { BLOB_SHADOW_Y, blobMaterialFor } from "./blobShadowAsset";
import { DEFAULT_DECAL_Y, applyDecalOffset, decalY, type GroundDecal } from "./groundDecal";

const VILLAGE: GroundDecal = { y: 0.05, polygonOffsetFactor: -2, polygonOffsetUnits: -8 };

describe("groundDecal: where a scene's ground decals lie (T7 review I2)", () => {
  it("every scene without its own placement keeps the old decals: 3 cm up, no polygon offset", () => {
    expect(DEFAULT_DECAL_Y).toBe(0.03);
    expect(BLOB_SHADOW_Y).toBe(DEFAULT_DECAL_Y);
    expect(decalY(null)).toBe(0.03);
    expect(decalY(undefined)).toBe(0.03);
    const m = applyDecalOffset(new MeshBasicMaterial(), null);
    expect(m.polygonOffset).toBe(false);
    expect(m.polygonOffsetFactor).toBe(0);
    expect(m.polygonOffsetUnits).toBe(0);
  });

  it("a scene's placement sets the height and the offset", () => {
    expect(decalY(VILLAGE)).toBe(0.05);
    const m = applyDecalOffset(new MeshBasicMaterial(), VILLAGE);
    expect(m.polygonOffset).toBe(true);
    expect(m.polygonOffsetFactor).toBe(-2);
    expect(m.polygonOffsetUnits).toBe(-8);
  });

  it("the blob shadow: the shared base untouched without a placement; one cached offset copy per placement, sharing the texture", () => {
    const base = new MeshBasicMaterial({ map: new Texture(), transparent: true, depthWrite: false });
    expect(blobMaterialFor(base, null)).toBe(base);
    const a = blobMaterialFor(base, VILLAGE);
    expect(a).not.toBe(base);
    expect(blobMaterialFor(base, { ...VILLAGE })).toBe(a);
    expect(a.polygonOffset).toBe(true);
    expect(a.polygonOffsetUnits).toBe(-8);
    expect(a.map).toBe(base.map);
    expect(a.transparent).toBe(true);
    expect(a.depthWrite).toBe(false);
    expect(base.polygonOffset).toBe(false);
  });
});
