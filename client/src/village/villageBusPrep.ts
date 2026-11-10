import { DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial, Vector3, type Material, type Object3D } from "three";
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
 * direction's height, softened toward their average with roughness) added to three's indirect specular light — no
 * environment map, so no PMREM pass (its blur shader made ANGLE's HLSL compiler log warnings) and no texture fetch.
 * Its strength follows the time of day's sky light (`busEnvScale`).
 *
 * The file's contract (build_bus.py; checked by villageBusPrep.test.ts's stand-in and the e2e probe):
 *  - one node `village_bus`, modelled nose north (-z), doors east (+x), its footprint centred on the origin, on the
 *    ground (y = 0): placed at the layout's parked-bus box (`busStop.bus.centre`) as it is;
 *  - `M_bus`: the atlas (base colour × COLOR_0 = baked ambient occlusion; ORM: R = the clear coat's mask, G roughness,
 *    B metalness; emissive = what glows at night: lamps, LED dots, the lit cabin), double-sided;
 *  - `M_bus_glass`: tinted glass (alpha blended, see-through to the cabin);
 *  - `M_bus_led`: the three destination signs (dot patterns that read as nothing; lit by day too).
 *
 * `prepareBus` works on a CLONE of the cached scene and makes its own materials (listed in `own`); the loader's stay as
 * they are, so `disposeBus` frees exactly what it made.
 */

export const BUS_MODEL_URL = "/models/village/village_bus.glb";

export const BUS_MATERIAL = { body: "M_bus", glass: "M_bus_glass", led: "M_bus_led" } as const;

/** The look's numbers (linear light; intensities are three's). */
export const BUS_LOOK = {
  /** The paint's and chrome's reflection of the sky (× the time of day's sky light, see `busEnvScale`). */
  envIntensity: 0.7,
  /** The glass reflects more than the paint (it is darker behind). */
  glassEnvIntensity: 1.2,
  /** How see-through the windows are, and their tint (sRGB). */
  glassOpacity: 0.8,
  glassColor: "#081014",
  /** The rich tier's clear coat over the paint (its mask is the ORM map's red channel). */
  clearcoat: 0.5,
  clearcoatRoughness: 0.12,
  /** The emissive map's strength at full night (headlamps and tail lamps, the DRL dots, the cabin's lights). */
  nightGlow: 1.7,
  /** The destination signs: lit by day as real LED signs are, brighter at night. */
  ledDay: 1.0,
  ledNight: 1.6,
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

export interface BusNodes {
  root: Object3D;
  body: MeshStandardMaterial | null;
  glass: MeshStandardMaterial | null;
  led: MeshStandardMaterial | null;
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
  uBusSkyAverage: { value: average(BUS_SKY.zenith, BUS_SKY.horizon, BUS_SKY.groundFar) },
};

/** The analytic sky's GLSL: declared before main, added to the indirect specular after three's own (empty) IBL. */
const SKY_PARS = /* glsl */ `uniform vec3 uBusZenith;
uniform vec3 uBusHorizon;
uniform vec3 uBusGround;
uniform vec3 uBusGroundFar;
uniform vec3 uBusSkyAverage;
uniform float uBusSky;
vec3 busSky( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
	vec3 r = transformNormalByInverseViewMatrix( reflect( - viewDir, normal ), viewMatrix );
	vec3 c = r.y >= 0.0
		? mix( uBusHorizon, uBusZenith, pow( clamp( r.y, 0.0, 1.0 ), 0.6 ) )
		: mix( uBusGroundFar, uBusGround, clamp( - r.y * 3.0, 0.0, 1.0 ) );
	return mix( c, uBusSkyAverage, smoothstep( 0.05, 0.75, roughness ) ) * uBusSky;
}
void main() {`;
const SKY_ADD = /* glsl */ `#include <lights_fragment_maps>
radiance += busSky( geometryViewDir, geometryNormal, material.roughness );
#ifdef USE_CLEARCOAT
	clearcoatRadiance += busSky( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
#endif`;

/** Give a material the sky's reflection, its strength read from `strength` (idempotent per material). */
export function addBusSky(material: MeshStandardMaterial, strength: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, skyUniforms, { uBusSky: strength });
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", SKY_PARS).replace("#include <lights_fragment_maps>", SKY_ADD);
  };
  material.customProgramCacheKey = () => "village-bus-sky";
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
  m.side = DoubleSide;
  m.vertexColors = false;
  m.envMap = null;
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
  const made = new Map<Material, MeshStandardMaterial>();
  const nodes: BusNodes = {
    root,
    body: null,
    glass: null,
    led: null,
    bodySky: { value: BUS_LOOK.envIntensity },
    glassSky: { value: BUS_LOOK.glassEnvIntensity },
    own: [],
  };
  const swap = (m: Material): Material => {
    const hit = made.get(m);
    if (hit) return hit;
    const s = m as MeshStandardMaterial;
    let out: MeshStandardMaterial | null = null;
    if (m.name === BUS_MATERIAL.body) {
      out = nodes.body = bodyMaterial(s, tier);
      addBusSky(out, nodes.bodySky);
    } else if (m.name === BUS_MATERIAL.glass) {
      out = nodes.glass = glassMaterial(s);
      addBusSky(out, nodes.glassSky);
    } else if (m.name === BUS_MATERIAL.led) {
      out = nodes.led = ledMaterial(s);
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
    o.receiveShadow = tier === "high"; // the avatars' live shadows fall on it
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
