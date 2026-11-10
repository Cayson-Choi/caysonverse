import { describe, expect, it } from "vitest";
import { CanvasTexture, LinearFilter, SRGBColorSpace, Vector2, Vector4, type SpriteMaterial, type WebGLRenderer } from "three";
import {
  LABEL_LAYER,
  LABEL_VERTEX,
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

  it("its shader: the pixel-snapping vertex stage and the LOD-biased map sample, one program for every label", () => {
    const a = billboardSprite(texture(), 3, 0.3, 999, { snap: 0.2 });
    const b = billboardSprite(texture(), 1, 0.5, 1001, { lodBias: -0.5 });
    const ma = a.material as SpriteMaterial;
    const mb = b.material as SpriteMaterial;
    expect(ma.customProgramCacheKey()).toBe(mb.customProgramCacheKey());
    const shader = (m: SpriteMaterial) => {
      const s = {
        uniforms: {} as Record<string, { value: unknown }>,
        vertexShader: "",
        fragmentShader: "uniform float opacity;\nvoid main() {\n#include <map_fragment>\n}",
      };
      m.onBeforeCompile(s as never, null as never);
      return s;
    };
    const sa = shader(ma);
    const sb = shader(mb);
    expect(sa.vertexShader).toBe(LABEL_VERTEX);
    expect(sa.uniforms.uSnap!.value).toBe(0.2);
    expect(sb.uniforms.uSnap!.value).toBe(0); // the emoji: never snapped
    expect(sb.uniforms.uLodBias!.value).toBe(-0.5);
    expect(sa.uniforms.uLodBias!.value).toBe(0);
    expect(sa.uniforms.uRes).toBe(sb.uniforms.uRes); // one viewport for every label
    expect(sa.uniforms.uTexPx).not.toBe(sb.uniforms.uTexPx); // each its own map size
    expect(sa.fragmentShader).toContain("uniform float uLodBias;");
    expect(sa.fragmentShader).toContain("texture2D( map, vMapUv, uLodBias )");
    expect(sa.fragmentShader).not.toContain("#include <map_fragment>");
  });

  it("before each draw it reads the viewport it is drawn into and its map's size", () => {
    const sprite = billboardSprite(texture(), 3, 0.3, 999, { snap: 0.2 });
    const m = sprite.material as SpriteMaterial;
    const s = { uniforms: {} as Record<string, { value: Vector2 }>, vertexShader: "", fragmentShader: "void main() {}" };
    m.onBeforeCompile(s as never, null as never);
    const renderer = { getCurrentViewport: (v: Vector4) => v.set(0, 0, 1920, 1080) } as unknown as WebGLRenderer;
    sprite.onBeforeRender(renderer, null as never, null as never, null as never, m, null as never);
    expect(s.uniforms.uRes!.value.toArray()).toEqual([1920, 1080]);
    expect(s.uniforms.uTexPx!.value.toArray()).toEqual([120, 31]);
    // a new look (another canvas) is picked up on the next draw
    m.map = new CanvasTexture({ width: 64, height: 20 } as never);
    sprite.onBeforeRender(renderer, null as never, null as never, null as never, m, null as never);
    expect(s.uniforms.uTexPx!.value.toArray()).toEqual([64, 20]);
  });

  it("the vertex stage snaps only within uSnap, to whole pixels, at the texture's own size", () => {
    expect(LABEL_VERTEX).toMatch(/uSnap > 0\.0 && off\.x <= uSnap && off\.y <= uSnap/);
    expect(LABEL_VERTEX).toMatch(/drawPx = texPx;\s*originPx = floor\( anchorPx - center \* drawPx \+ 0\.5 \);/);
  });
});
