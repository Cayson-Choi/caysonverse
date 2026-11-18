import { DataTexture, LinearFilter, NoColorSpace, RGFormat, ClampToEdgeWrapping, UnsignedByteType, type ShaderMaterial, type Texture } from "three";
import { createWaterMaterial } from "../villageWater";

/**
 * The depth-aware water, as a piece other water bodies can reuse (the village's creek and feeder today; the fishing lake and the
 * temple pond next). One shader (villageWater.ts, define `CREEK`): see-through shallows over the real bed, deeper and darker toward
 * the middle, a soft shoreline where the depth reaches zero, foam from a painted channel, flowing ripples, the scene's sky
 * reflection, fog and day/night. It needs only a small map of the water body's ground:
 *
 *   `depthMapTexture(w, h, bed, foam, range)`  ->  RG8: R = bed height in `range` (m), G = foam 0..1, row 0 at the rect's z0.
 *   `createDepthWater(base, { map, rect, noise, range })` -> the material; give it to the water body's meshes (any flat or gently
 *   sloped surface above the bed). `rect` is {x0, z0, x1, z1} in world metres; outside it the surface keeps the village's old look.
 *
 * Per frame: set `material.uniforms.uTime.value` (CreekPatch copies the village's clock). The day and night tint, the sun glint and the
 * sky mapping are the village water's own uniform objects, shared, so they follow the clock by themselves.
 */

export interface DepthRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** RG8 map of a water body: `bed` and `foam` are w x h arrays (bed in metres), packed as bytes over `range`. */
export function depthMapTexture(w: number, h: number, bed: ArrayLike<number>, foam: ArrayLike<number>, range: readonly [number, number]): DataTexture {
  const out = new Uint8Array(w * h * 2);
  const span = range[1] - range[0];
  for (let k = 0; k < w * h; k++) {
    const y = bed[k]!;
    out[k * 2] = Number.isNaN(y) ? 0 : Math.round(Math.max(0, Math.min(1, (y - range[0]) / span)) * 255);
    out[k * 2 + 1] = Math.round(Math.max(0, Math.min(1, foam[k]!)) * 255);
  }
  const t = new DataTexture(out, w, h, RGFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export interface DepthWaterOptions {
  map: Texture;
  rect: DepthRect;
  /** The foam noise (fountainWater.ts makeFountainNoise). */
  noise: Texture;
  /** The bed height range the map's red channel spans (m). */
  range: readonly [number, number];
  /** The rich tier: two ripple layers and the sun's glint. */
  detail: boolean;
}

/** A depth-aware water material that shares the village water's (`base`) sky, ripple texture and day/night uniforms. */
export function createDepthWater(base: ShaderMaterial, o: DepthWaterOptions): ShaderMaterial {
  const m = createWaterMaterial({
    map: base.uniforms.uMap!.value as Texture | null,
    sky: base.uniforms.uSky!.value as Texture | null,
    skyMapping: { uSign: 1, uOffset: 0, vScale: 0, vOffset: 0.5 },
    ripple: base.uniforms.uRipple!.value as Texture,
    detail: o.detail,
    side: base.side,
    creek: { map: o.map, rect: [o.rect.x0, o.rect.z0, 1 / (o.rect.x1 - o.rect.x0), 1 / (o.rect.z1 - o.rect.z0)], noise: o.noise, range: o.range },
  });
  for (const k of ["uTint", "uFountain", "uSunDir", "uSunColor", "uSkyMap"]) m.uniforms[k] = base.uniforms[k]!;
  return m;
}
