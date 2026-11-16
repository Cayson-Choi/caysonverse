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
  Vector3,
  type Texture,
} from "three";
import { FALLS, MIST_NEAR_FADE, plungeFallSeconds } from "./fallsConfig";
import { fallsUniforms } from "./fallsMaterials";

/**
 * The spray, the mist and the rainbow (design 5.2.5): all on the GPU. Each is one instanced quad whose position the
 * vertex shader computes from the time and a per-instance seed, so the CPU writes only a few uniforms per frame
 * (time, how much shows, the tint). The camera's distance fades them within 1.5..5 m so they never cover the screen.
 *
 *  - droplets: thrown up from where the water lands (a parabola each), and torn off the falling sheet (they follow its
 *    arc, drifting out). high 160 / low 48.
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

/** The instance seeds of the droplets (exported for the test: they must be deterministic and in range). */
export function dropletSeeds(count: number, seed = 5): { seeds: Float32Array; extra: Float32Array } {
  const r = rng(seed);
  const seeds = new Float32Array(count * 4);
  const extra = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    seeds[i * 4] = (i + r()) / count; // phase (spread evenly in time)
    seeds[i * 4 + 1] = r();
    seeds[i * 4 + 2] = r();
    seeds[i * 4 + 3] = r();
    // kind: 0 = thrown up from the landing; 1 = torn off the sheet
    extra[i * 4] = r() < 0.3 ? 1 : 0;
    extra[i * 4 + 1] = 0.035 + r() * 0.06; // radius (m)
    extra[i * 4 + 2] = 0.8 + r() * 0.8; // life (s)
    extra[i * 4 + 3] = r();
  }
  return { seeds, extra };
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
    extra[i * 4 + 2] = 6 + r() * 4; // life (s)
    extra[i * 4 + 3] = 3 + r() * 3; // rise (m)
  }
  return { seeds, extra };
}

const SPRAY_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
uniform vec3 uImpact;
uniform vec3 uLip;
uniform float uSpeed;
uniform float uFallS;
uniform float uAmount;
uniform vec2 uNear;
attribute vec4 aSeed;
attribute vec4 aExtra;
varying float vAlpha;
varying vec2 vQ;
void main() {
  float life = max( aExtra.z, 0.2 );
  float t = fract( uTime / life + aSeed.x );
  float ts = t * life;
  vec3 p;
  if ( aExtra.x < 0.5 ) {
    // thrown up where the water lands: out in a ring, up, then down
    float ang = aSeed.y * 6.2831853;
    float rad = 0.4 + aSeed.z * 1.6;
    vec3 start = uImpact + vec3( cos( ang ) * rad * 0.6, 0.05, sin( ang ) * rad * 1.3 );
    vec3 v = vec3( cos( ang ) * ( 0.4 + aSeed.w ), 2.5 + 3.5 * aSeed.w + aSeed.z, sin( ang ) * ( 0.6 + aSeed.w ) * 1.3 );
    v.x += 0.6; // the wind: east
    p = start + v * ts + vec3( 0.0, -4.905 * ts * ts * 0.5, 0.0 );
  } else {
    // torn off the sheet: rides its arc, drifting out
    float f = aSeed.y;
    float tau = f * uFallS;
    float spread = ( aSeed.z - 0.5 ) * ( 2.2 + 3.0 * f );
    vec3 on = vec3( uLip.x + uSpeed * tau, uLip.y - 4.905 * tau * tau, uLip.z + spread );
    p = on + vec3( 0.5 + 0.8 * ts, -0.4 * ts, ( aSeed.w - 0.5 ) * 0.8 * ts );
  }
  float fadeIn = smoothstep( 0.0, 0.08, t );
  float fadeOut = 1.0 - smoothstep( 0.6, 1.0, t );
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  float dist = length( mv.xyz );
  float near = smoothstep( uNear.x, uNear.y, dist );
  vAlpha = fadeIn * fadeOut * near * uAmount;
  vQ = position.xy * 2.0;
  mv.xy += position.xy * aExtra.y * 2.0;
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}
`;

const SPRAY_FRAGMENT = /* glsl */ `
uniform vec3 uTint;
uniform float uLamp;
#include <common>
#include <fog_pars_fragment>
varying float vAlpha;
varying vec2 vQ;
void main() {
  float d = length( vQ );
  if ( d > 1.0 || vAlpha < 0.01 ) discard;
  float a = ( 1.0 - d * d ) * vAlpha * 0.75;
  vec3 col = vec3( 0.92, 0.97, 1.0 ) * uTint + vec3( 1.0, 0.7, 0.42 ) * uLamp * 0.08;
  gl_FragColor = vec4( col, a );
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
void main() {
  float life = aExtra.z;
  float t = fract( uTime / life + aSeed.x );
  float ts = t * life;
  float ang = aSeed.y * 6.2831853;
  float rad = 0.6 + aSeed.z * 5.0;
  vec3 start = uImpact + vec3( cos( ang ) * rad * 0.7, 0.9, sin( ang ) * rad * 1.5 );
  // rises, and the wind takes it east (toward the village)
  vec3 p = start + vec3( 0.45 * ts + 0.4, aExtra.w * t, 0.0 );
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
uniform vec3 uTint;
uniform float uLamp;
#include <common>
#include <fog_pars_fragment>
varying float vAlpha;
varying vec2 vUvAtlas;
void main() {
  float a = texture2D( uAtlas, vUvAtlas ).a * vAlpha * 0.3;
  if ( vAlpha < 0.004 ) discard;
  vec3 col = vec3( 0.86, 0.93, 0.97 ) * uTint + vec3( 1.0, 0.7, 0.42 ) * uLamp * 0.1;
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
  droplets: number;
  mist: number;
  rainbow: boolean;
  atlas: Texture;
}

export function createSpray(o: SprayOptions): FallsSpray {
  const group = new Group();
  group.name = "falls_spray";
  const own: Array<{ dispose(): void }> = [];
  const impact = new Vector3(FALLS.impact.x, FALLS.impact.y, FALLS.impact.z);
  const lip = new Vector3(FALLS.lip.x, FALLS.lip.y, FALLS.lip.z);

  const timeAndTint = (): Record<string, { value: unknown }> => ({
    uTime: fallsUniforms.uTime,
    uTint: fallsUniforms.uTint,
    uLamp: fallsUniforms.uLamp,
  });

  const d = dropletSeeds(o.droplets);
  const dGeo = quadGeometry(o.droplets, d.seeds, d.extra);
  const dMat = new ShaderMaterial({
    name: "M_falls_spray",
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      { uImpact: { value: impact }, uLip: { value: lip }, uSpeed: { value: FALLS.plungeSpeed }, uFallS: { value: plungeFallSeconds() }, uAmount: { value: 1 }, uNear: { value: [MIST_NEAR_FADE[0], MIST_NEAR_FADE[1]] } },
    ]),
    vertexShader: SPRAY_VERTEX,
    fragmentShader: SPRAY_FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  Object.assign(dMat.uniforms, timeAndTint());
  const droplets = new Mesh(dGeo, dMat);
  droplets.name = "falls_droplets";
  droplets.renderOrder = 8;
  droplets.frustumCulled = true;
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
  Object.assign(mMat.uniforms, timeAndTint());
  const mist = new Mesh(mGeo, mMat);
  mist.name = "falls_mist";
  mist.renderOrder = 9;
  group.add(mist);
  own.push(mGeo, mMat);

  let rainbow: Mesh | null = null;
  let rMat: ShaderMaterial | null = null;
  if (o.rainbow) {
    // an arc in a plane facing east, in front of the fall, standing on the pool's shore
    const geo = new RingGeometry(7.6, 8.9, 48, 1, 0.05 * Math.PI, 0.9 * Math.PI);
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
