import {
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix3,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  Vector4,
  type Side,
  type Texture,
} from "three";

/**
 * 케이슨 마을's water and sky at runtime (Task 7) — the parts of the village model's look that the bake cannot hold:
 *
 *  - `M_water` (the fountain pool, the jets, the creek, the lake) becomes a water surface: a ripple normal map
 *    scrolling in world space (procedural, made here once: no texture file), a Fresnel reflection of the model's own
 *    sky dome texture, and a depth tint (the turquoise bed colour where you look down into it, a deep green-blue at
 *    a glance). The model's texture keeps its foam: its pale, unsaturated half (jets, spray, splash rings, cascades)
 *    and every steep surface draw as foam, a little scrolling, so the fountain's jets stay white and readable.
 *    The light tier draws one ripple sample and no sun glint.
 *  - `M_sky` (the dome, display-referred) must reach the screen as it is. The light tier draws it untone-mapped.
 *    The rich tier tone-maps the WHOLE frame in its last pass (QualityEffects' OutputPass), so there the dome is
 *    pre-distorted by the inverse of that curve (the scene's: neutral or ACES), the same idea as `skyBeforeToneMap`.
 *
 * Everything that can be checked without a GPU (the ripple data, the inverse curve, the material's set-up) is a
 * plain function with a unit test (villageWater.test.ts).
 */

// ───────────────────────────────────────── the ripple normal map ─────────────────────────────────────────

/** Side of the ripple texture (px): tiles seamlessly; 64 KB of RGBA. */
export const RIPPLE_SIZE = 128;

/** Deterministic PRNG (mulberry32), so every client draws the same water. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Wave {
  kx: number;
  kz: number;
  amp: number;
  phase: number;
}

/** A dozen sine waves with whole-number wave vectors (so the sum tiles over the unit square), small ones weaker. */
function rippleWaves(seed: number): Wave[] {
  const rnd = prng(seed);
  const waves: Wave[] = [];
  while (waves.length < 14) {
    const kx = Math.round((rnd() * 2 - 1) * 9);
    const kz = Math.round((rnd() * 2 - 1) * 9);
    const k = Math.hypot(kx, kz);
    if (k < 2 || k > 9.5) continue;
    waves.push({ kx, kz, amp: 1 / k ** 1.3, phase: rnd() * Math.PI * 2 });
  }
  return waves;
}

/**
 * The ripple normal map's texels (RGBA8, `size` x `size`): the normal of a height field made of sine waves, as
 * `(n + 1) / 2`, x in R and z in G (up is B). Tiles seamlessly in both directions.
 */
export function rippleNormalData(size = RIPPLE_SIZE, seed = 7): Uint8Array {
  const waves = rippleWaves(seed);
  const out = new Uint8Array(size * size * 4);
  const strength = 0.09;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      let dx = 0;
      let dz = 0;
      for (const w of waves) {
        const c = Math.cos(2 * Math.PI * (w.kx * u + w.kz * v) + w.phase) * w.amp * 2 * Math.PI;
        dx += c * w.kx;
        dz += c * w.kz;
      }
      const nx = -dx * strength;
      const nz = -dz * strength;
      const len = Math.hypot(nx, 1, nz);
      const o = (j * size + i) * 4;
      out[o] = Math.round(((nx / len + 1) / 2) * 255);
      out[o + 1] = Math.round(((nz / len + 1) / 2) * 255);
      out[o + 2] = Math.round(((1 / len + 1) / 2) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** The ripple normal map as a repeating, mip-mapped texture (data, not colour). */
export function makeRippleTexture(size = RIPPLE_SIZE): DataTexture {
  const t = new DataTexture(rippleNormalData(size), size, size, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// ───────────────────────────────────────── the inverse tone curve ─────────────────────────────────────────

/** three's ACES filmic matrices (tonemapping_pars_fragment), as row-major 3 x 3 (input: sRGB -> AP1-ish, output back). */
const ACES_IN = new Matrix3().set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777);
const ACES_OUT = new Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602);
/** Their inverses, for the dome's shader and for `inverseAcesFilmic`. */
export const ACES_IN_INV = ACES_IN.clone().invert();
export const ACES_OUT_INV = ACES_OUT.clone().invert();
/** The curve reaches 1 only at infinity: targets are held just under it. */
const INVERSE_MAX = 0.92;

/** The input of three's RRT+ODT fit that gives `y` (the positive root of its rational curve). */
function fitInverse(y: number): number {
  const t = Math.min(INVERSE_MAX, Math.max(0, y));
  const a = 0.983729 * t - 1;
  const b = 0.432951 * t - 0.0245786;
  const c = 0.238081 * t + 0.000090537;
  return Math.max(0, (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a));
}

/**
 * The linear colour that three's ACES filmic tone mapping (at `exposure`) turns into `rgb` (linear, 0..0.92):
 * the dome's colour on the rich tier, whose last pass tone-maps every pixel. Mirrors the dome's GLSL.
 */
export function inverseAcesFilmic(rgb: readonly number[], exposure: number): [number, number, number] {
  const f = new Vector3(rgb[0], rgb[1], rgb[2]).applyMatrix3(ACES_OUT_INV);
  const a = new Vector3(fitInverse(f.x), fitInverse(f.y), fitInverse(f.z)).applyMatrix3(ACES_IN_INV);
  const s = 0.6 / Math.max(1e-3, exposure);
  return [Math.max(0, a.x * s), Math.max(0, a.y * s), Math.max(0, a.z * s)];
}

/**
 * The inverse tone curves in GLSL (for an onBeforeCompile), `villageInverseTone( c )`: three's NeutralToneMapping
 * undone (`inverseNeutralToneMap` in quality.ts) with VILLAGE_INVERSE_NEUTRAL defined, ACES filmic undone
 * (`inverseAcesFilmic`) otherwise. Needs the uniforms `uAcesInInv`, `uAcesOutInv` and `uExposure`.
 */
export const INVERSE_TONE_GLSL = /* glsl */ `
uniform mat3 uAcesInInv;
uniform mat3 uAcesOutInv;
uniform float uExposure;
vec3 villageInverseNeutral( vec3 t ) {
  vec3 c = clamp( t, 0.0, 0.96 );
  float top = max( c.r, max( c.g, c.b ) );
  if ( top >= 0.76 ) {
    float d = 0.24;
    float peak = d * d / ( 1.0 - top ) - d + 0.76;
    float g = 1.0 - 1.0 / ( 0.15 * ( peak - top ) + 1.0 );
    c = ( c - g * top ) / ( 1.0 - g ) * peak / top;
  }
  float m = max( 0.0, min( c.r, min( c.g, c.b ) ) );
  float offset = m >= 0.04 ? 0.04 : sqrt( m / 6.25 ) - m;
  return max( ( c + offset ) / max( 1e-3, uExposure ), vec3( 0.0 ) );
}
float villageFitInverse( float y ) {
  float t = clamp( y, 0.0, ${INVERSE_MAX.toFixed(2)} );
  float a = 0.983729 * t - 1.0;
  float b = 0.432951 * t - 0.0245786;
  float c = 0.238081 * t + 0.000090537;
  return max( 0.0, ( -b - sqrt( b * b - 4.0 * a * c ) ) / ( 2.0 * a ) );
}
vec3 villageInverseAces( vec3 c ) {
  vec3 f = uAcesOutInv * c;
  vec3 a = uAcesInInv * vec3( villageFitInverse( f.r ), villageFitInverse( f.g ), villageFitInverse( f.b ) );
  return max( a * ( 0.6 / max( 1e-3, uExposure ) ), vec3( 0.0 ) );
}
vec3 villageInverseTone( vec3 c ) {
  #ifdef VILLAGE_INVERSE_NEUTRAL
    return villageInverseNeutral( c );
  #else
    return villageInverseAces( c );
  #endif
}
`;

// ───────────────────────────────────────── the sky texture's mapping ─────────────────────────────────────────

/**
 * How the dome's texture is laid on directions: `u = fract(uSign * azimuth / 2π + uOffset)` with the azimuth as
 * `atan2(x, z)`, and `v = vScale * elevation + vOffset` (elevation in radians). Fitted from the dome's own vertices
 * (villageModelPrep.ts `fitSkyMapping`), so the water reflects the sky the player sees above it.
 */
export interface SkyMapping {
  uSign: number;
  uOffset: number;
  vScale: number;
  vOffset: number;
}

/** The mapping for a model without a dome to fit: every direction reads the sky texture's middle row (a flat colour). */
export const FLAT_SKY_MAPPING: SkyMapping = { uSign: 1, uOffset: 0, vScale: 0, vOffset: 0.5 };

// ───────────────────────────────────────── the water material ─────────────────────────────────────────

/** Water look values (sRGB colours). */
export const WATER = {
  /** World metres -> ripple texture repeats, the two layers (waves of about 0.3 to 1.5 m, and finer). */
  rippleScale: [0.32, 0.85] as const,
  /** Ripple drift (texture repeats per second) of the two layers; the first one runs east, with the creek. */
  rippleDrift: [
    [0.045, 0.012],
    [-0.02, 0.035],
  ] as const,
  /** How strongly the ripple tilts the surface. */
  rippleTilt: 0.32,
  /** The bed seen through the water (looking down into it). The model's texture only shades it (its mean is 1). */
  shallow: "#3f9ea0",
  /** The deep colour at a glance. */
  deep: "#174f58",
  /** What a low reflection shows instead of the sky: the banks, trees and hills along the horizon (no planar reflection). */
  land: "#3f5a45",
  /** Sky reflections are this strong (a ripple scatters some of it). */
  reflect: 0.85,
  /** Opacity of the surface: looking down into it, and at a glance (Fresnel). */
  alpha: [0.82, 0.97] as const,
  /** Foam (the texture's pale half and every steep surface) scrolls down its UV this fast. */
  foamFlow: 0.35,
  /** The sun's glint (rich tier): colour and tightness. */
  sunGlint: { color: "#ffe2bc", power: 220, strength: 2.2 },
  /** The fountain's underwater lights at night (Task 7A): their colour and reach (m) around the fountain's centre. */
  fountainGlow: { color: "#8cc4ff", radius: 4.5 },
} as const;

/** Toward the baked sun (Task 6: azimuth 70° clockwise from north, elevation 20°). */
export const VILLAGE_SUN_DIR = (() => {
  const az = (70 * Math.PI) / 180;
  const el = (20 * Math.PI) / 180;
  return new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
})();

const WATER_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vUv = uv;
  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  vWorldPos = worldPosition.xyz;
  vWorldNormal = normalize( mat3( modelMatrix ) * normal );
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const WATER_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uRipple;
uniform sampler2D uSky;
uniform vec4 uSkyMap;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uLand;
uniform float uReflect;
uniform vec2 uAlpha;
uniform float uRippleTilt;
uniform vec2 uRippleScale;
uniform vec4 uRippleDrift;
uniform float uFoamFlow;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec2 uSunGlint;
uniform vec3 uTint;
uniform vec4 uFountain;
uniform vec3 uFountainColor;
#include <common>
#include <fog_pars_fragment>
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

vec3 skyAt( vec3 r ) {
  float low = 1.0 - smoothstep( 0.02, 0.2, r.y ); // reflections near the horizon show the land, not the haze
  r.y = max( r.y, 0.03 );
  r = normalize( r );
  float az = atan( r.x, r.z );
  float el = asin( clamp( r.y, 0.0, 1.0 ) );
  vec2 uv = vec2( fract( uSkyMap.x * az / PI2 + uSkyMap.y ), clamp( uSkyMap.z * el + uSkyMap.w, 0.0, 1.0 ) );
  // A fixed, blurred level: rippled water blurs its reflection, and the azimuth's wrap leaves no mip seam.
  return mix( textureLod( uSky, uv, 3.0 ).rgb, uLand, low );
}

void main() {
  // The model's texture at a coarse level: its foam half, and a soft shade over the bed (its sparkle patches blurred away).
  vec4 soft = texture2D( uMap, vUv, 3.0 );
  float sat = max( soft.r, max( soft.g, soft.b ) ) - min( soft.r, min( soft.g, soft.b ) );
  float steep = 1.0 - smoothstep( 0.45, 0.8, abs( vWorldNormal.y ) );
  float foam = max( 1.0 - smoothstep( 0.12, 0.25, sat ), steep );

  vec2 p = vWorldPos.xz;
  vec2 g = texture2D( uRipple, p * uRippleScale.x + uTime * uRippleDrift.xy ).xy * 2.0 - 1.0;
  #ifdef WATER_DETAIL
    g = g * 0.7 + ( texture2D( uRipple, p * uRippleScale.y + uTime * uRippleDrift.zw ).xy * 2.0 - 1.0 ) * 0.5;
  #endif
  vec3 n = normalize( vec3( g.x * uRippleTilt, 1.0, g.y * uRippleTilt ) );
  vec3 V = normalize( cameraPosition - vWorldPos );
  float cosT = clamp( dot( n, V ), 0.0, 1.0 );
  float F = 0.02 + 0.98 * pow( 1.0 - cosT, 5.0 );
  vec3 R = reflect( -V, n );
  vec3 sky = skyAt( R );

  // Depth tint: looking down into it you see the bed (turquoise); at a glance, the deep colour. The ripple
  // focuses a little light on the bed (a faint caustic shimmer).
  vec3 shallow = uShallow * ( 0.75 + 0.25 * dot( soft.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) / 0.25 );
  vec3 body = mix( uDeep, shallow, pow( cosT, 0.8 ) ) * ( 1.0 + 0.12 * ( g.x + g.y ) );
  vec3 col = mix( body, sky * uReflect, F );
  #ifdef WATER_DETAIL
    col += uSunColor * pow( max( dot( R, uSunDir ), 0.0 ), uSunGlint.x ) * uSunGlint.y;
  #endif
  float alpha = mix( uAlpha.x, uAlpha.y, F );

  // Foam: the texture as it is, drifting along its UV (jets, spray, splash rings, cascades).
  vec4 foamTex = texture2D( uMap, vUv + vec2( 0.0, -uTime * uFoamFlow ) );
  col = mix( col, foamTex.rgb, foam );
  alpha = mix( alpha, foamTex.a, foam );

  // The time of day (Task 7A): the whole surface follows the light (dark blue at night), and at night the fountain's
  // underwater lights glow in its pool and jets (x, z, radius, strength), the foam the most.
  col *= uTint;
  float fd = length( vWorldPos.xz - uFountain.xy ) / max( uFountain.z, 1e-3 );
  col += uFountainColor * ( uFountain.w * exp( -fd * fd ) * ( 0.45 + 0.55 * foam ) );

  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface WaterOptions {
  /** The model's water texture (turquoise + foam). */
  map: Texture | null;
  /** The dome's texture (reflections), and how it is laid on directions. */
  sky: Texture | null;
  skyMapping: SkyMapping;
  ripple: Texture;
  /** The rich tier: two ripple layers and the sun's glint. */
  detail: boolean;
  side: Side;
}

/** The village's water surface (a ShaderMaterial with the scene's fog, tone mapping and colour space). */
export function createWaterMaterial(o: WaterOptions): ShaderMaterial {
  const sun = new Color(WATER.sunGlint.color);
  const fountain = new Color(WATER.fountainGlow.color);
  const m = new ShaderMaterial({
    name: "M_water (runtime)",
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uMap: { value: null },
        uRipple: { value: null },
        uSky: { value: null },
        uSkyMap: { value: new Vector4() },
        uTime: { value: 0 },
        uDeep: { value: new Color(WATER.deep) },
        uShallow: { value: new Color(WATER.shallow) },
        uLand: { value: new Color(WATER.land) },
        uReflect: { value: WATER.reflect },
        uAlpha: { value: [WATER.alpha[0], WATER.alpha[1]] },
        uRippleTilt: { value: WATER.rippleTilt },
        uRippleScale: { value: [WATER.rippleScale[0], WATER.rippleScale[1]] },
        uRippleDrift: { value: new Vector4(...WATER.rippleDrift[0], ...WATER.rippleDrift[1]) },
        uFoamFlow: { value: WATER.foamFlow },
        uSunDir: { value: VILLAGE_SUN_DIR.clone() },
        uSunColor: { value: new Vector3(sun.r, sun.g, sun.b) },
        uSunGlint: { value: [WATER.sunGlint.power, WATER.sunGlint.strength] },
        // The clock's (Task 7A, dayNightBlend.ts): the light's tint, the fountain's night glow (off by day).
        uTint: { value: new Vector3(1, 1, 1) },
        uFountain: { value: new Vector4(0, 0, WATER.fountainGlow.radius, 0) },
        uFountainColor: { value: new Vector3(fountain.r, fountain.g, fountain.b) },
      },
    ]),
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    defines: o.detail ? { WATER_DETAIL: "" } : {},
    transparent: true,
    depthWrite: false,
    fog: true,
    side: o.side,
  });
  // Textures are set after the merge (UniformsUtils.merge clones uniform values, textures included).
  m.uniforms.uMap!.value = o.map;
  m.uniforms.uRipple!.value = o.ripple;
  m.uniforms.uSky!.value = o.sky;
  const s = o.skyMapping;
  (m.uniforms.uSkyMap!.value as Vector4).set(s.uSign, s.uOffset, s.vScale, s.vOffset);
  return m;
}
