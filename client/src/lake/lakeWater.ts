// The lake's water (design 4.2): a muddy green-brown reservoir, not the creek's turquoise. Its own shader, the village's ripple
// normal map (villageWater.ts exports it; that file is not touched), concentric rings from a 32-slot uniform array (a float
// landing, a tug, a bite, a thrashing fish, a fish jumping somewhere), wind patches, a Fresnel mix with a sky gradient and a
// dark tree line (the baked reflection panorama of design 4.2 replaces this when A delivers it), the sun glint by day and
// the long reflections of the lamps and windows at night. Colours are linear; fog, tone mapping and colour space come from
// three's chunks like every material of the village.

import { Color, DataTexture, ShaderMaterial, UniformsLib, UniformsUtils, Vector3, Vector4 } from "three";
import { makeRippleTexture } from "../village/villageWater";
import { LAKE_LAMPS, LAKE_SHOP } from "@caysonverse/shared/village/lakeLayout";

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
  vec3 refl = mix( uHorizon, uZenith, pow( ry, 0.6 ) );
  refl = mix( uTreeLine, refl, smoothstep( 0.03, 0.2, ry ) );
  float glint = pow( max( dot( R, normalize( uSunDir ) ), 0.0 ), 260.0 );
  refl += uSunColor * glint * 2.5 * ( 1.0 - uNight );
  vec3 body = mix( uShallow, uDeep, smoothstep( 0.0, 0.7, depth ) ) * uTint;
  vec3 col = mix( body, refl, clamp( fres + 0.08, 0.0, 1.0 ) );
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
  col += glow * uLights * 0.9;
  float alpha = mix( 0.90, 0.98, smoothstep( 0.0, 0.5, depth ) );
  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

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

export function createLakeWater(opts: { depthAttr?: boolean; ripple?: DataTexture } = {}): LakeWater {
  const ripple = opts.ripple ?? makeRippleTexture();
  const ownsTexture = !opts.ripple;
  const rings: Vector4[] = Array.from({ length: RIPPLE_SLOTS }, () => new Vector4(0, 0, -100, 0));
  const lamps: Vector4[] = Array.from({ length: LAMP_SLOTS }, () => new Vector4(0, 0, 0, 0));
  LAKE_LAMPS.slice(0, LAMP_SLOTS - 4).forEach((p, i) => lamps[i]!.set(p.x, p.z, 0, 1));
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
      },
    ]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: opts.depthAttr ? { USE_DEPTH_ATTR: "" } : {},
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  // UniformsUtils.merge clones the values (the arrays too): point the material and the ring list at the same objects
  material.uniforms.uRipple!.value = ripple;
  const liveRings = material.uniforms.uRipples!.value as Vector4[];
  let next = 0;
  let timeNow = 0;
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
