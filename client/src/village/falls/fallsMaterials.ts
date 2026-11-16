import {
  Color,
  DoubleSide,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type Material,
  type MeshBasicMaterial,
  type Texture,
} from "three";
import { createWaterMaterial, type SkyMapping } from "../villageWater";
import type { DayNightState } from "../dayNightBlend";
import { FALLS } from "./fallsConfig";

/**
 * The falls' materials (design 5.2). Every water surface is alpha-blended (never additive: the old falls were three
 * neon lines at night) and follows the time of day through `uTint` (the village water's tint) and, for the foam, the
 * warm ground lamps' glow (`uLamp`). All are ShaderMaterials with the scene's fog, tone mapping and colour space; their
 * per-frame inputs are the shared `fallsUniforms` (a few numbers: no array is touched per frame).
 *
 *  - plunge (`M_falls_water`): vertex colour R = air mixed in, G = speed, B = ragged edge. The flow texture is read at
 *    a coordinate that is constant along a falling parcel of water (its release time), so the pattern accelerates and
 *    stretches downward like water does, with no drift to build up.
 *  - cascade (`M_falls_cascade`): the upper stair water on the rock, a two-phase flow map: vertex colour RG = the flow
 *    direction in UV space (0.5 = none), B = a ledge's edge (white, splashing).
 *  - foam mound (`M_falls_foam`): a low heap of foam where the water lands, drifting texture and a wobble.
 *  - pool and outlet (`M_water`): the village's water shader (reflection, depth tint, glint) with falls rings, foam and
 *    the vertex-colour depth (0 = clear shallow rim .. 1 = deep emerald) patched in (`patchPool`).
 */

export const fallsUniforms = {
  uTime: { value: 0 },
  /** × the water's tint of the time of day (the village water's `waterTint`). */
  uTint: { value: new Vector3(1, 1, 1) },
  /** The warm ground lamps' light on the foam (0 by day). */
  uLamp: { value: 0 },
};

const LAMP_COLOR = new Color("#FFB46B");

const COMMON_VERTEX_HEAD = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec2 vUv;
varying vec3 vFalls;
varying vec3 vWorldPos;
varying vec3 vN;
`;

const PLUNGE_VERTEX = /* glsl */ `${COMMON_VERTEX_HEAD}
void main() {
  vUv = uv;
  vFalls = color.rgb;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWorldPos = wp.xyz;
  vN = normalize( mat3( modelMatrix ) * normal );
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG_HEAD = /* glsl */ `
uniform sampler2D uFlow;
uniform float uTime;
uniform vec3 uTint;
uniform float uLamp;
uniform vec3 uLampColor;
uniform float uOpacity;
uniform float uDetail;
#include <common>
#include <fog_pars_fragment>
varying vec2 vUv;
varying vec3 vFalls;
varying vec3 vWorldPos;
varying vec3 vN;
float fHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
`;

const FRAG_TAIL = /* glsl */ `
  col *= uTint * ( 1.0 - 0.25 * uLamp ); // at night the water sits back (no glowing ribbons)
  col += uLampColor * uLamp * lampLight;
  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const PLUNGE_FRAGMENT = /* glsl */ `${FRAG_HEAD}
void main() {
  float air = vFalls.r;
  float spd = vFalls.g;
  float edge = vFalls.b;
  float d = max( vUv.y * 4.0, 0.2 ); // metres fallen (v = distance / 4)
  float tau = sqrt( d / 4.905 );     // seconds since this water left the lip
  // The release time labels the parcel: the pattern rides the water down (accelerating, stretching).
  float qa = ( uTime - tau ) * 1.5;
  float qb = ( uTime - tau ) * 2.55 + 0.37;
  vec4 fa = texture2D( uFlow, vec2( vUv.x * 1.3, qa ) );
  vec4 fb = texture2D( uFlow, vec2( vUv.x * 2.1 + 0.37, qb ) );
  float n = mix( fa.r, 0.5 * ( fa.r + fb.g ), uDetail );
  float clump = mix( fa.b, 0.6 * fa.b + 0.4 * fb.b, uDetail );
  float e = smoothstep( 0.0, 0.24, vUv.x ) * smoothstep( 1.0, 0.76, vUv.x );
  // Streaks: the water is a bundle of ropes with gaps between them (the rock shows through); they thin out and break
  // up toward the bottom as air is mixed in.
  float dens = e * ( 0.2 + 1.15 * n ) - ( 1.0 - e ) * 0.25 * ( 0.4 + edge );
  float thr = mix( 0.1, 0.46, air );
  float a = smoothstep( thr, thr + 0.3, dens );
  float foam = clamp( pow( air, 1.2 ) * 1.2 + clump * air * 0.8 + edge * 0.2 * e, 0.0, 1.0 );
  vec3 water = vec3( 0.30, 0.58, 0.72 ) * ( 0.65 + 0.5 * n );
  vec3 col = mix( water, vec3( 0.97, 0.985, 1.0 ), foam * foam * ( 3.0 - 2.0 * foam ) );
  vec3 N = normalize( vN );
  vec3 V = normalize( cameraPosition - vWorldPos );
  float fr = pow( 1.0 - abs( dot( N, V ) ), 3.0 );
  col = mix( col, vec3( 0.55, 0.75, 0.95 ), fr * 0.3 );
  float alpha = a * mix( 0.78, 0.95, foam ) * uOpacity;
  float lampLight = foam * ( 1.0 - smoothstep( 0.0, 10.0, vWorldPos.y ) ) * 0.15;
${FRAG_TAIL}`;

const CASCADE_FRAGMENT = /* glsl */ `${FRAG_HEAD}
void main() {
  vec2 flow = vFalls.rg * 2.0 - 1.0;
  if ( dot( flow, flow ) < 0.01 ) flow = vec2( 0.0, 1.0 );
  flow = normalize( flow );
  float jitter = texture2D( uFlow, vUv * 0.37 ).r;
  float ph0 = fract( uTime * 0.5 + jitter );
  float ph1 = fract( uTime * 0.5 + jitter + 0.5 );
  float w0 = 1.0 - abs( 1.0 - 2.0 * ph0 );
  vec2 base = vUv * vec2( 1.5, 1.0 );
  vec4 t0 = texture2D( uFlow, base - flow * ph0 * 1.4 );
  vec4 t1 = texture2D( uFlow, base * 1.31 + 0.17 - flow * ph1 * 1.9 );
  float n = mix( t1.g, t0.r, w0 );
  float clump = mix( t1.b, t0.b, w0 );
  float ledge = vFalls.b;
  float e = smoothstep( 0.0, 0.16, vUv.x ) * smoothstep( 1.0, 0.84, vUv.x );
  float foam = clamp( clump * 0.55 + ledge * ( 0.5 + 0.7 * clump ) + ( 1.0 - e ) * 0.3, 0.0, 1.0 );
  vec3 water = vec3( 0.36, 0.62, 0.66 ) * ( 0.75 + 0.35 * n );
  vec3 col = mix( water, vec3( 0.95, 0.98, 1.0 ), foam );
  float alpha = ( 0.5 + 0.4 * n + 0.3 * foam ) * e * uOpacity;
  float lampLight = foam * 0.12;
${FRAG_TAIL}`;

const FOAM_VERTEX = /* glsl */ `${COMMON_VERTEX_HEAD}
uniform float uTime;
void main() {
  vUv = uv;
  vFalls = color.rgb;
  vec3 p = position;
  vec3 nrm = normal;
  // the heap heaves: a slow wobble along the normal, stronger where the vertex colour says "loose"
  p += nrm * 0.06 * sin( uTime * 2.3 + position.x * 3.1 + position.z * 2.7 ) * ( 0.4 + vFalls.r );
  vec4 wp = modelMatrix * vec4( p, 1.0 );
  vWorldPos = wp.xyz;
  vN = normalize( mat3( modelMatrix ) * normal );
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FOAM_FRAGMENT = /* glsl */ `${FRAG_HEAD}
void main() {
  vec4 fa = texture2D( uFlow, vWorldPos.xz * 0.35 + vec2( uTime * 0.05, uTime * 0.03 ) );
  vec4 fb = texture2D( uFlow, vWorldPos.xz * 0.62 - vec2( uTime * 0.04, 0.0 ) );
  float clump = 0.6 * fa.b + 0.4 * fb.b;
  float lace = 0.5 * ( fa.r + fb.g );
  float cover = clamp( 0.55 + 0.6 * vFalls.r, 0.0, 1.0 );
  float f = smoothstep( 1.0 - cover, 1.0 - cover + 0.3, clump * 0.7 + lace * 0.4 );
  vec3 col = vec3( 0.94, 0.97, 0.98 ) * ( 0.88 + 0.12 * lace );
  float alpha = f * 0.9 * uOpacity;
  float lampLight = f * 0.15;
${FRAG_TAIL}`;

function baseUniforms(flow: Texture, opacity: number, detail: boolean): Record<string, { value: unknown }> {
  return {
    uFlow: { value: flow },
    uOpacity: { value: opacity },
    uDetail: { value: detail ? 1 : 0 },
    uLampColor: { value: new Vector3(LAMP_COLOR.r, LAMP_COLOR.g, LAMP_COLOR.b) },
  };
}

/** Make the shared per-frame uniforms the material's own (the merge cloned them). */
function shareUniforms(m: ShaderMaterial, names: ReadonlyArray<keyof typeof fallsUniforms>): ShaderMaterial {
  for (const n of names) m.uniforms[n] = fallsUniforms[n];
  return m;
}

export interface FallsWaterOptions {
  flow: Texture;
  detail: boolean;
}

function waterShader(name: string, vertex: string, fragment: string, o: FallsWaterOptions, opacity: number): ShaderMaterial {
  const m = new ShaderMaterial({
    name,
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uTime: { value: 0 }, uTint: { value: new Vector3(1, 1, 1) }, uLamp: { value: 0 }, ...baseUniforms(o.flow, opacity, o.detail) }]),
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    vertexColors: true,
    fog: true,
  });
  m.uniforms.uFlow!.value = o.flow;
  return shareUniforms(m, ["uTime", "uTint", "uLamp"]);
}

export const createPlungeMaterial = (o: FallsWaterOptions): ShaderMaterial => waterShader("M_falls_water (runtime)", PLUNGE_VERTEX, PLUNGE_FRAGMENT, o, 1);
export const createCascadeMaterial = (o: FallsWaterOptions): ShaderMaterial => waterShader("M_falls_cascade (runtime)", PLUNGE_VERTEX, CASCADE_FRAGMENT, o, 1);
export const createFoamMaterial = (o: FallsWaterOptions): ShaderMaterial => waterShader("M_falls_foam (runtime)", FOAM_VERTEX, FOAM_FRAGMENT, o, 1);

// ───────────────────────────────────────────── the pool ─────────────────────────────────────────────

const POOL_PARS = /* glsl */ `uniform sampler2D uFlow;
uniform vec2 uImpact;
uniform vec2 uOutlet;
uniform vec3 uLampColor;
uniform float uLamp;
uniform float uFoamAmt;
varying float vFallsDepth;
void main() {`;

/** Rings spreading from where the water lands (two wave trains), added to the water's own slope. */
const POOL_RINGS = /* glsl */ `vec2 fallsQ = vWorldPos.xz - uImpact;
  float fallsR = length( fallsQ );
  vec2 fallsDir = fallsQ / max( fallsR, 1e-3 );
  float fallsAa = 1.0 - smoothstep( 0.012, 0.03, length( fwidth( vWorldPos.xz ) ) );
  float fallsEnv = exp( -fallsR / 4.5 ) * smoothstep( 0.0, 0.6, fallsR );
  float fallsEnv2 = exp( -fallsR / 8.0 ) * smoothstep( 0.0, 1.5, fallsR );
  vec2 extra = fallsDir * ( cos( fallsR * 9.0 - uTime * 4.2 ) * 0.24 * fallsEnv + cos( fallsR * 3.4 - uTime * 1.7 ) * 0.14 * fallsEnv2 ) * fallsAa;`;

/** The depth tint: the clear shallow rim (pebbles show through) to the emerald middle (#1E5A48 family). */
const POOL_BODY = /* glsl */ `vec3 body = mix( vec3( 0.22, 0.47, 0.36 ), vec3( 0.017, 0.12, 0.078 ), smoothstep( 0.05, 0.85, vFallsDepth ) ) * ( 0.8 + 0.2 * pow( cosT, 0.8 ) ) * ( 1.0 + 0.12 * ( g.x + g.y ) );`;

const POOL_ALPHA = /* glsl */ `float alpha = mix( uAlpha.x, uAlpha.y, F );
  alpha = mix( 0.34, alpha, smoothstep( 0.0, 0.55, vFallsDepth ) );`;

/** The foam heap under the fall and the streak the current drags toward the outlet. */
const POOL_FOAM = /* glsl */ `vec4 fallsFa = texture2D( uFlow, fallsQ * 0.28 - fallsDir * uTime * 0.06 );
  vec4 fallsFb = texture2D( uFlow, fallsQ * 0.5 + vec2( 0.3, 0.1 ) - fallsDir * uTime * 0.09 );
  float fallsClump = 0.6 * fallsFa.b + 0.4 * fallsFb.b;
  vec2 fallsAb = uOutlet - uImpact;
  float fallsT = clamp( dot( vWorldPos.xz - uImpact, fallsAb ) / max( dot( fallsAb, fallsAb ), 1e-3 ), 0.0, 1.0 );
  float fallsLine = length( vWorldPos.xz - ( uImpact + fallsAb * fallsT ) );
  float fallsCover = max( 1.0 - smoothstep( 1.0, 4.6, fallsR ), ( 1.0 - smoothstep( 0.3, 1.7, fallsLine ) ) * 0.55 * ( 1.0 - 0.5 * fallsT ) ) * uFoamAmt;
  float fallsFoam = smoothstep( 1.0 - fallsCover, 1.0 - fallsCover + 0.25, fallsClump * 0.75 + fallsFa.r * 0.3 ) * min( 1.0, fallsCover * 1.2 );
  col = mix( col, vec3( 0.86, 0.9, 0.9 ), fallsFoam * 0.9 );
  alpha = mix( alpha, 1.0, fallsFoam * 0.9 );
  float lampLight = fallsFoam * 0.15;
  col *= uTint * ( 1.0 - 0.25 * uLamp );
  col += uLampColor * uLamp * lampLight;`;

const POOL_VERTEX_HEAD = "varying float vFallsDepth;\nvoid main() {";

/** One replacement that must change the shader (a village water shader that moved would otherwise go unnoticed). */
function mustReplace(source: string, from: string, to: string): string {
  if (!source.includes(from)) throw new Error(`falls pool: the village water shader no longer contains: ${from.slice(0, 50)}`);
  return source.replace(from, to);
}

/** Patch the village water shader (vertex, fragment) into the pool's. Exported for the test. */
export function patchPool(vertex: string, fragment: string, outlet: boolean): { vertex: string; fragment: string } {
  let v = mustReplace(vertex, "void main() {", POOL_VERTEX_HEAD);
  v = mustReplace(v, "vUv = uv;", outlet ? "vUv = uv; vFallsDepth = 0.3;" : "vUv = uv; vFallsDepth = color.r;");
  let f = mustReplace(fragment, "void main() {", POOL_PARS);
  f = mustReplace(f, "vec2 extra = vec2( 0.0 );", outlet ? "vec2 extra = vec2( 0.0 ); vec2 fallsQ = vec2( 0.0 ); float fallsR = 0.0; vec2 fallsDir = vec2( 0.0 );" : POOL_RINGS);
  f = mustReplace(f, "vec3 body = mix( uDeep, shallow, pow( cosT, 0.8 ) ) * ( 1.0 + 0.12 * ( g.x + g.y ) );", POOL_BODY);
  f = mustReplace(f, "float alpha = mix( uAlpha.x, uAlpha.y, F );", POOL_ALPHA);
  f = mustReplace(f, "col *= uTint;", outlet ? "col *= uTint;" : POOL_FOAM);
  return { vertex: v, fragment: f };
}

export interface FallsPoolOptions {
  sky: Texture | null;
  skyMapping: SkyMapping;
  ripple: Texture;
  base: Texture;
  flow: Texture;
  detail: boolean;
  outlet?: boolean;
}

/** The pool's (or the outlet's) water: the village water shader, patched. */
export function createPoolMaterial(o: FallsPoolOptions): ShaderMaterial {
  const m = createWaterMaterial({ map: o.base, sky: o.sky, skyMapping: o.skyMapping, ripple: o.ripple, detail: o.detail, side: DoubleSide });
  const { vertex, fragment } = patchPool(m.vertexShader, m.fragmentShader, !!o.outlet);
  m.name = o.outlet ? "M_water (falls outlet)" : "M_water (falls pool)";
  m.vertexShader = vertex;
  m.fragmentShader = fragment;
  m.vertexColors = true;
  m.uniforms.uTime = fallsUniforms.uTime; // one clock for every falls surface
  m.uniforms.uFlow = { value: o.flow };
  m.uniforms.uImpact = { value: new Vector2(FALLS.impact.x, FALLS.impact.z) };
  const last = FALLS.outlet.points[0]!;
  m.uniforms.uOutlet = { value: new Vector2(last.x, last.z) };
  m.uniforms.uLampColor = { value: new Vector3(LAMP_COLOR.r, LAMP_COLOR.g, LAMP_COLOR.b) };
  m.uniforms.uLamp = fallsUniforms.uLamp;
  m.uniforms.uFoamAmt = { value: o.detail ? 1 : 0.85 };
  m.customProgramCacheKey = () => `falls-pool-${o.outlet ? "outlet" : "pool"}-${o.detail ? "hi" : "lo"}`;
  m.needsUpdate = true;
  return m;
}

/** The time of day on the pool: what the village water does (tint, glint) with the falls' own uniforms. */
export function fallsDayNight(s: DayNightState, pools: readonly ShaderMaterial[]): void {
  fallsUniforms.uTint.value.set(s.waterTint[0], s.waterTint[1], s.waterTint[2]);
  // the ground lamps come on with the village's lamps (night weight past 0.3)
  fallsUniforms.uLamp.value = s.lights;
  const level = Math.min(1, s.keyIntensity / 2.4);
  for (const w of pools) {
    (w.uniforms.uTint!.value as Vector3).set(s.waterTint[0], s.waterTint[1], s.waterTint[2]);
    (w.uniforms.uSunDir!.value as Vector3).set(s.keyDir[0], s.keyDir[1], s.keyDir[2]);
    (w.uniforms.uSunColor!.value as Vector3).set(s.keyColor[0] * level, s.keyColor[1] * level, s.keyColor[2] * level);
    (w.uniforms.uFountain!.value as Vector4).w = 0; // no fountain glow here
  }
}

// ───────────────────────────────────────────── the rock's light map ─────────────────────────────────────────────

export const rockUniforms = {
  uNight: { value: 0 },
  uNightMap: { value: null as Texture | null },
  uDayTint: { value: new Vector3(1, 1, 1) },
  uLift: { value: 0.2 },
  uLiftTint: { value: new Vector3(1, 1, 1) },
  uMoon: { value: new Vector3(0.55, 0.75, 1.2) },
};

const ROCK_PARS = /* glsl */ `uniform float uFallsNight;
uniform sampler2D uFallsNightMap;
uniform vec3 uFallsDayTint;
uniform float uFallsLift;
uniform vec3 uFallsLiftTint;
uniform vec3 uFallsMoon;
void main() {`;

/** The day map (x the dusk tint) and the night map (a moonlit cast), by the clock's weight; as the village's `liftMaterial`. */
const ROCK_TEXEL = /* glsl */ `vec4 lightMapTexel = vec4( 0.0, 0.0, 0.0, 1.0 );
	if ( uFallsNight < 0.999 ) lightMapTexel.rgb = texture2D( lightMap, vLightMapUv ).rgb * uFallsDayTint * ( 1.0 - uFallsNight );
	if ( uFallsNight > 0.001 ) {
		vec3 fallsNightLight = texture2D( uFallsNightMap, vLightMapUv ).rgb;
		fallsNightLight *= mix( uFallsMoon, vec3( 1.0 ), smoothstep( 0.04, 0.22, dot( fallsNightLight, vec3( 0.2126, 0.7152, 0.0722 ) ) ) );
		lightMapTexel.rgb += fallsNightLight * uFallsNight;
	}`;

/**
 * The rock's colour from its vertex colour masks (R moss on ledges and in cracks, G wet, B black streaks under the
 * channel), instead of multiplying the albedo by it.
 */
const ROCK_ALBEDO = /* glsl */ `vec3 fallsAlbedo = diffuseColor.rgb;
#ifdef USE_COLOR
  vec3 fallsMask = vColor.rgb;
#else
  vec3 fallsMask = vec3( 0.0 );
#endif
  fallsAlbedo = mix( fallsAlbedo, fallsAlbedo * vec3( 0.55, 0.78, 0.35 ) + vec3( 0.0, 0.03, 0.0 ), fallsMask.r * 0.8 );
  fallsAlbedo *= mix( 1.0, 0.45, fallsMask.g );
  fallsAlbedo *= 1.0 - 0.5 * fallsMask.b;
  diffuseColor.rgb = fallsAlbedo;`;

const ROCK_LIGHT = /* glsl */ `#ifdef USE_LIGHTMAP
  reflectedLight.indirectDiffuse += uFallsLift * uFallsLiftTint;
#endif
#include <aomap_fragment>`;

const LIGHTMAP_TEXEL_FROM = "vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );";

/**
 * A light-mapped rock/ground material of waterfall.glb: its own day/night blend (the falls' light maps are not the
 * village's, so the village's shared night-map uniform cannot be used) and the vertex colour masks. Idempotent.
 */
const rockPatched = new WeakSet<Material>();
export function rockMaterial(material: Material, masks = false): void {
  if (rockPatched.has(material)) return;
  rockPatched.add(material);
  const m = material as MeshBasicMaterial;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFallsNight = rockUniforms.uNight;
    shader.uniforms.uFallsNightMap = rockUniforms.uNightMap;
    shader.uniforms.uFallsDayTint = rockUniforms.uDayTint;
    shader.uniforms.uFallsLift = rockUniforms.uLift;
    shader.uniforms.uFallsLiftTint = rockUniforms.uLiftTint;
    shader.uniforms.uFallsMoon = rockUniforms.uMoon;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", ROCK_PARS)
      .replace(LIGHTMAP_TEXEL_FROM, ROCK_TEXEL)
      .replace("#include <color_fragment>", masks ? ROCK_ALBEDO : "#include <color_fragment>")
      .replace("#include <aomap_fragment>", ROCK_LIGHT);
  };
  m.customProgramCacheKey = () => (masks ? "falls-rock-masks" : "falls-rock");
  m.needsUpdate = true;
}

/** Per frame: the time of day into the rock's uniforms (number writes). */
export function rockDayNight(s: DayNightState): void {
  rockUniforms.uNight.value = rockUniforms.uNightMap.value ? s.night : 0;
  rockUniforms.uDayTint.value.set(s.dayTint[0], s.dayTint[1], s.dayTint[2]);
  rockUniforms.uLift.value = s.lift;
  rockUniforms.uLiftTint.value.set(s.liftTint[0], s.liftTint[1], s.liftTint[2]);
}

/** The shaders' source, for the test that checks the patches apply. */
export const SHADERS = { PLUNGE_FRAGMENT, CASCADE_FRAGMENT, FOAM_FRAGMENT, ROCK_TEXEL, ROCK_ALBEDO } as const;
