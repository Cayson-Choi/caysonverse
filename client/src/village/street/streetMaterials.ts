// Materials of the new lamp posts and banners (streetFurniture.ts). Lit live by the scene's sun and sky light (like the bus
// stop and the crossing signals), plus, at night, by the lanterns themselves: every fragment sums the warm light of the
// lanterns near it (a cheap point-light term, `uVillageLit` turns it on with the windows and lamps), so a banner hanging
// under its pole's lantern is lit from above at night and the posts catch their own lantern's glow.
//
// The textures that make them real up close are small, made here (no files): the powder coat's orange peel, chips and
// grime (bump + roughness + a colour wash), and the banner polyester's plain weave (a tiling bump, 1 mm threads). Only the
// banners' print is a file (street_banners.webp).

import {
  AdditiveBlending,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Texture,
} from "three";
import { litUniform } from "../villageModelPrep";
import { BANNER_ATLAS, LAMP_MODEL_LIGHT_Y, lanternPositions } from "./streetLayout";

/** The lanterns' light on what is near them (linear RGB × strength): a 2700-3000 K lamp, like the bake's. */
export const LANTERN_LIGHT = [1.0, 0.6, 0.3] as const;
export const LANTERN_STRENGTH = { metal: 1.6, fabric: 2.2 } as const;
/** The lantern glass's glow at full night (LIT.lamp in villageModelPrep: the old lanterns' colour and boost). */
export const LANTERN_GLOW = { color: [1.0, 0.5, 0.18] as const, boost: 2.6 };

/** Shared clock for the banners' wind (seconds). */
export const streetTime = { value: 0 };

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Tileable value noise on an n x n grid of `cells` cells (0..1). */
function tileNoise(n: number, cells: number, seed: number): Float32Array {
  const r = rng(seed);
  const g = Array.from({ length: cells * cells }, () => r());
  const at = (i: number, j: number): number => g[((j + cells) % cells) * cells + ((i + cells) % cells)]!;
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells;
      const fy = (y / n) * cells;
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      let tx = fx - i;
      let ty = fy - j;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const a = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
      const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
      out[y * n + x] = a + (b - a) * ty;
    }
  }
  return out;
}

function dataTexture(data: Uint8Array, n: number, srgb: boolean): DataTexture {
  const t = new DataTexture(data, n, n, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * The powder coat, 128 px a 0.5 m repeat: R = height (fine orange peel, a few chips and dents), G = roughness (satin 0.5,
 * rougher where weathered), and a colour texture (a soft wash, chips showing the grey primer).
 */
export function metalTextures(): { detail: DataTexture; color: DataTexture } {
  const n = 128;
  const peel = tileNoise(n, 32, 11);
  const blot = tileNoise(n, 4, 12);
  const fine = tileNoise(n, 64, 13);
  const r = rng(14);
  const chips: Array<[number, number, number]> = Array.from({ length: 7 }, () => [r() * n, r() * n, 0.8 + r() * 1.8]);
  const detail = new Uint8Array(n * n * 4);
  const color = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      let chip = 0;
      for (const [cx, cy, cr] of chips) {
        const dx = Math.min(Math.abs(x - cx), n - Math.abs(x - cx));
        const dy = Math.min(Math.abs(y - cy), n - Math.abs(y - cy));
        const d = Math.hypot(dx, dy) / cr;
        if (d < 1) chip = Math.max(chip, 1 - d);
      }
      const h = 0.5 + 0.22 * (peel[i]! - 0.5) + 0.1 * (fine[i]! - 0.5) - 0.35 * chip;
      const rough = 0.46 + 0.22 * blot[i]! + 0.25 * chip;
      detail[i * 4] = Math.round(Math.min(1, Math.max(0, h)) * 255);
      detail[i * 4 + 1] = Math.round(Math.min(1, rough) * 255);
      detail[i * 4 + 2] = 0;
      detail[i * 4 + 3] = 255;
      // the colour multiplies the paint's colour: a soft weathered wash, chips toward the lighter primer
      const wash = 0.9 + 0.1 * blot[i]! + 0.04 * (fine[i]! - 0.5);
      const c = Math.min(255, Math.round(255 * (wash * (1 - chip) + 1.6 * chip)));
      color[i * 4] = c;
      color[i * 4 + 1] = c;
      color[i * 4 + 2] = Math.min(255, Math.round(c * 0.98));
      color[i * 4 + 3] = 255;
    }
  }
  return { detail: dataTexture(detail, n, false), color: dataTexture(color, n, true) };
}

/** Plain weave, 8 x 8 threads a tile (R = height): over-under warp and weft with rounded threads. */
export function weaveTexture(): DataTexture {
  const n = 64;
  const T = n / 8;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const ix = Math.floor(x / T);
      const iy = Math.floor(y / T);
      const fx = (x % T) / T;
      const fy = (y % T) / T;
      const warpUp = (ix + iy) % 2 === 0; // the warp (vertical thread) on top here
      const warp = Math.sin(fx * Math.PI); // round thread profile across
      const weft = Math.sin(fy * Math.PI);
      const h = warpUp ? 0.55 + 0.45 * warp * (0.8 + 0.2 * Math.sin(fy * Math.PI)) : 0.55 + 0.45 * weft * (0.8 + 0.2 * Math.sin(fx * Math.PI));
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.round(h * 255);
      d[i + 3] = 255;
    }
  }
  return dataTexture(d, n, false);
}

/** A soft warm pool of light on the paving (alpha), for the banner poles' new lanterns (the old posts have theirs baked). */
export function poolTexture(): DataTexture {
  const n = 64;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5) * 2;
      const a = Math.max(0, 1 - r) ** 2.2;
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  }
  const t = dataTexture(d, n, false);
  t.wrapS = t.wrapT = 1001; // ClampToEdgeWrapping
  return t;
}

const LAMPS = lanternPositions();
const lampUniform = { value: LAMPS.map(([x, y, z]) => new Vector3(x, y, z)) };

const VERT_PARS = /* glsl */ `
attribute float liftW;
attribute float aLift;
varying vec3 vStreetWorld;
varying vec3 vStreetNormal;
varying float vStreetLocalY;
#ifdef STREET_FABRIC
attribute vec3 fab;
attribute vec2 aSlot;
attribute float aPhase;
uniform float uStreetTime;
uniform vec2 uSlotSize;
float stWind( vec2 f, float t, float ph ) {
  float gust = 0.55 + 0.45 * sin( t * 0.37 + ph * 2.0 ) * sin( t * 0.23 + ph );
  float w = sin( t * 2.1 + f.x * 3.0 + f.y * 2.2 + ph ) * 0.6 + sin( t * 3.7 - f.y * 4.4 + f.x * 2.3 + ph * 1.7 ) * 0.4;
  float hang = sin( 3.14159 * f.y );
  // a slack banner billows a little even in still air, and the free (outer) edge moves most
  return hang * ( 0.012 * sin( 3.14159 * f.x ) + 0.045 * gust * w * ( 0.35 + 0.65 * f.x ) );
}
#endif
void main() {`;

const BEGIN_NORMAL = /* glsl */ `#include <beginnormal_vertex>
#ifdef STREET_FABRIC
if ( fab.z > 0.5 ) {
  float e = 0.02;
  float d0 = stWind( fab.xy, uStreetTime, aPhase );
  float dx = ( stWind( fab.xy + vec2( e, 0.0 ), uStreetTime, aPhase ) - d0 ) / ( e * ${0.6.toFixed(2)} );
  float dy = ( stWind( fab.xy + vec2( 0.0, e ), uStreetTime, aPhase ) - d0 ) / ( e * ${1.8.toFixed(2)} );
  objectNormal = normalize( vec3( -dx, -dy, 1.0 ) ) * sign( objectNormal.z );
}
#endif`;

const BEGIN_VERTEX = /* glsl */ `#include <begin_vertex>
vStreetLocalY = transformed.y;
transformed.y += liftW * aLift;
#ifdef STREET_FABRIC
transformed.z += fab.z * stWind( fab.xy, uStreetTime, aPhase );
#endif`;

const UV_VERTEX = /* glsl */ `#include <uv_vertex>
#if defined( STREET_FABRIC ) && defined( USE_MAP )
vMapUv = aSlot + uv * uSlotSize;
#endif`;

const WORLD_VERTEX = /* glsl */ `#include <project_vertex>
{
  vec4 stW = vec4( transformed, 1.0 );
  vec3 stN = objectNormal;
  #ifdef USE_INSTANCING
  stW = instanceMatrix * stW;
  stN = mat3( instanceMatrix ) * stN;
  #endif
  vStreetWorld = ( modelMatrix * stW ).xyz;
  vStreetNormal = normalize( mat3( modelMatrix ) * stN );
}`;

const FRAG_PARS = /* glsl */ `
#define STREET_LAMP_COUNT ${LAMPS.length}
uniform vec3 uStreetLamps[ STREET_LAMP_COUNT ];
uniform float uVillageLit;
uniform vec3 uStreetLampColor;
varying vec3 vStreetWorld;
varying vec3 vStreetNormal;
varying float vStreetLocalY;
void main() {`;

/** The lanterns' light, added to the direct diffuse (a fabric also lets some through from behind). */
const LAMP_LIGHT = /* glsl */ `#include <lights_fragment_end>
if ( uVillageLit > 0.001 ) {
  vec3 stN = normalize( vStreetNormal );
  vec3 stSum = vec3( 0.0 );
  for ( int i = 0; i < STREET_LAMP_COUNT; i++ ) {
    vec3 L = uStreetLamps[ i ] - vStreetWorld;
    float d2 = dot( L, L );
    float fall = smoothstep( 110.0, 9.0, d2 ) / ( 1.0 + d2 * 0.5 );
    float ndl = dot( stN, L * inversesqrt( d2 + 1e-4 ) );
    #ifdef STREET_FABRIC
    float lit = max( ndl, 0.0 ) * 0.75 + 0.25 + 0.35 * max( -ndl, 0.0 );
    #else
    float lit = max( ndl, 0.0 ) * 0.85 + 0.15;
    #endif
    stSum += lit * fall;
  }
  reflectedLight.directDiffuse += uVillageLit * uStreetLampColor * stSum * diffuseColor.rgb;
}`;

/** The metal's grime: darker and duller in the splash zone at its foot. */
const GRIME = /* glsl */ `#include <map_fragment>
diffuseColor.rgb *= mix( 0.72, 1.0, smoothstep( 0.0, 0.45, vStreetLocalY ) );`;

function inject(
  m: MeshStandardMaterial,
  key: string,
  opts: { fabric?: boolean; grime?: boolean; strength: number; extra?: Record<string, { value: unknown }> },
): void {
  const color = new Vector3(LANTERN_LIGHT[0], LANTERN_LIGHT[1], LANTERN_LIGHT[2]).multiplyScalar(opts.strength);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uStreetLamps = lampUniform;
    shader.uniforms.uVillageLit = litUniform;
    shader.uniforms.uStreetLampColor = { value: color };
    if (opts.extra) Object.assign(shader.uniforms, opts.extra);
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", (opts.fabric ? "#define STREET_FABRIC\n" : "") + VERT_PARS)
      .replace("#include <beginnormal_vertex>", BEGIN_NORMAL)
      .replace("#include <begin_vertex>", BEGIN_VERTEX)
      .replace("#include <uv_vertex>", UV_VERTEX)
      .replace("#include <project_vertex>", WORLD_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", (opts.fabric ? "#define STREET_FABRIC\n" : "") + FRAG_PARS)
      .replace("#include <lights_fragment_end>", LAMP_LIGHT);
    if (opts.grime) shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", GRIME);
  };
  m.customProgramCacheKey = () => key;
}

/** Dark grey powder-coated steel and cast iron (posts and the banner hardware). */
export function metalMaterial(tex: { detail: Texture; color: Texture }): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    name: "M_street_metal",
    color: new Color("#464d56"),
    map: tex.color,
    roughness: 1,
    roughnessMap: tex.detail,
    bumpMap: tex.detail,
    bumpScale: 0.6,
    metalness: 0.15,
  });
  inject(m, "street-metal", { grime: true, strength: LANTERN_STRENGTH.metal });
  return m;
}

/** The lantern's opal glass: milky by day, glowing warm at night (`setGlassLit`). */
export function glassMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    name: "M_street_glass",
    color: new Color("#ece9e1"),
    roughness: 0.22,
    metalness: 0,
    emissive: new Color(LANTERN_GLOW.color[0], LANTERN_GLOW.color[1], LANTERN_GLOW.color[2]),
    emissiveIntensity: 0,
  });
  const base = LAMP_MODEL_LIGHT_Y - 0.226;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute float liftW;\nattribute float aLift;\nvarying float vStreetLocalY;\nvoid main() {")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvStreetLocalY = transformed.y;\ntransformed.y += liftW * aLift;");
    // brighter round the lamp's middle, a little dimmer at the tray and under the roof
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "varying float vStreetLocalY;\nvoid main() {")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.6 + 0.55 * sin( 3.14159 * clamp( ( vStreetLocalY - ${base.toFixed(3)} ) / 0.402, 0.0, 1.0 ) );`,
      );
  };
  m.customProgramCacheKey = () => "street-glass";
  return m;
}

/** The glass's glow for how lit the village is (0..1). */
export function setGlassLit(m: MeshStandardMaterial, lit: number): void {
  m.emissiveIntensity = lit * LANTERN_GLOW.boost;
}

/** The banners' printed polyester: the atlas cell per instance (`aSlot`), the weave as a bump, the wind in the vertices. */
export function fabricMaterial(print: Texture, weave: Texture): MeshStandardMaterial {
  weave.repeat.set(75, 225); // 8 mm a tile of 8 threads: 1 mm threads on 60 x 180 cm
  const m = new MeshStandardMaterial({
    name: "M_street_banner",
    map: print,
    roughness: 0.82,
    metalness: 0,
    bumpMap: weave,
    bumpScale: 0.35,
  });
  inject(m, "street-fabric", {
    fabric: true,
    strength: LANTERN_STRENGTH.fabric,
    extra: { uStreetTime: streetTime, uSlotSize: { value: new Vector2(1 / BANNER_ATLAS.cols, 1 / BANNER_ATLAS.rows) } },
  });
  return m;
}

/** The pools under the banner poles' lanterns (additive, faded in with the night). */
export function poolMaterial(map: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({
    name: "M_street_pool",
    map,
    color: new Color(LANTERN_GLOW.color[0], 0.62, 0.34),
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}
