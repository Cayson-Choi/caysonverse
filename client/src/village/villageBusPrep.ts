import { versionedUrl } from "./modelUrl";
import {
  AddEquation,
  Color,
  CustomBlending,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Vector3,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
} from "three";
import { VILLAGE_LAYOUT, type VillageLayout } from "@caysonverse/shared/village/villageLayout";
import { COLLIDER_PREFIX, isMesh } from "../game/hub/hubModelPrep";
import { neutralToneMap } from "../game/quality";
import { LIGHTING } from "../game/sceneLighting";
import { linearHex, type DayNightState } from "./dayNightBlend";
import { VILLAGE_GROUND_DECAL, type VillageTier } from "./villageModelPrep";

/**
 * 케이슨 마을's village bus (`village_bus.glb`, art/village/tools/build_bus.py): a 9 m low-floor midibus modelled by
 * script — the pure part, unit-tested with a hand-built node tree (villageBusPrep.test.ts).
 *
 * Unlike the village (unlit, light-mapped), the bus is lit live like the avatars: PBR materials under the scene's sun
 * and sky light, so it follows the time of day by itself. Its shadow on the road is baked, like the village's: the
 * contact shadow round and under it, in its ground quad, on both tiers. Bus review r4: no long shadow from the day
 * bake's sun any more (it fell 9 m west across the verge onto the plaza, opposite to the avatars' live shadows); the
 * contact shadow hugs the body, like the houses' and the benches'. It casts no live shadow either: the live sun follows
 * the clock while the village's baked shadows keep the bake's afternoon (and a live one lay on the asphalt as a blue
 * patch through the shadow floor). On the rich tier it takes the avatars' live shadows.
 *
 * The paint, chrome and glass reflect the sky, kept as plain as the village's houses (bus review r4, the owner: the bus
 * at the houses' level of detail, not photo-real): an analytic sky, a soft blend from the ground's colour through the
 * horizon's to the zenith's by the reflected direction's height, softened toward their average with roughness — no
 * horizon line, no band of tree tops — and no environment map, so no PMREM pass (its blur shader made ANGLE's HLSL
 * compiler log warnings) and no texture fetch. The paint adds it to three's indirect specular light. The glass mirrors
 * one even sky colour (their average) by its own Fresnel term over the tint and the cabin (stronger than the physical
 * 4 %: the live-lit cabin behind it is brighter than a real one): plain, even glass like the houses' windows, the cabin
 * showing through (r3 had a wavy band of trees painted across every window at the same height). Its strength follows
 * the time of day's sky light (`busEnvScale`).
 *
 * The file's contract (build_bus.py; checked by villageBusPrep.test.ts's stand-in and the e2e probe):
 *  - one node `village_bus`, modelled nose north (-z), doors east (+x), its footprint centred on the origin, on the
 *    ground (y = 0): placed at the layout's parked-bus box (`busStop.bus.centre`) as it is;
 *  - `M_bus`: the atlas (base colour × COLOR_0 = baked ambient occlusion; ORM: R = the clear coat's mask, G roughness,
 *    B metalness; emissive = what glows at night: lamps, LED dots, the lit cabin), double-sided;
 *  - `M_bus_glass`: tinted glass (alpha blended, see-through to the cabin);
 *  - `M_bus_led`: the three destination signs, amber LED dots that read the village's own name: 케이슨 마을 on the
 *    front and the kerb-side sign, 마을버스 on the rear (livery r4, make_bus_textures.py); lit by day too. The front
 *    sign has no pane over it; the kerb-side and rear signs stand a few cm behind the windows' tinted glass. Seen
 *    through that glass they read as switched off: on the light tier, which blends the glass in sRGB over a sign
 *    already tone-mapped and clamped, a grey sign (bus review r4, P2); on the rich tier, by day, a fifth of the dots'
 *    light under the sky's reflection, a grey sign with beige letters beside the lit amber front (r4 polish, visual
 *    r1). So on both tiers the glass in front of a sign keeps only its Fresnel reflection (`busSignsBehindGlass`,
 *    SIGN_PARS), a sign's clear cover as the front's: all three read as lit amber dots on dark, none brighter than
 *    the front;
 *  - `M_bus_ground`: a quad on the road round the bus, 5 cm up (the village's ground decals' height, over every ground
 *    layer: the road at 1 cm, the paving rings, the lawns, the forecourt's 3 cm), whose base colour
 *    map carries, sRGB-encoded (three's decode gives the values themselves): in red the darkness its body and tyres put
 *    on the road (ambient occlusion baked in Blender, 1 = darkest; gone 0.5 m out from the body and before the kerbs),
 *    the contact shadow the village's light map is too coarse for (about 0.5 m a texel on the road); in green the
 *    night's light on the road (the low beams' pool ahead, inside the kerbs). Blue is unused. Drawn first among the
 *    transparent things in one pass: dst × (1 - darkness) + light (`GROUND_OUT`). The rich tier adds the light in
 *    linear light before its tone curve. The light tier draws straight to the canvas, after its tone curve, and blends
 *    in sRGB: its shadow factor is the rich tier's raised to 1/2.2, and its light is what the rich tier's sum shows on
 *    the night's asphalt (`busPoolAdds`; bus review r4, P4: adding the light itself raised to 1/2.2 made its pool about
 *    twice as bright, and grey).
 *
 * `prepareBus` works on a CLONE of the cached scene and makes its own materials (listed in `own`); the loader's stay as
 * they are, so `disposeBus` frees exactly what it made. The loader's textures get a modest anisotropic filter
 * (`setBusAnisotropy`): the side wordmark and the rear louvres stay readable at a grazing 7-10 m.
 */

export const BUS_MODEL_URL = versionedUrl("/models/village/village_bus.glb");

export const BUS_MATERIAL = { body: "M_bus", glass: "M_bus_glass", led: "M_bus_led", ground: "M_bus_ground" } as const;

/** The look's numbers (linear light; intensities are three's). */
export const BUS_LOOK = {
  /** The paint's and chrome's reflection of the sky (× the time of day's sky light, see `busEnvScale`). */
  envIntensity: 0.85,
  /** The sky the glass mirrors (× the time of day's sky light), and its Fresnel: this share head-on, all of it grazing. */
  glassEnvIntensity: 1.0,
  glassF0: 0.12,
  /**
   * The Fresnel of the glass in front of a sign (SIGN_PARS): a clean pane's physical 4 % head-on. The 12 % above
   * stands in for a cabin lit brighter than a real one; in front of a sign there is none, and on the rich tier, which
   * adds the reflection in linear light, 12 % of the sky over the dark sign read as a grey plate (sRGB ~0.25 against
   * the front sign's 0.11; r4 polish, visual r1).
   */
  signGlassF0: 0.04,
  /** How see-through the windows are, and their tint (sRGB). */
  glassOpacity: 0.8,
  glassColor: "#081014",
  /**
   * The rich tier's clear coat over the paint (its mask is the ORM map's red channel). Its roughness keeps the sun's
   * glint on the rolled roof edges a small highlight instead of a bloom halo (bus review: 0.12 bloomed).
   */
  clearcoat: 0.5,
  clearcoatRoughness: 0.25,
  /** The emissive map's strength at full night (headlamps and tail lamps, the DRL dots, the cabin's lights). */
  nightGlow: 1.7,
  /**
   * The destination signs: lit by day as real LED signs are, and bright (bus review r3: at 1.0 they read as faint dots
   * on a grey panel; the side and rear signs sit behind the tinted windows, the front one has no tinted pane since);
   * at night less, the glass passing more and the dark around them.
   */
  ledDay: 3.0,
  ledNight: 1.5,
  /** How see-through the glass is at full night: the lit cabin shows as it does in a real bus after dark. */
  glassNightOpacity: 0.55,
  /** The contact shadow's darkness where the baked map is white (under the floor, at the tyres' contact). */
  groundShadow: 0.85,
  /**
   * The low beams' pool at full night: the light it adds where its map is 1 (linear, × its colour: sRGB warm white), a
   * modest pool on the dark asphalt beside the street lamps' (bus review r4: as a factor on what is there, 3.0, the
   * night's blue-black asphalt hardly changed; r3: added at 0.42 the pools lay over the road and the paving as a flat
   * beige sheet; now the pool keeps to the asphalt ahead, inside the kerbs).
   */
  groundGlow: 0.035,
  groundGlowColor: "#FFF0DA",
  /**
   * The asphalt the pool lies on at full night (linear, before the tone curve: what the rich tier adds the pool's light
   * to), measured in front of the parked bus at 21:00 on both tiers (bus review r4, P4: the bare asphalt's median sRGB
   * ~0.006 / 0.045 / 0.114, undone through the neutral curve at the night's exposure 1.95). The light tier, which can
   * only add in sRGB after its tone curve, adds what the rich tier's sum shows on it (`busPoolAdds`): the same pool on
   * both tiers there (within 2/255 at its faint edge), within 5/255 on asphalt half to three times as bright.
   */
  nightAsphalt: [0.0045, 0.006, 0.0105],
  /** The textures' anisotropic filter (at most the GPU's): the wordmarks and louvres at a grazing angle. */
  anisotropy: 4,
  /** How far round a sign behind glass the glass turns clear (m; the sign's black backing box is wider). */
  signCoverMargin: 0.02,
} as const;

/** The reflected sky (linear): the village's afternoon — pale blue above, hazy at the horizon, grey-green ground. */
export const BUS_SKY = {
  zenith: [0.33, 0.45, 0.62],
  horizon: [0.78, 0.8, 0.82],
  ground: [0.16, 0.17, 0.14],
  groundFar: [0.32, 0.34, 0.3],
} as const;

/** Where the bus stands: the parked-bus box's centre, nose north as modelled (yaw 0). */
export function busPlacement(layout: Pick<VillageLayout, "busStop"> = VILLAGE_LAYOUT): { x: number; z: number; yaw: number } {
  const c = layout.busStop.bus.centre;
  return { x: c.x, z: c.z, yaw: 0 };
}

/** A destination sign that stands behind the windows' glass: its box (world) and the way it faces (an axis). */
export interface BusSign {
  lo: Vector3;
  hi: Vector3;
  normal: Vector3;
}

export interface BusNodes {
  root: Object3D;
  body: MeshStandardMaterial | null;
  glass: MeshStandardMaterial | null;
  led: MeshStandardMaterial | null;
  /** The contact shadow and the night's light on the road (null in a file without one). */
  ground: MeshBasicMaterial | null;
  /** The night's light on the road now (its shader reads it; `applyBusDayNight` writes). */
  groundGlow: { value: number };
  /** The renderer's tone-mapping exposure now: the light tier's pool is worked out through its tone curve. */
  groundExposure: { value: number };
  /** The signs behind the windows' glass (world boxes): the glass is clear in front of them, on both tiers. */
  signs: BusSign[];
  /** The sky reflection's strength on the paint and on the glass (their shaders read these; `applyBusDayNight` writes). */
  bodySky: { value: number };
  glassSky: { value: number };
  /** Materials this call made: freed with `disposeBus`. */
  own: Material[];
}

const average = (a: readonly number[], b: readonly number[], c: readonly number[]) =>
  new Vector3((a[0]! + b[0]! + c[0]!) / 3, (a[1]! + b[1]! + c[1]!) / 3, (a[2]! + b[2]! + c[2]!) / 3);

/** The sky's colours, shared by every bus material (one write reaches all). */
const skyUniforms = {
  uBusZenith: { value: new Vector3(...BUS_SKY.zenith) },
  uBusHorizon: { value: new Vector3(...BUS_SKY.horizon) },
  uBusGround: { value: new Vector3(...BUS_SKY.ground) },
  uBusGroundFar: { value: new Vector3(...BUS_SKY.groundFar) },
  uBusGlassF0: { value: BUS_LOOK.glassF0 as number },
  uBusSignF0: { value: BUS_LOOK.signGlassF0 as number },
  uBusSkyAverage: { value: average(BUS_SKY.zenith, BUS_SKY.horizon, BUS_SKY.groundFar) },
};

/**
 * The analytic sky's GLSL, declared before main: by the reflected direction's height, a soft blend from the ground's
 * colour (looking down) through the horizon's to the zenith's (bus review r4: no hard horizon line, no band of tree
 * tops: plain, as the houses' windows and walls are), softened toward their average with roughness.
 */
const SKY_PARS = /* glsl */ `uniform vec3 uBusZenith;
uniform vec3 uBusHorizon;
uniform vec3 uBusGround;
uniform vec3 uBusGroundFar;
uniform vec3 uBusSkyAverage;
uniform float uBusGlassF0;
uniform float uBusSky;
vec3 busSky( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
	vec3 r = transformNormalByInverseViewMatrix( reflect( - viewDir, normal ), viewMatrix );
	vec3 sky = mix( uBusHorizon, uBusZenith, smoothstep( 0.0, 0.7, r.y ) );
	vec3 ground = mix( uBusGroundFar, uBusGround, smoothstep( 0.0, 0.5, - r.y ) );
	vec3 c = mix( ground, sky, smoothstep( - 0.25, 0.25, r.y ) );
	return mix( c, uBusSkyAverage, smoothstep( 0.05, 0.75, roughness ) ) * uBusSky;
}
void main() {`;
/** The paint: the sky added to the indirect specular after three's own (empty) IBL, and to the clear coat's. */
const SKY_ADD = /* glsl */ `#include <lights_fragment_maps>
radiance += busSky( geometryViewDir, geometryNormal, material.roughness );
#ifdef USE_CLEARCOAT
	clearcoatRadiance += busSky( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
#endif`;
/**
 * The glass: its lit tint (alpha a) with the cabin behind it, and one even sky colour (the analytic sky's average,
 * whatever the direction) over both by the Fresnel F, written as one source colour and alpha for the normal blend:
 * dst × (1 - a') + src × a', a' = mix(a, 1, F). Plain, even glass (bus review r4): no scenery mirrored in it. F's
 * head-on share `busF0`: the glass's (GLASS_F0), or in front of a sign the clean pane's (SIGN_COVER).
 */
const GLASS_F0 = /* glsl */ `float busF0 = uBusGlassF0;
`;
const GLASS_ADD = /* glsl */ `float busF = busF0 + ( 1.0 - busF0 ) * pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 5.0 );
float busA = mix( diffuseColor.a, 1.0, busF );
outgoingLight = ( uBusSkyAverage * uBusSky * busF + outgoingLight * diffuseColor.a * ( 1.0 - busF ) ) / max( busA, 1e-3 );
diffuseColor.a = busA;
#include <opaque_fragment>`;

/** The most signs behind glass the glass looks for (the kerb side's and the rear's). */
export const BUS_SIGN_SLOTS = 2;

/** The signs' boxes as the glass's shader reads them (an empty slot faces nowhere: its normal is zero). */
export interface BusSignUniforms {
  uBusSignLo: { value: Vector3[] };
  uBusSignHi: { value: Vector3[] };
  uBusSignN: { value: Vector3[] };
}

const slots = () => Array.from({ length: BUS_SIGN_SLOTS }, () => new Vector3());

/**
 * The glass, on both tiers: clear in front of a sign (bus review r4, P2; the rich tier's since r4 polish, visual r1).
 * Seen from a sign's side, the ray from the eye
 * through this fragment of glass meets the sign's box beyond the glass: there the tint goes (alpha 0) and only a
 * clean pane's Fresnel reflection stays (`signGlassF0`), nearly as over the front sign, which has no pane. The world
 * position comes from the vertex shader.
 */
const SIGN_PARS = /* glsl */ `varying vec3 vBusWorld;
uniform vec3 uBusSignLo[ ${BUS_SIGN_SLOTS} ];
uniform vec3 uBusSignHi[ ${BUS_SIGN_SLOTS} ];
uniform vec3 uBusSignN[ ${BUS_SIGN_SLOTS} ];
uniform float uBusSignF0;
bool busOverSign() {
	vec3 d = vBusWorld - cameraPosition;
	d = mix( d, vec3( 1e-5 ), vec3( lessThan( abs( d ), vec3( 1e-5 ) ) ) );
	vec3 inv = 1.0 / d;
	for ( int i = 0; i < ${BUS_SIGN_SLOTS}; i ++ ) {
		if ( dot( cameraPosition - 0.5 * ( uBusSignLo[ i ] + uBusSignHi[ i ] ), uBusSignN[ i ] ) <= 0.0 ) continue;
		vec3 t0 = ( uBusSignLo[ i ] - cameraPosition ) * inv;
		vec3 t1 = ( uBusSignHi[ i ] - cameraPosition ) * inv;
		vec3 tn = min( t0, t1 );
		vec3 tf = max( t0, t1 );
		float tNear = max( max( tn.x, tn.y ), tn.z );
		float tFar = min( min( tf.x, tf.y ), tf.z );
		if ( tFar >= max( tNear, 1.0 ) ) return true;
	}
	return false;
}
void main() {`;
const SIGN_COVER = /* glsl */ `if ( busOverSign() ) {
	diffuseColor.a = 0.0;
	busF0 = uBusSignF0;
}
`;
const SIGN_VERTEX_PARS = /* glsl */ `varying vec3 vBusWorld;
void main() {`;
const SIGN_VERTEX = /* glsl */ `#include <project_vertex>
vBusWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`;

/**
 * The same test in TypeScript (SIGN_PARS mirrors it): is the glass at `glass` (world) in front of one of `signs`, seen
 * from `eye`? Seen from a sign's side only, and with the sign beyond the glass.
 */
export function busOverSign(eye: Vector3, glass: Vector3, signs: readonly BusSign[]): boolean {
  const d = [glass.x - eye.x, glass.y - eye.y, glass.z - eye.z].map((v) => (Math.abs(v) < 1e-5 ? 1e-5 : v));
  const o = [eye.x, eye.y, eye.z];
  for (const sg of signs) {
    const mid = sg.lo.clone().add(sg.hi).multiplyScalar(0.5);
    if (eye.clone().sub(mid).dot(sg.normal) <= 0) continue;
    const lo = [sg.lo.x, sg.lo.y, sg.lo.z];
    const hi = [sg.hi.x, sg.hi.y, sg.hi.z];
    let near = -Infinity;
    let far = Infinity;
    for (let k = 0; k < 3; k++) {
      const t0 = (lo[k]! - o[k]!) / d[k]!;
      const t1 = (hi[k]! - o[k]!) / d[k]!;
      near = Math.max(near, Math.min(t0, t1));
      far = Math.min(far, Math.max(t0, t1));
    }
    if (far >= Math.max(near, 1)) return true;
  }
  return false;
}

/**
 * Give a material the sky's reflection, its strength read from `strength` (idempotent per material): the paint's way
 * (`"paint"`, through three's specular) or the glass's (`"glass"`, its own Fresnel mix: GLASS_ADD). `cover`: the
 * glass clear in front of the signs behind it (SIGN_PARS).
 */
export function addBusSky(
  material: MeshStandardMaterial,
  strength: { value: number },
  kind: "paint" | "glass" = "paint",
  cover?: BusSignUniforms,
): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, skyUniforms, { uBusSky: strength }, cover);
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", SKY_PARS);
    if (kind === "glass") {
      shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", GLASS_F0 + (cover ? SIGN_COVER : "") + GLASS_ADD);
      if (cover) {
        shader.fragmentShader = shader.fragmentShader.replace("void main() {", SIGN_PARS);
        shader.vertexShader = shader.vertexShader.replace("void main() {", SIGN_VERTEX_PARS).replace("#include <project_vertex>", SIGN_VERTEX);
      }
    } else {
      shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_maps>", SKY_ADD);
    }
  };
  material.customProgramCacheKey = () => `village-bus-sky-${kind}${cover ? "-cover" : ""}`;
  material.needsUpdate = true;
}

/**
 * The destination signs behind the windows' glass, from the sign material's own triangles in world space (the bus
 * placed): grouped by the way they face; the front sign (facing forward, -z: it has no pane in front of it), anything
 * not upright, and any face turned into the cabin (the back of a sign: the glass in front of it would be the far
 * side's windows, seen across the cabin) left out; the largest `BUS_SIGN_SLOTS`, each box grown by `signCoverMargin`.
 */
export function busSignsBehindGlass(root: Object3D, led: Material): BusSign[] {
  const groups = new Map<string, BusSign & { area: number }>();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const e = new Vector3();
  root.updateMatrixWorld(true);
  const centre = new Vector3().setFromMatrixPosition(root.matrixWorld);
  root.traverse((o) => {
    if (!isMesh(o) || o.material !== led) return;
    const g = (o as Mesh).geometry as BufferGeometry;
    const pos = g.attributes.position;
    if (!pos) return;
    const idx = g.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const at = (k: number) => (idx ? idx.getX(i + k) : i + k);
      a.fromBufferAttribute(pos, at(0)).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, at(1)).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, at(2)).applyMatrix4(o.matrixWorld);
      n.subVectors(b, a).cross(e.subVectors(c, a));
      const twice = n.length();
      if (twice < 1e-9) continue;
      n.divideScalar(twice);
      if (Math.abs(n.y) > 0.5 || n.z < -0.5) continue;
      // facing out of the body (seen from outside), not into the cabin
      if (((a.x + b.x + c.x) / 3 - centre.x) * n.x + ((a.z + b.z + c.z) / 3 - centre.z) * n.z <= 0) continue;
      const key = Math.abs(n.x) >= Math.abs(n.z) ? (n.x > 0 ? "+x" : "-x") : "+z";
      let gr = groups.get(key);
      if (!gr) {
        const normal = key === "+z" ? new Vector3(0, 0, 1) : new Vector3(key === "+x" ? 1 : -1, 0, 0);
        gr = { lo: a.clone(), hi: a.clone(), normal, area: 0 };
        groups.set(key, gr);
      }
      for (const v of [a, b, c]) {
        gr.lo.min(v);
        gr.hi.max(v);
      }
      gr.area += twice / 2;
    }
  });
  const m = BUS_LOOK.signCoverMargin;
  return [...groups.values()]
    .sort((p, q) => q.area - p.area)
    .slice(0, BUS_SIGN_SLOTS)
    .map(({ lo, hi, normal }) => ({ lo: lo.subScalar(m), hi: hi.addScalar(m), normal }));
}

/** The body's material for a tier: the rich tier's clear-coated paint, or the light tier's plain standard material. */
function bodyMaterial(source: MeshStandardMaterial, tier: VillageTier): MeshStandardMaterial {
  let m: MeshStandardMaterial;
  if (tier === "high") {
    const p = new MeshPhysicalMaterial();
    // The standard material's own properties (MeshPhysicalMaterial.copy wants a physical source), then the physical
    // material's defines back.
    MeshStandardMaterial.prototype.copy.call(p, source);
    p.defines = { STANDARD: "", PHYSICAL: "" };
    p.clearcoat = BUS_LOOK.clearcoat;
    p.clearcoatRoughness = BUS_LOOK.clearcoatRoughness;
    p.clearcoatMap = source.roughnessMap; // the ORM map: its red channel is the clear coat's mask
    m = p;
  } else {
    m = source.clone();
  }
  m.name = source.name;
  m.side = DoubleSide;
  m.envMap = null;
  m.emissiveIntensity = 0;
  return m;
}

function glassMaterial(source: MeshStandardMaterial): MeshStandardMaterial {
  const m = source.clone();
  m.color.set(BUS_LOOK.glassColor);
  m.transparent = true;
  m.opacity = BUS_LOOK.glassOpacity;
  m.depthWrite = false;
  m.roughness = 0.05;
  m.metalness = 0;
  // Both faces (the far windows are seen from inside) in ONE pass: three draws a transparent double-sided material
  // twice, back faces then front, unless told otherwise (bus review: 4 draw calls, the glass's triangles twice).
  m.side = DoubleSide;
  m.forceSinglePass = true;
  m.vertexColors = false;
  m.envMap = null;
  return m;
}

type Rgb = [number, number, number];

/** sRGB's transfer (three's sRGBTransferOETF): linear light to what the canvas stores. */
const encodeSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** What the village's light tier writes to the canvas for a linear colour: its tone curve (neutral) at `exposure`, in sRGB. */
export function busDisplay(rgb: readonly number[], exposure: number): Rgb {
  const t = neutralToneMap(rgb, exposure);
  return [encodeSrgb(Math.max(0, t[0])), encodeSrgb(Math.max(0, t[1])), encodeSrgb(Math.max(0, t[2]))];
}

/**
 * What the ground quad adds where the pool's light is `light` (linear; GROUND_OUT mirrors this). The rich tier adds the
 * light itself, in linear light, before its tone curve. The light tier adds in sRGB on the canvas, after its tone
 * curve: there it adds what the rich tier's sum shows on the night's asphalt, display(asphalt + light) -
 * display(asphalt): the same pool on both tiers there (warm: the neutral curve's toe lifts the dark red most), a little
 * more on brighter ground (bus review r4, P4: the light itself raised to 1/2.2 was about twice the rich tier's, and grey).
 * Never below 0: an 8-bit canvas clamps a fragment's colour to 0..1 before it blends, so the light tier cannot take
 * away. At the pool's faint edge the toe's offset grows with the light and the rich tier's sum loses a little blue;
 * there the light tier keeps the asphalt's blue, at most about 2/255 more than the rich tier (polish tech r1).
 */
export function busPoolAdds(
  tier: VillageTier,
  light: readonly number[],
  exposure: number,
  asphalt: readonly number[] = BUS_LOOK.nightAsphalt,
): Rgb {
  if (tier === "high") return [light[0]!, light[1]!, light[2]!];
  const lit = busDisplay([asphalt[0]! + light[0]!, asphalt[1]! + light[1]!, asphalt[2]! + light[2]!], exposure);
  const bare = busDisplay(asphalt, exposure);
  return [Math.max(0, lit[0] - bare[0]), Math.max(0, lit[1] - bare[1]), Math.max(0, lit[2] - bare[2])];
}

/**
 * The ground quad's uniforms, and the light tier's display of a linear colour (`busDisplay`): three's own
 * NeutralToneMapping (tonemapping_pars_fragment, which a material that is not tone-mapped does not get), word for word
 * but for its exposure, `uBusExposure` (villageBusPrep.test.ts holds it to three's).
 */
const GROUND_PARS = /* glsl */ `uniform float uBusGlow;
uniform vec3 uBusGlowColor;
uniform vec3 uBusAsphalt;
uniform float uBusExposure;
vec3 busNeutral( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= uBusExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 busDisplay( vec3 c ) {
	return sRGBTransferOETF( vec4( max( busNeutral( c ), 0.0 ), 1.0 ) ).rgb;
}
void main() {`;

/**
 * The ground quad's output, written last (after three's tone mapping, colour space and fog: a light and a darkness,
 * not a surface's colour): the darkness (alpha) is the contact shadow (red), the night's light (green) is added. The
 * blend (`One`, `OneMinusSrcAlpha`: premultiplied) gives dst × (1 - darkness) + light. The light tier blends in sRGB
 * on the canvas (`BUS_SRGB_CANVAS`): its shadow factor is the rich tier's raised to 1/2.2, its light `busPoolAdds`.
 */
export const GROUND_OUT = /* glsl */ `vec4 busG = texture2D( map, vMapUv );
float busKeep = 1.0 - busG.r * opacity;
vec3 busLight = uBusGlowColor * ( busG.g * uBusGlow );
#ifdef BUS_SRGB_CANVAS
busLight = max( busDisplay( uBusAsphalt + busLight ) - busDisplay( uBusAsphalt ), 0.0 );
busKeep = pow( busKeep, 1.0 / 2.2 );
#endif
gl_FragColor = vec4( busLight, 1.0 - busKeep );`;

/**
 * The contact shadow and the low beams' pool: the file's map read by channel (GROUND_OUT), on the road round the
 * bus, drawn first among the transparent things. The quad lies at the village's decal height and the material carries
 * its offset (VILLAGE_GROUND_DECAL, stronger than every ground layer's): bus review r3 found the quad 1 cm UNDER the
 * road, where the depth test hid it from most views (and at 2 cm it still hid under the paving's rings). No fog.
 */
function groundMaterial(source: MeshStandardMaterial, nodes: Pick<BusNodes, "groundGlow" | "groundExposure">, tier: VillageTier): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: BUS_LOOK.groundShadow });
  if (tier !== "high") m.defines = { BUS_SRGB_CANVAS: "" };
  m.name = source.name;
  m.map = source.map;
  m.fog = false;
  m.toneMapped = false;
  m.blending = CustomBlending;
  m.blendEquation = AddEquation;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.polygonOffset = true;
  m.polygonOffsetFactor = VILLAGE_GROUND_DECAL.polygonOffsetFactor;
  m.polygonOffsetUnits = VILLAGE_GROUND_DECAL.polygonOffsetUnits;
  const glowColor = new Color(BUS_LOOK.groundGlowColor);
  const asphalt = new Vector3(...BUS_LOOK.nightAsphalt);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uBusGlow: nodes.groundGlow,
      uBusGlowColor: { value: glowColor },
      uBusAsphalt: { value: asphalt },
      uBusExposure: nodes.groundExposure,
    });
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", GROUND_PARS).replace("#include <dithering_fragment>", GROUND_OUT);
  };
  m.customProgramCacheKey = () => `village-bus-ground-${tier === "high" ? "linear" : "srgb"}`;
  return m;
}

function ledMaterial(source: MeshStandardMaterial): MeshStandardMaterial {
  const m = source.clone();
  m.vertexColors = false;
  m.emissiveIntensity = BUS_LOOK.ledDay;
  return m;
}

/**
 * Dress a clone of the loaded bus: placed at the stop, its materials made for the tier (the paint and glass reflecting
 * the sky), the night's glow off, live shadows taken on the rich tier only (none cast: its shadows are baked into the
 * ground quad). The bus never moves: its matrices are computed once.
 */
export function prepareBus(source: Object3D, tier: VillageTier, layout: Pick<VillageLayout, "busStop"> = VILLAGE_LAYOUT): BusNodes {
  const root = source.clone(true);
  const at = busPlacement(layout);
  root.position.set(at.x, 0, at.z);
  root.rotation.set(0, at.yaw, 0);
  const made = new Map<Material, Material>();
  const nodes: BusNodes = {
    root,
    body: null,
    glass: null,
    led: null,
    ground: null,
    bodySky: { value: BUS_LOOK.envIntensity },
    glassSky: { value: BUS_LOOK.glassEnvIntensity },
    groundGlow: { value: 0 },
    groundExposure: { value: 1 },
    signs: [],
    own: [],
  };
  // the glass, on both tiers: clear in front of the signs behind it (filled once the bus is placed, below)
  const cover: BusSignUniforms = { uBusSignLo: { value: slots() }, uBusSignHi: { value: slots() }, uBusSignN: { value: slots() } };
  const swap = (m: Material): Material => {
    const hit = made.get(m);
    if (hit) return hit;
    const s = m as MeshStandardMaterial;
    let out: Material | null = null;
    if (m.name === BUS_MATERIAL.body) {
      out = nodes.body = bodyMaterial(s, tier);
      addBusSky(nodes.body, nodes.bodySky);
    } else if (m.name === BUS_MATERIAL.glass) {
      out = nodes.glass = glassMaterial(s);
      addBusSky(nodes.glass, nodes.glassSky, "glass", cover);
    } else if (m.name === BUS_MATERIAL.led) {
      out = nodes.led = ledMaterial(s);
    } else if (m.name === BUS_MATERIAL.ground) {
      out = nodes.ground = groundMaterial(s, nodes, tier);
    }
    if (!out) return m;
    made.set(m, out);
    nodes.own.push(out);
    return out;
  };
  root.traverse((o) => {
    if (o.name.startsWith(COLLIDER_PREFIX)) {
      o.visible = false;
      return;
    }
    if (!isMesh(o)) return;
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    const ground = !Array.isArray(o.material) && o.material.name === BUS_MATERIAL.ground;
    o.castShadow = false; // its shadow is baked into the ground quad (the contact shadow)
    // The avatars' live shadows fall on it on the rich tier (the road under the ground quad takes its own).
    o.receiveShadow = tier === "high" && !ground;
    if (ground) o.renderOrder = -1; // under the glass, whatever the sort
  });
  root.updateMatrixWorld(true);
  if (nodes.led) nodes.signs = busSignsBehindGlass(root, nodes.led);
  root.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.matrixWorldAutoUpdate = false;
  });
  nodes.signs.forEach((sg, i) => {
    cover.uBusSignLo.value[i]!.copy(sg.lo);
    cover.uBusSignHi.value[i]!.copy(sg.hi);
    cover.uBusSignN.value[i]!.copy(sg.normal);
  });
  return nodes;
}

/**
 * A modest anisotropic filter on the bus's drawn detail: the paint's atlas (the wordmarks, the louvres, the seams) and the
 * signs' dots. At a grazing 7-10 m the side wordmark and the rear louvres stay readable instead of smearing into the
 * paint (bus review r4, P3). The ORM and glow maps keep plain filtering (no fine detail; measured on the rich tier, all
 * four filtered cost ~0.08 ms of GPU a frame with the bus filling the view). `max`: the GPU's
 * (`renderer.capabilities.getMaxAnisotropy()`). The textures are the loader's, shared by every clone: set once, before
 * their first upload (the same value on a re-dress, so never uploaded again). Returns the level.
 */
export function setBusAnisotropy(nodes: Pick<BusNodes, "body" | "led">, max: number): number {
  const level = Math.max(1, Math.min(BUS_LOOK.anisotropy, Math.floor(max)));
  for (const t of [nodes.body?.map, nodes.led?.map, nodes.led?.emissiveMap]) {
    if (!t || t.anisotropy === level) continue; // (a texture listed twice is set once)
    t.anisotropy = level;
    t.needsUpdate = true;
  }
  return level;
}

/** Linear luminance of a linear RGB triple. */
const luma = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

/** The day's sky light (linear luminance × intensity), what the reflected sky's colours stand for. */
const DAY_SKY_LIGHT = luma(linearHex(LIGHTING.village.hemi[0])) * LIGHTING.village.hemi[2];

/**
 * How much of the day's sky the bus reflects now: the live sky light (the hemisphere light's sky colour × intensity, as
 * the clock eases it) against the day's, 0.05 .. 1.2. At night the sky light is dim and blue: the paint and glass
 * reflect a twelfth of the day's sky, not a bright one.
 */
export function busEnvScale(s: Pick<DayNightState, "hemiIntensity" | "hemiSky">): number {
  return Math.min(1.2, Math.max(0.05, (luma(s.hemiSky) * s.hemiIntensity) / DAY_SKY_LIGHT));
}

/** Per frame: the time of day and the renderer's exposure into the bus (plain number writes). */
export function applyBusDayNight(nodes: BusNodes, s: Pick<DayNightState, "lights" | "hemiIntensity" | "hemiSky">, exposure = 1): void {
  const env = busEnvScale(s);
  nodes.bodySky.value = BUS_LOOK.envIntensity * env;
  nodes.glassSky.value = BUS_LOOK.glassEnvIntensity * env;
  if (nodes.body) nodes.body.emissiveIntensity = s.lights * BUS_LOOK.nightGlow;
  if (nodes.led) nodes.led.emissiveIntensity = BUS_LOOK.ledDay + (BUS_LOOK.ledNight - BUS_LOOK.ledDay) * s.lights;
  if (nodes.glass) nodes.glass.opacity = BUS_LOOK.glassOpacity + (BUS_LOOK.glassNightOpacity - BUS_LOOK.glassOpacity) * s.lights;
  nodes.groundGlow.value = s.lights * BUS_LOOK.groundGlow;
  nodes.groundExposure.value = exposure;
}

/** Free what `prepareBus` made (the loader's geometry, textures and materials stay with its cache). */
export function disposeBus(nodes: BusNodes): void {
  for (const m of nodes.own) m.dispose();
}
