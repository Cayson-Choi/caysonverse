/**
 * 집 외관 A8 (X3): the ten houses' own model in the game — `village_houses.glb` (X1 body kit + X2 porches; contract
 * docs/designs/house-exteriors/contract.md ch. 5, 6, 10) dressed for a graphics tier. The pure part; VillageHouses.tsx loads the
 * files and drives it.
 *
 *  - Surfaces: the GLB carries no images. Each LM_ material gets its photo-real tiling set by name from
 *    `houses/house_textures.json` (albedo sRGB, normal, roughness; flipY false, repeat; `normalScale (1, -1)`: glTF tangent
 *    space without tangents). The houses' pastel and grime are the vertex colours (COLOR_0, linear), multiplied in. The
 *    materials are LIT (MeshStandard: the scene's sun and sky light, like the bus and the avatars), never unlit — an unlit
 *    material would drop the normal and roughness maps (X1 hand-over). The light tier takes the albedo at full size (the
 *    512 px/m first-person rule holds) and a 512 px normal map, and no roughness map (a per-surface constant).
 *  - Sun and shadow, until the X4 light map: the scene's key light IS the live sun (LiveSunShadows aims it at the real KST sun,
 *    the moon at night) and the sky light the day-and-night blend's hemisphere. Its direct light is shadowed by the village's
 *    live cascades (sunShadows.ts `ssLive`: the near one round the camera, the far cached one over the village), on both tiers,
 *    so a house is shaded by its own eaves and porch and by the trees exactly as the ground beside it is. The houses cast
 *    into the same cascades (`userData.cvHouses`, LiveSunShadows).
 *  - Night: the room behind each window glows (M_window's emissive, warm, with the village's `litUniform`), the porch lamps
 *    glow, and the lamps near a wall light it (a cheap point term per fragment: the porch lamps and the street lanterns
 *    within reach, as the street furniture does).
 *  - Draw calls: the ten shells are merged into one mesh per material (contract: <= 8 draws, always drawn); each house's
 *    detail stays its own group (<= 6 draws), shown only near the player or the camera (`pickDetail`: PC 35 m / 4 houses,
 *    phone 25 m / the 2 nearest, +4 m before hiding again).
 *  - The old houses: village.glb's A7 houses are baked into its per-cell meshes; `oldHouseFootprints` finds their triangles by
 *    place (streetTrim.ts's way: all three corners inside, standing above 0.1 m) and they are cut out of the clone only once
 *    the new shells are drawn — a failed or slow houses' model leaves the old houses standing (the fallback). Once village.glb
 *    is rebuilt with the A8 houses (X4: `modelHasA8Houses`), nothing is cut and its stand-in boxes (`houseproxy__`) are hidden.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  ShaderChunk,
  Vector2,
  Vector3,
  Vector4,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { AABB } from "@caysonverse/shared/collision";
import {
  HOUSE_DETAIL_LOD,
  HOUSE_BODY_BACK,
  HOUSE_BODY_FRONT,
  HOUSE_BODY_HALF,
  houseDetailNode,
  houseLocalToWorld,
  houseWorldToLocal,
  houseProxyNode,
  houseShellNode,
  porchKind,
  porchSlabLocal,
  localBox,
} from "@caysonverse/shared/village/houseExterior";
import { A7_MODEL_HOUSE_BOXES, A8_TREE_MOVES, modelHasA8Houses } from "@caysonverse/shared/village/a8Staging";
import { houseGardenCollider } from "@caysonverse/shared/village/houseExterior";
import { VILLAGE_LAYOUT, type SceneryHouse } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_COLLIDERS } from "@caysonverse/shared/village/generated/villageColliders";
import { deckHouseSurface, splitDeckTriangles } from "./deckPlanks";
import { ridgeCaps, ridgeLines, tintRidgeMortar } from "./roofRidge";
import { builderGeometry, closedShutterParts, houseShutterParts, onOpenLeafOfClosed } from "./houseShutters";
import { cardGeometry, houseSideBoxParts, setHouseSideBeds, type BoxBed } from "./houseSideBoxes";
import { kitFlowerBoxBeds } from "./houseFlowerBoxes";
import { versionedUrl } from "../modelUrl";
import { LIT, litUniform } from "../villageModelPrep";
import { SS_FRAGMENT_PARS, SS_VERTEX_PARS, SS_VERTEX_WORLD, bindSunShadowUniforms } from "../sunShadows";
import { lanternPositions } from "../street/streetLayout";
import { trimMesh } from "../street/streetTrim";
import { addBusSky, busEnvScale } from "../villageBusPrep";
import { clearGlassMaterial, patchWindowCards, type ClearGlass } from "../portal/clearGlass";
import type { DayNightState } from "../dayNightBlend";
import type { VillageTier } from "../villageModelPrep";

/** The DEV address flag `?houses=old`: the old houses baked into village.glb, for the before sheets. Production: always the new. */
export function housesMode(): "new" | "old" {
  if (!import.meta.env.DEV || typeof location === "undefined") return "new";
  return new URLSearchParams(location.search).get("houses") === "old" ? "old" : "new";
}

export const VILLAGE_HOUSES_URL = versionedUrl("/models/village/village_houses.glb");
export const HOUSE_TEXTURES_DIR = "/models/village/houses/";
export const HOUSE_TEXTURES_URL = versionedUrl(`${HOUSE_TEXTURES_DIR}house_textures.json`);

/** `houses/house_textures.json` (X1 make_house_textures.py): the maps of each material, by its name. */
export interface HouseTextureMeta {
  format: "caysonverse-house-textures";
  materials: Record<string, { maps: { albedo: string; normal: string; rough: string } }>;
}

export type HouseMapKind = "albedo" | "normal" | "rough";

/** The light tier's smaller normal map beside the full one: `house_render_normal.webp` -> `house_render_normal_512.webp`. */
export function lightVariant(file: string): string {
  return file.replace(/\.webp$/, "_512.webp");
}

/**
 * The texture files a tier loads, in a fixed order (material, kind): the rich tier every map at 1024; the light tier the albedo at
 * 1024 (the texel density the first-person rule asks for), the normal at 512, no roughness map.
 */
export function houseTextureFiles(meta: HouseTextureMeta, tier: VillageTier): Array<{ material: string; kind: HouseMapKind; url: string }> {
  const out: Array<{ material: string; kind: HouseMapKind; url: string }> = [];
  for (const name of Object.keys(meta.materials).sort()) {
    const m = meta.materials[name]!.maps;
    out.push({ material: name, kind: "albedo", url: versionedUrl(HOUSE_TEXTURES_DIR + m.albedo) });
    out.push({ material: name, kind: "normal", url: versionedUrl(HOUSE_TEXTURES_DIR + (tier === "high" ? m.normal : lightVariant(m.normal))) });
    if (tier === "high") out.push({ material: name, kind: "rough", url: versionedUrl(HOUSE_TEXTURES_DIR + m.rough) });
  }
  return out;
}

/** The look's numbers. */
export const HOUSE_LOOK = {
  /** Roughness where the light tier has no map (per surface family). */
  roughness: { LM_render: 0.93, LM_stone: 0.82, LM_roof: 0.9, LM_wood: 0.72, LM_metal: 0.55 } as Record<string, number>,
  /** The normal maps' strength (x, y: glTF without tangents flips y). */
  normalScale: 1,
  /**
   * The window glass (portal/clearGlass.ts): over a house whose rooms are not drawn, how much the dark reflective pane hides the lit card
   * behind it (owner 2026-11-21: clear glass; the house nearest the camera shows its real rooms through clear panes).
   */
  glassDark: 0.78,
  /**
   * At night, over the house whose real rooms are drawn: how much of the room is seen through the warm haze of its lamplight
   * (clearGlass.ts `warmVeil`; 2026-11-27, the lit windows read warm and inviting from the street again, as the lit cards did).
   */
  glassNightVeil: 0.2,
  /** The rooms behind the windows at night: LIT.window's warm colour, this bright (× the village's lit weight). */
  windowGlow: 1.35,
  /** The keypad's screen (M_lamp: X2 hand-over, only the door lock's pad): a faint glow by day, a soft one at night. */
  lampDay: 0.25,
  lampNight: 0.9,
  /** The warm lamp light on the walls near a porch lamp or a street lantern at night (linear RGB x strength). */
  lampLight: [1.0, 0.6, 0.3] as const,
  lampStrength: 2.4,
  /** Under the moon colours fade (the eye's night vision): the albedo this much toward its grey at full night. */
  nightDesaturate: 0.45,
  /** A street lantern lights a house within this much of its body (m). */
  lanternReach: 12,
} as const;

// ───────────────────────────────────────── materials ─────────────────────────────────────────

/** The lamps lighting the houses at night (world), shared by every house material (set by `prepareHouses`). */
const lampUniform = { value: [new Vector3(0, -100, 0)] as Vector3[] };
/** How deep in the night it is (DayNightState.night), shared by every house material. */
const nightUniform = { value: 0 };
let lampCount = 1;

const HOUSE_FRAG_PARS = (count: number) => /* glsl */ `
#define HOUSE_LAMP_COUNT ${count}
uniform vec3 uHouseLamps[ HOUSE_LAMP_COUNT ];
uniform float uVillageLit;
uniform vec3 uHouseLampColor;
uniform float uHouseNight;
void main() {`;

/** The night's colour fade on the albedo (after the vertex colour is in). */
const HOUSE_NIGHT_COLOUR = /* glsl */ `#include <color_fragment>
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), uHouseNight );`;

/** The live sun's shadow on the scene's key light (the sun by day, the moon at night): three's own shadow is off. */
const HOUSE_LIGHTS_BEGIN = (): string =>
  /* glsl */ `float houseSunLit = 1.0;
if ( uSsOn.w > 0.0 ) {
	vec3 hsN = ssNormal();
	houseSunLit = ssLive( hsN, max( dot( hsN, uSsSunDir ), 0.0 ) );
}
` + ShaderChunk.lights_fragment_begin.replace("getDirectionalLightInfo( directionalLight, directLight );", "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= houseSunLit;");

const HOUSE_LAMP_LIGHT = /* glsl */ `#include <lights_fragment_end>
if ( uVillageLit > 0.001 ) {
	vec3 hlN = normalize( vSsNormal );
	vec3 hlSum = vec3( 0.0 );
	for ( int i = 0; i < HOUSE_LAMP_COUNT; i ++ ) {
		vec3 L = uHouseLamps[ i ] - vSsWorld;
		float d2 = dot( L, L );
		float fall = smoothstep( 120.0, 4.0, d2 ) / ( 1.0 + d2 * 0.45 );
		float ndl = dot( hlN, L * inversesqrt( d2 + 1e-4 ) );
		hlSum += ( max( ndl, 0.0 ) * 0.85 + 0.15 ) * fall;
	}
	reflectedLight.directDiffuse += uVillageLit * uHouseLampColor * hlSum * diffuseColor.rgb;
}`;

const lampColour = new Vector3(...HOUSE_LOOK.lampLight).multiplyScalar(HOUSE_LOOK.lampStrength);

/** Give a lit house material the live sun's shadows and the night lamps (idempotent per material). */
export function patchHouseLight(m: MeshStandardMaterial, key: string): void {
  m.onBeforeCompile = (shader) => {
    bindSunShadowUniforms(shader.uniforms);
    shader.uniforms.uHouseLamps = lampUniform;
    shader.uniforms.uVillageLit = litUniform;
    shader.uniforms.uHouseLampColor = { value: lampColour };
    shader.uniforms.uHouseNight = nightUniform;
    shader.vertexShader = "#define SS_GEO_NORMAL\n" + shader.vertexShader.replace("void main() {", SS_VERTEX_PARS).replace("#include <project_vertex>", SS_VERTEX_WORLD);
    shader.fragmentShader =
      "#define SS_GEO_NORMAL\n" +
      shader.fragmentShader
        .replace("void main() {", SS_FRAGMENT_PARS + HOUSE_FRAG_PARS(lampCount))
        .replace("#include <lights_fragment_begin>", HOUSE_LIGHTS_BEGIN())
        .replace("#include <color_fragment>", HOUSE_NIGHT_COLOUR)
        .replace("#include <lights_fragment_end>", HOUSE_LAMP_LIGHT);
  };
  m.customProgramCacheKey = () => `village-house-${key}-${lampCount}`;
  m.needsUpdate = true;
}

/**
 * Surface character (audit 2026-11-18: "walls are flat colour"). The render and sandstone sets were flattened to a few per cent of
 * variation (brand-new: no stains) so the vertex-colour pastel read as paint. Per material: `gain` stretches the albedo's own
 * grain around its mean (`mean`, linear) so the lime-wash trowelling and the sandstone's sand show; `macro` adds a slow
 * world-space mottle (a few per cent of tint, drifting slightly in hue: each wall a little different, none stained); `foot` darkens
 * the first metre of wall a touch (the contact shade at the ground); `normal` is the relief's strength.
 */
export const HOUSE_SURFACE: Record<string, { mean: number; gain: number; macro: number; foot: number; eave: number; sat: number; bright: number; normal: number; repeat: number; oakMean?: number; oakGain?: number }> = {
  // eave: how much the wall just under the roof edge darkens (the soffit shades it: the ambient occlusion the lightmap-free walls lack)
  // third pass (2026-11-27): the render, sandstone and tile sheets are new procedural sets (tools/house-ext/
  // make_house_fresh_textures.py) that already carry their own fine grain: `gain` 1 (no stretching: the old 4.2 turned the
  // scan's trowel swirls into stains), the mottle down to a whisper, the roof sheet's rows back on the model's courses (repeat 1)
  LM_render: { mean: 0.7975, gain: 1.0, macro: 0.012, foot: 0.06, eave: 0.16, sat: 1, bright: 1, normal: 1.6, repeat: 1 },
  // dressed Vosges sandstone, procedural (fine sand, laminae, claw tooling), 1 m x 1 m; the pink / buff is the vertex colour
  LM_stone: { mean: 0.584, gain: 1.0, macro: 0.015, foot: 0.03, eave: 0.1, sat: 0.85, bright: 1.0, normal: 1.4, repeat: 1 },
  // the oak half is Poly Haven dark_wood's grain (oiled oak beams); the painted-board half is the first pass's
  LM_wood: { mean: 0.504, gain: 1.0, macro: 0.04, foot: 0, eave: 0.1, sat: 0.62, bright: 1.05, normal: 2.6, repeat: 1, oakMean: 0.0405, oakGain: 1.9 },
  // new Biberschwanz tiles, procedural: 11 tiles x 14 rows per 2 m sheet, each modelled course on its rows (repeat 1)
  LM_roof: { mean: 0.19, gain: 1.0, macro: 0.02, foot: 0, eave: 0, sat: 1, bright: 1, normal: 1.3, repeat: 1 },
};

const SURFACE_PARS = /* glsl */ `uniform vec4 uSurf;
uniform vec3 uSurf2;
uniform vec2 uSurf3;
float srfHash( vec3 p ) {
	p = fract( p * 0.3183099 + vec3( 0.1, 0.2, 0.3 ) );
	p *= 17.0;
	return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float srfNoise( vec3 x ) {
	vec3 i = floor( x );
	vec3 f = fract( x );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( srfHash( i ), srfHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( srfHash( i + vec3( 0, 1, 0 ) ), srfHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( srfHash( i + vec3( 0, 0, 1 ) ), srfHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( srfHash( i + vec3( 0, 1, 1 ) ), srfHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
void main() {`;

const SURFACE_COLOUR = /* glsl */ `#include <map_fragment>
{
	float srL = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	float srR = srL / uSurf.x;
	diffuseColor.rgb *= max( 0.15, 1.0 + ( srR - 1.0 ) * uSurf.y ) / max( srR, 0.05 );
	// the oak half of the wood sheet (glTF v < 0.5): its grain stretched around its own mean, so dark beams still show their grain
	float srOak = ( 1.0 - step( 0.5, vMapUv.y ) ) * step( 0.001, uSurf3.y );
	float srOR = srL / max( uSurf3.x, 0.001 );
	diffuseColor.rgb *= mix( 1.0, max( 0.2, 1.0 + ( srOR - 1.0 ) * uSurf3.y ) / max( srOR, 0.05 ), srOak );
	float srN = srfNoise( vSsWorld * 0.55 ) * 0.65 + srfNoise( vSsWorld * 1.9 ) * 0.35 - 0.5;
	diffuseColor.rgb *= vec3( 1.0 + srN * uSurf.z * 2.0, 1.0 + srN * uSurf.z * 1.0, 1.0 - srN * uSurf.z * 1.4 );
	float srWall = step( abs( vSsNormal.y ), 0.5 );
	diffuseColor.rgb *= 1.0 - uSurf.w * ( 1.0 - smoothstep( 0.05, 1.0, vSsWorld.y ) ) * srWall;
	// the soffit's shade: the last metre of wall under the roof edge (the walls end at 7.2 m)
	diffuseColor.rgb *= 1.0 - uSurf2.x * smoothstep( 6.0, 7.15, vSsWorld.y ) * ( 1.0 - smoothstep( 7.2, 7.7, vSsWorld.y ) ) * srWall;
}`;

/** Layer the surface character on a lit house material (after patchHouseLight: wraps its compile hook). */
export function enhanceHouseSurface(m: MeshStandardMaterial, name: string): void {
  const spec = HOUSE_SURFACE[name];
  if (!spec) return;
  // DEV before/after sheets: `?surf=off` leaves the stretched-grain and mottle out
  if (import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).get("surf") === "off") return;
  const prev = m.onBeforeCompile;
  const uSurf = { value: new Vector4(spec.mean, spec.gain, spec.macro, spec.foot) };
  const uSurf2 = { value: new Vector3(spec.eave, spec.sat, spec.bright) };
  const uSurf3 = { value: new Vector2(spec.oakMean ?? 1, spec.oakGain ?? 0) };
  m.onBeforeCompile = (shader, r) => {
    prev.call(m, shader, r);
    shader.uniforms.uSurf = uSurf;
    shader.uniforms.uSurf2 = uSurf2;
    shader.uniforms.uSurf3 = uSurf3;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", SURFACE_PARS)
      .replace("#include <map_fragment>", SURFACE_COLOUR)
      // after the vertex colour is in: the pastel / sandstone / oak colours of the model, toned (saturation, brightness)
      .replace("uHouseNight );", "uHouseNight );\n\tdiffuseColor.rgb = mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, uSurf2.y ) * uSurf2.z;");
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}|surf-${name}`;
  m.needsUpdate = true;
}

/** The sky the metal parts (gutters, downpipes, hinges) mirror: scaled by the time of day in `applyHousesDayNight`. */
const metalSky = { value: 0.9 };
const METAL_FRAGMENT = /* glsl */ `#include <metalnessmap_fragment>
// the sheet's grainy iron half (glTF v < 0.5) is real zinc / iron; the painted-frame half stays dielectric
float metalBand = 1.0 - step( 0.5, vMapUv.y );
metalnessFactor = 0.82 * metalBand;
roughnessFactor = mix( roughnessFactor, 0.36, metalBand );`;

/** Gutters and downpipes as real metal: a metalness mask by the sheet's band, and the village's sky for it to mirror. */
export function metalHouseSurface(m: MeshStandardMaterial): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  addBusSky(m, metalSky, "paint");
  const sky = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev.call(m, shader, r);
    sky.call(m, shader, r);
    shader.fragmentShader = shader.fragmentShader.replace("#include <metalnessmap_fragment>", METAL_FRAGMENT);
  };
  m.customProgramCacheKey = () => `${prevKey()}|metal-sky`;
  m.needsUpdate = true;
}

export interface HouseMaps {
  map: Texture;
  normalMap: Texture;
  roughnessMap: Texture | null;
}

/** The porch decks and steps (deckPlanks.ts): the wood sheet's oak half laid out as boards. */
export const DECK_KEY = "LM_deck";
const deckSource = new MeshStandardMaterial({ name: DECK_KEY });
export function deckMaterial(maps: HouseMaps | null): MeshStandardMaterial {
  const m = houseSurfaceMaterial(deckSource, maps);
  if (maps) m.normalScale = new Vector2(1.8, -1.8);
  if (maps?.map) deckHouseSurface(m);
  return m;
}

/** A house surface (LM_*): its tiling set, the vertex colour, lit. */
export function houseSurfaceMaterial(source: MeshStandardMaterial, maps: HouseMaps | null): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    name: source.name,
    color: new Color(1, 1, 1),
    vertexColors: true,
    metalness: 0,
    roughness: maps?.roughnessMap ? 1 : HOUSE_LOOK.roughness[source.name] ?? 0.85,
    map: maps?.map ?? null,
    normalMap: maps?.normalMap ?? null,
    roughnessMap: maps?.roughnessMap ?? null,
    side: source.side,
  });
  const ns = HOUSE_SURFACE[source.name]?.normal ?? HOUSE_LOOK.normalScale;
  if (maps) m.normalScale = new Vector2(ns, -ns);
  const rep = HOUSE_SURFACE[source.name]?.repeat ?? 1;
  if (maps && rep !== 1) for (const t of [maps.map, maps.normalMap, maps.roughnessMap]) t?.repeat.set(rep, rep);
  patchHouseLight(m, `${maps ? "pbr" : "flat"}${maps?.roughnessMap ? "-r" : ""}`);
  if (maps?.map) enhanceHouseSurface(m, source.name);
  if (source.name === "LM_metal") metalHouseSurface(m);
  return m;
}

export interface HouseGlow {
  window: MeshStandardMaterial | null;
  lamp: MeshStandardMaterial | null;
  /** The panes: clear over the house whose rooms are drawn (portal/HouseShowcase.tsx), dark and reflective over the others' lit cards. */
  glass: ClearGlass | null;
}

function windowMaterial(source: MeshStandardMaterial): MeshStandardMaterial {
  const m = source.clone();
  m.emissive = new Color(...LIT.window.color);
  m.emissiveIntensity = 0;
  patchHouseLight(m, "window");
  patchWindowCards(m); // the cards step aside where the house's real rooms are drawn
  return m;
}

function lampMaterial(source: MeshStandardMaterial): MeshStandardMaterial {
  const m = source.clone();
  m.emissive = new Color(...LIT.lamp.color);
  m.emissiveIntensity = HOUSE_LOOK.lampDay;
  return m;
}


function screenMaterial(source: MeshStandardMaterial): MeshStandardMaterial {
  const m = source.clone();
  m.transparent = true;
  m.depthWrite = false;
  m.side = DoubleSide;
  m.forceSinglePass = true;
  return m;
}

// ───────────────────────────────────────── the old houses ─────────────────────────────────────────

/** A place of the old model (streetTrim.ts's footprint shape). */
export interface TrimFootprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
  /** A triangle goes only when its top is above this (m). */
  minTop: number;
  inside: (x: number, y: number, z: number) => boolean;
}

/** Around an old house body: its eaves, gutters, downpipes, plinth and the beds along its walls (m). */
export const OLD_HOUSE_EAVES = 1.0;
/** Past the old footprint's front edge (m): as far as the new steps reach (2 x 0.34), which cover the cut. */
export const OLD_PORCH_STEPS = 0.68;
/**
 * The lowest top (m) the porch's and the garden's cut takes: the old porch's tiles (3 cm), its beds' kerbs and soil; not the
 * lane's paving that runs up to the steps (2 cm), nor the lawn.
 */
export const OLD_PORCH_MIN_TOP = 0.025;

const boxFoot = (b: AABB, pad: number, maxY: number, minTop = 0.1): TrimFootprint => {
  const f = { minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad, maxY, minTop };
  return { ...f, inside: (x, y, z) => x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ && y > -0.05 && y < maxY };
};

/**
 * The A7 houses as village.glb holds them (a8Staging.ts's exact boxes): each body with its eaves, its porch from the body to
 * past the old steps (the whole footprint front), and its garden. Only what stands up is taken (trimMesh: above 0.1 m), never
 * the lawn or the path's paving under it.
 */
export function oldHouseFootprints(houses: readonly SceneryHouse[] = VILLAGE_LAYOUT.sceneryHouses): TrimFootprint[] {
  const out: TrimFootprint[] = [];
  const box = (id: string) => A7_MODEL_HOUSE_BOXES.find((b) => b.id === id)?.box;
  for (const h of houses.filter((x) => x.kind === "house")) {
    const body = box(h.id);
    if (!body) continue;
    out.push(boxFoot(body, OLD_HOUSE_EAVES, 14));
    // the porch: from the old body to the farther of the old porch's front (A7 porch boxes: houses 7 and 9 stood 1.2 m nearer
    // the street) and the new footprint's, the footprint's width, and out past that by the new steps' run
    const fp = { minX: h.centre.x - h.size.x / 2, maxX: h.centre.x + h.size.x / 2, minZ: h.centre.z - h.size.z / 2, maxZ: h.centre.z + h.size.z / 2 };
    const old = A7_MODEL_HOUSE_BOXES.filter((b) => b.id.startsWith(`${h.id}_porch_`)).map((b) => b.box);
    const span = (k: "minX" | "maxX" | "minZ" | "maxZ", pick: (...v: number[]) => number) => pick(fp[k], body[k], ...old.map((b) => b[k]));
    const porch: AABB = { minX: span("minX", Math.min), maxX: span("maxX", Math.max), minZ: span("minZ", Math.min), maxZ: span("maxZ", Math.max) };
    switch (h.doorSide) {
      case "s": porch.minZ = body.maxZ; porch.maxZ += OLD_PORCH_STEPS; break;
      case "n": porch.maxZ = body.minZ; porch.minZ -= OLD_PORCH_STEPS; break;
      case "e": porch.minX = body.maxX; porch.maxX += OLD_PORCH_STEPS; break;
      case "w": porch.maxX = body.minX; porch.minX -= OLD_PORCH_STEPS; break;
    }
    out.push(boxFoot(porch, 0.25, 4.5, OLD_PORCH_MIN_TOP));
    const garden = box(`garden_${h.id}`);
    if (garden) out.push(boxFoot(garden, 0.3, 2.5, OLD_PORCH_MIN_TOP));
  }
  return out;
}

/**
 * The ground the houses take (the vegetation plants no flowers or bed soil there, villageVegetation.ts): the old houses' cut
 * (their porch beds' cards are cut with them) and the new houses' footprints and gardens (X2's porches bring their own beds).
 */
export function makeHouseGrounds(houses: readonly SceneryHouse[] = VILLAGE_LAYOUT.sceneryHouses): (x: number, z: number) => boolean {
  const boxes: AABB[] = oldHouseFootprints(houses).map((f) => ({ minX: f.minX, maxX: f.maxX, minZ: f.minZ, maxZ: f.maxZ }));
  for (const h of houses.filter((x) => x.kind === "house")) {
    boxes.push({ minX: h.centre.x - h.size.x / 2 - 0.3, maxX: h.centre.x + h.size.x / 2 + 0.3, minZ: h.centre.z - h.size.z / 2 - 0.3, maxZ: h.centre.z + h.size.z / 2 + 0.3 });
    const g = houseGardenCollider(h);
    if (g) boxes.push(g.box);
  }
  return (x, z) => boxes.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
}

/**
 * The trees the A8 houses displace (a8Staging.ts A8_TREE_MOVES: their crowns would reach into the deeper or turned houses):
 * the shift (m, game x / z) of the tree whose trunk stands at (x, z) in village.glb, or null. The runtime vegetation grows
 * them at their new spots (villageVegetation.ts) until X4 rebuilds village.glb with them moved (then nothing matches here).
 */
export function a8TreeShift(x: number, z: number): { dx: number; dz: number } | null {
  if (modelHasA8Houses(VILLAGE_COLLIDERS, VILLAGE_LAYOUT.sceneryHouses)) return null;
  for (const m of A8_TREE_MOVES) {
    const old = A7_MODEL_HOUSE_BOXES.find((b) => b.id === m.id)?.box;
    if (!old || !m.id.startsWith("tree_")) continue;
    const cx = (old.minX + old.maxX) / 2;
    const cz = (old.minZ + old.maxZ) / 2;
    if (Math.abs(cx - x) < 0.05 && Math.abs(cz - z) < 0.05) return { dx: m.to.x - cx, dz: m.to.z - cz };
  }
  return null;
}

/** The same for the bush the A8 houses displace (bush_15, a drawn bush found in the file's cards): its shift, or null. */
export function a8BushShift(x: number, z: number): { dx: number; dz: number } | null {
  if (modelHasA8Houses(VILLAGE_COLLIDERS, VILLAGE_LAYOUT.sceneryHouses)) return null;
  for (const m of A8_TREE_MOVES) {
    const old = A7_MODEL_HOUSE_BOXES.find((b) => b.id === m.id)?.box;
    if (!old || !m.id.startsWith("bush_")) continue;
    const cx = (old.minX + old.maxX) / 2;
    const cz = (old.minZ + old.maxZ) / 2;
    if (Math.abs(cx - x) < 0.3 && Math.abs(cz - z) < 0.6) return { dx: m.to.x - cx, dz: m.to.z - cz };
  }
  return null;
}

/** Names of village.glb meshes the trim never touches (streetTrim.ts KEEP, plus the leaf chunks' far cards). */
const KEEP = /^(village_sky|village_water|village_backdrop|fountain_moon|col__|light__|seat__|inst__|houseproxy__)/;

export interface OldHouseCut {
  meshes: number;
  trianglesRemoved: number;
  proxiesHidden: number;
  restore(): void;
}

/**
 * Take the old houses out of a village clone (or, once village.glb has the A8 houses, hide its `houseproxy__` stand-ins).
 * `restore` puts everything back (the houses' model went away).
 */
export function cutOldHouses(root: Object3D, a8Model = modelHasA8Houses(VILLAGE_COLLIDERS, VILLAGE_LAYOUT.sceneryHouses)): OldHouseCut {
  const undo: Array<() => void> = [];
  const stats = { meshes: 0, trianglesRemoved: 0, proxiesHidden: 0 };
  root.updateWorldMatrix(true, true);
  const feet = a8Model ? [] : oldHouseFootprints();
  root.traverse((o) => {
    if (o.name.startsWith("houseproxy__") && o.visible) {
      o.visible = false;
      stats.proxiesHidden++;
      undo.push(() => {
        o.visible = true;
      });
      return;
    }
    const mesh = o as Mesh;
    if (feet.length === 0 || !mesh.isMesh || (o as { isInstancedMesh?: boolean }).isInstancedMesh || KEEP.test(mesh.name)) return;
    const t = trimMesh(mesh, feet);
    if (!t) return;
    const original = mesh.geometry;
    mesh.geometry = t.geometry;
    stats.meshes++;
    stats.trianglesRemoved += t.removed;
    undo.push(() => {
      if (mesh.geometry !== t.geometry) return; // another patch layered its own copy since: it puts ours back itself
      mesh.geometry = original;
      t.geometry.dispose();
    });
  });
  return {
    ...stats,
    restore() {
      for (const u of undo.reverse()) u();
      undo.length = 0;
    },
  };
}

// ───────────────────────────────────────── level of detail ─────────────────────────────────────────

/** Distance (m) from a point to a box on the ground (0 inside). */
export function gapToBox(x: number, z: number, b: AABB): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

export type DetailDevice = "pc" | "phone";

/**
 * Which houses draw their detail (contract ch. 5, HOUSE_DETAIL_LOD): within `pc` m (PC) or `phone` m (phone) of any reference
 * point (the player, the camera), a shown one until `hysteresis` m farther; at most `pcMaxNear` (PC) or `phoneNearest` (phone),
 * the nearest first.
 */
export function pickDetail(
  shown: ReadonlySet<string>,
  refs: ReadonlyArray<{ x: number; z: number }>,
  houses: ReadonlyArray<{ id: string; box: AABB }>,
  device: DetailDevice,
): Set<string> {
  const L = HOUSE_DETAIL_LOD;
  const reach = device === "pc" ? L.pc : L.phone;
  const most = device === "pc" ? L.pcMaxNear : L.phoneNearest;
  const near: Array<{ id: string; d: number }> = [];
  for (const h of houses) {
    let d = Infinity;
    for (const r of refs) d = Math.min(d, gapToBox(r.x, r.z, h.box));
    if (d <= reach + (shown.has(h.id) ? L.hysteresis : 0)) near.push({ id: h.id, d });
  }
  near.sort((a, b) => a.d - b.d || (shown.has(a.id) ? -1 : 0));
  return new Set(near.slice(0, most).map((n) => n.id));
}

// ───────────────────────────────────────── the model ─────────────────────────────────────────

export interface HouseNodes {
  root: Group;
  /** The ten shells merged per material (always drawn). */
  shells: Mesh[];
  /** Each house's detail (shown near). */
  details: Map<string, Object3D>;
  /** Each house's footprint (world), for the detail's distance. */
  boxes: Array<{ id: string; box: AABB }>;
  /** The houses whose model has a porch slab at +0.30 (their lift zones may lift). */
  porches: string[];
  glow: HouseGlow;
  /** Materials and geometries this call made: freed by `disposeHouses`. */
  own: { materials: Material[]; geometries: BufferGeometry[] };
  stats: { shellTriangles: number; detailTriangles: Record<string, number>; shellDraws: number; detailDraws: Record<string, number>; lamps: number; ridges: number; shutterWindows: number; closedWindows: number; sideBoxes: number };
}

const isMeshObj = (o: Object3D): o is Mesh => (o as Mesh).isMesh === true;
const matsOf = (m: Mesh): Material[] => (Array.isArray(m.material) ? m.material : [m.material]);
const tris = (g: BufferGeometry): number => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

/** The house id of a model node (`houseshell__house_3` -> house_3), and which part. */
export function houseNodePart(name: string): { part: "shell" | "detail"; id: string } | null {
  const m = /^house(shell|detail)__(house_\d+)$/.exec(name);
  return m ? { part: m[1] as "shell" | "detail", id: m[2]! } : null;
}

/** Whether a house's geometry has an upward face at the porch's height over its slab (X2's porch is in the model). */
export function hasPorchSlab(meshes: readonly Mesh[], h: Pick<SceneryHouse, "id" | "centre" | "doorSide">): boolean {
  const slab = localBox(h, porchSlabLocal(h.id));
  const inner = { minX: slab.minX + 0.3, maxX: slab.maxX - 0.3, minZ: slab.minZ + 0.3, maxZ: slab.maxZ - 0.3 };
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const e = new Vector3();
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const pos = g.getAttribute("position");
    if (!pos) continue;
    const idx = g.index;
    const count = idx ? idx.count : pos.count;
    mesh.updateWorldMatrix(true, false);
    for (let i = 0; i + 2 < count; i += 3) {
      const at = (k: number) => (idx ? idx.getX(i + k) : i + k);
      a.fromBufferAttribute(pos, at(0)).applyMatrix4(mesh.matrixWorld);
      if (a.y < 0.27 || a.y > 0.33) continue;
      b.fromBufferAttribute(pos, at(1)).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, at(2)).applyMatrix4(mesh.matrixWorld);
      if (Math.abs(b.y - a.y) > 0.02 || Math.abs(c.y - a.y) > 0.02) continue;
      n.subVectors(b, a).cross(e.subVectors(c, a));
      if (n.y <= 0) continue;
      const x = (a.x + b.x + c.x) / 3;
      const z = (a.z + b.z + c.z) / 3;
      if (x >= inner.minX && x <= inner.maxX && z >= inner.minZ && z <= inner.maxZ) return true;
    }
  }
  return false;
}

/**
 * The porch lamps (X2 hand-over, porch_kit.py; their lenses are M_window, lit with the windows): the gable porch's ceiling
 * downlight, the box canopies' two, otherwise (the decks, house 8's glass canopy) the two wall lights beside the door. Local
 * (x, y, z), turned into the world per house.
 */
export function porchLampPoints(h: Pick<SceneryHouse, "id" | "centre" | "doorSide">): Vector3[] {
  const kind = porchKind(h.id);
  const at: Array<[number, number, number]> =
    kind === "gable" ? [[0, 3.5, 4.19]] : kind === "canopy" && h.id !== "house_8" ? [[-0.65, 3.5, 3.975], [0.65, 3.5, 3.975]] : [[-1.3, 2.4, 3.2], [1.3, 2.4, 3.2]];
  return at.map(([x, y, z]) => houseLocalPoint(h, x, y, z));
}

/** The porch lamps' lenses (M_lamp) of the model, one point per lamp (world: each connected bunch of its triangles' corners). */
export function lampPoints(meshes: readonly Mesh[]): Vector3[] {
  const pts: Vector3[] = [];
  const v = new Vector3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.getAttribute("position");
    if (!pos) continue;
    const clusters: Array<{ sum: Vector3; n: number; c: Vector3 }> = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      let cl = clusters.find((q) => q.c.distanceToSquared(v) < 0.25);
      if (!cl) {
        cl = { sum: new Vector3(), n: 0, c: v.clone() };
        clusters.push(cl);
      }
      cl.sum.add(v);
      cl.n++;
    }
    for (const q of clusters) pts.push(q.sum.divideScalar(q.n));
  }
  return pts;
}

/** The ridge's mortar bed under the new ridge tiles (linear; sRGB #B49A86: a warm clay-lime mortar, not a white line). */
export const RIDGE_MORTAR: [number, number, number] = [0.456, 0.323, 0.238];

const A8_HOUSES = (): SceneryHouse[] => VILLAGE_LAYOUT.sceneryHouses.filter((h) => h.kind === "house");

/**
 * Dress a CLONE-free copy of the houses' model for a tier: materials made here (the loader's stay as they are), the shells
 * merged per material into new geometry, the details reparented (their geometry stays the loader's).
 */
export function prepareHouses(scene: Object3D, maps: Record<string, HouseMaps>, floraMap: Texture | null = null): HouseNodes {
  scene.updateWorldMatrix(true, true);
  const own = { materials: [] as Material[], geometries: [] as BufferGeometry[] };
  const made = new Map<string, Material>();
  const glow: HouseGlow = { window: null, lamp: null, glass: null };
  const lamps: Mesh[] = [];
  const material = (src: Material): Material => {
    const hit = made.get(src.name);
    if (hit) return hit;
    const s = src as MeshStandardMaterial;
    let m: Material;
    if (src === deckSource) m = deckMaterial(maps.LM_wood ?? null);
    else if (src.name.startsWith("LM_")) m = houseSurfaceMaterial(s, maps[src.name] ?? null);
    else if (src.name === "M_window") m = glow.window = windowMaterial(s);
    else if (src.name === "M_lamp") m = glow.lamp = lampMaterial(s);
    else if (src.name === "M_glass") m = (glow.glass = clearGlassMaterial("M_glass", HOUSE_LOOK.glassDark, HOUSE_LOOK.glassNightVeil)).material;
    else if (src.name === "M_screen") m = screenMaterial(s);
    else {
      // what a later kit adds (X2's M_leaf_flora: flower cards): the file's own material, lit, cut out
      const c = s.clone();
      // the planting cards' picture is the village's (T_flora, by the material's name: X2 hand-over); the 3D plants hide them
      if (c.name === "M_leaf_flora" && floraMap && !c.map) c.map = floraMap;
      if (c.alphaTest > 0 || c.name === "M_leaf_flora") {
        c.alphaTest = Math.max(c.alphaTest, 0.5);
        c.side = DoubleSide;
        c.transparent = false;
      }
      m = c;
    }
    made.set(src.name, m);
    own.materials.push(m);
    return m;
  };

  const a8Houses = A8_HOUSES();
  const root = new Group();
  root.name = "village_houses";
  root.userData.cvHouses = true;
  const shellParts = new Map<string, BufferGeometry[]>();
  const details = new Map<string, Object3D>();
  const detailTriangles: Record<string, number> = {};
  const detailDraws: Record<string, number> = {};
  const byHouse = new Map<string, Mesh[]>();
  const unknown: Object3D[] = [];
  const tmp = new Matrix4();
  /** Each house's window glass (world), for the side and back shutters (houseShutters.ts). */
  const glassOf = new Map<string, BufferGeometry[]>();

  for (const node of [...scene.children]) {
    const part = houseNodePart(node.name);
    if (!part) {
      if (!node.name.startsWith("slot__") && (isMeshObj(node) || node.children.length > 0)) unknown.push(node);
      continue;
    }
    const meshes: Mesh[] = [];
    node.traverse((o) => {
      if (isMeshObj(o)) meshes.push(o);
    });
    byHouse.set(part.id, [...(byHouse.get(part.id) ?? []), ...meshes]);
    if (part.part === "shell") {
      for (const mesh of meshes) {
        const src = matsOf(mesh);
        const g = mesh.geometry;
        // one primitive per mesh (GLTFLoader): the whole geometry in the world, under its material's name
        const world = g.clone().applyMatrix4(tmp.copy(mesh.matrixWorld));
        const key = src[0]!.name;
        if (src[0]!.name === "M_lamp") lamps.push(mesh);
        if (key === "M_glass") glassOf.set(part.id, [...(glassOf.get(part.id) ?? []), world]);
        if (key === "LM_stone") {
          // the porch slab and steps are drawn as oak planks (deckPlanks.ts), the rest stays sandstone
          const sp = splitDeckTriangles(world, a8Houses);
          if (sp.deck) {
            world.dispose();
            if (sp.rest) shellParts.set(key, [...(shellParts.get(key) ?? []), sp.rest]);
            shellParts.set(DECK_KEY, [...(shellParts.get(DECK_KEY) ?? []), sp.deck]);
            if (!made.has(DECK_KEY)) material(deckSource);
            if (!made.has(key)) material(src[0]!);
            continue;
          }
        }
        shellParts.set(key, [...(shellParts.get(key) ?? []), world]);
        if (!made.has(key)) material(src[0]!);
      }
    } else {
      const group = new Group();
      group.name = node.name;
      let t = 0;
      let d = 0;
      for (const mesh of meshes) {
        if (matsOf(mesh)[0]!.name === "LM_stone") {
          // the steps: oak planks (deckPlanks.ts), in the world (an identity transform inside the group)
          const sp = splitDeckTriangles(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), a8Houses);
          if (sp.deck) {
            const pieces: Array<[BufferGeometry | null, Material, string]> = [
              [sp.rest, matsOf(mesh).map(material)[0]!, mesh.name],
              [sp.deck, material(deckSource), `${mesh.name}_deck`],
            ];
            for (const [geo, mat, nm] of pieces) {
              if (!geo) continue;
              own.geometries.push(geo);
              const piece = new Mesh(geo, mat);
              piece.name = nm;
              piece.matrixAutoUpdate = false;
              group.add(piece);
              d++;
            }
            t += tris(mesh.geometry);
            continue;
          }
        }
        const fresh = freshenColours(mesh.geometry);
        if (fresh) own.geometries.push(fresh);
        const m = new Mesh(fresh ?? mesh.geometry, matsOf(mesh).map(material)[0]!);
        m.name = mesh.name;
        mesh.matrixWorld.decompose(m.position, m.quaternion, m.scale);
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        if (matsOf(mesh)[0]!.name === "M_lamp") lamps.push(mesh);
        group.add(m);
        t += tris(mesh.geometry);
        d++;
      }
      group.visible = false;
      details.set(part.id, group);
      detailTriangles[part.id] = t;
      detailDraws[part.id] = d;
      root.add(group);
    }
  }

  // shutters on the side walls' and the back's ground-floor windows (houseShutters.ts), merged into the detail's own wood and
  // metal meshes (no extra draw); measured before the shells merge (the glass parts are disposed with them)
  let shutterWindows = 0;
  let closedWindows = 0;
  let sideBoxes = 0;
  const kitBeds = kitFlowerBoxBeds();
  const sideBeds: BoxBed[] = [];
  for (const h of a8Houses) {
    const group = details.get(h.id);
    if (!group) continue;
    const glass = glassOf.get(h.id) ?? [];
    const parts = houseShutterParts(glass, h);
    shutterWindows += parts.windows;
    // the windows whose shutters are shut (houseShutters.ts HOUSE_CLOSED_WINDOWS: the room behind their glass showed a door or
    // its own window's edge): the closed leaves join the shell's painted wood (always drawn, like the rooms behind the glass), and
    // the model's own open leaves beside them leave the detail
    const closed = closedShutterParts(glass, h);
    closedWindows += closed.windows.length;
    // window boxes under the side and back windows (houseSideBoxes.ts): the troughs and brackets join the same wood and metal
    // meshes, the planting cards the detail's M_leaf_flora (the vegetation grows them into 3D plants), the beds the flower mass
    const boxes = houseSideBoxParts(sideBoxesOn() ? glass : [], h, kitBeds);
    sideBoxes += boxes.windows;
    sideBeds.push(...boxes.beds);
    const flora = group.children.find((c): c is Mesh => isMeshObj(c) && matsOf(c)[0]!.name === "M_leaf_flora");
    const cards = flora ? cardGeometry(boxes.cards, h, flora.geometry) : null;
    if (flora && cards) {
      cards.applyMatrix4(tmp.copy(flora.matrix).invert());
      const merged = mergeGeometries([flora.geometry, cards], false);
      cards.dispose();
      if (merged) {
        if (own.geometries.includes(flora.geometry)) {
          own.geometries.splice(own.geometries.indexOf(flora.geometry), 1);
          flora.geometry.dispose();
        }
        detailTriangles[h.id] = (detailTriangles[h.id] ?? 0) + tris(merged) - tris(flora.geometry);
        own.geometries.push(merged);
        flora.geometry = merged;
      }
    }
    const woodParts = shellParts.get("LM_wood");
    const closedGeo = woodParts?.length ? builderGeometry(closed.wood, woodParts[0]!) : null;
    if (closedGeo) woodParts!.push(closedGeo);
    for (const [mat, b] of [["LM_wood", joinBuilders(parts.wood, boxes.wood)], ["LM_metal", joinBuilders(parts.metal, boxes.metal)]] as const) {
      const mesh = group.children.find((c): c is Mesh => isMeshObj(c) && matsOf(c)[0]!.name === mat);
      if (!mesh) continue;
      if (closed.windows.length) {
        const kept = dropTriangles(mesh.geometry, mesh.matrix, (x, y, z) => onOpenLeafOfClosed(h, closed.windows, x, y, z));
        if (kept) {
          detailTriangles[h.id] = (detailTriangles[h.id] ?? 0) + tris(kept) - tris(mesh.geometry);
          if (own.geometries.includes(mesh.geometry)) {
            own.geometries.splice(own.geometries.indexOf(mesh.geometry), 1);
            mesh.geometry.dispose();
          }
          own.geometries.push(kept);
          mesh.geometry = kept;
        }
      }
      const add = builderGeometry(b, mesh.geometry);
      if (!add) continue;
      add.applyMatrix4(tmp.copy(mesh.matrix).invert()); // the group sits at the origin: the mesh's own matrix is its world
      const base = mesh.geometry;
      const merged = mergeGeometries([base, add], false);
      add.dispose();
      if (!merged) continue;
      if (own.geometries.includes(base)) {
        own.geometries.splice(own.geometries.indexOf(base), 1);
        base.dispose();
      }
      own.geometries.push(merged);
      mesh.geometry = merged;
      const added = tris(merged) - tris(base);
      detailTriangles[h.id] = (detailTriangles[h.id] ?? 0) + added;
    }
  }

  setHouseSideBeds(sideBeds);

  const shells: Mesh[] = [];
  let shellTriangles = 0;
  // the roofs get a row of real half-round ridge tiles on their ridge (roofRidge.ts); the model's white mortar strip is tinted
  const ridges = ridgeLines(shellParts.get("LM_roof") ?? [], a8Houses);
  for (const [name, parts] of shellParts) {
    if (name === "LM_roof") parts.push(...ridgeCaps(parts, ridges));
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) continue;
    if (name === "LM_render" || name === "LM_wood") freshenWalls(merged, name === "LM_wood");
    if (name === "LM_render") tintRidgeMortar(merged, ridges, RIDGE_MORTAR);
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    own.geometries.push(merged);
    const mesh = new Mesh(merged, made.get(name)!);
    mesh.name = `houseshells_${name}`;
    mesh.matrixAutoUpdate = false;
    shells.push(mesh);
    root.add(mesh);
    shellTriangles += tris(merged);
  }
  for (const u of unknown) {
    // drawn as it is (always): a node a later kit adds that this file does not know by name
    const copy = u.clone();
    copy.traverse((o) => {
      if (!isMeshObj(o)) return;
      const ms = matsOf(o).map(material);
      o.material = ms.length > 1 ? ms : ms[0]!;
    });
    root.add(copy);
  }
  // every solid part casts the live sun's shadow; the transparent glass, screens and the lamps' lenses do not
  root.traverse((o) => {
    if (!isMeshObj(o)) return;
    const m = matsOf(o)[0]!;
    o.castShadow = m.name.startsWith("LM_") || m.name === "M_leaf_flora" || m.name === "M_window";
    o.receiveShadow = false; // the live cascades shade them (patchHouseLight)
  });

  const houses = A8_HOUSES();
  const boxes = houses.map((h) => ({ id: h.id, box: { minX: h.centre.x - h.size.x / 2, maxX: h.centre.x + h.size.x / 2, minZ: h.centre.z - h.size.z / 2, maxZ: h.centre.z + h.size.z / 2 } }));
  const porches = houses.filter((h) => hasPorchSlab(byHouse.get(h.id) ?? [], h)).map((h) => h.id);

  // the night lamps: the porch lamps and the street lanterns within reach of a house
  const points = houses.flatMap((h) => porchLampPoints(h));
  for (const [x, y, z] of lanternPositions()) {
    if (boxes.some((b) => gapToBox(x, z, b.box) <= HOUSE_LOOK.lanternReach)) points.push(new Vector3(x, y, z));
  }
  lampUniform.value = points.length ? points : [new Vector3(0, -100, 0)];
  lampCount = lampUniform.value.length;

  return {
    root,
    shells,
    details,
    boxes,
    porches,
    glow,
    own,
    stats: { shellTriangles, detailTriangles, shellDraws: shells.length, detailDraws, lamps: points.length, ridges: ridges.length, shutterWindows, closedWindows, sideBoxes },
  };
}

// ───────────────────────────────────────── brand-new (owner 2026-11-17) ─────────────────────────────────────────

/**
 * The X1 build's wall weathering (house_kit.py `wall_shade`, 2026-11-16): the vertex colour darkened to 0.80 at the foot of
 * the walls (y 0.30, rising smoothly to 1 at 1.25 m) and to 0.94 under the eaves (above 7.2 m). The owner, 2026-11-17: "모두가
 * 새것이어야 해 헌집은 없어야 해" — the kit no longer does it; until the houses' model is built again, `freshenWalls` takes it out.
 */
export function oldWallShade(y: number): number {
  let k = 1;
  if (y < 1.25) {
    const t = Math.max(0, Math.min(1, (y - 0.3) / (1.25 - 0.3)));
    k *= 0.8 + 0.2 * (t * t * (3 - 2 * t));
  }
  if (y > 7.2) k *= 0.94;
  return k;
}

/** The houses' body planes (local): the front and back walls' outer faces and the side walls'. */
const WALL_PLANE_TOL = 0.035;
function onWallPlane(x: number, z: number): boolean {
  for (const h of A8_HOUSES()) {
    if (Math.abs(x - h.centre.x) > 7 || Math.abs(z - h.centre.z) > 7) continue;
    const { lx, lz } = houseWorldToLocal(h, x, z);
    if (lz < HOUSE_BODY_BACK - WALL_PLANE_TOL || lz > HOUSE_BODY_FRONT + WALL_PLANE_TOL || Math.abs(lx) > HOUSE_BODY_HALF + WALL_PLANE_TOL) continue;
    if (Math.abs(lz - HOUSE_BODY_FRONT) < WALL_PLANE_TOL || Math.abs(lz - HOUSE_BODY_BACK) < WALL_PLANE_TOL || Math.abs(Math.abs(lx) - HOUSE_BODY_HALF) < WALL_PLANE_TOL) return true;
  }
  return false;
}

/**
 * Undo the old wall weathering in a merged shell geometry (world positions; stucco, or the timber cladding's band of LM_wood:
 * glTF v >= 0.5): every wall-plane vertex's colour divided by `oldWallShade(y)` — only when the model still has it (the
 * walls' feet measurably darker than their middles), so a model built without it is left as it is. Returns the vertices changed.
 */
export function freshenWalls(geo: BufferGeometry, claddingBand: boolean): number {
  const pos = geo.getAttribute("position");
  const col = geo.getAttribute("color");
  const uv = geo.getAttribute("uv");
  if (!pos || !col) return 0;
  const picks: number[] = [];
  let foot = 0;
  let footN = 0;
  let mid = 0;
  let midN = 0;
  for (let i = 0; i < pos.count; i++) {
    if (claddingBand && uv && uv.getY(i) < 0.5) continue;
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (!onWallPlane(x, z)) continue;
    picks.push(i);
    const l = 0.2126 * col.getX(i) + 0.7152 * col.getY(i) + 0.0722 * col.getZ(i);
    if (Math.abs(y - 0.3) < 0.03) {
      foot += l;
      footN++;
    } else if (y > 1.4 && y < 3.5) {
      mid += l;
      midN++;
    }
  }
  if (footN === 0 || midN === 0 || foot / footN / (mid / midN) > 0.9) return 0;
  let n = 0;
  for (const i of picks) {
    const k = oldWallShade(pos.getY(i));
    if (k >= 0.999) continue;
    col.setXYZ(i, Math.min(1, col.getX(i) / k), Math.min(1, col.getY(i) / k), Math.min(1, col.getZ(i) / k));
    n++;
  }
  col.needsUpdate = true;
  return n;
}

/**
 * A copy of a geometry without the triangles whose three corners (through `matrix`, into the world) all pass `drop`; null when none
 * does. Indexed in, indexed out (the attributes kept whole: only the index shrinks).
 */
export function dropTriangles(geo: BufferGeometry, matrix: Matrix4, drop: (x: number, y: number, z: number) => boolean): BufferGeometry | null {
  const pos = geo.getAttribute("position");
  const n = geo.index ? geo.index.count : pos.count;
  const at = (k: number) => (geo.index ? geo.index.getX(k) : k);
  const v = new Vector3();
  const keep: number[] = [];
  let dropped = 0;
  for (let t = 0; t + 2 < n; t += 3) {
    let all = true;
    for (let k = 0; k < 3 && all; k++) {
      v.fromBufferAttribute(pos, at(t + k)).applyMatrix4(matrix);
      all = drop(v.x, v.y, v.z);
    }
    if (all) dropped++;
    else keep.push(at(t), at(t + 1), at(t + 2));
  }
  if (dropped === 0) return null;
  const out = geo.clone();
  out.setIndex(keep);
  return out;
}

/** Vertex colours of the 2026-11-17 build that look old, and their new ones (sRGB hex): the garden beds' weathered grey timber. */
export const FRESH_COLOURS: ReadonlyArray<[string, string]> = Object.freeze([["#9C8A76", "#B98A5E"]]);

const linHex = (hex: string): [number, number, number] => {
  const c = new Color(hex); // three converts sRGB hex to its linear working colour
  return [c.r, c.g, c.b];
};

/** A detail mesh's geometry with its old-looking colours replaced (a copy sharing every other attribute), or null when none is. */
export function freshenColours(geo: BufferGeometry): BufferGeometry | null {
  const col = geo.getAttribute("color");
  if (!col) return null;
  const maps = FRESH_COLOURS.map(([a, b]) => [linHex(a), linHex(b)] as const);
  let copy: BufferAttribute | null = null;
  for (let i = 0; i < col.count; i++) {
    const r = col.getX(i);
    const g = col.getY(i);
    const b = col.getZ(i);
    for (const [from, to] of maps) {
      if (Math.abs(r - from[0]) < 0.012 && Math.abs(g - from[1]) < 0.012 && Math.abs(b - from[2]) < 0.012) {
        copy ??= (col as BufferAttribute).clone();
        copy.setXYZ(i, to[0], to[1], to[2]);
      }
    }
  }
  if (!copy) return null;
  const out = new BufferGeometry();
  for (const name of Object.keys(geo.attributes)) out.setAttribute(name, name === "color" ? copy : geo.getAttribute(name));
  out.setIndex(geo.index);
  for (const gr of geo.groups) out.addGroup(gr.start, gr.count, gr.materialIndex);
  out.boundingBox = geo.boundingBox?.clone() ?? null;
  out.boundingSphere = geo.boundingSphere?.clone() ?? null;
  return out;
}

/** DEV `?sideboxes=off`: no side window boxes (the before / after measurements). Production: on. */
function sideBoxesOn(): boolean {
  if (!import.meta.env.DEV || typeof location === "undefined") return true;
  return new URLSearchParams(location.search).get("sideboxes") !== "off";
}

/** Two builders' parts as one (the shutters' and the side boxes' wood, or their iron). */
function joinBuilders<B extends { pos: number[]; nor: number[]; uv: number[]; col: number[] }>(a: B, b: B): B {
  return { ...a, pos: [...a.pos, ...b.pos], nor: [...a.nor, ...b.nor], uv: [...a.uv, ...b.uv], col: [...a.col, ...b.col] };
}

/** Per frame (number writes only): the night's windows, lamps and glass. */
export function applyHousesDayNight(nodes: HouseNodes, s: Pick<DayNightState, "lights" | "night" | "hemiIntensity" | "hemiSky">): void {
  nightUniform.value = s.night * HOUSE_LOOK.nightDesaturate;
  const g = nodes.glow;
  if (g.window) g.window.emissiveIntensity = s.lights * HOUSE_LOOK.windowGlow;
  if (g.lamp) g.lamp.emissiveIntensity = HOUSE_LOOK.lampDay + (HOUSE_LOOK.lampNight - HOUSE_LOOK.lampDay) * s.lights;
  metalSky.value = 0.9 * busEnvScale(s);
}

/** Show the detail of exactly `ids`. */
export function showDetail(nodes: HouseNodes, ids: ReadonlySet<string>): void {
  for (const [id, g] of nodes.details) g.visible = ids.has(id);
}

/** Free what `prepareHouses` made (the loader's geometry and textures stay with its cache). */
export function disposeHouses(nodes: HouseNodes): void {
  for (const m of nodes.own.materials) m.dispose();
  for (const g of nodes.own.geometries) g.dispose();
}

/** The houses' contract node names (for the dev hook's checks). */
export function houseNodeNames(id: string): { shell: string; detail: string; proxy: string } {
  return { shell: houseShellNode(id), detail: houseDetailNode(id), proxy: houseProxyNode(id) };
}

/** A house's local point in the world, as a Vector3 at height y. */
export function houseLocalPoint(h: Pick<SceneryHouse, "centre" | "doorSide">, lx: number, y: number, lz: number): Vector3 {
  const p = houseLocalToWorld(h, lx, lz);
  return new Vector3(p.x, y, p.z);
}
