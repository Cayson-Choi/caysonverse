import {
  AdditiveBlending,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  RingGeometry,
  ShaderMaterial,
  Sphere,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
} from "three";
import { FALLS, MIST_NEAR_FADE, plungeFallSeconds } from "./fallsConfig";
import { FALLS_LIGHT_GLSL, fallsUniforms } from "./fallsMaterials";

const viewport = new Vector4();

/**
 * The spray, the mist and the rainbow (design 5.2.5): all on the GPU. Each is one instanced quad whose position the
 * vertex shader computes from the time and a per-instance seed, so the CPU writes only a few uniforms per frame
 * (time, how much shows, the tint). The camera's distance fades them within 1.5..5 m so they never cover the screen.
 *
 *  - drops (the fountain's recipe: streaks smeared along their screen velocity, never under 1.5 px, lit as white water):
 *    splash drops thrown up where the sheet lands, drops peeling off the falling sheet, and soft churn clouds boiling up
 *    in the splash zone. high 200 + 136 + 32 / low 72 + 40 + 12, one instanced draw.
 *  - mist: big soft puffs (a 4 x 4 atlas) rising 3..6 m and drifting east, toward the village. high 28 / low 10.
 *  - rainbow (high tier, a clear morning only): an arc in the mist, in front of the fall.
 */

export interface SprayUniforms {
  uTime: { value: number };
  /** 0..1: how much spray / mist shows (distance, sound-off does not matter: this is the picture). */
  uAmount: { value: number };
}

const QUAD = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quadGeometry(count: number, seeds: Float32Array, extra: Float32Array): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(QUAD, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 4));
  g.setAttribute("aExtra", new InstancedBufferAttribute(extra, 4));
  g.instanceCount = count;
  // the spray stays within ~30 m of the landing point: one sphere, so it is not drawn while the falls are out of view
  g.boundingSphere = new Sphere(new Vector3(FALLS.impact.x + 4, 8, FALLS.impact.z), 28);
  return g;
}

/** Per-instance data of the drops and churn (one instanced draw): see `buildFallsParticles`. */
export interface FallsParticles {
  origin: Float32Array; // where (world), at age 0
  vel: Float32Array; // launch velocity (m/s)
  life: Float32Array; // life (s, 600 / k: repeats over the wrapped clock), phase 0..1, size (m), kind
  count: number;
}

export const PARTICLE = { splash: 0, peel: 1, churn: 2 } as const;

/** A life (s) near `want` that divides the wrapped clock (600 s), so a drop's cycle never jumps when the clock wraps. */
export function wrapLife(want: number): number {
  return 600 / Math.max(1, Math.round(600 / want));
}

/**
 * The falls' drops (deterministic, tested): `splash` drops thrown up and out where the sheet lands (a band as wide as
 * the sheet, 2..7 m/s up), `peel` drops torn off the falling sheet's face and rim in its lower two thirds (they leave
 * with the sheet's own velocity there plus a push out), and `churn` clouds: soft white puffs boiling up in the splash
 * zone. Lives are fitted to the wrapped clock.
 */
export function buildFallsParticles(splash: number, peel: number, churn: number, seed = 5): FallsParticles {
  const r = rng(seed);
  const count = splash + peel + churn;
  const origin = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const life = new Float32Array(count * 4);
  const ix = FALLS.impact.x;
  const iz = FALLS.impact.z;
  const wy = FALLS.pool.waterY;
  const fallS = plungeFallSeconds();
  let i = 0;
  for (let k = 0; k < splash; k++, i++) {
    // the landing band: as wide as the sheet's foot (about 5 m across, z), a metre deep (x)
    const along = (r() * 2 - 1) * 2.4;
    const o = [ix + (r() - 0.4) * 1.1, wy + 0.05, iz + along];
    const out = 0.6 + r() * 2.4; // m/s outward (mostly east, away from the rock)
    const ang = (r() - 0.5) * 2.6;
    const up = 2.2 + r() * r() * 5.5;
    origin.set(o, i * 3);
    vel.set([Math.cos(ang) * out + 0.5, up, Math.sin(ang) * out * 0.8 + along * 0.15], i * 3);
    life.set([wrapLife((2 * up) / 9.81 + 0.05), r(), 0.022 + r() * 0.04, PARTICLE.splash], i * 4);
  }
  for (let k = 0; k < peel; k++, i++) {
    // where on the fall it tears off: the lower two thirds, from the face or the rim
    const f = 0.33 + 0.67 * Math.sqrt(r());
    const tau = f * fallS;
    const half = (3.4 + 1.8 * f) * 0.5;
    const rimSide = r() < 0.5 ? -1 : 1;
    const across = r() < 0.55 ? rimSide * half * (0.85 + 0.25 * r()) : (r() * 2 - 1) * half * 0.8;
    origin.set([FALLS.lip.x + FALLS.plungeSpeed * tau + 0.15, FALLS.lip.y - 4.905 * tau * tau, FALLS.lip.z + across], i * 3);
    const vy = -9.81 * tau;
    vel.set([FALLS.plungeSpeed + 0.4 + r() * 1.4, vy * (0.9 + 0.15 * r()), Math.sign(across) * (0.2 + r() * 1.1)], i * 3);
    // it falls with about the sheet's speed: alive until it reaches the pool (the shader hides it below the water)
    const rest = fallS - tau;
    life.set([wrapLife(rest + 0.25), r(), 0.03 + r() * 0.05, PARTICLE.peel], i * 4);
  }
  for (let k = 0; k < churn; k++, i++) {
    const along = (r() * 2 - 1) * 2.6;
    origin.set([ix + (r() - 0.3) * 1.6, wy + 0.1, iz + along], i * 3);
    vel.set([0.4 + r() * 0.9, 0.8 + r() * 1.6, (r() - 0.5) * 0.8], i * 3);
    life.set([wrapLife(1.4 + r() * 1.4), r(), 1.0 + r() * 1.4, PARTICLE.churn], i * 4);
  }
  return { origin, vel, life, count };
}

export function mistSeeds(count: number, seed = 17): { seeds: Float32Array; extra: Float32Array } {
  const r = rng(seed);
  const seeds = new Float32Array(count * 4);
  const extra = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    seeds[i * 4] = (i + r()) / count;
    seeds[i * 4 + 1] = r();
    seeds[i * 4 + 2] = r();
    seeds[i * 4 + 3] = r();
    extra[i * 4] = Math.floor(r() * 16); // atlas tile
    extra[i * 4 + 1] = 3.5 + r() * 3.5; // size (m)
    extra[i * 4 + 2] = wrapLife(6 + r() * 4); // life (s)
    extra[i * 4 + 3] = 3 + r() * 3; // rise (m)
  }
  return { seeds, extra };
}

/** Drops are never drawn thinner than this (px): a 3 cm drop 30 m away is under a pixel and would flicker. */
export const MIN_PX = 1.5;
/** The shutter (s) a falling drop is smeared over on screen (the fountain's). */
export const SHUTTER = 1 / 45;
/** A drop quad stands for a clump of drops: its ink is this many times one drop's. */
export const DROP_GAIN = 5;

const f6 = (x: number) => x.toFixed(6);

/**
 * The drops (the fountain's particle recipe, fountainWater.ts PARTICLE_VERTEX): each a capsule smeared along its
 * screen velocity over a 1/45 s shutter, never thinner than 1.5 px (its ink spread over what is drawn), lit as white
 * water (sky + key, thrown forward: they sparkle against the sun) with a glint now and then; the churn clouds are soft
 * round puffs that boil up and spread. Gone below the pool's surface; faded within 1.5..5 m of the camera.
 */
const SPRAY_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
uniform float uAmount;
uniform vec2 uNear;
uniform vec2 uViewport;
${FALLS_LIGHT_GLSL}
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec4 aLife; // life (s), phase, size (m), kind
varying vec2 vC;
varying vec2 vHalf;
varying vec3 vColor;
varying float vAlpha;
varying float vSoft;
void main() {
  float life = aLife.x;
  float age = fract( uTime / life + aLife.y ) * life;
  float phase = age / life;
  float kind = aLife.w;
  float soft = kind > 1.5 ? 1.0 : 0.0;
  vec3 p;
  vec3 vel;
  float vis;
  float diam;
  if ( soft > 0.5 ) {
    // a churn cloud: boils up fast, slows, spreads, thins out
    float k = 1.0 - exp( -1.8 * age );
    p = aOrigin + aVel * k / 1.8;
    vel = vec3( 0.0 );
    vis = sin( PI * phase ) * ( 1.0 - 0.4 * phase );
    diam = aLife.z * ( 0.6 + 0.9 * phase );
  } else {
    p = aOrigin + aVel * age;
    p.y -= 4.905 * age * age;
    vel = aVel;
    vel.y -= 9.81 * age;
    vis = smoothstep( 0.0, 0.04, phase );
    diam = aLife.z;
  }
  // gone into the pool
  vis *= smoothstep( 0.0, 0.06, p.y - ${f6(FALLS.pool.waterY)} );
  float camD = length( cameraPosition - p );
  vis *= smoothstep( uNear.x, uNear.y, camD ) * uAmount;
  vec4 c0 = projectionMatrix * viewMatrix * vec4( p, 1.0 );
  vec4 c1 = projectionMatrix * viewMatrix * vec4( p - vel * ${f6(SHUTTER)}, 1.0 );
  vec2 halfVp = 0.5 * uViewport;
  vec2 a0 = c0.xy / max( c0.w, 1e-3 ) * halfVp;
  vec2 a1 = c1.xy / max( c1.w, 1e-3 ) * halfVp;
  if ( c1.w < 0.05 ) a1 = a0;
  vec2 d = a0 - a1;
  float len = length( d );
  vec2 dir = len > 1e-3 ? d / len : vec2( 0.0, 1.0 );
  float pxPerM = halfVp.y * projectionMatrix[ 1 ][ 1 ] / max( c0.w, 1e-3 );
  float dPx = diam * pxPerM;
  float wPx = max( dPx, ${f6(MIN_PX)} );
  float lPx = max( len, wPx );
  float ink = soft > 0.5 ? 0.22 : min( 0.85, ${f6(DROP_GAIN)} * dPx * dPx / ( wPx * lPx ) );
  vec2 centre = soft > 0.5 ? a0 : a0 - d * 0.5;
  vec2 axisL = soft > 0.5 ? vec2( 0.0, 1.0 ) : dir;
  vec2 axisW = vec2( -axisL.y, axisL.x );
  float hw = soft > 0.5 ? 0.5 * dPx : 0.5 * wPx;
  float hl = soft > 0.5 ? 0.5 * dPx : 0.5 * lPx;
  vec2 corner = centre + axisW * position.x * 2.0 * hw + axisL * position.y * 2.0 * hl;
  gl_Position = vec4( corner / halfVp * c0.w, c0.z, c0.w );
  vC = position.xy * 2.0;
  vHalf = vec2( hw, hl );
  vSoft = soft;
  vec3 V = normalize( cameraPosition - p );
  vec3 col = flWarm( flWhite( V, 1.0 - 0.5 * soft ), p, 1.4 );
  float tw = fract( sin( dot( vec2( aLife.y * 97.0, floor( uTime * 9.0 + aLife.y * 61.0 ) ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  col += uGlintColor * step( 0.93, tw ) * ( 0.6 + 1.6 * clamp( dot( -uKeyDir, V ), 0.0, 1.0 ) ) * ( 1.0 - soft );
  vColor = col;
  vAlpha = vis * ink;
  if ( vAlpha < 0.002 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
  #ifdef USE_FOG
    vec4 mvPosition = viewMatrix * vec4( p, 1.0 );
    vFogDepth = - mvPosition.z;
  #endif
}
`;

const SPRAY_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying vec2 vC;
varying vec2 vHalf;
varying vec3 vColor;
varying float vAlpha;
varying float vSoft;
void main() {
  float m;
  if ( vSoft > 0.5 ) m = exp( -3.2 * dot( vC, vC ) );
  else {
    vec2 pp = vC * vHalf;
    float d = length( vec2( pp.x, max( abs( pp.y ) - max( vHalf.y - vHalf.x, 0.0 ), 0.0 ) ) );
    m = 1.0 - smoothstep( max( vHalf.x - 0.8, 0.0 ), vHalf.x + 0.2, d );
  }
  float a = vAlpha * m;
  if ( a < 0.002 ) discard;
  gl_FragColor = vec4( vColor, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const MIST_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
uniform vec3 uImpact;
uniform float uAmount;
uniform vec2 uNear;
attribute vec4 aSeed;
attribute vec4 aExtra;
varying float vAlpha;
varying vec2 vUvAtlas;
varying vec3 vMistPos;
void main() {
  float life = aExtra.z;
  float t = fract( uTime / life + aSeed.x );
  float ts = t * life;
  float ang = aSeed.y * 6.2831853;
  float rad = 0.6 + aSeed.z * 5.0;
  vec3 start = uImpact + vec3( cos( ang ) * rad * 0.7, 0.9, sin( ang ) * rad * 1.5 );
  // rises, and the wind takes it east (toward the village)
  vec3 p = start + vec3( 0.45 * ts + 0.4, aExtra.w * t, 0.0 );
  vMistPos = p;
  float size = aExtra.y * ( 0.55 + 0.6 * t );
  float fadeIn = smoothstep( 0.0, 0.2, t );
  float fadeOut = 1.0 - smoothstep( 0.55, 1.0, t );
  // above the ground (the quad must not slice through it): fades out near the floor
  float aboveGround = smoothstep( 0.1, 0.9, p.y - ( size * 0.18 ) );
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  float dist = length( mv.xyz );
  float near = smoothstep( uNear.x, uNear.y, dist );
  vAlpha = fadeIn * fadeOut * near * uAmount * aboveGround;
  float tile = aExtra.x;
  vec2 cell = vec2( mod( tile, 4.0 ), floor( tile / 4.0 ) );
  vUvAtlas = ( cell + position.xy + 0.5 ) * 0.25;
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}
`;

const MIST_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
#include <common>
#include <fog_pars_fragment>
${FALLS_LIGHT_GLSL}
varying float vAlpha;
varying vec2 vUvAtlas;
varying vec3 vMistPos;
void main() {
  float a = texture2D( uAtlas, vUvAtlas ).a * vAlpha * 0.3;
  if ( vAlpha < 0.004 ) discard;
  vec3 V = normalize( cameraPosition - vMistPos );
  vec3 col = flWarm( flWhite( V, 0.9 ) * 0.92, vMistPos, 0.5 );
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const RAINBOW_FRAGMENT = /* glsl */ `
uniform float uAmount;
uniform vec3 uTint;
#include <common>
#include <fog_pars_fragment>
varying vec2 vUv;
vec3 spectrum( float x ) {
  // red (outside) .. violet (inside)
  vec3 c = vec3( 1.0, 0.18, 0.12 );
  c = mix( c, vec3( 1.0, 0.6, 0.1 ), smoothstep( 0.0, 0.2, x ) );
  c = mix( c, vec3( 0.95, 0.95, 0.2 ), smoothstep( 0.18, 0.38, x ) );
  c = mix( c, vec3( 0.2, 0.85, 0.35 ), smoothstep( 0.36, 0.55, x ) );
  c = mix( c, vec3( 0.2, 0.5, 1.0 ), smoothstep( 0.55, 0.78, x ) );
  c = mix( c, vec3( 0.55, 0.25, 0.9 ), smoothstep( 0.78, 1.0, x ) );
  return c;
}
void main() {
  // vUv.x: across the band (0 outer .. 1 inner), vUv.y: along the arc (0..1)
  float band = smoothstep( 0.0, 0.12, vUv.x ) * smoothstep( 1.0, 0.88, vUv.x );
  float along = smoothstep( 0.0, 0.18, vUv.y ) * smoothstep( 1.0, 0.82, vUv.y );
  float a = band * along * uAmount * 0.26;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( spectrum( vUv.x ) * uTint, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const RAINBOW_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}
`;

export interface FallsSpray {
  group: Group;
  droplets: Mesh;
  mist: Mesh;
  rainbow: Mesh | null;
  /** The per-frame numbers: set `spray`/`mist`/`rainbow` (0..1) and the tint; the clock is the shared falls uniform. */
  set(v: { spray: number; mist: number; rainbow: number }): void;
  dispose(): void;
}

export interface SprayOptions {
  /** Splash drops, drops peeling off the sheet, churn clouds (one instanced draw). */
  splash: number;
  peel: number;
  churn: number;
  mist: number;
  rainbow: boolean;
  atlas: Texture;
}

export function createSpray(o: SprayOptions): FallsSpray {
  const group = new Group();
  group.name = "falls_spray";
  const own: Array<{ dispose(): void }> = [];
  const impact = new Vector3(FALLS.impact.x, FALLS.impact.y, FALLS.impact.z);

  const lit = (): Record<string, { value: unknown }> => ({
    uTime: fallsUniforms.uTime,
    uTint: fallsUniforms.uTint,
    uLamp: fallsUniforms.uLamp,
    uAmbient: fallsUniforms.uAmbient,
    uKeyColor: fallsUniforms.uKeyColor,
    uKeyDir: fallsUniforms.uKeyDir,
    uGlintColor: fallsUniforms.uGlintColor,
    uLampColor: { value: new Vector3(1.0, 0.706, 0.42) },
  });

  const parts = buildFallsParticles(o.splash, o.peel, o.churn);
  const dGeo = new InstancedBufferGeometry();
  dGeo.setAttribute("position", new Float32BufferAttribute(QUAD, 3));
  dGeo.setIndex([0, 1, 2, 0, 2, 3]);
  dGeo.setAttribute("aOrigin", new InstancedBufferAttribute(parts.origin, 3));
  dGeo.setAttribute("aVel", new InstancedBufferAttribute(parts.vel, 3));
  dGeo.setAttribute("aLife", new InstancedBufferAttribute(parts.life, 4));
  dGeo.instanceCount = parts.count;
  dGeo.boundingSphere = new Sphere(new Vector3(FALLS.impact.x + 2, 8, FALLS.impact.z), 16);
  const dMat = new ShaderMaterial({
    name: "M_falls_spray",
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      { uAmount: { value: 1 }, uNear: { value: [MIST_NEAR_FADE[0], MIST_NEAR_FADE[1]] }, uViewport: { value: new Vector2(1280, 720) } },
    ]),
    vertexShader: SPRAY_VERTEX,
    fragmentShader: SPRAY_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
  });
  dMat.forceSinglePass = true;
  Object.assign(dMat.uniforms, lit());
  const droplets = new Mesh(dGeo, dMat);
  droplets.name = "falls_droplets";
  droplets.renderOrder = 8;
  droplets.frustumCulled = true;
  // the pixel size of what is drawn: the viewport of the target being drawn into (the rich tier's render scale included)
  droplets.onBeforeRender = (renderer) => {
    renderer.getCurrentViewport(viewport);
    (dMat.uniforms.uViewport!.value as Vector2).set(Math.max(1, viewport.z), Math.max(1, viewport.w));
  };
  group.add(droplets);
  own.push(dGeo, dMat);

  const m = mistSeeds(o.mist);
  const mGeo = quadGeometry(o.mist, m.seeds, m.extra);
  const mMat = new ShaderMaterial({
    name: "M_falls_mist",
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      { uImpact: { value: impact }, uAtlas: { value: null }, uAmount: { value: 1 }, uNear: { value: [MIST_NEAR_FADE[0], MIST_NEAR_FADE[1]] } },
    ]),
    vertexShader: MIST_VERTEX,
    fragmentShader: MIST_FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  mMat.uniforms.uAtlas!.value = o.atlas;
  Object.assign(mMat.uniforms, lit());
  const mist = new Mesh(mGeo, mMat);
  mist.name = "falls_mist";
  mist.renderOrder = 9;
  group.add(mist);
  own.push(mGeo, mMat);

  let rainbow: Mesh | null = null;
  let rMat: ShaderMaterial | null = null;
  if (o.rainbow) {
    // an arc in a plane facing east, in front of the fall, standing on the pool's shore
    const geo = new RingGeometry(7.6, 8.9, 24, 1, 0.05 * Math.PI, 0.9 * Math.PI);
    const uv = geo.getAttribute("uv");
    const pos = geo.getAttribute("position");
    for (let i = 0; i < uv.count; i++) {
      const rr = Math.hypot(pos.getX(i), pos.getY(i));
      const ang = Math.atan2(pos.getY(i), pos.getX(i));
      uv.setXY(i, (8.9 - rr) / (8.9 - 7.6), (ang - 0.05 * Math.PI) / (0.9 * Math.PI));
    }
    rMat = new ShaderMaterial({
      name: "M_falls_rainbow",
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uAmount: { value: 0 }, uTint: { value: new Vector3(1, 1, 1) } }]),
      vertexShader: RAINBOW_VERTEX,
      fragmentShader: RAINBOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      fog: true,
    });
    rMat.uniforms.uTint = fallsUniforms.uTint;
    rainbow = new Mesh(geo, rMat);
    rainbow.name = "falls_rainbow";
    rainbow.rotation.y = Math.PI / 2;
    rainbow.position.set(FALLS.impact.x + 3.5, 0.3, FALLS.impact.z);
    rainbow.renderOrder = 10;
    rainbow.visible = false;
    group.add(rainbow);
    own.push(geo, rMat);
  }

  return {
    group,
    droplets,
    mist,
    rainbow,
    set({ spray, mist: mistAmount, rainbow: rb }) {
      dMat.uniforms.uAmount!.value = spray;
      mMat.uniforms.uAmount!.value = mistAmount;
      droplets.visible = spray > 0.005;
      mist.visible = mistAmount > 0.005;
      if (rainbow && rMat) {
        rMat.uniforms.uAmount!.value = rb;
        rainbow.visible = rb > 0.005;
      }
    },
    dispose() {
      for (const r of own) r.dispose();
    },
  };
}
