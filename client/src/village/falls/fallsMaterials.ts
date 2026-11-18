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
import { createWaterMaterial, SKY_AT_GLSL, WATER, type SkyMapping } from "../villageWater";
import { WHITE_WATER_LIGHT } from "../fountainWater";
import { wrapOmega } from "../fountainLayout";
import type { DayNightState } from "../dayNightBlend";
import { FALLS, MACRO_RECT } from "./fallsConfig";
import { GROUND_GRADE, GROUND_GRADE_NIGHT } from "../villageModelPrep";
import { SS_DAY_FUNCTION, SS_FRAGMENT_PARS, SS_MAIN_TOP, SS_VERTEX_PARS, SS_VERTEX_WORLD, bindSunShadowUniforms } from "../sunShadows";

/**
 * The falls' materials (design 5.2; W3 2026-11-16: "as real as the plaza fountain", owner). The falling water is drawn
 * the way the fountain's streams and curtains are (fountainWater.ts), scaled up to a 36 m fall:
 *
 *  - every water surface is alpha-blended (never additive: the old falls were three neon lines at night) and LIT like
 *    the fountain's water: a clear part is glass (it lets the rock behind through and adds the sky's reflection by
 *    Fresnel and the sun's glint), a white part is aerated water lit by the sky's light and the key light (thrown
 *    forward: bright against the sun), both from the time of day (`fallsDayNight`, the same numbers as the fountain's
 *    `fountainDayNight`); at night the two warm ground lamps light the white water near the pool.
 *  - plunge (`M_falls_water`): the pattern is sampled at the moment the water left the lip (`uTime - tau`, tau from the
 *    metres fallen), so it rides down at the water's own speed and stretches as it accelerates. Over the lip the sheet is
 *    smooth glass with one bright line where it bends over; it whitens with air as it falls, opens into strands that
 *    keep their place across the fall, and the strands break into drops above the pool; the rim is torn and see-through.
 *    W2's vertex colour: R air, G speed, B edge, A base opacity.
 *  - cascade (`M_falls_cascade`): the upper stair water on the rock, a two-phase flow map: vertex colour RG = the flow
 *    direction in UV space (0.5 = none), B = a ledge's brink (white, splashing), A = opacity.
 *  - foam heap (`M_falls_foam`): churning white water where the fall lands, flowing outward, heaving.
 *  - pool and outlet (`M_water`): the village's water shader (reflection, depth tint, glint) with the falls' rings, churn
 *    and foam, and W2's vertex colour depth (R) and opacity (A) patched in (`patchPool`).
 *
 * The clock is the fountain's wrapped one (`wrapTime`, 600 s): every rate here repeats over it, so nothing jumps.
 */

export const fallsUniforms = {
  uTime: { value: 0 },
  /** × the water's tint of the time of day (the village water's `waterTint`): the pool's. */
  uTint: { value: new Vector3(1, 1, 1) },
  /** The warm ground lamps' light (0 by day). */
  uLamp: { value: 0 },
  /** The light on white water (linear): the sky's (hemisphere) and the key's (sun or moon), its direction, its glint. */
  uAmbient: { value: new Vector3(0.4, 0.4, 0.4) },
  uKeyColor: { value: new Vector3(0.25, 0.23, 0.2) },
  uKeyDir: { value: new Vector3(0.6, 0.5, -0.3).normalize() },
  uGlintColor: { value: new Vector3(0.5, 0.48, 0.42) },
  /** The sky texture for reflections (the village dome's), its mapping, and the land colour near the horizon. */
  uSky: { value: null as Texture | null },
  uSkyMap: { value: new Vector4(1, 0, 1, 0) },
  uLand: { value: new Color(WATER.land) },
  /** The fountain's noise (fountainWater.ts makeFountainNoise): R soft, G finer, B foam lace, A fine. */
  uNoise: { value: null as Texture | null },
};

/** How much brighter the falls' white water is lit than the fountain's (a big sheet seen from far). */
export const FALLS_WHITE_GAIN = 1.25;

const LAMP_COLOR = new Color("#FFB46B");

const f6 = (x: number) => x.toFixed(6);

/** Lighting shared by the falls' water (as the fountain's COMMON): white water and the forward throw of the drops. */
export const FALLS_LIGHT_GLSL = /* glsl */ `
uniform vec3 uAmbient;
uniform vec3 uKeyColor;
uniform vec3 uKeyDir;
uniform vec3 uGlintColor;
uniform vec3 uLampColor;
uniform float uLamp;
float flForward( float c ) {
  float d = 1.0 + 0.36 - 1.2 * c;
  return 0.64 / ( d * sqrt( d ) );
}
vec3 flWhite( vec3 V, float forward ) {
  float hg = min( flForward( dot( -uKeyDir, V ) ), 3.0 );
  return ( uAmbient + uKeyColor * ( 0.4 + 0.6 * mix( 1.0, hg, forward ) ) ) * ${f6(FALLS_WHITE_GAIN)};
}
// The two warm ground lamps on the slabs (night): a gentle light on white water, strongest at the foot, gone 10 m up.
vec3 flLamp( vec3 p ) {
  float near = 1.0 - smoothstep( 0.0, 10.0, p.y - ${f6(FALLS.pool.waterY)} );
  return uLampColor * uLamp * near * near * 0.3;
}
// White water by the lamps (W6): the lamp's warm light takes the place of the moonlit blue near them instead of being
// added to it (blue + orange read as a purple glow at the foot of the falls); higher up the moon's blue stays.
vec3 flWarm( vec3 base, vec3 p, float k ) {
  vec3 lamp = flLamp( p ) * k;
  float w = uLamp * ( 1.0 - smoothstep( 0.0, 12.0, p.y - ${f6(FALLS.pool.waterY)} ) ) * 0.9;
  float l = dot( base, vec3( 0.2126, 0.7152, 0.0722 ) );
  return mix( base, vec3( l ), w * 0.85 ) + lamp;
}
`;

const COMMON_VERTEX_HEAD = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec2 vUv;
varying vec4 vFalls;
varying vec3 vWorldPos;
varying vec3 vN;
`;

/** Vertex colour as RGBA (W2 writes A); 1 when the mesh has none. */
const READ_COLOR = /* glsl */ `
#if defined( USE_COLOR_ALPHA )
  vFalls = color;
#elif defined( USE_COLOR )
  vFalls = vec4( color, 1.0 );
#else
  vFalls = vec4( 0.0, 0.0, 0.0, 1.0 );
#endif
`;

const PLUNGE_VERTEX = /* glsl */ `${COMMON_VERTEX_HEAD}
uniform float uTime;
void main() {
  vUv = uv;
  ${READ_COLOR}
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  // the sheet breathes: a slow sideways sway and a flutter that grows downward (more at the torn rim)
  float h = max( ${f6(FALLS.lip.y)} - wp.y, 0.0 );
  float sway = sin( ${f6(wrapOmega(0.9))} * uTime - h * 0.21 ) + 0.5 * sin( ${f6(wrapOmega(2.3))} * uTime - h * 0.53 + wp.z );
  wp.z += sway * 0.05 * smoothstep( 2.0, 30.0, h ) * ( 1.0 + 2.0 * vFalls.b );
  wp.x += sin( ${f6(wrapOmega(3.1))} * uTime - h * 0.8 + wp.z * 1.7 ) * 0.04 * smoothstep( 4.0, 30.0, h );
  vWorldPos = wp.xyz;
  vN = normalize( mat3( modelMatrix ) * normal );
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SIMPLE_VERTEX = /* glsl */ `${COMMON_VERTEX_HEAD}
void main() {
  vUv = uv;
  ${READ_COLOR}
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWorldPos = wp.xyz;
  vN = normalize( mat3( modelMatrix ) * normal );
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG_HEAD = /* glsl */ `
uniform sampler2D uNoise;
uniform sampler2D uSky;
uniform vec4 uSkyMap;
uniform vec3 uLand;
uniform float uTime;
uniform float uOpacity;
uniform float uDetail;
#include <common>
#include <fog_pars_fragment>
${FALLS_LIGHT_GLSL}
${SKY_AT_GLSL}
varying vec2 vUv;
varying vec4 vFalls;
varying vec3 vWorldPos;
varying vec3 vN;
`;

const FRAG_TAIL = /* glsl */ `
  gl_FragColor = vec4( col, clamp( alpha, 0.0, 1.0 ) );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Metres from the lip to the pool's surface. */
const FALL_H = FALLS.lip.y - FALLS.pool.waterY;

const PLUNGE_FRAGMENT = /* glsl */ `${FRAG_HEAD}
void main() {
  float air = vFalls.r;
  float edge = vFalls.b;
  float h = max( ${f6(FALLS.lip.y)} - vWorldPos.y, 0.0 ); // metres fallen
  float s = clamp( h / ${f6(FALL_H)}, 0.0, 1.0 );          // 0 at the lip .. 1 at the pool
  float tau = sqrt( h / 4.905 + 0.0025 );                  // seconds since this water left the lip
  float tl = uTime - tau;                                   // when it left: the pattern rides with the water
  // metres across the fall (it faces east), meandering a little with height so the ropes are never ruler-straight
  float across = vWorldPos.z + ( texture2D( uNoise, vec2( vWorldPos.z * 0.09, h * 0.03 ) ).r - 0.5 ) * 0.45;
  // Strands: a pattern across the flow that drifts only slowly, so each strand keeps its place as it falls.
  float sA = texture2D( uNoise, vec2( across * 0.43 + 0.17, tl * 0.05 ) ).r;
  float sB = texture2D( uNoise, vec2( across * 1.31 + 0.61, tl * 0.11 ) ).g;
  float strands = sA * 0.6 + sB * 0.4;
  // Grain down the flow (the sheet's ripples, the white "rockets" of air): moves at the water's speed, stretches as it falls.
  float g1 = texture2D( uNoise, vec2( across * 2.1, tl * 1.6 ) ).a;
  float g2 = texture2D( uNoise, vec2( across * 0.9 + 0.5, tl * 0.7 ) ).g;
  float g3 = texture2D( uNoise, vec2( across * 4.7 + 0.2, tl * 3.1 ) ).r;
  float grain = g1 * 0.5 + g2 * 0.35 + g3 * 0.15 * uDetail + 0.075 * ( 1.0 - uDetail );
  // Air: the art's (R) and the fall's own (it whitens within the first few metres), heavier where the grain is.
  float aer = clamp( max( air, smoothstep( 0.4, 7.0, h ) * ( 0.75 + 0.35 * grain ) ), 0.0, 1.0 );
  // The sheet opens into strands as it falls (gaps between them widen; the strands keep their width) ...
  float tear = smoothstep( 0.3, 0.9, s ) * ( 0.55 + 0.45 * air ) + 0.35 * edge * smoothstep( 0.1, 0.5, s );
  float open = smoothstep( 0.42 * tear, 0.42 * tear + 0.09, strands + 0.08 * grain );
  // ... and the strands' ends break into drops above the pool.
  float dropsN = texture2D( uNoise, vec2( across * 5.3 + 0.21, tl * 6.0 ) ).a;
  float strand = open * mix( 1.0, smoothstep( 0.32, 0.58, dropsN ), smoothstep( 0.8, 1.0, s ) * ( 0.6 + 0.4 * edge ) );
  // The light: a glass sheet (sky by Fresnel, the sun's glint) whose grain bends the normal ...
  vec3 V = normalize( cameraPosition - vWorldPos );
  vec3 n = normalize( vN + vec3( 0.0, 1.0, 0.0 ) * ( g1 - 0.5 ) * 0.5 + vec3( 0.0, 0.0, 1.0 ) * ( g2 - 0.5 ) * 0.6 );
  if ( dot( n, V ) < 0.0 ) n = -n;
  float cosT = clamp( dot( n, V ), 0.0, 1.0 );
  float F = 0.02 + 0.98 * pow( 1.0 - cosT, 5.0 );
  vec3 R = reflect( -V, n );
  vec3 refl = skyAt( R ) * 0.9 + uGlintColor * pow( max( dot( R, uKeyDir ), 0.0 ), 300.0 ) * 5.0;
  // the lip: the water bulges over it and catches the sky in one bright line
  float lip = smoothstep( 0.05, 0.3, h ) * ( 1.0 - smoothstep( 0.3, 1.0, h ) );
  float glassA = ( 0.16 + 0.7 * F + 0.22 * lip + 0.14 * grain ) * ( 1.0 - 0.85 * aer );
  // ... and aerated white water: dense white ropes (the strands' cores and the "rockets" of air racing down them) with
  // thin, see-through water between them, shaded so the ropes stand out (their flanks and the gaps are darker).
  float core = smoothstep( 0.32, 0.72, strands + 0.12 * ( g2 - 0.5 ) );
  // clumps of white water racing down (cells of the foam lace, stretched by the fall's speed), the fine grain only shades
  float clumpA = texture2D( uNoise, vec2( across * 0.8 + 0.37, tl * 1.2 ) ).b;
  float clumpB = texture2D( uNoise, vec2( across * 1.9 + 0.11, tl * 2.0 ) ).b;
  float rocket = smoothstep( 0.15, 0.75, mix( clumpA, 0.6 * clumpA + 0.4 * clumpB, uDetail ) + 0.25 * ( g1 - 0.5 ) );
  float whiteA = aer * mix( 0.22, 1.0, core ) * ( 0.45 + 0.55 * rocket ) * smoothstep( 0.15, 0.5, strands + 0.3 * aer )
    + 0.06 * ( 1.0 - aer );
  float shade = ( 0.6 + 0.45 * core * ( 0.5 + 0.5 * rocket ) ) * ( 0.94 + 0.12 * g3 );
  vec3 white = flWarm( flWhite( V, 0.6 ) * shade, vWorldPos, 1.3 * shade );
  refl += flLamp( vWorldPos ) * 0.25;
  float a = whiteA + glassA * ( 1.0 - whiteA );
  vec3 col = ( white * whiteA + refl * glassA * ( 1.0 - whiteA ) ) / max( a, 1e-3 );
  // the torn rim: ragged, thinner and see-through
  float ru = vUv.x + ( g2 - 0.5 ) * 0.16 + ( sB - 0.5 ) * 0.1;
  float rim = smoothstep( 0.0, 0.22, ru ) * smoothstep( 1.0, 0.78, ru );
  a *= strand * mix( 0.2 + 0.8 * core, 1.0, rim ) * ( 1.0 - 0.45 * edge );
  // into the water it lands in; over the lip it grows out of the cascade's water (no flat cap where the two skins meet)
  a *= smoothstep( 0.0, 0.25, vWorldPos.y - ${f6(FALLS.pool.waterY)} ) * smoothstep( 0.0, 0.35, h );
  float alpha = a * vFalls.a * uOpacity;
${FRAG_TAIL}`;

const CASCADE_FRAGMENT = /* glsl */ `${FRAG_HEAD}
void main() {
  vec2 flow = vFalls.rg * 2.0 - 1.0;
  float speed = clamp( length( flow ), 0.15, 1.0 );
  if ( dot( flow, flow ) < 0.01 ) flow = vec2( 0.0, 1.0 );
  flow = normalize( flow );
  float jitter = texture2D( uNoise, vUv * 0.37 ).r;
  float ph0 = fract( uTime * 0.6 + jitter );
  float ph1 = fract( uTime * 0.6 + jitter + 0.5 );
  float w0 = 1.0 - abs( 1.0 - 2.0 * ph0 );
  vec2 base = vUv * vec2( 3.0, 1.2 );
  vec4 t0 = texture2D( uNoise, base - flow * ph0 * 1.6 * speed );
  vec4 t1 = texture2D( uNoise, base * 1.31 + 0.17 - flow * ph1 * 1.6 * speed );
  float n = mix( t1.g, t0.r, w0 );
  float lace = mix( t1.b, t0.b, w0 );
  float ledge = vFalls.b;
  // white where it is fast or leaves a tread, glassy where it slides slowly over a shelf
  float aer = clamp( 0.45 + 0.5 * speed + ledge * 0.8, 0.0, 1.0 );
  float whiteA = aer * smoothstep( 0.2, 0.7, n * 0.7 + ( 1.0 - lace ) * 0.45 ) * ( 0.7 + 0.3 * ledge );
  vec3 V = normalize( cameraPosition - vWorldPos );
  vec3 nn = normalize( vN + vec3( 0.0, 1.0, 0.0 ) * ( n - 0.5 ) * 0.6 );
  if ( dot( nn, V ) < 0.0 ) nn = -nn;
  float F = 0.02 + 0.98 * pow( 1.0 - clamp( dot( nn, V ), 0.0, 1.0 ), 5.0 );
  vec3 R = reflect( -V, nn );
  vec3 refl = skyAt( R ) * 0.85 + uGlintColor * pow( max( dot( R, uKeyDir ), 0.0 ), 200.0 ) * 4.0;
  float glassA = ( 0.18 + 0.7 * F ) * ( 1.0 - 0.6 * aer );
  vec3 white = flWarm( flWhite( V, 0.5 ) * ( 0.7 + 0.45 * n ), vWorldPos, 1.0 );
  float a = whiteA + glassA * ( 1.0 - whiteA );
  vec3 col = ( white * whiteA + refl * glassA * ( 1.0 - whiteA ) ) / max( a, 1e-3 );
  // the film's sides: torn, see-through
  float cu = vUv.x + ( n - 0.5 ) * 0.18;
  a *= smoothstep( 0.0, 0.2, cu ) * smoothstep( 1.0, 0.8, cu );
  float alpha = a * vFalls.a * uOpacity;
${FRAG_TAIL}`;

const FOAM_VERTEX = /* glsl */ `${COMMON_VERTEX_HEAD}
uniform float uTime;
void main() {
  vUv = uv;
  ${READ_COLOR}
  vec3 p = position;
  // the heap heaves: boils rising and sinking, stronger in the middle (vertex colour R = density, B = lump)
  float boil = sin( ${f6(wrapOmega(2.3))} * uTime + position.x * 3.1 + position.z * 2.7 )
    + 0.6 * sin( ${f6(wrapOmega(3.7))} * uTime - position.x * 1.7 + position.z * 4.1 );
  p.y += 0.06 * boil * ( 0.4 + vFalls.r ) * ( 0.5 + vFalls.b );
  vec4 wp = modelMatrix * vec4( p, 1.0 );
  vWorldPos = wp.xyz;
  vN = normalize( mat3( modelMatrix ) * normal );
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FOAM_FRAGMENT = /* glsl */ `${FRAG_HEAD}
uniform vec2 uImpact;
void main() {
  vec2 q = vWorldPos.xz - uImpact;
  float r = length( q );
  vec2 dir = q / max( r, 1e-3 );
  // the foam runs outward from where the water lands and boils in place
  vec4 fa = texture2D( uNoise, q * 0.22 - dir * uTime * 0.3 );
  vec4 fb = texture2D( uNoise, q * 0.47 + vec2( 0.31, 0.17 ) - dir * uTime * 0.45 );
  vec4 fc = texture2D( uNoise, q * 0.9 + vec2( uTime * 0.1, -uTime * 0.05 ) );
  float lace = 0.55 * fa.b + 0.45 * fb.b;
  float n = 0.5 * ( fa.r + fb.g );
  float cover = clamp( vFalls.r * ( 0.7 + 0.35 * n ) * ( 1.0 - smoothstep( 1.5, 4.0, r ) * 0.6 ) + 0.1 * fc.a, 0.0, 1.0 );
  float fo = smoothstep( 1.0 - cover, 1.0 - cover + 0.2, lace * 0.6 + n * 0.5 );
  vec3 V = normalize( cameraPosition - vWorldPos );
  vec3 col = flWarm( flWhite( V, 0.3 ) * ( 0.72 + 0.3 * n ), vWorldPos, 0.8 );
  float alpha = fo * vFalls.a * 0.95 * uOpacity;
${FRAG_TAIL}`;

function baseUniforms(opacity: number, detail: boolean): Record<string, { value: unknown }> {
  return {
    uOpacity: { value: opacity },
    uDetail: { value: detail ? 1 : 0 },
    uLampColor: { value: new Vector3(LAMP_COLOR.r, LAMP_COLOR.g, LAMP_COLOR.b) },
  };
}

const SHARED = ["uTime", "uLamp", "uAmbient", "uKeyColor", "uKeyDir", "uGlintColor", "uSky", "uSkyMap", "uLand", "uNoise"] as const;

/** Make the shared per-frame uniforms the material's own (the merge cloned them). */
export function shareUniforms(m: ShaderMaterial, names: ReadonlyArray<keyof typeof fallsUniforms> = SHARED): ShaderMaterial {
  for (const n of names) m.uniforms[n] = fallsUniforms[n];
  return m;
}

export interface FallsWaterOptions {
  detail: boolean;
}

function waterShader(name: string, vertex: string, fragment: string, o: FallsWaterOptions, opacity: number): ShaderMaterial {
  const m = new ShaderMaterial({
    name,
    uniforms: UniformsUtils.merge([UniformsLib.fog, baseUniforms(opacity, o.detail)]),
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    vertexColors: true,
    fog: true,
  });
  m.forceSinglePass = true;
  return shareUniforms(m);
}

export const createPlungeMaterial = (o: FallsWaterOptions): ShaderMaterial => waterShader("M_falls_water (runtime)", PLUNGE_VERTEX, PLUNGE_FRAGMENT, o, 1);
export const createCascadeMaterial = (o: FallsWaterOptions): ShaderMaterial => waterShader("M_falls_cascade (runtime)", SIMPLE_VERTEX, CASCADE_FRAGMENT, o, 1);
export function createFoamMaterial(o: FallsWaterOptions): ShaderMaterial {
  const m = waterShader("M_falls_foam (runtime)", FOAM_VERTEX, FOAM_FRAGMENT, o, 1);
  m.uniforms.uImpact = { value: new Vector2(FALLS.impact.x, FALLS.impact.z) };
  return m;
}

// ───────────────────────────────────────────── the pool ─────────────────────────────────────────────

const POOL_PARS = /* glsl */ `uniform sampler2D uNoise;
uniform vec2 uImpact;
uniform vec2 uOutlet;
uniform vec3 uLampColor;
uniform float uLamp;
uniform float uFoamAmt;
varying float vFallsDepth;
varying float vFallsAlpha;
void main() {`;

/** Rings spreading from where the water lands (two wave trains) and the churn of the landing, added to the water's slope. */
const POOL_RINGS = /* glsl */ `vec2 fallsQ = vWorldPos.xz - uImpact;
  float fallsR = length( fallsQ );
  vec2 fallsDir = fallsQ / max( fallsR, 1e-3 );
  float fallsAa = 1.0 - smoothstep( 0.012, 0.03, length( fwidth( vWorldPos.xz ) ) );
  float fallsEnv = exp( -fallsR / 4.5 ) * smoothstep( 0.0, 0.6, fallsR );
  float fallsEnv2 = exp( -fallsR / 8.0 ) * smoothstep( 0.0, 1.5, fallsR );
  vec2 fallsChurn = ( texture2D( uNoise, fallsQ * 0.35 + vec2( uTime * 0.21, -uTime * 0.13 ) ).xy - 0.5 ) * 0.9 * exp( -fallsR / 2.5 );
  vec2 extra = fallsDir * ( cos( fallsR * 9.0 - uTime * ${f6(wrapOmega(4.2))} ) * 0.24 * fallsEnv + cos( fallsR * 3.4 - uTime * ${f6(wrapOmega(1.7))} ) * 0.14 * fallsEnv2 ) * fallsAa + fallsChurn;`;

/** The depth tint: the clear shallow rim (pebbles show through) to the dark olive-teal middle (W2's colours). */
const POOL_BODY = /* glsl */ `vec3 body = mix( vec3( 0.16, 0.30, 0.19 ), vec3( 0.03, 0.13, 0.13 ), sqrt( clamp( vFallsDepth, 0.0, 1.0 ) ) ) * ( 0.8 + 0.2 * pow( cosT, 0.8 ) ) * ( 1.0 + 0.12 * ( g.x + g.y ) );`;

/** W2's opacity (A: 0.12 at the rim, pebbles visible, .. 0.95 once ~0.65 m deep), raised by the reflection at grazing angles. */
const POOL_ALPHA = /* glsl */ `float alpha = mix( vFallsAlpha, 1.0, F * 0.7 );`;

/** The foam where the fall lands and the streak the current drags toward the outlet. */
const POOL_FOAM = /* glsl */ `vec4 fallsFa = texture2D( uNoise, fallsQ * 0.16 - fallsDir * uTime * 0.12 );
  vec4 fallsFb = texture2D( uNoise, fallsQ * 0.34 + vec2( 0.3, 0.1 ) - fallsDir * uTime * 0.18 );
  float fallsClump = 0.55 * fallsFa.b + 0.45 * fallsFb.b;
  vec2 fallsAb = uOutlet - uImpact;
  float fallsT = clamp( dot( vWorldPos.xz - uImpact, fallsAb ) / max( dot( fallsAb, fallsAb ), 1e-3 ), 0.0, 1.0 );
  float fallsLine = length( vWorldPos.xz - ( uImpact + fallsAb * fallsT ) );
  float fallsCover = max( 1.0 - smoothstep( 0.6, 3.6, fallsR ), ( 1.0 - smoothstep( 0.3, 1.4, fallsLine ) ) * 0.4 * ( 1.0 - 0.6 * fallsT ) ) * uFoamAmt;
  float fallsFoam = smoothstep( 1.0 - fallsCover, 1.0 - fallsCover + 0.25, fallsClump * 0.7 + fallsFa.r * 0.35 ) * min( 1.0, fallsCover * 1.2 );
  col *= uTint;
  col = mix( col, vec3( 0.78, 0.82, 0.82 ) * uTint + uLampColor * uLamp * 0.08, fallsFoam * 0.8 );
  alpha = mix( alpha, 1.0, fallsFoam * 0.8 );`;

/**
 * The outlet's southern end (z -58, where the village's feeder stream takes over) ends in a straight cut; the water thins out over its
 * last 1.5 m, and the feeder thins in over its first 2 m (villageWater.ts, CREEK), so the two overlap as one stream running out of the
 * pool over the gravel instead of two surfaces butted at a line.
 */
const OUTLET_END = /* glsl */ `col *= uTint;
  alpha *= 1.0 - smoothstep( ${f6(FALLS.site.maxZ - 1.6)}, ${f6(FALLS.site.maxZ - 0.1)}, vWorldPos.z );`;

const POOL_VERTEX_HEAD ="varying float vFallsDepth;\nvarying float vFallsAlpha;\nvoid main() {";

/** One replacement that must change the shader (a village water shader that moved would otherwise go unnoticed). */
function mustReplace(source: string, from: string, to: string): string {
  if (!source.includes(from)) throw new Error(`falls pool: the village water shader no longer contains: ${from.slice(0, 50)}`);
  return source.replace(from, to);
}

const POOL_COLOR_READ = /* glsl */ `vUv = uv;
#if defined( USE_COLOR_ALPHA )
  vFallsDepth = color.r; vFallsAlpha = color.a;
#elif defined( USE_COLOR )
  vFallsDepth = color.r; vFallsAlpha = mix( 0.3, 0.95, smoothstep( 0.0, 0.3, color.r ) );
#else
  vFallsDepth = 0.6; vFallsAlpha = 0.9;
#endif`;

/** Patch the village water shader (vertex, fragment) into the pool's. Exported for the test. */
export function patchPool(vertex: string, fragment: string, outlet: boolean): { vertex: string; fragment: string } {
  let v = mustReplace(vertex, "void main() {", POOL_VERTEX_HEAD);
  v = mustReplace(v, "vUv = uv;", outlet ? "vUv = uv; vFallsDepth = 0.3; vFallsAlpha = 0.85;" : POOL_COLOR_READ);
  let f = mustReplace(fragment, "void main() {", POOL_PARS);
  f = mustReplace(f, "vec2 extra = vec2( 0.0 );", outlet ? "vec2 extra = vec2( 0.0 ); vec2 fallsQ = vec2( 0.0 ); float fallsR = 0.0; vec2 fallsDir = vec2( 0.0 );" : POOL_RINGS);
  f = mustReplace(f, "vec3 body = mix( uDeep, shallow, pow( cosT, 0.8 ) ) * ( 1.0 + 0.12 * ( g.x + g.y ) );", POOL_BODY);
  f = mustReplace(f, "float alpha = mix( uAlpha.x, uAlpha.y, F );", POOL_ALPHA);
  f = mustReplace(f, "col *= uTint;", outlet ? OUTLET_END : POOL_FOAM);
  return { vertex: v, fragment: f };
}

export interface FallsPoolOptions {
  sky: Texture | null;
  skyMapping: SkyMapping;
  ripple: Texture;
  base: Texture;
  noise: Texture;
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
  m.uniforms.uNoise = { value: o.noise };
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

/** The time of day on the falls' water: the white water's light (the fountain's numbers), the pool's tint and glint. */
export function fallsDayNight(s: DayNightState, pools: readonly ShaderMaterial[]): void {
  fallsUniforms.uTint.value.set(s.waterTint[0], s.waterTint[1], s.waterTint[2]);
  // the ground lamps come on with the village's lamps (night weight past 0.3)
  fallsUniforms.uLamp.value = s.lights;
  const a = s.hemiIntensity * WHITE_WATER_LIGHT.ambient;
  fallsUniforms.uAmbient.value.set(s.hemiSky[0] * a, s.hemiSky[1] * a, s.hemiSky[2] * a);
  const k = s.keyIntensity * WHITE_WATER_LIGHT.key;
  fallsUniforms.uKeyColor.value.set(s.keyColor[0] * k, s.keyColor[1] * k, s.keyColor[2] * k);
  fallsUniforms.uKeyDir.value.set(s.keyDir[0], s.keyDir[1], s.keyDir[2]);
  const level = Math.min(1, s.keyIntensity / 2.4);
  const glint = level * WHITE_WATER_LIGHT.glint;
  fallsUniforms.uGlintColor.value.set(s.keyColor[0] * glint, s.keyColor[1] * glint, s.keyColor[2] * glint);
  for (const w of pools) {
    (w.uniforms.uTint!.value as Vector3).set(s.waterTint[0], s.waterTint[1], s.waterTint[2]);
    (w.uniforms.uSunDir!.value as Vector3).set(s.keyDir[0], s.keyDir[1], s.keyDir[2]);
    (w.uniforms.uSunColor!.value as Vector3).set(s.keyColor[0] * level, s.keyColor[1] * level, s.keyColor[2] * level);
    (w.uniforms.uFountain!.value as Vector4).w = 0; // no fountain glow here
  }
}

/** The sky for the falls' reflections (the village dome's texture and mapping) and the noise, once at dressing. */
export function setFallsSky(sky: Texture | null, mapping: SkyMapping, noise: Texture): void {
  fallsUniforms.uSky.value = sky;
  fallsUniforms.uSkyMap.value.set(mapping.uSign, mapping.uOffset, mapping.vScale, mapping.vOffset);
  fallsUniforms.uNoise.value = noise;
}

// ───────────────────────────────────────────── the rock's light map ─────────────────────────────────────────────

/**
 * Where the falls ground meets the village's lawn (W6): the box's east side and the north / south sides east of x -112
 * (west of it the village's side is the wooded backdrop). Over SEAM_FADE m the ground's albedo goes to the lawn's
 * colour (a little world-space variation; the same for the gravel and the turf, so their stepped border goes under
 * it), so the seam reads as lawn running into the forest floor and gravel, not as a dark olive strip along a straight
 * line. Linear RGB: T_grass's mean (0.097, 0.177, 0.029) x 1.38 (the falls light map is darker there: matched by eye on the seam); x the
 * lawn's grade of the time of day (villageModelPrep GROUND_GRADE / GROUND_GRADE_NIGHT), as the village's own lawn.
 */
export const SEAM_GRASS: readonly [number, number, number] = [0.136, 0.245, 0.04];
export const SEAM_FADE = 3.0;
/**
 * The ground materials' mean albedo luminance (linear, their texture's mean x W1's vertex tint ~0.8): the seam keeps
 * each one's grain as a ratio to it. T_falls_gravel (0.183, 0.167, 0.131), T_falls_turf (0.085, 0.085, 0.027).
 */
export const SEAM_MEAN = { ground: 0.134, turf: 0.066 } as const;
const LAWN_DAY = GROUND_GRADE.LM_grass!;
const LAWN_NIGHT = GROUND_GRADE_NIGHT.LM_grass!;
const SEAM_GLSL = /* glsl */ `#ifdef FALLS_SEAM
  float fsE = ${f6(FALLS.site.maxX)} - vFallsWorld.x;
  float fsN = vFallsWorld.z - ${f6(FALLS.site.minZ)};
  float fsS = ${f6(FALLS.site.maxZ)} - vFallsWorld.z;
  float fsX = smoothstep( -114.0, -110.5, vFallsWorld.x );
  float fsW = max( 1.0 - smoothstep( 0.0, ${f6(SEAM_FADE)}, fsE ), max( 1.0 - smoothstep( 0.0, ${f6(SEAM_FADE)}, fsN ), 1.0 - smoothstep( 0.0, ${f6(SEAM_FADE)}, fsS ) ) * fsX );
  vec2 fsQ = vFallsWorld.xz * vec2( 0.37, 0.41 );
  float fsV = 0.9 + 0.1 * sin( fsQ.x * 2.1 + sin( fsQ.y * 1.7 ) ) + 0.05 * sin( fsQ.y * 5.3 + fsQ.x * 3.1 );
  // the texture's own grain, as a ratio to this material's mean (gravel and turf then give the same lawn)
  float fsD = clamp( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) / uFallsSeamMean, 0.45, 1.7 );
  diffuseColor.rgb = mix( diffuseColor.rgb, uFallsGrass * fsV * mix( 1.0, fsD, 0.7 ), fsW );
#endif`;

export const rockUniforms = {
  uNight: { value: 0 },
  uNightMap: { value: null as Texture | null },
  uDayTint: { value: new Vector3(1, 1, 1) },
  uLift: { value: 0.2 },
  uLiftTint: { value: new Vector3(1, 1, 1) },
  uMoon: { value: new Vector3(0.55, 0.75, 1.2) },
  /** The macro map's rectangle: (z0, z span, y0, y span) in world metres (W1's UV2, computed here from the position). */
  uMacroRect: { value: new Vector4(MACRO_RECT.z0, MACRO_RECT.z1 - MACRO_RECT.z0, MACRO_RECT.y0, MACRO_RECT.y1 - MACRO_RECT.y0) },
  /** The village lawn's colour the falls ground fades to at the seam (W6, `SEAM_GRASS`). */
  uGrass: { value: new Vector3(SEAM_GRASS[0] * LAWN_DAY[0], SEAM_GRASS[1] * LAWN_DAY[1], SEAM_GRASS[2] * LAWN_DAY[2]) },
};

const ROCK_PARS = /* glsl */ `uniform float uFallsNight;
uniform sampler2D uFallsNightMap;
uniform vec3 uFallsDayTint;
uniform float uFallsLift;
uniform vec3 uFallsLiftTint;
uniform vec3 uFallsMoon;
#if defined( FALLS_MACRO ) || defined( FALLS_SEAM )
varying vec3 vFallsWorld;
#endif
#ifdef FALLS_MACRO
uniform sampler2D uFallsMacro;
uniform vec4 uFallsMacroRect;
#endif
#ifdef FALLS_SEAM
uniform vec3 uFallsGrass;
uniform float uFallsSeamMean;
#endif
void main() {`;

/**
 * The day map (x the dusk tint) and the night map (a moonlit cast), by the clock's weight; as the village's `liftMaterial`.
 * The live sun shadows (sunShadows.ts, release 2) as on any model with its own bake (`SS_FOREIGN_BAKE`): the baked sun stays,
 * the live shadows (the players', the village's casters) take a share of the light, the exposure's sun adaptation is undone.
 */
const ROCK_TEXEL = /* glsl */ `vec4 lightMapTexel = vec4( 0.0, 0.0, 0.0, 1.0 );
	if ( uFallsNight < 0.999 ) lightMapTexel.rgb = ssDay( texture2D( lightMap, vLightMapUv ).rgb, vLightMapUv ) * uFallsDayTint * ( 1.0 - uFallsNight );
	if ( uFallsNight > 0.001 ) {
		vec3 fallsNightLight = texture2D( uFallsNightMap, vLightMapUv ).rgb;
		fallsNightLight *= mix( uFallsMoon, vec3( 1.0 ), smoothstep( 0.04, 0.22, dot( fallsNightLight, vec3( 0.2126, 0.7152, 0.0722 ) ) ) ) * ssNightShade() * uSsKeep;
		lightMapTexel.rgb += fallsNightLight * uFallsNight;
	}`;

/**
 * The stone's colour (W1's stone_material, simplified): the macro map (x2, 0.5 = x1) over the cliff's face, then the
 * vertex colour masks: R moss (a yellow-green that keeps the stone's relief), G wet (darker).
 */
const ROCK_ALBEDO = /* glsl */ `vec3 fallsAlbedo = diffuseColor.rgb;
#ifdef FALLS_MACRO
  vec2 fallsMuv = vec2( ( vFallsWorld.z - uFallsMacroRect.x ) / uFallsMacroRect.y, 1.0 - ( vFallsWorld.y - uFallsMacroRect.z ) / uFallsMacroRect.w );
  fallsAlbedo *= texture2D( uFallsMacro, fallsMuv ).rgb * 2.0;
#endif
#ifdef USE_COLOR
  vec3 fallsMask = vColor.rgb;
#else
  vec3 fallsMask = vec3( 0.0 );
#endif
  float fallsLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 fallsMoss = vec3( 0.0685, 0.1119, 0.0194 ) * mix( 0.6, 1.4, smoothstep( 0.01, 0.45, fallsLum ) ) * 1.6;
  fallsAlbedo = mix( fallsAlbedo, fallsMoss, min( fallsMask.r * 0.95, 1.0 ) );
  fallsAlbedo *= mix( 1.0, 0.33, fallsMask.g );
  diffuseColor.rgb = fallsAlbedo;`;

const ROCK_LIGHT = /* glsl */ `#ifdef USE_LIGHTMAP
  reflectedLight.indirectDiffuse += uFallsLift * uFallsLiftTint;
#endif
#include <aomap_fragment>`;

const LIGHTMAP_TEXEL_FROM = "vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );";

export type RockKind = "stone" | "tint" | "plain";

/**
 * A light-mapped material of waterfall.glb: its own day/night blend (the falls' light maps are not the village's, so
 * the village's shared night-map uniform cannot be used), and for stone the macro map and the vertex colour masks;
 * for `tint` the vertex colour multiplies (three's own). `seam` (W6, the ground's materials: their mean luminance,
 * `SEAM_MEAN`) fades the albedo to the village lawn along the lawn's side of the site box. Idempotent.
 */
const rockPatched = new WeakSet<Material>();
export function rockMaterial(material: Material, kind: RockKind = "plain", macro: Texture | null = null, seam = 0): void {
  if (rockPatched.has(material)) return;
  rockPatched.add(material);
  const m = material as MeshBasicMaterial;
  const stone = kind === "stone";
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFallsNight = rockUniforms.uNight;
    shader.uniforms.uFallsNightMap = rockUniforms.uNightMap;
    shader.uniforms.uFallsDayTint = rockUniforms.uDayTint;
    shader.uniforms.uFallsLift = rockUniforms.uLift;
    shader.uniforms.uFallsLiftTint = rockUniforms.uLiftTint;
    shader.uniforms.uFallsMoon = rockUniforms.uMoon;
    const defines = (macro ? "#define FALLS_MACRO\n" : "") + (seam ? "#define FALLS_SEAM\n" : "");
    if (macro) {
      shader.uniforms.uFallsMacro = { value: macro };
      shader.uniforms.uFallsMacroRect = rockUniforms.uMacroRect;
    }
    if (seam) {
      shader.uniforms.uFallsGrass = rockUniforms.uGrass;
      shader.uniforms.uFallsSeamMean = { value: seam };
    }
    if (macro || seam) {
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "varying vec3 vFallsWorld;\nvoid main() {")
        .replace("#include <project_vertex>", "#include <project_vertex>\n  vFallsWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
    }
    // the live sun shadows' world position and uniforms (sunShadows.ts)
    bindSunShadowUniforms(shader.uniforms);
    shader.vertexShader = shader.vertexShader.replace("void main() {", SS_VERTEX_PARS).replace("#include <project_vertex>", SS_VERTEX_WORLD);
    shader.fragmentShader =
      defines +
      "#define SS_FOREIGN_BAKE\n" +
      shader.fragmentShader
        .replace("void main() {", ROCK_PARS)
        .replace(LIGHTMAP_TEXEL_FROM, ROCK_TEXEL)
        .replace("#include <color_fragment>", `${stone ? ROCK_ALBEDO : "#include <color_fragment>"}\n${SEAM_GLSL}`)
        .replace("#include <aomap_fragment>", ROCK_LIGHT)
        .replace("void main() {", `${SS_FRAGMENT_PARS}${SS_DAY_FUNCTION}void main() {\n${SS_MAIN_TOP}`);
  };
  m.customProgramCacheKey = () => `falls-rock-${kind}${macro ? "-macro" : ""}${seam ? "-seam" : ""}`;
  m.needsUpdate = true;
}

/** Per frame: the time of day into the rock's uniforms (number writes). */
export function rockDayNight(s: DayNightState): void {
  rockUniforms.uNight.value = rockUniforms.uNightMap.value ? s.night : 0;
  rockUniforms.uDayTint.value.set(s.dayTint[0], s.dayTint[1], s.dayTint[2]);
  rockUniforms.uLift.value = s.lift;
  rockUniforms.uLiftTint.value.set(s.liftTint[0], s.liftTint[1], s.liftTint[2]);
  const g = (k: 0 | 1 | 2) => SEAM_GRASS[k] * (LAWN_DAY[k]! + (LAWN_NIGHT[k]! - LAWN_DAY[k]!) * s.night);
  rockUniforms.uGrass.value.set(g(0), g(1), g(2));
}

/** The lamp glass: dim warm glass by day, glowing (past the rich tier's bloom) once the lamps are on. */
export function lampMaterial(material: MeshBasicMaterial): void {
  material.color.setRGB(1.0, 0.5, 0.18);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFallsLamp = fallsUniforms.uLamp;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uFallsLamp;\nvoid main() {")
      .replace("#include <opaque_fragment>", "outgoingLight *= 0.35 + 2.6 * uFallsLamp;\n#include <opaque_fragment>");
  };
  material.customProgramCacheKey = () => "falls-lamp";
  material.needsUpdate = true;
}

/** The shaders' source, for the test that checks the patches apply. */
export const SHADERS = { PLUNGE_FRAGMENT, CASCADE_FRAGMENT, FOAM_FRAGMENT, ROCK_TEXEL, ROCK_ALBEDO } as const;
