import {
  BackSide,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  ShaderMaterial,
  Sphere,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
  type IUniform,
  type Material,
  type Matrix4,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from "three";
import {
  ARC_BREAK,
  FOUNTAIN,
  PARTICLE_CAP,
  PARTICLE_LOD,
  UPRIGHT_BREAK,
  TIME_WRAP,
  arcJet,
  buildParticles,
  curtainFlow,
  particleCountAt,
  rng,
  uprightJet,
  wrapOmega,
  wrapTime,
  type Jet,
} from "./fountainLayout";
import { SKY_AT_GLSL, WATER, type SkyMapping } from "./villageWater";
import type { DayNightState } from "./dayNightBlend";

/**
 * 케이슨 마을's plaza fountain, real water at run time (feature/fountain-water). The model's water (village.glb's
 * `M_water` jets and sheets: thick six-sided tubes and cones that read as pale blue plastic) is cut down to its three pool
 * surfaces (`fountainPoolGeometry`), and this draws the rest the way water really moves (fountainLayout.ts: the same
 * nozzles and landing points, real parabolas):
 *
 *  1. Streams (`ribbons`): the 16 arcs and 8 upright jets as thin ribbons turned to the camera along their parabola (the
 *     GTA V "wormy fountain" recipe). Near the nozzle a clear glass rod (2-3 cm: a pseudo-cylinder's Fresnel edges reflect
 *     the sky, its middle shows what is behind); from the apex on it frays into streaks and white drops. The streaks are
 *     sampled at the time the water left the nozzle (`uTime - s * flight`), so they flow at the water's own speed and
 *     stretch as it falls. Each jet sways a little (its launch velocity wobbles; every parcel keeps the one it left with).
 *  2. Drops (`particles`): one instanced draw, positions computed on the GPU from the launch and a clock (no CPU work):
 *     drops peeling off the arcs, the upright jets' crowns, drops off the curtains, splashes where water lands, and (rich
 *     tier) a little mist. Each is a streak along its screen velocity (what an eye or a camera sees of a falling drop).
 *  3. Curtains (`curtains`): the two sheets over the bowl's and the pedestal's lips, on their real parabola; a glassy film
 *     with vertical grain at the top that tears into strands and white water toward the bottom.
 *  4. The pool (villageWater.ts FOUNTAIN_POOL): rings and foam where the water lands, the lights' bright points at night.
 *
 * Lighting follows the clock (`applyDayNight`): the sky's reflection and the sun's glint by day; at night the
 * underwater lights' light travels up inside the clear streams and shows where the water breaks (the drops, the crowns,
 * the foam), as in a real lit fountain, while the smooth parts stay dark. Nothing here allocates per frame.
 *
 * The light (phone) tier draws the same with fewer segments and a fifth of the drops, no splashes and no mist.
 * Everything without a GPU (the trajectories, the pool's triangles, the particle pools, the LOD) is unit-tested in
 * fountainWater.test.ts.
 */

// ───────────────────────────────────────── the noise texture ─────────────────────────────────────────

/** Side of the fountain's noise texture (px); tiles seamlessly. 16 KB of RGBA. */
export const NOISE_SIZE = 64;

/** A periodic value noise (`cells` lattice cells across `size` texels), smooth, 0..1. */
function valueNoise(size: number, cells: number, rand: () => number): Float32Array {
  const lattice = new Float32Array(cells * cells).map(() => rand());
  const out = new Float32Array(size * size);
  const at = (x: number, y: number) => lattice[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)]!;
  const fade = (t: number) => t * t * (3 - 2 * t);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const fx = (i / size) * cells;
      const fy = (j / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fade(fx - x0);
      const ty = fade(fy - y0);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      out[j * size + i] = a + (b - a) * ty;
    }
  }
  return out;
}

/**
 * The fountain's noise (RGBA8, `size` x `size`, tiling): R a soft value noise (8 cells across), G a finer one (16), B
 * the gap between a Worley pattern's nearest two cells (0 on the cell walls: foam's lace), A a fine one (32).
 */
export function fountainNoiseData(size = NOISE_SIZE, seed = 11): Uint8Array {
  const rand = rng(seed);
  const r = valueNoise(size, 8, rand);
  const g = valueNoise(size, 16, rand);
  const a = valueNoise(size, 32, rand);
  const pts: Array<[number, number]> = Array.from({ length: 28 }, () => [rand(), rand()]);
  const out = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i + 0.5) / size;
      const v = (j + 0.5) / size;
      let f1 = 9;
      let f2 = 9;
      for (const [px, py] of pts) {
        let dx = Math.abs(u - px);
        let dy = Math.abs(v - py);
        dx = Math.min(dx, 1 - dx);
        dy = Math.min(dy, 1 - dy);
        const d = Math.hypot(dx, dy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
      const o = (j * size + i) * 4;
      out[o] = Math.round(r[j * size + i]! * 255);
      out[o + 1] = Math.round(g[j * size + i]! * 255);
      out[o + 2] = Math.round(Math.min(1, (f2 - f1) * 9) * 255);
      out[o + 3] = Math.round(a[j * size + i]! * 255);
    }
  }
  return out;
}

/** The noise as a repeating, mip-mapped texture (data, not colour). */
export function makeFountainNoise(size = NOISE_SIZE): DataTexture {
  const t = new DataTexture(fountainNoiseData(size), size, size, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// ───────────────────────────────────────── the old water: cut down to the pools ─────────────────────────────────────────

/** The fountain's three water surfaces (y, m): the basin's, the pedestal's pool, the bowl's. */
export const POOL_HEIGHTS: readonly number[] = [FOUNTAIN.pool.y, FOUNTAIN.tier.y, FOUNTAIN.bowl.y];
const POOL_TOLERANCE = 0.005;

const va = new Vector3();
const vb = new Vector3();
const vc = new Vector3();
const e1 = new Vector3();
const e2 = new Vector3();

/**
 * The model's fountain water cut down to its pool surfaces: the triangles that lie flat (face normal within 8° of
 * vertical) with all three corners on one of `POOL_HEIGHTS` (±5 mm, in world space). Everything else in it (the jet
 * tubes, the falling sheets, the splash rings) is left out. A new, non-indexed geometry in the mesh's own space (the
 * source geometry is the loader's: untouched); null when no triangle qualifies.
 */
export function fountainPoolGeometry(geometry: BufferGeometry, matrixWorld: Matrix4, heights: readonly number[] = POOL_HEIGHTS): BufferGeometry | null {
  const pos = geometry.getAttribute("position");
  if (!pos) return null;
  const index = geometry.getIndex();
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const count = index ? index.count : pos.count;
  const keep: number[] = [];
  const onPool = (y: number) => heights.some((h) => Math.abs(y - h) <= POOL_TOLERANCE);
  for (let t = 0; t + 2 < count; t += 3) {
    const i0 = index ? index.getX(t) : t;
    const i1 = index ? index.getX(t + 1) : t + 1;
    const i2 = index ? index.getX(t + 2) : t + 2;
    va.fromBufferAttribute(pos, i0).applyMatrix4(matrixWorld);
    vb.fromBufferAttribute(pos, i1).applyMatrix4(matrixWorld);
    vc.fromBufferAttribute(pos, i2).applyMatrix4(matrixWorld);
    if (!onPool(va.y) || Math.abs(vb.y - va.y) > POOL_TOLERANCE || Math.abs(vc.y - va.y) > POOL_TOLERANCE) continue;
    e1.subVectors(vb, va);
    e2.subVectors(vc, va);
    e1.cross(e2);
    const len = e1.length();
    if (len < 1e-9 || Math.abs(e1.y / len) < 0.99) continue;
    keep.push(i0, i1, i2);
  }
  if (keep.length === 0) return null;
  const out = new BufferGeometry();
  const copy = (attr: typeof pos | undefined, size: number) => {
    if (!attr) return null;
    const a = new Float32Array(keep.length * size);
    keep.forEach((i, k) => {
      for (let c = 0; c < size; c++) a[k * size + c] = attr.getComponent(i, c);
    });
    return new Float32BufferAttribute(a, size);
  };
  out.setAttribute("position", copy(pos, 3)!);
  const n = copy(normal, 3);
  if (n) out.setAttribute("normal", n);
  else out.computeVertexNormals();
  const u = copy(uv, 2);
  if (u) out.setAttribute("uv", u);
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/**
 * The model's fountain water among `candidates` (the meshes drawn with `M_water`): the one centred within 6 m of the
 * fountain (x, z) that reaches above 1 m (the jets; the creek and the lake lie flat and far). Null if none.
 */
export function findFountainWater<T extends Object3D & { geometry: BufferGeometry }>(candidates: readonly T[], centre: { x: number; z: number }): T | null {
  for (const m of candidates) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const box = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    if (Math.hypot(cx - centre.x, cz - centre.z) < 6 && box.max.y > 1) return m;
  }
  return null;
}

// ───────────────────────────────────────── geometry ─────────────────────────────────────────

/** Ribbon segments per jet, per tier (the arcs, the upright jets). */
export const RIBBON_SEGMENTS = { high: { arc: 32, upright: 24 }, low: { arc: 16, upright: 12 } } as const;
/** Curtain mesh size per tier: around, and down. */
export const CURTAIN_SEGMENTS = { high: { around: 96, down: 12 }, low: { around: 48, down: 6 } } as const;

/** What a stream looks like (m): its diameter at the nozzle and at the end, where it starts and finishes breaking. */
export const STREAM = {
  arc: { width: [0.026, 0.045], break: ARC_BREAK },
  upright: { width: [0.032, 0.07], break: UPRIGHT_BREAK },
} as const;

/** The streams (16 arcs, 8 upright jets) as one ribbon geometry: the vertex shader places every vertex (see RIBBON_VERTEX). */
export function buildRibbonGeometry(tier: "high" | "low"): BufferGeometry {
  const seg = RIBBON_SEGMENTS[tier];
  const jets: Array<{ jet: Jet; kind: 0 | 1; segments: number; seed: number }> = [];
  for (let k = 0; k < FOUNTAIN.arcs.count; k++) jets.push({ jet: arcJet(k), kind: 0, segments: seg.arc, seed: k });
  for (let k = 0; k < FOUNTAIN.uprights.count; k++) jets.push({ jet: uprightJet(k), kind: 1, segments: seg.upright, seed: k });
  const position: number[] = [];
  const origin: number[] = [];
  const vel: number[] = [];
  const jetA: number[] = [];
  const shape: number[] = [];
  const index: number[] = [];
  for (const { jet, kind, segments, seed } of jets) {
    const look = kind === 0 ? STREAM.arc : STREAM.upright;
    const base = position.length / 3;
    for (let i = 0; i <= segments; i++) {
      // Even in time: the slow apex gets the most vertices, where the stream bends most.
      const s = i / segments;
      const t = s * jet.flight;
      for (const side of [-1, 1]) {
        position.push(jet.origin[0] + jet.velocity[0] * t, jet.origin[1] + jet.velocity[1] * t - 4.905 * t * t, jet.origin[2] + jet.velocity[2] * t);
        origin.push(...jet.origin);
        vel.push(...jet.velocity);
        jetA.push(s, side, jet.flight, seed);
        shape.push(look.width[0], look.width[1], look.break.start, look.break.full + kind * 10);
      }
      if (i < segments) {
        const a = base + i * 2;
        index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setAttribute("aOrigin", new Float32BufferAttribute(origin, 3));
  g.setAttribute("aVel", new Float32BufferAttribute(vel, 3));
  g.setAttribute("aJet", new Float32BufferAttribute(jetA, 4));
  g.setAttribute("aShape", new Float32BufferAttribute(shape, 4));
  g.setIndex(index);
  g.boundingSphere = new Sphere(new Vector3(0, 2, 0), 6.6);
  return g;
}

/** The two curtains as one ring mesh each row a moment of the fall (`aCur`: angle, time since the lip, fall time, which). */
export function buildCurtainGeometry(tier: "high" | "low"): BufferGeometry {
  const { around, down } = CURTAIN_SEGMENTS[tier];
  const position: number[] = [];
  const normal: number[] = [];
  const cur: number[] = [];
  const index: number[] = [];
  for (let c = 0; c < FOUNTAIN.curtains.length; c++) {
    const f = curtainFlow(c);
    const base = position.length / 3;
    for (let j = 0; j <= down; j++) {
      // A little denser near the lip, where the sheet bends over it.
      const tn = (j / down) ** 1.3;
      const tau = tn * f.fall;
      const r = f.lipR + f.u * tau;
      const y = f.lipY - 4.905 * tau * tau;
      // The sheet's normal in the (r, y) plane: across the flow (u, -g tau), toward the outside and up.
      const nr = 9.81 * tau;
      const ny = f.u;
      const nl = Math.hypot(nr, ny);
      for (let i = 0; i <= around; i++) {
        const a = (2 * Math.PI * i) / around;
        position.push(r * Math.cos(a), y, r * Math.sin(a));
        normal.push((nr / nl) * Math.cos(a), ny / nl, (nr / nl) * Math.sin(a));
        cur.push(a, tau, f.fall, c);
      }
    }
    for (let j = 0; j < down; j++) {
      for (let i = 0; i < around; i++) {
        const a = base + j * (around + 1) + i;
        const b = a + around + 1;
        // Front faces look outward.
        index.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  g.setAttribute("aCur", new Float32BufferAttribute(cur, 4));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/** Every particle of a tier as one instanced quad; `farCount` of them (first) are drawn up to the mid distance. */
export function buildParticleGeometry(tier: "high" | "low"): { geometry: InstancedBufferGeometry; total: number; farCount: number } {
  const { particles, farCount } = buildParticles(tier);
  const n = Math.min(particles.length, PARTICLE_CAP[tier]);
  const origin = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const life = new Float32Array(n * 4);
  const kick = new Float32Array(n * 4);
  const kind = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = particles[i]!;
    origin.set(p.origin, i * 3);
    vel.set(p.velocity, i * 3);
    life.set([p.life, p.phase, p.show, p.size], i * 4);
    kick.set([p.kick[0], p.kick[1], p.kickAt, p.seed], i * 4);
    kind.set([p.kind, p.far], i * 2);
  }
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  g.setAttribute("aOrigin", new InstancedBufferAttribute(origin, 3));
  g.setAttribute("aVel", new InstancedBufferAttribute(vel, 3));
  g.setAttribute("aLife", new InstancedBufferAttribute(life, 4));
  g.setAttribute("aKick", new InstancedBufferAttribute(kick, 4));
  g.setAttribute("aKind", new InstancedBufferAttribute(kind, 2));
  g.instanceCount = n;
  g.boundingSphere = new Sphere(new Vector3(0, 2, 0), 6.8);
  return { geometry: g, total: n, farCount: Math.min(farCount, n) };
}

// ───────────────────────────────────────── shaders ─────────────────────────────────────────

const f = (x: number) => x.toFixed(6);

/** Uniforms, lighting and motion shared by the three shaders. */
const COMMON = /* glsl */ `
#define FW_G 9.81
uniform float uTime;      // the fountain's clock, wrapped every ${TIME_WRAP} s
uniform vec3 uOrigin;     // the fountain's centre (world)
uniform vec2 uViewport;   // the render viewport (px)
uniform float uMinPx;     // a stream or a drop is never drawn thinner than this (px): its alpha carries the rest
uniform sampler2D uNoise;
uniform sampler2D uSky;
uniform vec4 uSkyMap;
uniform vec3 uLand;
uniform vec3 uAmbient;    // the sky's light on white water (linear)
uniform vec3 uKeyDir;     // toward the sun (or the moon)
uniform vec3 uKeyColor;   // its light on white water
uniform vec3 uGlintColor; // its glint in a clear surface
uniform vec3 uGlow;       // the fountain's lights (colour x strength; 0 by day)
// A jet's launch velocity sways a little with the time it left the nozzle (each parcel keeps its own).
vec3 fwWobble( vec3 v, float tl, float seed ) {
  vec3 h = vec3( v.x, 0.0, v.z );
  float hl = length( h );
  vec3 lat = hl > 1e-3 ? vec3( -h.z, 0.0, h.x ) / hl : vec3( cos( seed * 2.4 ), 0.0, sin( seed * 2.4 ) );
  float a = sin( ${f(wrapOmega(1.7))} * tl + seed * 7.13 ) + 0.6 * sin( ${f(wrapOmega(4.3))} * tl + seed * 3.71 );
  float p = sin( ${f(wrapOmega(2.9))} * tl + seed * 5.31 );
  return v * ( 1.0 + 0.006 * p ) + lat * ( 0.02 * a );
}
// Henyey-Greenstein (g 0.6) relative to an even scatter: drops throw the light forward (bright against the sun).
float fwForward( float c ) {
  float d = 1.0 + 0.36 - 1.2 * c;
  return 0.64 / ( d * sqrt( d ) );
}
// Aerated (white) water seen along V (toward the camera): the sky's light and the key light, more when backlit.
vec3 fwWhite( vec3 V, float forward ) {
  float hg = min( fwForward( dot( -uKeyDir, V ) ), 3.0 );
  return uAmbient + uKeyColor * ( 0.4 + 0.6 * mix( 1.0, hg, forward ) );
}
// Where the water is ( r from the centre ): the surface a drop ends on.
float fwSurface( float r ) {
  return r < ${f(FOUNTAIN.bowl.lipR)} ? ${f(FOUNTAIN.bowl.y)} : ( r < ${f(FOUNTAIN.tier.lipR)} ? ${f(FOUNTAIN.tier.y)} : ${f(FOUNTAIN.pool.y)} );
}
`;

/** The streams: each vertex placed on its jet's parabola (at its share of the flight) and spread across to face the camera. */
const RIBBON_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${COMMON}
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec4 aJet;   // share of the flight, side (-1 / +1), flight (s), seed
attribute vec4 aShape; // diameter at the nozzle, at the end, breakup start, breakup full (+10: an upright jet)
varying vec3 vWorld;
varying vec3 vSide;
varying vec2 vUS;      // across (-1..1), along (0..1)
varying float vTl;     // when this water left the nozzle (s)
varying float vCover;  // the drawn width's share that is water (thin lines are drawn wider and fainter)
varying float vBreak;
varying float vSeed;
varying float vUpright;
void main() {
  float s = aJet.x;
  float t = s * aJet.z;
  float tl = uTime - t;
  float upright = aShape.w > 5.0 ? 1.0 : 0.0;
  float bFull = aShape.w - upright * 10.0;
  vec3 v = fwWobble( aVel, tl, aJet.w );
  vec3 p = aOrigin + v * t;
  p.y -= 0.5 * FW_G * t * t;
  vec3 tang = v;
  tang.y -= FW_G * t;
  // An upright column stays upright to its top (its sway is a few centimetres; the crown spreads round it).
  if ( upright > 0.5 ) tang.y = max( tang.y, 2.0 );
  tang = normalize( tang + vec3( 0.0, 1e-4, 0.0 ) );
  vec3 world = p + uOrigin;
  vec3 toCam = cameraPosition - world;
  float dist = length( toCam );
  toCam /= max( dist, 1e-4 );
  vec3 side = cross( tang, toCam );
  float sl = length( side );
  side = sl > 1e-3 ? side / sl : normalize( cross( tang, vec3( 0.0, 0.0, 1.0 ) ) );
  float b = smoothstep( aShape.z, bFull, s );
  // The broken part spreads: the ribbon widens to hold the fraying veil around the core (an upright jet's top
  // spreads into its crown).
  float w = mix( aShape.x, aShape.y, s ) * ( 1.0 + ( 1.8 + 0.6 * upright ) * b );
  float pxPerM = 0.5 * uViewport.y * projectionMatrix[ 1 ][ 1 ] / max( dist, 1e-3 );
  float wDraw = max( w, uMinPx / pxPerM );
  vCover = w / wDraw;
  world += side * ( aJet.y * 0.5 * wDraw );
  vWorld = world;
  vSide = side;
  vUS = vec2( aJet.y, s );
  vTl = tl;
  vBreak = b;
  vSeed = aJet.w + upright * 16.0;
  vUpright = upright;
  vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const RIBBON_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${COMMON}
${SKY_AT_GLSL}
varying vec3 vWorld;
varying vec3 vSide;
varying vec2 vUS;
varying float vTl;
varying float vCover;
varying float vBreak;
varying float vSeed;
varying float vUpright;
void main() {
  float u = vUS.x;
  float s = vUS.y;
  float b = vBreak;
  vec3 V = normalize( cameraPosition - vWorld );
  // Grain that flows with the water: sampled at the moment this water left the nozzle.
  float n1 = texture2D( uNoise, vec2( u * 0.05 + vSeed * 0.137, vTl * 3.0 ) ).r;
  // (An upright jet's top: the water slows to a stop there and would bunch its grain into bands: there the grain rises
  // with the column instead.)
  float flow = vUpright > 0.5 ? mix( vTl * 11.0, ( vWorld.y - uOrigin.y ) * 3.0 - uTime * 2.0, b ) : vTl * 11.0;
  float n2 = texture2D( uNoise, vec2( u * 0.21 + vSeed * 0.291, flow ) ).g;
  float n3 = texture2D( uNoise, vec2( u * 0.43 + vSeed * 0.077, flow * 2.1 ) ).a;
  // The clear core: narrower than the ribbon where it breaks, its edge wavy (the jet beads up before it breaks).
  float core = ( 1.0 / ( 1.0 + ( 1.8 + 0.6 * vUpright ) * b ) ) * ( 1.0 + 0.5 * b * ( n1 * 2.0 - 1.0 ) );
  float uc = u / max( core, 0.05 );
  float inCore = 1.0 - smoothstep( 0.85, 1.0, abs( uc ) );
  float ucl = clamp( uc, -1.0, 1.0 );
  // A glass rod: its normal turns from the camera to the side across it.
  vec3 n = normalize( vSide * ucl + V * sqrt( max( 0.0, 1.0 - ucl * ucl ) ) );
  float cosT = clamp( dot( n, V ), 0.0, 1.0 );
  float F = 0.02 + 0.98 * pow( 1.0 - cosT, 5.0 );
  vec3 R = reflect( -V, n );
  vec3 refl = skyAt( R ) * 0.9 + uGlintColor * pow( max( dot( R, uKeyDir ), 0.0 ), 600.0 ) * 8.0;
  // The glass lets the background through ( 1 - alpha ) and adds its reflection (alpha x colour).
  float glassA = ( 0.05 + 0.8 * F ) * inCore * ( 1.0 - 0.75 * b );
  // White water: drops and streaks, sparse at the edge of the veil, denser in the core.
  float veil = exp( -u * u * 2.6 ) * b;
  float streak = smoothstep( 0.5 - 0.22 * b, 0.95, n2 * 0.55 + n3 * 0.45 + 0.25 * inCore );
  float whiteA = veil * streak * ( 0.35 + 0.55 * b );
  // The smooth start is a little milky in the middle where the nozzle aerates it (an upright column more so).
  whiteA += inCore * ( 1.0 - b ) * ( 0.06 + 0.05 * vUpright );
  vec3 white = fwWhite( V, 0.8 );
  // At night the lights' light runs up inside the stream and leaks out where it breaks.
  // (An upright jet stands right over its light: its whole column glows a little.)
  float guide = vUpright > 0.5 ? exp( -0.5 * s ) * ( 0.16 + 0.84 * b ) : exp( -1.6 * s ) * ( 0.12 + 0.88 * b );
  vec3 glow = uGlow * guide;
  white += glow * 1.6;
  refl += glow * 0.35;
  float a = whiteA + glassA * ( 1.0 - whiteA );
  vec3 col = ( white * whiteA + refl * glassA * ( 1.0 - whiteA ) ) / max( a, 1e-3 );
  a *= vCover;
  // The upright jets end in their crown (the drops take over); the arcs fade into their splash just above the water.
  if ( vUpright > 0.5 ) a *= 1.0 - smoothstep( 0.8, 0.97, s );
  else a *= mix( 1.0, 0.35, smoothstep( 0.78, 0.98, s ) ) * smoothstep( 0.0, 0.05, vWorld.y - uOrigin.y - ${f(FOUNTAIN.pool.y)} );
  gl_FragColor = vec4( col, clamp( a, 0.0, 1.0 ) );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const CURTAIN_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aCur; // angle, time since the lip (s), fall time (s), which curtain
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vCur;
void main() {
  vCur = aCur;
  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  vWorld = worldPosition.xyz;
  vNormal = normalize( mat3( modelMatrix ) * normal );
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const CURTAIN_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${COMMON}
${SKY_AT_GLSL}
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vCur;
void main() {
  float which = vCur.w;
  float lipR = which < 0.5 ? ${f(FOUNTAIN.curtains[0].lipR)} : ${f(FOUNTAIN.curtains[1].lipR)};
  float along = vCur.x * lipR;          // metres around the lip
  float launch = uTime - vCur.y;        // when this water went over the lip
  float t = vCur.y / vCur.z;            // 0 at the lip .. 1 at the water
  // Where the strands are: a pattern across the flow that drifts only slowly, so each strand keeps its place as it falls.
  float sA = texture2D( uNoise, vec2( along * 2.3 + which * 0.31, launch * 0.12 ) ).r;
  float sB = texture2D( uNoise, vec2( along * 6.7 + which * 0.57, launch * 0.25 ) ).g;
  float strands = sA * 0.55 + sB * 0.45;
  // Grain down the flow (the film's ripples): moves at the water's speed and stretches as it falls.
  float g1 = texture2D( uNoise, vec2( along * 11.0, launch * 2.4 ) ).a;
  float g2 = texture2D( uNoise, vec2( along * 4.1 + 0.5, launch * 1.1 ) ).g;
  float grain = g1 * 0.6 + g2 * 0.4;
  // The sheet opens into strands as it falls (gaps between them widen; the strands keep their width) ...
  float tear = smoothstep( 0.22, 0.8, t );
  float open = smoothstep( 0.4 * tear, 0.4 * tear + 0.07, strands );
  // ... and the strands' ends break into drops.
  float drops = smoothstep( 0.32, 0.55, texture2D( uNoise, vec2( along * 7.3 + 0.21, launch * 7.0 ) ).a );
  float strand = open * mix( 1.0, drops, smoothstep( 0.72, 1.0, t ) );
  vec3 V = normalize( cameraPosition - vWorld );
  vec3 around = normalize( vec3( -vWorld.z + uOrigin.z, 0.0, vWorld.x - uOrigin.x ) );
  vec3 n = normalize( vNormal + around * ( g2 - 0.5 ) * 0.6 );
  if ( !gl_FrontFacing ) n = -n;
  float cosT = abs( dot( n, V ) );
  float F = 0.02 + 0.98 * pow( 1.0 - cosT, 5.0 );
  vec3 R = reflect( -V, n );
  vec3 refl = skyAt( R ) * 0.9 + uGlintColor * pow( max( dot( R, uKeyDir ), 0.0 ), 300.0 ) * 5.0;
  // The rounded lip: the water bulges over it and catches the sky in one bright line.
  float lip = 1.0 - smoothstep( 0.0, 0.06, t );
  float glassA = ( 0.14 + 0.7 * F + 0.22 * lip + 0.12 * grain ) * ( 1.0 - 0.55 * tear );
  float whiteA = tear * ( 0.2 + 0.55 * smoothstep( 0.45, 0.85, grain ) ) * smoothstep( 0.35, 0.7, strands + 0.25 * tear ) + 0.05 * ( 1.0 - tear );
  vec3 white = fwWhite( V, 0.4 );
  // At night: the pedestal pool's lights (r 1.9) light the strands of the upper curtain that fall past them; a
  // little of the basin's light reaches the lower one.
  float glowAt = 0.18;
  if ( which < 0.5 ) {
    float th = atan( vWorld.z - uOrigin.z, vWorld.x - uOrigin.x );
    float k = floor( ( th - ${f(FOUNTAIN.uprights.angle0)} ) / PI2 * ${f(FOUNTAIN.uprights.count)} + 0.5 );
    float ang = ${f(FOUNTAIN.uprights.angle0)} + k * PI2 / ${f(FOUNTAIN.uprights.count)};
    float d = abs( th - ang ) * lipR;
    glowAt = 0.15 + 1.6 * exp( -d * d / 0.08 ) * t;
  }
  white += uGlow * glowAt * 1.4;
  refl += uGlow * glowAt * 0.3;
  float a = whiteA + glassA * ( 1.0 - whiteA );
  vec3 col = ( white * whiteA + refl * glassA * ( 1.0 - whiteA ) ) / max( a, 1e-3 );
  a *= strand;
  // Into the water it lands in.
  a *= smoothstep( 0.0, 0.035, vWorld.y - uOrigin.y - ( which < 0.5 ? ${f(FOUNTAIN.tier.y)} : ${f(FOUNTAIN.pool.y)} ) );
  gl_FragColor = vec4( col, clamp( a, 0.0, 1.0 ) );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Particles: the shutter (s) a falling drop is smeared over on screen. */
export const SHUTTER = 1 / 45;
/** A particle stands for a clump of drops: its ink is this many times one drop's. */
export const DROP_GAIN = 5;

const PARTICLE_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${COMMON}
uniform float uLodDist;
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec4 aLife; // cycle (s), phase, shown from (share of the cycle), size (m)
attribute vec4 aKick; // sideways velocity (x, z), from (s), seed
attribute vec2 aKind; // kind, far class
varying vec2 vC;      // across, along (-1..1)
varying vec2 vHalf;   // half width, half length (px)
varying vec3 vColor;
varying float vAlpha;
varying float vMist;
void main() {
  float life = aLife.x;
  float age = fract( uTime / life + aLife.y ) * life;
  float kind = aKind.x;
  float seed = aKick.w;
  vec3 v = aVel;
  // The jets' own drops follow their stream's sway (the same launch velocity it had).
  if ( kind < 1.5 ) v = fwWobble( v, uTime - age, floor( seed ) );
  float kt = max( 0.0, age - aKick.z );
  vec3 p = aOrigin + v * age;
  p.y -= 0.5 * FW_G * age * age;
  p.xz += aKick.xy * kt;
  vec3 vel = v;
  vel.y -= FW_G * age;
  if ( kt > 0.0 ) vel.xz += aKick.xy;
  float mist = kind > 3.5 ? 1.0 : 0.0;  // soft clouds: the mist and the crowns' heads
  float head = kind > 4.5 ? 1.0 : 0.0;
  float phase = age / life;
  float vis = smoothstep( aLife.z, aLife.z + 0.05, phase );
  float puff = 1.0;
  if ( head > 0.5 ) {
    // A head bubbles on its jet's top, swaying with the column.
    vec3 sway = fwWobble( vec3( 0.0, 7.5, 0.0 ), uTime - 0.75, floor( seed ) ) * 0.75;
    p = aOrigin + vec3( sway.x + 0.025 * sin( 6.1 * age + seed * 9.0 ), 0.035 * sin( PI2 * phase ), sway.z + 0.025 * cos( 5.3 * age + seed * 4.0 ) );
    vel = vec3( 0.0 );
    puff = 0.85 + 0.25 * sin( PI2 * phase + seed );
    vis = 1.0;
  } else if ( mist > 0.5 ) {
    p = aOrigin + vec3( 0.18 * sin( 0.7 * age + seed ), 0.06 * age, 0.18 * cos( 0.5 * age + seed * 1.3 ) );
    vel = vec3( 0.0 );
    vis = sin( PI * phase );
  } else {
    // Gone into the water (or onto the stone) it falls on.
    vis *= smoothstep( 0.0, 0.03, p.y - fwSurface( length( p.xz ) ) );
  }
  // Level of detail: the far class is drawn to the mid distance, the near one only close up.
  float lodEnd = aKind.y > 0.5 ? ${f(PARTICLE_LOD.far)} : ${f(PARTICLE_LOD.near)};
  vis *= 1.0 - smoothstep( lodEnd - ${f(PARTICLE_LOD.fade)}, lodEnd, uLodDist );
  // Mist: never in the camera's face.
  vec3 world = p + uOrigin;
  float camD = length( cameraPosition - world );
  if ( head > 0.5 ) vis *= smoothstep( 0.4, 1.2, camD );
  else if ( mist > 0.5 ) vis *= smoothstep( 2.5, 4.5, camD ) * ( 1.0 - smoothstep( 30.0, 40.0, camD ) );
  vec4 c0 = projectionMatrix * viewMatrix * vec4( world, 1.0 );
  vec4 c1 = projectionMatrix * viewMatrix * vec4( world - vel * ${f(SHUTTER)}, 1.0 );
  vec2 halfVp = 0.5 * uViewport;
  vec2 a0 = c0.xy / max( c0.w, 1e-3 ) * halfVp;
  vec2 a1 = c1.xy / max( c1.w, 1e-3 ) * halfVp;
  if ( c1.w < 0.05 ) a1 = a0;
  vec2 d = a0 - a1;
  float len = length( d );
  vec2 dir = len > 1e-3 ? d / len : vec2( 0.0, 1.0 );
  float pxPerM = halfVp.y * projectionMatrix[ 1 ][ 1 ] / max( c0.w, 1e-3 );
  float diam = aLife.w * pxPerM * puff;
  float wPx = max( diam, uMinPx );
  float lPx = max( len, wPx );
  // Its ink (a clump of drops) spread over the streak it is smeared into.
  float gain = ${f(DROP_GAIN)} * ( kind > 0.5 && kind < 1.5 ? 1.3 : 1.0 );
  float ink = head > 0.5 ? 0.3 : ( mist > 0.5 ? 0.05 : min( 0.85, gain * diam * diam / ( wPx * lPx ) ) );
  vec2 centre = mist > 0.5 ? a0 : a0 - d * 0.5;
  vec2 axisL = mist > 0.5 ? vec2( 0.0, 1.0 ) : dir;
  vec2 axisW = vec2( -axisL.y, axisL.x );
  float hw = mist > 0.5 ? 0.5 * diam : 0.5 * wPx;
  float hl = mist > 0.5 ? 0.5 * diam : 0.5 * lPx;
  vec2 corner = centre + axisW * position.x * hw + axisL * position.y * hl;
  gl_Position = vec4( corner / halfVp * c0.w, c0.z, c0.w );
  vC = position.xy;
  vHalf = vec2( hw, hl );
  vMist = mist;
  // The light: white water lit by the sky and the key (drops throw it forward), a glint now and then, and at night the
  // lights' light that came up the stream.
  vec3 V = normalize( cameraPosition - world );
  vec3 col = fwWhite( V, 1.0 - 0.6 * mist );
  float tw = fract( sin( dot( vec2( seed, floor( uTime * 9.0 + seed * 7.0 ) ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  col += uGlintColor * step( 0.94, tw ) * ( 0.6 + 1.6 * clamp( dot( -uKeyDir, V ), 0.0, 1.0 ) ) * ( 1.0 - mist );
  float glow;
  if ( kind < 0.5 ) glow = exp( -1.6 * phase ) * 1.4;           // off an arc: lit from its nozzle
  else if ( kind < 1.5 ) glow = 1.5;                            // the crown, right above its light
  else if ( kind < 2.5 ) glow = 0.45;                           // off a curtain
  else if ( kind < 3.5 ) glow = 0.9;                            // a splash
  else if ( kind < 4.5 ) glow = 0.35;                           // mist
  else glow = 1.9;                                              // a crown's head, right above its light
  col += uGlow * glow;
  vColor = col;
  vAlpha = vis * ink;
  // Not shown (inside its stream, under the water, past its distance): no pixels at all.
  if ( vAlpha < 0.002 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
  #ifdef USE_FOG
    vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
    vFogDepth = - mvPosition.z;
  #endif
}
`;

const PARTICLE_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying vec2 vC;
varying vec2 vHalf;
varying vec3 vColor;
varying float vAlpha;
varying float vMist;
void main() {
  float m;
  if ( vMist > 0.5 ) m = exp( -3.2 * dot( vC, vC ) );
  else {
    // A drop smeared along its path: a capsule with round ends (in pixels), soft by a pixel.
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

// ───────────────────────────────────────── the system ─────────────────────────────────────────

/** Never thinner than this on screen (px): a 2 cm stream 20 m away is under a pixel, and would flicker. */
export const MIN_PX = 1.5;

/**
 * How the clock's light lands on white water (× the state's linear light): the sky's (hemisphere) and the key's. By day
 * this keeps the white water at about 0.6-1.2 (linear, under the rich tier's bloom threshold 1.6).
 */
export const WHITE_WATER_LIGHT = { ambient: 0.32, key: 0.135, glint: 0.9 } as const;
/** The fountain's lights in the streams and drops at night: × the lights' weight (0..1) × `WATER.fountainGlow.color`. */
export const FOUNTAIN_LIGHT_STRENGTH = 1.25;

/** Render order: the pool (the model's water, 0) first, then the curtains' inside and outside, the streams, the drops. */
export const FOUNTAIN_RENDER_ORDER = { curtainBack: 3, curtainFront: 4, ribbons: 5, particles: 6 } as const;

export interface FountainWater {
  /** The streams, curtains and drops (at the fountain's centre); add it to the scene. */
  group: Group;
  /** The uniforms every part shares (one object each). */
  uniforms: Record<string, IUniform>;
  /** The particle draw, and how many particles it has (in total, and drawn up to the mid distance). */
  particles: { mesh: Mesh; total: number; farCount: number };
  ribbons: Mesh;
  curtains: Mesh[];
  /** The noise texture (the pool's foam reads it too). */
  noise: DataTexture;
  /** What this made: dispose with the scene. */
  own: Array<Material | Texture | BufferGeometry>;
}

export interface FountainOptions {
  tier: "high" | "low";
  centre: { x: number; z: number };
  sky: Texture | null;
  skyMapping: SkyMapping;
  /** The noise texture to use (made here when absent). */
  noise?: DataTexture;
}

const viewport = new Vector4();

/** Build the fountain's streams, curtains and drops (see the file header). Rendering-ready; nothing is uploaded yet. */
export function createFountainWater(o: FountainOptions): FountainWater {
  const noise = o.noise ?? makeFountainNoise();
  const glow = new Color(WATER.fountainGlow.color);
  const uniforms: Record<string, IUniform> = {
    uTime: { value: 0 },
    uOrigin: { value: new Vector3(o.centre.x, 0, o.centre.z) },
    uViewport: { value: new Vector2(1280, 720) },
    uMinPx: { value: MIN_PX },
    uNoise: { value: noise },
    uSky: { value: o.sky },
    uSkyMap: { value: new Vector4(o.skyMapping.uSign, o.skyMapping.uOffset, o.skyMapping.vScale, o.skyMapping.vOffset) },
    uLand: { value: new Color(WATER.land) },
    uAmbient: { value: new Vector3(0.55, 0.55, 0.55) },
    uKeyDir: { value: new Vector3(0.6, 0.5, -0.3).normalize() },
    uKeyColor: { value: new Vector3(0.3, 0.27, 0.22) },
    uGlintColor: { value: new Vector3(0.9, 0.85, 0.75) },
    uGlow: { value: new Vector3(0, 0, 0) },
    uGlowBase: { value: new Vector3(glow.r, glow.g, glow.b) },
    uLodDist: { value: 0 },
  };
  const material = (name: string, vertexShader: string, fragmentShader: string, side: typeof FrontSide | typeof BackSide | typeof DoubleSide) => {
    const m = new ShaderMaterial({
      name,
      // Fog's uniforms are the material's own (three refreshes them); everything else is the shared objects.
      uniforms: { ...UniformsUtils.clone(UniformsLib.fog), ...uniforms },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      side,
    });
    m.forceSinglePass = true;
    return m;
  };
  const group = new Group();
  group.name = "fountain_water";
  group.position.set(o.centre.x, 0, o.centre.z);

  // The pixel size of what is drawn: the viewport of the target being drawn into (the rich tier's render scale included).
  const updateViewport = (renderer: WebGLRenderer) => {
    renderer.getCurrentViewport(viewport);
    (uniforms.uViewport!.value as Vector2).set(Math.max(1, viewport.z), Math.max(1, viewport.w));
  };

  const curtainGeometry = buildCurtainGeometry(o.tier);
  const curtainBack = material("M_fountain_curtain_back", CURTAIN_VERTEX, CURTAIN_FRAGMENT, BackSide);
  const curtainFront = material("M_fountain_curtain", CURTAIN_VERTEX, CURTAIN_FRAGMENT, FrontSide);
  const curtains = [
    new Mesh(curtainGeometry, curtainBack),
    new Mesh(curtainGeometry, curtainFront),
  ];
  curtains[0]!.name = "fountain_curtain_back";
  curtains[1]!.name = "fountain_curtain";
  curtains[0]!.renderOrder = FOUNTAIN_RENDER_ORDER.curtainBack;
  curtains[1]!.renderOrder = FOUNTAIN_RENDER_ORDER.curtainFront;

  const ribbonGeometry = buildRibbonGeometry(o.tier);
  const ribbonMaterial = material("M_fountain_streams", RIBBON_VERTEX, RIBBON_FRAGMENT, DoubleSide);
  const ribbons = new Mesh(ribbonGeometry, ribbonMaterial);
  ribbons.name = "fountain_streams";
  ribbons.renderOrder = FOUNTAIN_RENDER_ORDER.ribbons;
  ribbons.onBeforeRender = (renderer) => updateViewport(renderer);

  const built = buildParticleGeometry(o.tier);
  const particleMaterial = material("M_fountain_drops", PARTICLE_VERTEX, PARTICLE_FRAGMENT, DoubleSide);
  const drops = new Mesh(built.geometry, particleMaterial);
  drops.name = "fountain_drops";
  drops.renderOrder = FOUNTAIN_RENDER_ORDER.particles;
  drops.frustumCulled = true;
  const origin = uniforms.uOrigin!.value as Vector3;
  drops.onBeforeRender = (renderer, _scene, camera: Camera) => {
    updateViewport(renderer);
    const d = camera.position.distanceTo(origin);
    uniforms.uLodDist!.value = d;
    built.geometry.instanceCount = particleCountAt(d, built.total, built.farCount);
  };

  group.add(curtains[0]!, curtains[1]!, ribbons, drops);
  return {
    group,
    uniforms,
    particles: { mesh: drops, total: built.total, farCount: built.farCount },
    ribbons,
    curtains,
    noise,
    own: [curtainGeometry, curtainBack, curtainFront, ribbonGeometry, ribbonMaterial, built.geometry, particleMaterial, ...(o.noise ? [] : [noise])],
  };
}

/** Per frame: the fountain's clock (wrapped). Returns the wrapped time (the pool's `uFTime` takes the same). */
export function tickFountain(f: FountainWater, seconds: number): number {
  const t = wrapTime(seconds);
  f.uniforms.uTime!.value = t;
  return t;
}

/** Per frame: the time of day's light on the fountain's water (number writes only). */
export function fountainDayNight(f: FountainWater, s: DayNightState): void {
  const u = f.uniforms;
  const a = s.hemiIntensity * WHITE_WATER_LIGHT.ambient;
  (u.uAmbient!.value as Vector3).set(s.hemiSky[0] * a, s.hemiSky[1] * a, s.hemiSky[2] * a);
  const k = s.keyIntensity * WHITE_WATER_LIGHT.key;
  (u.uKeyColor!.value as Vector3).set(s.keyColor[0] * k, s.keyColor[1] * k, s.keyColor[2] * k);
  (u.uKeyDir!.value as Vector3).set(s.keyDir[0], s.keyDir[1], s.keyDir[2]);
  const level = Math.min(1, s.keyIntensity / 2.4) * WHITE_WATER_LIGHT.glint;
  (u.uGlintColor!.value as Vector3).set(s.keyColor[0] * level, s.keyColor[1] * level, s.keyColor[2] * level);
  const g = s.lights * FOUNTAIN_LIGHT_STRENGTH;
  const base = u.uGlowBase!.value as Vector3;
  (u.uGlow!.value as Vector3).set(base.x * g, base.y * g, base.z * g);
}

/** The particles drawn from `d` m (for a probe or a test): see `particleCountAt`. */
export function fountainParticlesAt(f: FountainWater, d: number): number {
  return particleCountAt(d, f.particles.total, f.particles.farCount);
}
