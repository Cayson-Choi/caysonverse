// The lake's water (design 4.2): a muddy green-brown reservoir, not the creek's turquoise. Its own shader, the village's ripple
// normal map (villageWater.ts exports it; that file is not touched), concentric rings from a 32-slot uniform array (a float
// landing, a tug, a bite, a thrashing fish, a fish jumping somewhere), wind patches, a Fresnel mix with a sky gradient and a
// dark tree line, the sun glint by day and the long reflections of the lamps and windows at night. Colours are linear; fog,
// tone mapping and colour space come from three's chunks like every material of the village.
//
// With chunk A's lake.glb (F): the water mesh's COLOR_0 says r = depth / 3.5 m, g = shallows, b = distance from the shore / 24 m
// (`extras.lake.waterLook`: murky green-brown, deeper and darker toward the middle, softened reflections), the reflection is A's
// baked panorama (lake_refl_day / _night, equirect seen from the lake's middle) read with a mip bias that grows toward the
// middle, so it is never a mirror, and the bake's light map (UV1) puts the trees' and the structures' shadows on the water.

import { Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, ShaderMaterial, UniformsLib, UniformsUtils, Vector3, Vector4, type Texture } from "three";
import { makeRippleTexture } from "../village/villageWater";
import { waveTexture } from "./lakeWaves";
import { LAKE_LAMPS, LAKE_SHOP, LAKE_SHORE, distToPolygonEdge, insidePolygon } from "@caysonverse/shared/village/lakeLayout";

export const RIPPLE_SLOTS = 32;
export const LAMP_SLOTS = 12;

/** Design 4.2: shallow #5d6b3a, deep #26331f. */
export const LAKE_WATER_COLORS = { shallow: "#5d6b3a", deep: "#26331f" } as const;

const VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#ifdef USE_DEPTH_ATTR
attribute float aDepth;
#endif
#ifdef USE_LAKE_COLOR
attribute vec3 color;
attribute vec2 uv1;
varying vec3 vData;
varying vec2 vLmUv;
#endif
varying vec3 vWorld;
varying float vDepth;
uniform float uTime;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  #ifdef LAKE_SWELL
  // lake v2: a mild swell (2-3 cm, 7-12 m long, the PC tier): the waterline climbs and falls on the bank (the lapping)
  wp.y += 0.016 * sin( dot( wp.xz, vec2( 0.55, 0.21 ) ) - uTime * 1.1 ) + 0.010 * sin( dot( wp.xz, vec2( -0.23, 0.71 ) ) - uTime * 0.83 ) + 0.005 * sin( dot( wp.xz, vec2( 1.3, 0.4 ) ) - uTime * 1.9 );
  #endif
  vWorld = wp.xyz;
  #ifdef USE_DEPTH_ATTR
  vDepth = aDepth;
  #else
  vDepth = -1.0;
  #endif
  #ifdef USE_LAKE_COLOR
  vData = color;
  vLmUv = uv1;
  vDepth = clamp( color.r * 3.5 / 2.5, 0.0, 1.0 );
  #endif
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform sampler2D uRipple;
uniform sampler2D uWaves;
uniform vec4 uRipples[${RIPPLE_SLOTS}];
uniform vec4 uLamps[${LAMP_SLOTS}];
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uTreeLine;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uLights;
uniform float uTint;
uniform vec4 uBasin;
uniform vec4 uDebug;
#ifdef USE_LAKE_COLOR
uniform sampler2D uReflDay;
uniform sampler2D uReflNight;
uniform sampler2D uLm;
uniform sampler2D uLmNight;
uniform float uLmNightOn;
uniform sampler2D uShoreDist;
uniform vec4 uShoreBox;
varying vec3 vData;
varying vec2 vLmUv;
#endif
varying vec3 vWorld;
varying float vDepth;

void main() {
  float depth = vDepth;
  if ( depth < 0.0 ) {
    vec2 q = ( vWorld.xz - uBasin.xy ) / uBasin.zw;
    depth = clamp( 1.0 - dot( q, q ), 0.0, 1.0 );
  }
  // lake v2: the water moves (owner 2026-11-16) — wind chop from the wave tile in two (three on PC) layers drifting with the
  // wind, gust patches (cat's paws) running across, the old fine ripple on top; still a calm reservoir, never surf
  vec2 p = vWorld.xz;
  float gust = texture2D( uWaves, p * 0.011 + uTime * vec2( 0.0105, 0.0042 ) ).a;
  gust = smoothstep( 0.3, 0.85, gust ) * 0.85 + 0.15 * ( 0.5 + 0.5 * sin( p.x * 0.045 + uTime * 0.06 ) );
  vec2 s1 = texture2D( uWaves, p * 0.19 + uTime * vec2( 0.052, 0.021 ) ).rg * 2.0 - 1.0;
  vec2 q2 = vec2( 0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y );
  vec2 s2 = texture2D( uWaves, q2 * 0.43 + uTime * vec2( 0.071, -0.033 ) ).rg * 2.0 - 1.0;
  vec2 s2r = vec2( 0.8 * s2.x + 0.6 * s2.y, -0.6 * s2.x + 0.8 * s2.y );
  vec3 n1 = texture2D( uRipple, p * 0.85 + uTime * vec2( -0.009, 0.013 ) ).xyz * 2.0 - 1.0;
  vec2 chop = s1 * 0.55 + s2r * 0.4;
  #ifdef LAKE_SWELL
  vec2 s3 = texture2D( uWaves, p * 1.07 + uTime * vec2( 0.13, 0.06 ) ).rg * 2.0 - 1.0;
  chop += s3 * 0.22;
  // the swell's own slope (the vertex shader's waves)
  vec2 swell = 0.016 * vec2( 0.55, 0.21 ) * cos( dot( p, vec2( 0.55, 0.21 ) ) - uTime * 1.1 ) + 0.010 * vec2( -0.23, 0.71 ) * cos( dot( p, vec2( -0.23, 0.71 ) ) - uTime * 0.83 );
  #else
  vec2 swell = vec2( 0.0 );
  #endif
  vec2 slope = chop * ( 0.04 + 0.085 * gust ) + n1.xy * 0.018 - swell * 3.0;
  #pragma unroll_loop_start
  for ( int i = 0; i < ${RIPPLE_SLOTS}; i ++ ) {
    {
    vec4 r = uRipples[ UNROLLED_LOOP_INDEX ];
    float age = uTime - r.z;
    float live = step( 0.0, r.w ) * step( 0.0, age ) * step( age, 4.5 );
    vec2 d2 = vWorld.xz - r.xy;
    float d = length( d2 );
    float radius = age * 0.85;
    float band = ( d - radius ) * 4.5;
    float w = exp( - band * band ) * r.w * live * exp( - max( age, 0.0 ) * 0.8 ) * ( 1.0 / ( 1.0 + d * 0.6 ) + 0.15 );
    slope += normalize( d2 + vec2( 1e-4 ) ) * w * 0.9 * cos( ( d - radius ) * 14.0 );
    }
  }
  #pragma unroll_loop_end
  vec3 N = normalize( vec3( slope.x, 1.0, slope.y ) );
  vec3 V = normalize( cameraPosition - vWorld );
  float ndv = clamp( dot( N, V ), 0.0, 1.0 );
  float fres = 0.02 + 0.98 * pow( 1.0 - ndv, 5.0 );
  vec3 R = reflect( -V, N );
  float ry = clamp( R.y, 0.0, 1.0 );
  #ifdef USE_LAKE_COLOR
  // the baked panorama (equirect, its middle looking south = +z, its right edge west), a little blurred (more toward the lake's middle)
  vec3 Rp = normalize( vec3( R.x, max( R.y, 0.0 ), R.z ) );
  vec2 puv = vec2( 0.5 + atan( -Rp.x, Rp.z ) / 6.2831853, 0.5 + asin( Rp.y ) / 3.1415927 );
  // the water's data per pixel: A's COLOR_0 (r depth, g shallows, b distance from the shore) is per vertex: even with the mesh filled by
  // rings every few metres (F: no more 17 m slivers) its straight triangle edges show as faint bands in the shallows, so the same
  // quantities come from the shore's distance field (lakeShoreField), smooth per pixel; COLOR_0 stays the fallback look
  vec3 data = vData;
  {
    float d = texture2D( uShoreDist, ( vWorld.xz - uShoreBox.xy ) / uShoreBox.zw ).r * 24.0;
    data = vec3( clamp( d / 7.0, 0.0, 1.0 ), 1.0 - smoothstep( 0.0, 3.0, d ), clamp( d / 24.0, 0.0, 1.0 ) );
  }
  float blur = 1.0 + 1.6 * data.b;
  vec3 pano = mix( texture2D( uReflDay, puv, blur ).rgb, texture2D( uReflNight, puv, blur ).rgb, uNight );
  // the panorama is A's open-water render (from (162, -14), 1.5 m above the water, no deck or railing in view): the sky, the bank's
  // forest and the far ridges all round, so the water reflects them as the photos do (no 35 degree fallback any more)
  // a little lift of the dark bank (the photos' water shows the forest and the ridges as soft mid tones, not black)
  vec3 refl = pow( pano, vec3( 0.86 ) ) * 1.08;
  // the bake's light on the water: the shadows of the trees and the structures (× 1.6, the light maps' gain)
  vec3 lm = texture2D( uLm, vLmUv ).rgb;
  if ( uLmNightOn > 0.5 ) lm = mix( lm, texture2D( uLmNight, vLmUv ).rgb * 2.2, uNight );
  float shade = mix( clamp( dot( lm, vec3( 0.2126, 0.7152, 0.0722 ) ) * 1.6, 0.25, 1.25 ), 1.0, uDebug.x );
  // murky green-brown: the shallows lighter and greener, deeper and darker toward the middle
  float deepMix = clamp( 0.65 * data.r + 0.55 * data.b, 0.0, 1.0 );
  vec3 body = mix( uShallow, uDeep, smoothstep( 0.0, 0.9, deepMix ) ) * uTint * shade;
  // softened reflections: a muted panorama, a little less in the shallows (the bank shows through), never a mirror
  float reflAmt = clamp( fres * 0.95 + 0.14, 0.0, 0.82 ) * mix( 0.8, 1.0, data.b ) * ( 1.0 - uDebug.z );
  float glint = pow( max( dot( R, normalize( uSunDir ) ), 0.0 ), 260.0 );
  vec3 col = mix( body, refl * 0.9, reflAmt );
  col += uSunColor * glint * 1.6 * ( 1.0 - uNight ) * shade;
  // lake v2: the lapping at the bank — a thin pale line of wet foam that comes and goes with the small waves
  {
    float dS = data.g > 0.0 ? ( 1.0 - data.g ) * 3.0 : 3.0;
    float along = vWorld.x * 0.61 + vWorld.z * 0.47;
    float edge = 0.18 + 0.12 * sin( uTime * 1.25 + along ) + 0.05 * sin( uTime * 2.7 + along * 2.3 );
    float foam = exp( - pow( ( dS - edge ) / 0.09, 2.0 ) ) * ( 0.6 + 0.4 * gust );
    col = mix( col, vec3( 0.62, 0.62, 0.55 ) * uTint * shade, 0.22 * foam * ( 1.0 - 0.6 * uNight ) );
  }
  #else
  vec3 refl = mix( uHorizon, uZenith, pow( ry, 0.6 ) );
  refl = mix( uTreeLine, refl, smoothstep( 0.03, 0.2, ry ) );
  float glint = pow( max( dot( R, normalize( uSunDir ) ), 0.0 ), 260.0 );
  refl += uSunColor * glint * 2.5 * ( 1.0 - uNight );
  vec3 body = mix( uShallow, uDeep, smoothstep( 0.0, 0.7, depth ) ) * uTint;
  vec3 col = mix( body, refl, clamp( fres + 0.08, 0.0, 1.0 ) );
  #endif
  vec2 vdir = normalize( ( cameraPosition.xz - vWorld.xz ) + vec2( 1e-4 ) );
  vec3 glow = vec3( 0.0 );
  #pragma unroll_loop_start
  for ( int i = 0; i < ${LAMP_SLOTS}; i ++ ) {
    {
    vec4 L = uLamps[ UNROLLED_LOOP_INDEX ];
    vec2 to = L.xy - vWorld.xz;
    float along = dot( to, vdir );
    float across = length( to - vdir * along );
    float streak = exp( - ( across * across ) / ( 0.5 + 0.02 * abs( along ) ) ) * exp( - abs( along ) * 0.06 );
    glow += vec3( 1.0, 0.72, 0.38 ) * max( L.w, 0.0 ) * streak * ( 0.35 + 0.65 * fres );
    }
  }
  #pragma unroll_loop_end
  col += glow * uLights * 0.9 * ( 1.0 - uDebug.w );
  #ifdef USE_LAKE_COLOR
  // the shallows (g) let the muddy bank show through
  float alpha = mix( mix( 0.97, 0.80, clamp( data.g, 0.0, 1.0 ) ), 1.0, uDebug.y );
  #else
  float alpha = mix( 0.90, 0.98, smoothstep( 0.0, 0.5, depth ) );
  #endif
  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

let shoreField: { texture: DataTexture; box: { minX: number; maxX: number; minZ: number; maxZ: number } } | null = null;

/**
 * The distance from the shore inside the water (m / 24, 0 at the bank), on a 192 x 256 grid over the shoreline's box: made once
 * from LAKE_SHORE. The water reads it per pixel (depth, shallows and the distance of A's COLOR_0 per vertex show triangle edges).
 */
export function lakeShoreField(): { texture: DataTexture; box: { minX: number; maxX: number; minZ: number; maxZ: number } } {
  if (shoreField) return shoreField;
  const xs = LAKE_SHORE.map((p) => p.x);
  const zs = LAKE_SHORE.map((p) => p.z);
  const box = { minX: Math.min(...xs) - 2, maxX: Math.max(...xs) + 2, minZ: Math.min(...zs) - 2, maxZ: Math.max(...zs) + 2 };
  const W = 192;
  const H = 256;
  const data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = box.minX + ((i + 0.5) / W) * (box.maxX - box.minX);
      const z = box.minZ + ((j + 0.5) / H) * (box.maxZ - box.minZ);
      const d = insidePolygon(x, z, LAKE_SHORE) ? distToPolygonEdge(x, z, LAKE_SHORE) : 0;
      const v = Math.round(Math.min(1, d / 24) * 255);
      const k = (j * W + i) * 4;
      data[k] = v;
      data[k + 1] = v;
      data[k + 2] = v;
      data[k + 3] = 255;
    }
  }
  const texture = new DataTexture(data, W, H);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  shoreField = { texture, box };
  return shoreField;
}

export interface LakeDayLook {
  night: number;
  lights: number;
  sunDir: readonly number[];
  horizon: readonly number[];
  tint: number;
}

export interface LakeWater {
  material: ShaderMaterial;
  /** A ring on the water at (x, z) now; `strength` about 0.3 (a tug) to 1.2 (a float landing). */
  ripple(x: number, z: number, strength: number): void;
  /** Per frame: the clock and the time of day. */
  update(timeS: number, day: LakeDayLook): void;
  dispose(): void;
}

/** Whether a mesh of lake.glb wears the lake's water (A names it `lake_water`): its own depth values (aDepth) stay. */
export const LAKE_WATER_NODE = /water/i;

/** Chunk A's water data: the reflection panoramas and the light maps (day, and night when loaded). */
export interface LakeWaterLook {
  reflDay: Texture;
  reflNight: Texture;
  lightmap: Texture;
  lightmapNight: Texture | null;
  /** The lamp heads (x, z) for the long reflections, when the structures say where they are. */
  lamps?: ReadonlyArray<{ x: number; z: number }>;
}

export function createLakeWater(opts: { depthAttr?: boolean; ripple?: DataTexture; look?: LakeWaterLook; tier?: "high" | "low" } = {}): LakeWater {
  const ripple = opts.ripple ?? makeRippleTexture();
  const ownsTexture = !opts.ripple;
  const rings: Vector4[] = Array.from({ length: RIPPLE_SLOTS }, () => new Vector4(0, 0, -100, 0));
  const lamps: Vector4[] = Array.from({ length: LAMP_SLOTS }, () => new Vector4(0, 0, 0, 0));
  (opts.look?.lamps ?? LAKE_LAMPS).slice(0, LAMP_SLOTS - 4).forEach((p, i) => lamps[i]!.set(p.x, p.z, 0, 1));
  lamps[LAMP_SLOTS - 4]!.set((LAKE_SHOP.minX + LAKE_SHOP.maxX) / 2, LAKE_SHOP.maxZ, 0, 1.2);
  const shallow = new Color(LAKE_WATER_COLORS.shallow);
  const deep = new Color(LAKE_WATER_COLORS.deep);
  const material = new ShaderMaterial({
    name: "M_lake_water (runtime)",
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uTime: { value: 0 },
        uRipple: { value: ripple },
        uWaves: { value: null },
        uRipples: { value: rings },
        uLamps: { value: lamps },
        uShallow: { value: new Vector3(shallow.r, shallow.g, shallow.b) },
        uDeep: { value: new Vector3(deep.r, deep.g, deep.b) },
        uHorizon: { value: new Vector3(0.55, 0.62, 0.7) },
        uZenith: { value: new Vector3(0.25, 0.4, 0.68) },
        uTreeLine: { value: new Vector3(0.025, 0.045, 0.02) },
        uSunDir: { value: new Vector3(0.6, 0.4, 0.3) },
        uSunColor: { value: new Vector3(1, 0.85, 0.6) },
        uNight: { value: 0 },
        uLights: { value: 0 },
        uTint: { value: 1 },
        uBasin: { value: new Vector4(145, -12, 38, 52) },
        uReflDay: { value: null },
        uReflNight: { value: null },
        uLm: { value: null },
        uLmNight: { value: null },
        uLmNightOn: { value: 0 },
        uShoreDist: { value: null },
        uShoreBox: { value: new Vector4(0, 0, 1, 1) },
        uDebug: { value: new Vector4(0, 0, 0, 0) },
      },
    ]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: { ...(opts.look ? { USE_LAKE_COLOR: "" } : opts.depthAttr ? { USE_DEPTH_ATTR: "" } : {}), ...(opts.tier !== "low" ? { LAKE_SWELL: "" } : {}) },
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  // UniformsUtils.merge clones the values (the arrays too): point the material and the ring list at the same objects
  material.uniforms.uRipple!.value = ripple;
  material.uniforms.uWaves!.value = waveTexture();
  if (opts.look) {
    for (const t of [opts.look.reflDay, opts.look.reflNight]) {
      t.wrapS = RepeatWrapping;
      t.colorSpace = SRGBColorSpace;
      t.generateMipmaps = true;
      t.minFilter = LinearMipmapLinearFilter;
      t.needsUpdate = true;
    }
    material.uniforms.uReflDay!.value = opts.look.reflDay;
    material.uniforms.uReflNight!.value = opts.look.reflNight;
    material.uniforms.uLm!.value = opts.look.lightmap;
    material.uniforms.uLmNight!.value = opts.look.lightmapNight;
    material.uniforms.uLmNightOn!.value = opts.look.lightmapNight ? 1 : 0;
    const field = lakeShoreField();
    material.uniforms.uShoreDist!.value = field.texture;
    (material.uniforms.uShoreBox!.value as Vector4).set(field.box.minX, field.box.minZ, field.box.maxX - field.box.minX, field.box.maxZ - field.box.minZ);
  }
  const liveRings = material.uniforms.uRipples!.value as Vector4[];
  let next = 0;
  let timeNow = 0;
  if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __cvLakeWater?: ShaderMaterial }).__cvLakeWater = material;
  return {
    material,
    ripple(x, z, strength) {
      liveRings[next]!.set(x, z, timeNow, strength);
      next = (next + 1) % RIPPLE_SLOTS;
    },
    update(t, day) {
      timeNow = t;
      const u = material.uniforms;
      u.uTime!.value = t;
      u.uNight!.value = day.night;
      u.uLights!.value = day.lights;
      u.uTint!.value = day.tint;
      (u.uSunDir!.value as Vector3).set(day.sunDir[0]!, day.sunDir[1]!, day.sunDir[2]!);
      (u.uHorizon!.value as Vector3).set(day.horizon[0]!, day.horizon[1]!, day.horizon[2]!);
    },
    dispose() {
      material.dispose();
      if (ownsTexture) ripple.dispose();
    },
  };
}
