import { DoubleSide, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Vector3, type Material, type Object3D } from "three";
import { VILLAGE_LAYOUT, type VillageLayout } from "@caysonverse/shared/village/villageLayout";
import { COLLIDER_PREFIX, isMesh } from "../game/hub/hubModelPrep";
import { LIGHTING } from "../game/sceneLighting";
import { linearHex, type DayNightState } from "./dayNightBlend";
import type { VillageTier } from "./villageModelPrep";

/**
 * 케이슨 마을's village bus (`village_bus.glb`, art/village/tools/build_bus.py): a 9 m low-floor midibus modelled by
 * script — the pure part, unit-tested with a hand-built node tree (villageBusPrep.test.ts).
 *
 * Unlike the village (unlit, light-mapped), the bus is lit live like the avatars: PBR materials under the scene's sun
 * and sky light, so it follows the time of day by itself. Its ground shadow is baked into the village's light maps (day
 * and night, under its real outline), so it stands on the road on both tiers; it does not cast a live shadow too (that
 * would double the baked one) but on the rich tier it takes the avatars' live shadows.
 *
 * The paint, chrome and glass reflect the sky: an analytic sky (zenith, horizon and ground colours by the reflected
 * direction's height, a dark band of tree tops and roofs just above the horizon, softened toward their average with
 * roughness) — no environment map, so no PMREM pass (its blur shader made ANGLE's HLSL compiler log warnings) and no
 * texture fetch. The paint adds it to three's indirect specular light; the glass mixes it in by its own Fresnel term
 * (stronger than the physical 4 %: the live-lit cabin behind it is brighter than a real one), so the windows read as
 * glass that mirrors the sky and the trees with the cabin showing through (bus review). Its strength follows the time of
 * day's sky light (`busEnvScale`).
 *
 * The file's contract (build_bus.py; checked by villageBusPrep.test.ts's stand-in and the e2e probe):
 *  - one node `village_bus`, modelled nose north (-z), doors east (+x), its footprint centred on the origin, on the
 *    ground (y = 0): placed at the layout's parked-bus box (`busStop.bus.centre`) as it is;
 *  - `M_bus`: the atlas (base colour × COLOR_0 = baked ambient occlusion; ORM: R = the clear coat's mask, G roughness,
 *    B metalness; emissive = what glows at night: lamps, LED dots, the lit cabin), double-sided;
 *  - `M_bus_glass`: tinted glass (alpha blended, see-through to the cabin);
 *  - `M_bus_led`: the three destination signs (dot patterns that read as nothing; lit by day too);
 *  - `M_bus_ground`: a quad on the road under the bus whose base colour is the darkness its body and tyres put on the
 *    road (ambient occlusion baked in Blender, sRGB-encoded: white = darkest): the contact shadow the village's light
 *    map is too coarse for (about 0.5 m a texel on the road). Drawn black through that map, before the glass.
 *
 * `prepareBus` works on a CLONE of the cached scene and makes its own materials (listed in `own`); the loader's stay as
 * they are, so `disposeBus` frees exactly what it made.
 */

export const BUS_MODEL_URL = "/models/village/village_bus.glb";

export const BUS_MATERIAL = { body: "M_bus", glass: "M_bus_glass", led: "M_bus_led", ground: "M_bus_ground" } as const;

/** The look's numbers (linear light; intensities are three's). */
export const BUS_LOOK = {
  /** The paint's and chrome's reflection of the sky (× the time of day's sky light, see `busEnvScale`). */
  envIntensity: 0.85,
  /** The sky the glass mirrors (× the time of day's sky light), and its Fresnel: this share head-on, all of it grazing. */
  glassEnvIntensity: 1.0,
  glassF0: 0.12,
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
  /** The destination signs: lit by day as real LED signs are, brighter at night. */
  ledDay: 1.0,
  ledNight: 1.6,
  /** The contact shadow's darkness where the baked map is white (under the floor, at the tyres' contact). */
  groundShadow: 0.85,
} as const;

/** The reflected sky (linear): the village's afternoon — pale blue above, hazy at the horizon, grey-green ground. */
export const BUS_SKY = {
  zenith: [0.33, 0.45, 0.62],
  horizon: [0.78, 0.8, 0.82],
  ground: [0.16, 0.17, 0.14],
  groundFar: [0.32, 0.34, 0.3],
  /** The tree tops and roofs round the stop, just above the horizon (a ragged band, about 2-8 degrees high). */
  treeline: [0.07, 0.09, 0.07],
} as const;

/** Where the bus stands: the parked-bus box's centre, nose north as modelled (yaw 0). */
export function busPlacement(layout: Pick<VillageLayout, "busStop"> = VILLAGE_LAYOUT): { x: number; z: number; yaw: number } {
  const c = layout.busStop.bus.centre;
  return { x: c.x, z: c.z, yaw: 0 };
}

export interface BusNodes {
  root: Object3D;
  body: MeshStandardMaterial | null;
  glass: MeshStandardMaterial | null;
  led: MeshStandardMaterial | null;
  /** The contact shadow on the road (null in a file without one). */
  ground: MeshBasicMaterial | null;
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
  uBusTreeline: { value: new Vector3(...BUS_SKY.treeline) },
  uBusGlassF0: { value: BUS_LOOK.glassF0 as number },
  uBusSkyAverage: { value: average(BUS_SKY.zenith, BUS_SKY.horizon, BUS_SKY.groundFar) },
};

/**
 * The analytic sky's GLSL, declared before main: the reflected direction's height picks zenith, horizon or ground, and
 * a ragged dark band of tree tops sits just above the horizon (its top wanders with the direction round the bus).
 */
const SKY_PARS = /* glsl */ `uniform vec3 uBusZenith;
uniform vec3 uBusHorizon;
uniform vec3 uBusGround;
uniform vec3 uBusGroundFar;
uniform vec3 uBusTreeline;
uniform vec3 uBusSkyAverage;
uniform float uBusGlassF0;
uniform float uBusSky;
vec3 busSky( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
	vec3 r = transformNormalByInverseViewMatrix( reflect( - viewDir, normal ), viewMatrix );
	vec3 c = r.y >= 0.0
		? mix( uBusHorizon, uBusZenith, pow( clamp( r.y, 0.0, 1.0 ), 0.6 ) )
		: mix( uBusGroundFar, uBusGround, clamp( - r.y * 3.0, 0.0, 1.0 ) );
	float az = atan( r.z, r.x );
	float top = 0.085 + 0.032 * sin( az * 5.0 + 0.7 ) + 0.02 * sin( az * 13.0 + 2.1 ) + 0.012 * sin( az * 31.0 + 4.0 ) + 0.007 * sin( az * 67.0 + 1.0 );
	c = mix( c, uBusTreeline, 0.75 * smoothstep( - 0.03, 0.005, r.y ) * ( 1.0 - smoothstep( top - 0.018, top, r.y ) ) );
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
 * The glass: its lit tint (alpha a) with the cabin behind it, and the sky mirrored over both by the Fresnel F, written
 * as one source colour and alpha for the normal blend: dst × (1 - a') + src × a', a' = mix(a, 1, F).
 */
const GLASS_ADD = /* glsl */ `float busF = uBusGlassF0 + ( 1.0 - uBusGlassF0 ) * pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 5.0 );
float busA = mix( diffuseColor.a, 1.0, busF );
outgoingLight = ( busSky( geometryViewDir, geometryNormal, material.roughness ) * busF + outgoingLight * diffuseColor.a * ( 1.0 - busF ) ) / max( busA, 1e-3 );
diffuseColor.a = busA;
#include <opaque_fragment>`;

/**
 * Give a material the sky's reflection, its strength read from `strength` (idempotent per material): the paint's way
 * (`"paint"`, through three's specular) or the glass's (`"glass"`, its own Fresnel mix: GLASS_ADD).
 */
export function addBusSky(material: MeshStandardMaterial, strength: { value: number }, kind: "paint" | "glass" = "paint"): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, skyUniforms, { uBusSky: strength });
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", SKY_PARS);
    shader.fragmentShader =
      kind === "glass"
        ? shader.fragmentShader.replace("#include <opaque_fragment>", GLASS_ADD)
        : shader.fragmentShader.replace("#include <lights_fragment_maps>", SKY_ADD);
  };
  material.customProgramCacheKey = () => `village-bus-sky-${kind}`;
  material.needsUpdate = true;
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

/**
 * The contact shadow: black through the baked darkness (the file's base colour map, sRGB-encoded so that three's
 * decode gives the darkness itself), on the road just under the bus, drawn first among the transparent things.
 */
function groundMaterial(source: MeshStandardMaterial): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, opacity: BUS_LOOK.groundShadow });
  m.name = source.name;
  m.alphaMap = source.map;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
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
 * the sky), the night's glow off, live shadows taken on the rich tier only. The bus never moves: its matrices are
 * computed once.
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
    own: [],
  };
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
      addBusSky(nodes.glass, nodes.glassSky, "glass");
    } else if (m.name === BUS_MATERIAL.led) {
      out = nodes.led = ledMaterial(s);
    } else if (m.name === BUS_MATERIAL.ground) {
      out = nodes.ground = groundMaterial(s);
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
    o.castShadow = false; // the baked shadow is its shadow
    const ground = !Array.isArray(o.material) && o.material.name === BUS_MATERIAL.ground;
    // The avatars' live shadows fall on it on the rich tier (the road under the contact shadow takes its own).
    o.receiveShadow = tier === "high" && !ground;
    if (ground) o.renderOrder = -1; // under the glass, whatever the sort
  });
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.matrixWorldAutoUpdate = false;
  });
  return nodes;
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

/** Per frame: the time of day into the bus (plain number writes). */
export function applyBusDayNight(nodes: BusNodes, s: Pick<DayNightState, "lights" | "hemiIntensity" | "hemiSky">): void {
  const env = busEnvScale(s);
  nodes.bodySky.value = BUS_LOOK.envIntensity * env;
  nodes.glassSky.value = BUS_LOOK.glassEnvIntensity * env;
  if (nodes.body) nodes.body.emissiveIntensity = s.lights * BUS_LOOK.nightGlow;
  if (nodes.led) nodes.led.emissiveIntensity = BUS_LOOK.ledDay + (BUS_LOOK.ledNight - BUS_LOOK.ledDay) * s.lights;
}

/** Free what `prepareBus` made (the loader's geometry, textures and materials stay with its cache). */
export function disposeBus(nodes: BusNodes): void {
  for (const m of nodes.own) m.dispose();
}
