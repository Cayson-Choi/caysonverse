import { describe, expect, it } from "vitest";
import { BackSide, DoubleSide, FrontSide, RepeatWrapping, Texture } from "three";
import { acesFilmic } from "../game/quality";
import {
  FLAT_SKY_MAPPING,
  RIPPLE_SIZE,
  VILLAGE_SUN_DIR,
  createWaterMaterial,
  inverseAcesFilmic,
  makeRippleTexture,
  rippleNormalData,
} from "./villageWater";

const texel = (d: Uint8Array, size: number, i: number, j: number) => {
  const o = (((j + size) % size) * size + ((i + size) % size)) * 4;
  return [d[o]!, d[o + 1]!, d[o + 2]!];
};
const diff = (a: number[], b: number[]) => Math.max(...a.map((v, k) => Math.abs(v - b[k]!)));

describe("the ripple normal map (procedural, no texture file)", () => {
  const size = 64;
  const data = rippleNormalData(size);

  it("is RGBA8 of the asked size, every normal pointing up and of unit length", () => {
    expect(data).toHaveLength(size * size * 4);
    for (let o = 0; o < data.length; o += 4) {
      const n = [0, 1, 2].map((k) => (data[o + k]! / 255) * 2 - 1);
      expect(n[2]).toBeGreaterThan(0.3); // up
      expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeCloseTo(1, 1);
      expect(data[o + 3]).toBe(255);
    }
  });

  it("has ripples (the normals vary), and tiles: across the wrap it changes no more than between neighbours", () => {
    let maxStep = 0;
    let spread = 0;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size - 1; i++) {
        maxStep = Math.max(maxStep, diff(texel(data, size, i, j), texel(data, size, i + 1, j)));
        spread = Math.max(spread, diff(texel(data, size, i, j), texel(data, size, 0, 0)));
      }
    }
    expect(spread).toBeGreaterThan(40);
    for (let j = 0; j < size; j++) expect(diff(texel(data, size, size - 1, j), texel(data, size, 0, j))).toBeLessThanOrEqual(maxStep);
    for (let i = 0; i < size; i++) expect(diff(texel(data, size, i, size - 1), texel(data, size, i, 0))).toBeLessThanOrEqual(maxStep);
  });

  it("is the same on every client (seeded), and the texture repeats with mip maps, as data", () => {
    expect(rippleNormalData(16)).toEqual(rippleNormalData(16));
    const t = makeRippleTexture();
    expect(t.image.width).toBe(RIPPLE_SIZE);
    expect(t.wrapS).toBe(RepeatWrapping);
    expect(t.wrapT).toBe(RepeatWrapping);
    expect(t.generateMipmaps).toBe(true);
    expect(t.colorSpace).toBe("");
    t.dispose();
  });
});

describe("the inverse of the rich tier's tone curve (the sky dome reaches the screen as it is on both tiers)", () => {
  it("three's ACES filmic of the inverse gives the colour back", () => {
    for (const exposure of [0.8, 1, 1.15, 1.6]) {
      for (const c of [
        [0.05, 0.1, 0.2],
        [0.35, 0.45, 0.6],
        [0.6, 0.62, 0.65],
        [0.85, 0.8, 0.75],
        [0.02, 0.02, 0.02],
      ]) {
        const back = acesFilmic(inverseAcesFilmic(c, exposure), exposure);
        for (let k = 0; k < 3; k++) expect(back[k], `${c} @ ${exposure}`).toBeCloseTo(c[k]!, 3);
      }
    }
  });

  it("stays finite and not negative for black, white and out-of-range input", () => {
    for (const c of [
      [0, 0, 0],
      [1, 1, 1],
      [2, -1, 0.5],
    ]) {
      for (const v of inverseAcesFilmic(c, 1.15)) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("the water material", () => {
  const map = new Texture();
  const sky = new Texture();
  const ripple = makeRippleTexture(8);

  it("is see-through, writes no depth, takes the scene's fog, and carries the model's map, the ripple and the sky", () => {
    const m = createWaterMaterial({ map, sky, skyMapping: { uSign: -1, uOffset: 0.5, vScale: -0.57, vOffset: 0.9 }, ripple, detail: true, side: DoubleSide });
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.fog).toBe(true);
    expect(m.side).toBe(DoubleSide);
    expect(m.uniforms.uMap!.value).toBe(map);
    expect(m.uniforms.uSky!.value).toBe(sky);
    expect(m.uniforms.uRipple!.value).toBe(ripple);
    expect(m.uniforms.fogColor).toBeDefined();
    expect(m.uniforms.uSkyMap!.value.toArray()).toEqual([-1, 0.5, -0.57, 0.9]);
    expect(m.uniforms.uSunDir!.value.toArray()).toEqual(VILLAGE_SUN_DIR.toArray());
    // The shader: Fresnel, a ripple, the depth tint and the scene's fog / tone mapping / colour space.
    expect(m.fragmentShader).toMatch(/pow\( 1\.0 - cosT, 5\.0 \)/);
    expect(m.fragmentShader).toMatch(/uRipple/);
    expect(m.fragmentShader).toMatch(/mix\( uDeep, shallow/);
    for (const chunk of ["tonemapping_fragment", "colorspace_fragment", "fog_fragment"]) expect(m.fragmentShader).toContain(chunk);
    m.dispose();
  });

  it("the rich tier draws two ripple layers and the sun's glint; the light tier one layer, no glint", () => {
    const rich = createWaterMaterial({ map, sky, skyMapping: FLAT_SKY_MAPPING, ripple, detail: true, side: FrontSide });
    const light = createWaterMaterial({ map, sky, skyMapping: FLAT_SKY_MAPPING, ripple, detail: false, side: BackSide });
    expect(rich.defines).toHaveProperty("WATER_DETAIL");
    expect(light.defines).not.toHaveProperty("WATER_DETAIL");
    expect(light.side).toBe(BackSide);
    rich.dispose();
    light.dispose();
  });

  it("the baked sun is up in the east-north-east (Task 6: azimuth 70°, elevation 20°)", () => {
    expect(VILLAGE_SUN_DIR.length()).toBeCloseTo(1, 9);
    expect(Math.asin(VILLAGE_SUN_DIR.y)).toBeCloseTo((20 * Math.PI) / 180, 6);
    expect(Math.atan2(VILLAGE_SUN_DIR.x, -VILLAGE_SUN_DIR.z)).toBeCloseTo((70 * Math.PI) / 180, 6);
  });
});
