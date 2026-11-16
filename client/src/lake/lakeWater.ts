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
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
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
  vec2 uv1 = vWorld.xz * 0.30 + uTime * vec2( 0.011, 0.007 );
  vec2 uv2 = vWorld.xz * 0.85 + uTime * vec2( -0.009, 0.013 );
  vec3 n1 = texture2D( uRipple, uv1 ).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D( uRipple, uv2 ).xyz * 2.0 - 1.0;
  float gust = 0.5 + 0.5 * sin( vWorld.x * 0.045 + uTime * 0.06 ) * sin( vWorld.z * 0.037 - uTime * 0.045 + 1.3 );
  vec2 slope = ( n1.xy + 0.6 * n2.xy ) * ( 0.035 + 0.09 * gust );
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
  // the baked panorama (equirect, its middle looking south = +z, its right edge west), blurred more toward the lake's middle
  vec3 Rp = normalize( vec3( R.x, max( R.y, 0.0 ), R.z ) );
  vec2 puv = vec2( 0.5 + atan( -Rp.x, Rp.z ) / 6.2831853, 0.5 + asin( Rp.y ) / 3.1415927 );
  // the water's data per pixel: COLOR_0 (r depth, g shallows, b distance from the shore) is per vertex on A's long sliver
  // triangles and shows them as bands; the same quantities come from the shore's distance field (lakeShoreField)
  vec3 data = vData;
  {
    float d = texture2D( uShoreDist, ( vWorld.xz - uShoreBox.xy ) / uShoreBox.zw ).r * 24.0;
    data = vec3( clamp( d / 7.0, 0.0, 1.0 ), 1.0 - smoothstep( 0.0, 3.0, d ), clamp( d / 24.0, 0.0, 1.0 ) );
  }
  float blur = 1.5 + 2.0 * data.b;
  vec3 pano = mix( texture2D( uReflDay, puv, blur ).rgb, texture2D( uReflNight, puv, blur ).rgb, uNight );
  // A's panorama was rendered from (145, -12), on the T-end's deck: below ~35 degrees it shows the deck and its railings, so
  // the low reflections are the forested ridge's dark band and the horizon (as without the panorama); the sky above is the bake's
  vec3 low = mix( uHorizon, uZenith, pow( ry, 0.6 ) );
  low = mix( uTreeLine, low, smoothstep( 0.05, 0.32, ry ) );
  vec3 refl = mix( low, pano, smoothstep( 0.5, 0.75, ry ) );
  // the bake's light on the water: the shadows of the trees and the structures (× 1.6, the light maps' gain)
  vec3 lm = texture2D( uLm, vLmUv ).rgb;
  if ( uLmNightOn > 0.5 ) lm = mix( lm, texture2D( uLmNight, vLmUv ).rgb * 2.2, uNight );
  float shade = mix( clamp( dot( lm, vec3( 0.2126, 0.7152, 0.0722 ) ) * 1.6, 0.25, 1.25 ), 1.0, uDebug.x );
  // murky green-brown: the shallows lighter and greener, deeper and darker toward the middle
  float deepMix = clamp( 0.65 * data.r + 0.55 * data.b, 0.0, 1.0 );
  vec3 body = mix( uShallow, uDeep, smoothstep( 0.0, 0.9, deepMix ) ) * uTint * shade;
  // softened reflections: a muted panorama, a little less in the shallows (the bank shows through), never a mirror
  float reflAmt = clamp( fres * 0.85 + 0.06, 0.0, 0.72 ) * mix( 0.75, 1.0, data.b ) * ( 1.0 - uDebug.z );
  float glint = pow( max( dot( R, normalize( uSunDir ) ), 0.0 ), 260.0 );
  vec3 col = mix( body, refl * mix( 0.8, 0.65, data.b ), reflAmt );
  col += uSunColor * glint * 1.6 * ( 1.0 - uNight ) * shade;
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
 * from LAKE_SHORE, linearly filtered. The water reads it per pixel (depth, shallows and the distance of A's COLOR_0).
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

export function createLakeWater(opts: { depthAttr?: boolean; ripple?: DataTexture; look?: LakeWaterLook } = {}): LakeWater {
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
    defines: opts.look ? { USE_LAKE_COLOR: "" } : opts.depthAttr ? { USE_DEPTH_ATTR: "" } : {},
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  // UniformsUtils.merge clones the values (the arrays too): point the material and the ring list at the same objects
  material.uniforms.uRipple!.value = ripple;
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
