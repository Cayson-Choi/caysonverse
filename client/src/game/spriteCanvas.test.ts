import { describe, expect, it } from "vitest";
import { CanvasTexture, LinearFilter, SRGBColorSpace, type SpriteMaterial } from "three";
import {
  LABEL_LAYER,
  LABEL_SNAP,
  labelInfo,
  labelSprites,
  RASTERS_PER_FRAME,
  billboardSprite,
  canvasTexture,
  fontBucket,
  takeRasterBudget,
} from "./spriteCanvas";

describe("fontBucket: the whole-pixel font a label is rasterized at", () => {
  it("the nearest whole pixel to the shown size", () => {
    expect(fontBucket(19.2, 48, 8, 64)).toBe(19);
    expect(fontBucket(19.6, 48, 8, 64)).toBe(20);
    expect(fontBucket(12 * 1.5, 48, 8, 64)).toBe(18);
  });

  it("keeps the current size until the shown one is 0.75 px away (no re-raster on a bobbing camera)", () => {
    expect(fontBucket(19.7, 19, 8, 64)).toBe(19);
    expect(fontBucket(18.3, 19, 8, 64)).toBe(19);
    expect(fontBucket(19.75, 19, 8, 64)).toBe(20);
    expect(fontBucket(18.2, 19, 8, 64)).toBe(18);
  });

  it("clamps into [min, max] and ignores a nonsense size", () => {
    expect(fontBucket(2, 19, 8, 64)).toBe(8);
    expect(fontBucket(900, 19, 8, 64)).toBe(64);
    expect(fontBucket(3, 8, 8, 64)).toBe(8); // already at the floor
    for (const bad of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) expect(fontBucket(bad, 19, 8, 64)).toBe(19);
  });
});

describe("takeRasterBudget: a few new canvases per frame", () => {
  it(`gives RASTERS_PER_FRAME (${RASTERS_PER_FRAME}) per frame key, then none until the next frame`, () => {
    const got = Array.from({ length: RASTERS_PER_FRAME + 2 }, () => takeRasterBudget(1001));
    expect(got.filter(Boolean)).toHaveLength(RASTERS_PER_FRAME);
    expect(got.slice(RASTERS_PER_FRAME).every((g) => !g)).toBe(true);
    expect(takeRasterBudget(1002)).toBe(true);
    expect(takeRasterBudget(1003, 0)).toBe(false);
  });
});

describe("label sprites", () => {
  const texture = () => {
    const t = new CanvasTexture({ width: 120, height: 31 } as never);
    return t;
  };

  it("canvasTexture: one texel per pixel — no mipmaps, linear filters, sRGB", () => {
    const t = canvasTexture({ width: 10, height: 10 } as never);
    expect(t.generateMipmaps).toBe(false);
    expect(t.minFilter).toBe(LinearFilter);
    expect(t.magFilter).toBe(LinearFilter);
    expect(t.colorSpace).toBe(SRGBColorSpace);
  });

  it("on the label layer only, readable over everything, in its canvas colours (no tone map, no fog)", () => {
    const sprite = billboardSprite(texture(), 3, 0.3, 999);
    expect(sprite.layers.mask).toBe(1 << LABEL_LAYER);
    expect(sprite.renderOrder).toBe(999);
    expect(sprite.scale.x).toBeCloseTo(0.9, 6);
    const m = sprite.material as SpriteMaterial;
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
    expect(m.transparent).toBe(true);
    expect(m.toneMapped).toBe(false);
    expect(m.fog).toBe(false);
  });

  it("is on the overlay's list while its material lives, with its snap; disposing the material takes it off", () => {
    const a = billboardSprite(texture(), 3, 0.3, 999, { snap: LABEL_SNAP });
    const b = billboardSprite(texture(), 1, 0.5, 1001);
    expect(labelSprites().has(a)).toBe(true);
    expect(labelSprites().has(b)).toBe(true);
    expect(labelInfo(a).snap).toBe(LABEL_SNAP);
    expect(labelInfo(b).snap).toBe(0); // the emoji: never snapped
    (a.material as SpriteMaterial).dispose();
    expect(labelSprites().has(a)).toBe(false);
    expect(labelSprites().has(b)).toBe(true);
    (b.material as SpriteMaterial).dispose();
    expect(labelSprites().has(b)).toBe(false);
  });
});
