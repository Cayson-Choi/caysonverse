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
  type Material,
  type Object3D,
} from "three";
import { VILLAGE_LAYOUT, type VillageLayout } from "@caysonverse/shared/village/villageLayout";
import { COLLIDER_PREFIX, isMesh } from "../game/hub/hubModelPrep";
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
 *  - `M_bus_led`: the three destination signs (dot patterns that read as nothing; lit by day too);
 *  - `M_bus_ground`: a quad on the road round the bus, 5 cm up (the village's ground decals' height, over every ground
 *    layer: the road at 1 cm, the paving rings, the lawns, the forecourt's 3 cm), whose base colour
 *    map carries, sRGB-encoded (three's decode gives the values themselves): in red the darkness its body and tyres put
 *    on the road (ambient occlusion baked in Blender, 1 = darkest; gone 0.5 m out from the body and before the kerbs),
 *    the contact shadow the village's light map is too coarse for (about 0.5 m a texel on the road); in green the
 *    night's light on the road (the low beams' pool ahead, inside the kerbs). Blue is unused. Drawn first among the
 *    transparent things in one pass: dst × (1 - darkness) + light (`GROUND_OUT`). The light tier draws straight to
 *    the canvas and blends in sRGB: its shadow factor and its light are the rich tier's raised to 1/2.2 (`uBusGamma`),
 *    so both tiers show the same shadow and light.
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
  /** The contact shadow and the night's light on the road (null in a file without one). */
  ground: MeshBasicMaterial | null;
  /** The night's light on the road now (its shader reads it; `applyBusDayNight` writes). */
  groundGlow: { value: number };
  /** 1 on the rich tier (it blends in linear light), 1 / 2.2 on the light tier (in sRGB, on the canvas). */
  groundGamma: { value: number };
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
 * dst × (1 - a') + src × a', a' = mix(a, 1, F). Plain, even glass (bus review r4): no scenery mirrored in it.
 */
const GLASS_ADD = /* glsl */ `float busF = uBusGlassF0 + ( 1.0 - uBusGlassF0 ) * pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 5.0 );
float busA = mix( diffuseColor.a, 1.0, busF );
outgoingLight = ( uBusSkyAverage * uBusSky * busF + outgoingLight * diffuseColor.a * ( 1.0 - busF ) ) / max( busA, 1e-3 );
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
 * The ground quad's output, written last (after three's tone mapping, colour space and fog: a light and a darkness,
 * not a surface's colour): the darkness (alpha) is the contact shadow (red), the night's light (green) is added. The
 * blend (`One`, `OneMinusSrcAlpha`: premultiplied) gives dst × (1 - darkness) + light. The light tier blends in sRGB
 * on the canvas: both are raised to 1/2.2 there (`uBusGamma`; for the light, exact on the dark asphalt it lies on).
 */
export const GROUND_OUT = /* glsl */ `vec4 busG = texture2D( map, vMapUv );
float busKeep = 1.0 - busG.r * opacity;
gl_FragColor = vec4( pow( uBusGlowColor * ( busG.g * uBusGlow ), vec3( uBusGamma ) ), 1.0 - pow( busKeep, uBusGamma ) );`;

/**
 * The contact shadow and the low beams' pool: the file's map read by channel (GROUND_OUT), on the road round the
 * bus, drawn first among the transparent things. The quad lies at the village's decal height and the material carries
 * its offset (VILLAGE_GROUND_DECAL, stronger than every ground layer's): bus review r3 found the quad 1 cm UNDER the
 * road, where the depth test hid it from most views (and at 2 cm it still hid under the paving's rings). No fog.
 */
function groundMaterial(source: MeshStandardMaterial, nodes: Pick<BusNodes, "groundGlow" | "groundGamma">): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: BUS_LOOK.groundShadow });
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
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uBusGlow: nodes.groundGlow,
      uBusGamma: nodes.groundGamma,
      uBusGlowColor: { value: glowColor },
    });
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uBusGlow;\nuniform float uBusGamma;\nuniform vec3 uBusGlowColor;\nvoid main() {")
      .replace("#include <dithering_fragment>", GROUND_OUT);
  };
  m.customProgramCacheKey = () => "village-bus-ground";
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
    groundGamma: { value: tier === "high" ? 1 : 1 / 2.2 },
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
      out = nodes.ground = groundMaterial(s, nodes);
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
  if (nodes.glass) nodes.glass.opacity = BUS_LOOK.glassOpacity + (BUS_LOOK.glassNightOpacity - BUS_LOOK.glassOpacity) * s.lights;
  nodes.groundGlow.value = s.lights * BUS_LOOK.groundGlow;
}

/** Free what `prepareBus` made (the loader's geometry, textures and materials stay with its cache). */
export function disposeBus(nodes: BusNodes): void {
  for (const m of nodes.own) m.dispose();
}
