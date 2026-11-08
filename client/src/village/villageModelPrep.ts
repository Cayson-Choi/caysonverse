import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix3,
  Matrix4,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Vector3,
  Vector4,
  type Material,
  type Mesh,
  type Object3D,
  type ShaderMaterial,
  type Texture,
} from "three";
import {
  COLLIDER_PREFIX,
  LIGHTMAP_MATERIAL_PREFIX,
  configureLightmap,
  isMesh,
  lightmapMaterial,
  materialsOf,
} from "../game/hub/hubModelPrep";
import {
  WATER,
  ACES_IN_INV,
  ACES_OUT_INV,
  FLAT_SKY_MAPPING,
  INVERSE_TONE_GLSL,
  createWaterMaterial,
  makeRippleTexture,
  type SkyMapping,
} from "./villageWater";
import type { ToneCurve } from "../game/quality";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import type { DayNightState } from "./dayNightBlend";

/**
 * The village model (`village.glb`, 케이슨 마을 Task 6) dressed for the game (Task 7) — the pure part, unit-tested
 * with a hand-built node tree (villageModelPrep.test.ts), the same way as the hub's (hubModelPrep.ts).
 *
 * The file's contract (Task 6 report, checked by scripts/check-school-glb.ts `village`):
 *  - `LM_*` materials are unlit with a baked light on the second UV set: the hub's recipe as it is (channel 1,
 *    flipY false, sRGB, `lightMapIntensity` 1.6π). Some carry a tint in COLOR_0 (the loader turns vertex colours on).
 *  - Foliage (`M_leaf_*`, MASK, double-sided) and trunks (`M_bark`) have their light in COLOR_0; many are GPU
 *    instances (EXT_mesh_gpu_instancing: one InstancedMesh, one draw call, per node). Left as loaded.
 *  - `M_sky` is a dome 1.4 km out (display-referred): no fog, never tone-mapped (the rich tier pre-distorts it by
 *    the inverse of its final tone curve, villageWater.ts). The backdrop has its haze baked in and takes no fog:
 *    `M_backdrop` (the hills and the far range) and the forest on the hills, the instanced `inst__far_*` cards (their
 *    leaf material is copied for them, as the village's own trees share it and stay in the fog).
 *  - `M_water` gets the runtime water (villageWater.ts); `M_waterfall` scrolls down its sheet.
 *  - `M_glow_plot` (the plots' outline strips) glows: its colour is pushed past white (the rich tier blooms it) and
 *    it shows through the fog.
 *  - Day and night (Task 7A, dayNightBlend.ts): every `LM_*` blends the day light map with the night one (`village_lm_night.webp`,
 *    the same UV set: the moon, and the lamps' and windows' pools) by one shared weight; the foliage's vertex light and
 *    the far hills, forest and falls take the time of day's tint; `M_window` and `M_lamp` (copies) glow warm and past
 *    white at night (the rich tier's bloom picks them up); the fountain's lights glow in the water. `M_glass` stays
 *    as it is: not emissive.
 *  - `col__*` are the collision boxes (shared/…/generated/villageColliders.ts is generated from them): hidden.
 *  - The ground's flat layers lie 1-3 cm above each other (plaza and road +0.01, plot lawns +0.02, lanes +0.018,
 *    forecourt +0.03); with the far plane at 1.6 km their materials get a polygon offset, the upper layer winning.
 *  - Brightness (the Task 7 gate, with the scene's neutral tone curve and exposure, sceneLighting.ts): the bake's
 *    ambient lift is raised at runtime on the light-mapped materials and the village's foliage (`LIGHT_LIFT`), and the
 *    lawns and plaza get a small grade (`GROUND_GRADE`).
 *
 * `prepareVillage` works on a CLONE of the cached glTF scene. The shared materials are changed idempotently (the
 * light map, the lift, the grade, fog and tone flags, the polygon offset); everything else that changes is a copy
 * made here, listed in `own` and released with `disposeVillage`.
 */

export const VILLAGE_MODEL_URL = "/models/village/village.glb";
export const VILLAGE_LIGHTMAP_URL = "/models/village/village_lm.webp";
/** The night light map: baked on the same UV set as the day one (art/village/tools/bake_village.py --night). */
export const VILLAGE_NIGHT_LIGHTMAP_URL = "/models/village/village_lm_night.webp";

/**
 * The village camera's planes (m): the sky dome is 1.4 km out (and the far range 1.1 km), so the far plane is past
 * it. The near plane is twice the school's 0.1: the ground's 1-2 cm layers then keep their depth order twice as far
 * (the depth buffer's resolution goes with the near plane, not the far one). The village's spring arm stops the camera
 * 0.3 m in front of a wall (activeMap.ts `VILLAGE_CAMERA_PAD`), so a camera pressed into a corner keeps clear of it.
 */
export const VILLAGE_CAMERA_PLANES = { near: 0.2, far: 1600 } as const;

/** The instanced forest cards on the backdrop's hills (`inst__far_<variant>_<k>`). */
export const BACKDROP_FOREST_PREFIX = "inst__far_";

export const MATERIAL = {
  sky: "M_sky",
  backdrop: "M_backdrop",
  glowPlot: "M_glow_plot",
  water: "M_water",
  waterfall: "M_waterfall",
  window: "M_window",
  lamp: "M_lamp",
  glass: "M_glass",
} as const;

/** How far past white the plot outlines are pushed (×). The rich tier's bloom starts at luminance 1.6. */
export const GLOW_BOOST = 3.2;

/**
 * The ground's flat layers and their polygon offset (units; more negative is drawn over the rest). The base grass
 * (`LM_grass`, y = 0) has none.
 */
export const GROUND_LAYER_OFFSET: Readonly<Record<string, number>> = {
  LM_plaza: -1,
  LM_lawn: -1,
  LM_concrete: -2,
  LM_stone: -2,
};

/**
 * Where the village's ground decals lie (the avatars' blob shadows, the rich tier's shadow floor; game/groundDecal.ts):
 * 5 cm up, over the memorial forecourt's top (3 cm), with a polygon offset stronger than every ground layer's on both
 * terms (factor -2 against -1, units -8 against -1/-2), as the plot markers do. At the default 3 cm without an offset
 * they drew under the offset layers and the avatars lost their shadows on the forecourt (Task 7 review I2).
 */
export const VILLAGE_GROUND_DECAL = { y: 0.05, polygonOffsetFactor: -2, polygonOffsetUnits: -8 } as const;

/**
 * The bake's ambient lift, raised at runtime (light units: 1 = the albedo as it is). The light map stores light from
 * Cycles with a +0.10 lift (Task 6) and the foliage its light in COLOR_0; under the tone curve the shadowed sides,
 * the dark woods and the leaf undersides fell near black (luma p5 0.00-0.04 in the Task 6 frames). This adds the same
 * light everywhere on the light-mapped materials and the village's own foliage and trunks, which lifts the shadows
 * most (a re-bake with a higher LM_LIFT would do the same, Task 6 report). The backdrop's forest keeps its light.
 */
export const LIGHT_LIFT = 0.2;

/**
 * A colour grade on the ground (× the material's colour, linear). The lawns brighter and sunnier, toward the owner's
 * style picture (art/village/refs/owner_village_style.webp): the ground holds most of every frame, so they carry the
 * frame's brightness. The pale granite plaza darker (0.7), so its paving pattern holds under the exposure and stays
 * below the neutral curve's shoulder, where a live 0.7x shadow still reads (Task 7 review m8; at 0.86 the rich tier's
 * shoulder wiped the avatars' shadows off the paving).
 */
export const GROUND_GRADE: Readonly<Record<string, readonly [number, number, number]>> = {
  LM_grass: [1.4, 1.34, 1.05],
  LM_lawn: [1.4, 1.34, 1.05],
  LM_plaza: [0.7, 0.7, 0.7],
};

/**
 * The same grade at night (× the light-mapped light): the day's sunny lime would stay vivid under the moon, so the lawns
 * move toward a cool dark green with the night weight (Task 7A). The plaza's grade is neutral and stays.
 */
export const GROUND_GRADE_NIGHT: Readonly<Record<string, readonly [number, number, number]>> = {
  LM_grass: [0.85, 1.0, 1.3],
  LM_lawn: [0.85, 1.0, 1.3],
};

/** The village's own foliage and trunks: their light is in COLOR_0 (no light map). */
export const FOLIAGE_MATERIALS: readonly string[] = ["M_leaf_green", "M_leaf_cherry", "M_leaf_flora", "M_bark"];

/**
 * The time of day's shared uniforms (Task 7A): ONE object each for every patched material, so one write reaches them
 * all (`applyDayNight` writes them from the clock's state, every frame). Their starting values are the afternoon the
 * model was baked in (the day look: lift 0.2, no tint, the day light map alone).
 */
export const liftUniform = { value: LIGHT_LIFT };
/** The colour the lift carries (white by day, moonlit blue at night). */
export const liftTintUniform = { value: new Vector3(1, 1, 1) };
/** × the day light map's light (the golden hour's warm cast). */
export const dayTintUniform = { value: new Vector3(1, 1, 1) };
/** × the foliage's vertex light (warm at dusk, dark blue at night). */
export const foliageTintUniform = { value: new Vector3(1, 1, 1) };
/** The same for the cherry blossoms (`M_leaf_cherry`), darker at night (Task 7A review m-g). */
export const cherryTintUniform = { value: new Vector3(1, 1, 1) };
/** The cherry blossoms' material: its foliage tint is `cherryTintUniform`. */
export const CHERRY_MATERIAL = "M_leaf_cherry";
/**
 * The cool cast of moonlight on the night light map's dim texels (× linear): what the moon alone lights is bluish and
 * a little darker, while the lamps' and windows' pools (bright texels) keep their warm colour.
 */
export const MOON_TINT: readonly [number, number, number] = [0.55, 0.75, 1.2];
export const moonTintUniform = { value: new Vector3(...MOON_TINT) };
/** The night light map's weight: 0 = the day map alone, 1 = the night map alone. */
export const nightBlendUniform = { value: 0 };
/** The night light map (the same UV set as the day one), or null until it is loaded (`setNightLightmap`). */
export const nightMapUniform: { value: Texture | null } = { value: null };

/** Lay the night light map on every patched material (configured like the day one), or take it away (null). */
export function setNightLightmap(texture: Texture | null): void {
  if (texture) configureLightmap(texture);
  nightMapUniform.value = texture;
}

/** The light tier's largest texture side (final review I2). The light maps keep their 2048 (soft shadows show it). */
export const LIGHT_TIER_MAX_TEXTURE = 1024;

/** The slice of a canvas `capTextureSize` draws into. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): { drawImage(image: never, x: number, y: number, w: number, h: number): void } | null;
}

const browserCanvas = (): CanvasLike | null =>
  typeof document === "undefined" ? null : (document.createElement("canvas") as unknown as CanvasLike);

/**
 * Shrink a texture's image so its longest side is at most `max` (a canvas copy; the decoded original is closed). Done
 * once per texture, before its first upload. Returns true when it shrank it. Never throws: a texture it cannot draw
 * stays as it is.
 */
export function capTextureSize(texture: Texture, max: number, makeCanvas: () => CanvasLike | null = browserCanvas): boolean {
  const img = texture.image as { width?: number; height?: number; close?: () => void } | null | undefined;
  if (!img || !img.width || !img.height || (img.width <= max && img.height <= max)) return false;
  if (texture.userData.villageCapped) return false;
  const scale = max / Math.max(img.width, img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  let canvas: CanvasLike | null;
  try {
    canvas = makeCanvas();
    if (!canvas) return false;
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return false;
    g.drawImage(img as never, 0, 0, w, h);
  } catch {
    return false;
  }
  try {
    img.close?.(); // an ImageBitmap: free the decoded original now
  } catch {
    // ignore
  }
  texture.image = canvas;
  texture.needsUpdate = true;
  texture.userData.villageCapped = true;
  return true;
}

const COLOUR_MAPS = ["map", "alphaMap", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "bumpMap"] as const;

/** Cap every texture of the model's materials (not the light maps) at `max` px. Returns how many it shrank. */
export function capModelTextures(root: Object3D, max: number, makeCanvas?: () => CanvasLike | null): number {
  const seen = new Set<Texture>();
  let n = 0;
  root.traverse((o) => {
    if (!isMesh(o)) return;
    for (const m of materialsOf(o)) {
      for (const key of COLOUR_MAPS) {
        const t = (m as unknown as Record<string, Texture | null | undefined>)[key];
        if (!t || seen.has(t)) continue;
        seen.add(t);
        if (capTextureSize(t, max, makeCanvas)) n++;
      }
    }
  });
  return n;
}

/** Free a texture on the GPU and close its decoded bitmap (Safari keeps a decoded copy otherwise). */
export function freeTexture(t: Texture): void {
  t.dispose();
  const img = t.image as { close?: () => void } | null | undefined;
  try {
    img?.close?.();
  } catch {
    // ignore
  }
}
const lifted = new WeakSet<Material>();

const LIFT_PARS = /* glsl */ `uniform float uVillageLift;
uniform vec3 uVillageLiftTint;
uniform vec3 uVillageDayTint;
uniform vec3 uVillageFoliageTint;
#ifdef USE_LIGHTMAP
uniform float uVillageNight;
uniform sampler2D uVillageNightMap;
uniform vec3 uVillageMoonTint;
#endif
void main() {`;
/** The albedo before COLOR_0 (which is the light on the foliage, a tint on the light-mapped materials). */
const LIFT_ALBEDO = /* glsl */ `vec3 villageAlbedo = diffuseColor.rgb;
#include <color_fragment>`;
/**
 * The light map's texel: the day map (× the dusk tint) and the night map, blended by the clock's weight. Each map is
 * read only while it counts (the weight is a uniform: the branch is coherent), so a daytime frame costs one fetch.
 */
const LIGHTMAP_TEXEL_FROM = "vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );";
const LIGHTMAP_TEXEL_TO = /* glsl */ `vec4 lightMapTexel = vec4( 0.0, 0.0, 0.0, 1.0 );
	if ( uVillageNight < 0.999 ) lightMapTexel.rgb = texture2D( lightMap, vLightMapUv ).rgb * uVillageDayTint * ( 1.0 - uVillageNight );
	if ( uVillageNight > 0.001 ) {
		vec3 villageNightLight = texture2D( uVillageNightMap, vLightMapUv ).rgb;
		villageNightLight *= mix( uVillageMoonTint, vec3( 1.0 ), smoothstep( 0.04, 0.22, dot( villageNightLight, vec3( 0.2126, 0.7152, 0.0722 ) ) ) );
		lightMapTexel.rgb += villageNightLight * uVillageNight;
	}`;
const LIFT_LIGHT = /* glsl */ `#ifdef USE_LIGHTMAP
  reflectedLight.indirectDiffuse += uVillageLift * uVillageLiftTint;
#else
  diffuseColor.rgb = ( diffuseColor.rgb + villageAlbedo * uVillageLift ) * uVillageFoliageTint;
#endif
#include <aomap_fragment>`;

/**
 * Give a material the time of day's light (idempotent). Light-mapped: `day map × golden tint` blended with the night
 * map, plus the lift; vertex-lit (no light map): `(COLOR_0 + lift) × foliage tint`. Both times multiplied by the albedo, as the
 * light is. The shared uniforms above drive it.
 */
export function liftMaterial(material: Material): void {
  if (lifted.has(material)) return;
  lifted.add(material);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVillageLift = liftUniform;
    shader.uniforms.uVillageLiftTint = liftTintUniform;
    shader.uniforms.uVillageDayTint = dayTintUniform;
    shader.uniforms.uVillageFoliageTint = material.name === CHERRY_MATERIAL ? cherryTintUniform : foliageTintUniform;
    shader.uniforms.uVillageNight = nightBlendUniform;
    shader.uniforms.uVillageNightMap = nightMapUniform;
    shader.uniforms.uVillageMoonTint = moonTintUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", LIFT_PARS)
      .replace(LIGHTMAP_TEXEL_FROM, LIGHTMAP_TEXEL_TO)
      .replace("#include <color_fragment>", LIFT_ALBEDO)
      .replace("#include <aomap_fragment>", LIFT_LIGHT);
  };
  material.customProgramCacheKey = () => "village-light";
  material.needsUpdate = true;
}

/**
 * The night lights: `M_window` and `M_lamp` (copies) glow warm and past white once the clock turns them on
 * (`DayNightState.lights`, from night 0.3). The texture stays as the detail (mullions, curtains, the lamp's metal),
 * pulled toward the glow colour; the rich tier's bloom (threshold 1.6) lets the lit ones shine.
 */
export const LIT = {
  window: { color: [1.0, 0.76, 0.46], boost: 2.1 },
  lamp: { color: [1.0, 0.8, 0.5], boost: 3.4 },
} as const;
/** How lit the windows and lamps are (0..1), shared by their copies. */
export const litUniform = { value: 0 };
const LIT_PARS = /* glsl */ `uniform float uVillageLit;
uniform vec3 uVillageLitColor;
uniform float uVillageLitBoost;
void main() {`;
const LIT_GLOW = /* glsl */ `#include <map_fragment>
float villageGlowLuma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, uVillageLitColor * ( 0.4 + 0.9 * villageGlowLuma ) * uVillageLitBoost, uVillageLit );`;

/** A copy of a window or lamp material that glows with `litUniform`. */
export function litMaterial(source: Material, kind: keyof typeof LIT): MeshBasicMaterial {
  const m = (source as MeshBasicMaterial).clone();
  const uniforms = {
    uVillageLit: litUniform,
    uVillageLitColor: { value: new Vector3(...LIT[kind].color) },
    uVillageLitBoost: { value: LIT[kind].boost },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", LIT_PARS).replace("#include <map_fragment>", LIT_GLOW);
  };
  m.customProgramCacheKey = () => "village-lit";
  return m;
}

/** The fountain's lights in the water at night: how hard they glow (the water shader's `uFountain.w`). */
export const FOUNTAIN_GLOW_STRENGTH = 1.5;

/** The waterfall's sheet slides down this many texture lengths per second. */
export const FALLS_SPEED = 0.45;

export interface VillageNodes {
  root: Object3D;
  /** The water surfaces' material (one, shared by every `M_water` primitive), or null. */
  water: ShaderMaterial | null;
  /** The waterfall sheets' map (a copy) and which way along v is "down" (+1 or -1). */
  falls: { map: Texture; down: number } | null;
  /** The dome's material (a copy), whose exposure the rich tier keeps in step with the renderer. */
  sky: MeshBasicMaterial | null;
  /** The sky dome's mapping, for the water's reflection. */
  skyMapping: SkyMapping;
  /** The far hills, the forest on them and the falls: x the time of day's haze tint (the hills' material is shared). */
  hazed: MeshBasicMaterial[];
  /** The graded ground materials (shared): the day's grade moves to the night's with the night weight. */
  graded: Array<{ material: MeshBasicMaterial; day: readonly [number, number, number]; night: readonly [number, number, number] }>;
  /** The stars (a layer of points just inside the dome), fading in with the night; null when none. */
  stars: Points | null;
  /** Materials, textures and geometries this call made (and nothing else): dispose them with the scene. */
  own: Array<Material | Texture | BufferGeometry>;
}

/** The light tier draws cheaper water and the dome untone-mapped; the rich tier, two ripple layers and a pre-distorted dome. */
export type VillageTier = "high" | "low";

const tmp = new Vector3();

/**
 * Fit how the dome's texture lies on directions (see `SkyMapping`) from the dome's vertices: the azimuth's sign and
 * offset by a circular mean (the u wrap seam does not matter), the elevation's scale and offset by least squares.
 */
export function fitSkyMapping(geometry: BufferGeometry, matrixWorld?: Matrix4): SkyMapping {
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!pos || !uv || pos.count < 3) return FLAT_SKY_MAPPING;
  const world = (i: number) => (matrixWorld ? tmp.fromBufferAttribute(pos, i).applyMatrix4(matrixWorld) : tmp.fromBufferAttribute(pos, i));
  const bb = new Box3();
  for (let i = 0; i < pos.count; i++) bb.expandByPoint(world(i));
  // A sphere's cap (the dome reaches a little below the horizon): its centre is a radius below the top.
  const radius = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
  const centre = new Vector3((bb.min.x + bb.max.x) / 2, bb.max.y - radius, (bb.min.z + bb.max.z) / 2);
  const step = Math.max(1, Math.floor(pos.count / 4000));
  let best: { sign: number; offset: number; spread: number } | null = null;
  for (const sign of [1, -1]) {
    let cs = 0;
    let sn = 0;
    let n = 0;
    for (let i = 0; i < pos.count; i += step) {
      world(i).sub(centre);
      const horiz = Math.hypot(tmp.x, tmp.z);
      if (horiz < 1e-3 * tmp.length()) continue; // the zenith has no azimuth
      const az = Math.atan2(tmp.x, tmp.z);
      const offset = uv.getX(i) - (sign * az) / (2 * Math.PI);
      cs += Math.cos(offset * 2 * Math.PI);
      sn += Math.sin(offset * 2 * Math.PI);
      n++;
    }
    if (n === 0) continue;
    const r = Math.hypot(cs, sn) / n; // 1 = every vertex agrees
    const offset = ((Math.atan2(sn, cs) / (2 * Math.PI)) % 1 + 1) % 1;
    if (!best || 1 - r < best.spread) best = { sign, offset, spread: 1 - r };
  }
  // v against elevation (radians).
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let n = 0;
  for (let i = 0; i < pos.count; i += step) {
    world(i).sub(centre);
    const len = tmp.length();
    if (len === 0) continue;
    const el = Math.asin(Math.min(1, Math.max(-1, tmp.y / len)));
    const v = uv.getY(i);
    sx += el;
    sy += v;
    sxx += el * el;
    sxy += el * v;
    n++;
  }
  const den = n * sxx - sx * sx;
  if (!best || n < 2 || Math.abs(den) < 1e-9) return FLAT_SKY_MAPPING;
  const vScale = (n * sxy - sx * sy) / den;
  const vOffset = (sy - vScale * sx) / n;
  return { uSign: best.sign, uOffset: best.offset, vScale, vOffset };
}

/**
 * Which way the waterfall falls along its texture: +1 when v grows as the sheet goes down, -1 when it shrinks (the
 * sign of the covariance of v and height, over the sheets' vertices). +1 if it cannot tell.
 */
export function fallsDown(sheets: ReadonlyArray<{ geometry: BufferGeometry; matrixWorld: Matrix4 }>): number {
  let n = 0;
  let sy = 0;
  let sv = 0;
  let syv = 0;
  for (const s of sheets) {
    const pos = s.geometry.getAttribute("position");
    const uv = s.geometry.getAttribute("uv");
    if (!pos || !uv) continue;
    for (let i = 0; i < pos.count; i++) {
      const y = tmp.fromBufferAttribute(pos, i).applyMatrix4(s.matrixWorld).y;
      const v = uv.getY(i);
      n++;
      sy += y;
      sv += v;
      syv += y * v;
    }
  }
  if (n < 2) return 1;
  const cov = syv / n - (sy / n) * (sv / n);
  return cov > 0 ? -1 : 1;
}

/** The meshes below `root` that use the material named `name`. */
function meshesWith(root: Object3D, name: string): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (isMesh(o) && materialsOf(o).some((m) => m.name === name)) out.push(o);
  });
  return out;
}

/** Replace every use of the material named `name` below `root` by `replacement`. */
function swapMaterial(root: Object3D, name: string, replacement: Material): void {
  root.traverse((o) => {
    if (!isMesh(o)) return;
    if (Array.isArray(o.material)) o.material = o.material.map((m) => (m.name === name ? replacement : m));
    else if (o.material.name === name) o.material = replacement;
  });
}

/** The dome's material for a tier: untone-mapped, no fog, and on the rich tier pre-distorted (see villageWater.ts). */
function skyMaterial(source: MeshBasicMaterial, tier: VillageTier, curve: ToneCurve): MeshBasicMaterial {
  const m = source.clone();
  m.fog = false;
  m.toneMapped = false;
  if (tier === "high") {
    const uniforms = {
      uAcesInInv: { value: new Matrix3().copy(ACES_IN_INV) },
      uAcesOutInv: { value: new Matrix3().copy(ACES_OUT_INV) },
      uExposure: { value: 1 },
    };
    m.userData.inverseTone = uniforms;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", `${curve === "neutral" ? "#define VILLAGE_INVERSE_NEUTRAL\n" : ""}${INVERSE_TONE_GLSL}\nvoid main() {`)
        .replace("#include <tonemapping_fragment>", "gl_FragColor.rgb = villageInverseTone( gl_FragColor.rgb );\n#include <tonemapping_fragment>");
    };
    m.customProgramCacheKey = () => `village-sky-inverse-${curve}`;
  }
  return m;
}

/**
 * Dress a clone of the village model for the game (see the file header). Safe to call again on the same source
 * scene (the shared materials are changed idempotently); every call makes its own copies of what it changes more.
 */
export function prepareVillage(
  source: Object3D,
  lightmap: Texture,
  tier: VillageTier,
  curve: ToneCurve = "neutral",
  nightLightmap?: Texture | null,
): VillageNodes {
  const root = source.clone(true);
  configureLightmap(lightmap);
  // The night light map is loaded on its own when night is near (VillageModel's NightLightmap, final fix I2b):
  // left out, the current one stays; null clears it.
  if (nightLightmap !== undefined) setNightLightmap(nightLightmap);
  // The light (phone) tier caps the model's colour textures at 1024 px (final review I2): a quarter of the memory.
  if (tier === "low") capModelTextures(source, LIGHT_TIER_MAX_TEXTURE);
  const own: VillageNodes["own"] = [];
  const hazed: MeshBasicMaterial[] = [];
  const graded: VillageNodes["graded"] = [];
  const found = new Map<string, Material>();

  root.traverse((o) => {
    if (o.name.startsWith(COLLIDER_PREFIX)) {
      o.visible = false;
      return;
    }
    if (!isMesh(o)) return;
    for (const m of materialsOf(o)) {
      if (!found.has(m.name)) found.set(m.name, m);
      if (m.name.startsWith(LIGHTMAP_MATERIAL_PREFIX) || (FOLIAGE_MATERIALS.includes(m.name) && !o.name.startsWith(BACKDROP_FOREST_PREFIX))) {
        liftMaterial(m);
      }
      if (m.name.startsWith(LIGHTMAP_MATERIAL_PREFIX)) {
        lightmapMaterial(m, lightmap);
        const grade = GROUND_GRADE[m.name];
        if (grade) {
          (m as MeshBasicMaterial).color.setRGB(grade[0], grade[1], grade[2]);
          const night = GROUND_GRADE_NIGHT[m.name];
          if (night && !graded.some((g) => g.material === m)) graded.push({ material: m as MeshBasicMaterial, day: grade, night });
        }
        const offset = GROUND_LAYER_OFFSET[m.name];
        if (offset !== undefined && (!m.polygonOffset || m.polygonOffsetUnits !== offset)) {
          m.polygonOffset = true;
          m.polygonOffsetFactor = -1;
          m.polygonOffsetUnits = offset;
          m.needsUpdate = true;
        }
      } else if (m.name === MATERIAL.backdrop) {
        if ((m as MeshBasicMaterial).fog) {
          (m as MeshBasicMaterial).fog = false;
          m.needsUpdate = true;
        }
        if (!hazed.includes(m as MeshBasicMaterial)) hazed.push(m as MeshBasicMaterial);
      }
    }
  });
  root.updateMatrixWorld(true);

  // The sky dome: its own material per tier, and its texture's mapping for the water's reflection.
  let sky: MeshBasicMaterial | null = null;
  let skyMapping = FLAT_SKY_MAPPING;
  const skySource = found.get(MATERIAL.sky) as MeshBasicMaterial | undefined;
  if (skySource) {
    sky = skyMaterial(skySource, tier, curve);
    own.push(sky);
    swapMaterial(root, MATERIAL.sky, sky);
    const dome = meshesWith(root, MATERIAL.sky)[0];
    if (dome) skyMapping = fitSkyMapping(dome.geometry, dome.matrixWorld);
  }

  // The forest on the backdrop's hills: no fog, like the hills under it (one copy per leaf material it uses).
  const forestCopies = new Map<Material, Material>();
  root.traverse((o) => {
    if (!isMesh(o) || !o.name.startsWith(BACKDROP_FOREST_PREFIX)) return;
    const swap = (m: Material): Material => {
      let copy = forestCopies.get(m);
      if (!copy) {
        const c = (m as MeshBasicMaterial).clone();
        c.fog = false;
        own.push(c);
        hazed.push(c);
        forestCopies.set(m, c);
        copy = c;
      }
      return copy;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });

  // The windows and lamps: copies that glow at night (M_glass, the lanterns' and windows' panes, stays as it is).
  for (const [name, kind] of [
    [MATERIAL.window, "window"],
    [MATERIAL.lamp, "lamp"],
  ] as const) {
    const source = found.get(name);
    if (!source) continue;
    const lit = litMaterial(source, kind);
    own.push(lit);
    swapMaterial(root, name, lit);
  }

  // The plots' outlines glow.
  const glowSource = found.get(MATERIAL.glowPlot) as MeshBasicMaterial | undefined;
  if (glowSource) {
    const glow = glowSource.clone();
    glow.color.multiplyScalar(GLOW_BOOST);
    glow.fog = false;
    own.push(glow);
    swapMaterial(root, MATERIAL.glowPlot, glow);
  }

  // The water.
  let water: ShaderMaterial | null = null;
  const waterSource = found.get(MATERIAL.water) as MeshBasicMaterial | undefined;
  if (waterSource) {
    const ripple = makeRippleTexture();
    own.push(ripple);
    water = createWaterMaterial({
      map: waterSource.map,
      sky: skySource?.map ?? null,
      skyMapping,
      ripple,
      detail: tier === "high",
      side: waterSource.side,
    });
    own.push(water);
    for (const mesh of meshesWith(root, MATERIAL.water)) {
      if (!mesh.geometry.getAttribute("normal")) mesh.geometry.computeVertexNormals();
    }
    swapMaterial(root, MATERIAL.water, water);
  }

  // The waterfall: a copy of its material and map, the map slid down every frame.
  let falls: VillageNodes["falls"] = null;
  const fallsSource = found.get(MATERIAL.waterfall) as MeshBasicMaterial | undefined;
  if (fallsSource?.map) {
    const sheets = meshesWith(root, MATERIAL.waterfall);
    const material = fallsSource.clone();
    const map = fallsSource.map.clone();
    material.map = map;
    own.push(material, map);
    hazed.push(material);
    swapMaterial(root, MATERIAL.waterfall, material);
    falls = { map, down: fallsDown(sheets) };
  }

  // The fountain's lights: where the water glows at night.
  if (water) {
    const f = VILLAGE_LAYOUT.plaza.fountain.centre;
    (water.uniforms.uFountain!.value as Vector4).set(f.x, f.z, WATER.fountainGlow.radius, 0);
  }

  // The stars, just inside the dome.
  let stars: Points | null = null;
  if (skySource) {
    stars = makeStars();
    own.push(stars.geometry, stars.material as PointsMaterial);
    root.add(stars);
  }

  return { root, water, falls, sky, skyMapping, hazed, graded, stars, own };
}

/** The stars: this many, between 8 and 90 degrees above the horizon, `STAR_RADIUS` m from the dome's centre (inside the dome). */
export const STAR_COUNT = 520;
export const STAR_RADIUS = 1300;

/** A seeded generator (mulberry32): the same sky every time. */
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

/** The night sky's stars (points of mixed brightness, never in the fog, never lit). Invisible until the night fades them in. */
export function makeStars(count = STAR_COUNT): Points {
  const rand = rng(20261103);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const sin8 = Math.sin((8 * Math.PI) / 180);
  for (let i = 0; i < count; i++) {
    // Uniform over the sky above 8 degrees: sin(elevation) is uniform between sin 8 and 1.
    const sinEl = sin8 + rand() * (1 - sin8);
    const cosEl = Math.sqrt(1 - sinEl * sinEl);
    const az = rand() * Math.PI * 2;
    pos[i * 3] = STAR_RADIUS * cosEl * Math.sin(az);
    pos[i * 3 + 1] = STAR_RADIUS * sinEl - 60; // the dome's centre is 60 m below the ground
    pos[i * 3 + 2] = -STAR_RADIUS * cosEl * Math.cos(az);
    const b = 0.35 + 0.65 * rand() ** 2;
    col[i * 3] = b * (0.85 + 0.15 * rand());
    col[i * 3 + 1] = b * 0.95;
    col[i * 3 + 2] = b;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  const m = new PointsMaterial({
    size: 2.2,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const stars = new Points(g, m);
  stars.name = "village_stars";
  stars.frustumCulled = false;
  stars.visible = false;
  stars.renderOrder = -1; // behind the transparent surfaces (water, falls), in front of the dome by depth
  return stars;
}

/**
 * Per frame: the time of day's numbers into the model (plain number writes, no shader change): the shared light
 * uniforms (the light maps' blend, the dusk tint, the lift), the lamps' and windows' glow, the tints of the dome,
 * hills and falls, the water's tint, glint and the fountain's lights, the stars.
 */
export function applyDayNight(nodes: VillageNodes, s: DayNightState): void {
  liftUniform.value = s.lift;
  liftTintUniform.value.set(s.liftTint[0], s.liftTint[1], s.liftTint[2]);
  dayTintUniform.value.set(s.dayTint[0], s.dayTint[1], s.dayTint[2]);
  foliageTintUniform.value.set(s.foliageTint[0], s.foliageTint[1], s.foliageTint[2]);
  cherryTintUniform.value.set(s.cherryTint[0], s.cherryTint[1], s.cherryTint[2]);
  // No night map yet (it loads when night is near, final fix I2b): the day map alone, never a black blend.
  nightBlendUniform.value = nightMapUniform.value ? s.night : 0;
  litUniform.value = s.lights;
  nodes.sky?.color.setRGB(s.domeTint[0], s.domeTint[1], s.domeTint[2]);
  for (const m of nodes.hazed) m.color.setRGB(s.hazeTint[0], s.hazeTint[1], s.hazeTint[2]);
  for (const g of nodes.graded) {
    const n = s.night;
    g.material.color.setRGB(g.day[0] + (g.night[0] - g.day[0]) * n, g.day[1] + (g.night[1] - g.day[1]) * n, g.day[2] + (g.night[2] - g.day[2]) * n);
  }
  const w = nodes.water;
  if (w) {
    (w.uniforms.uTint!.value as Vector3).set(s.waterTint[0], s.waterTint[1], s.waterTint[2]);
    (w.uniforms.uFountain!.value as Vector4).w = s.lights * FOUNTAIN_GLOW_STRENGTH;
    // The glint is the live key light's: the sun, or the moon at night.
    (w.uniforms.uSunDir!.value as Vector3).set(s.keyDir[0], s.keyDir[1], s.keyDir[2]);
    const level = Math.min(1, s.keyIntensity / 2.4);
    (w.uniforms.uSunColor!.value as Vector3).set(s.keyColor[0] * level, s.keyColor[1] * level, s.keyColor[2] * level);
  }
  const stars = nodes.stars;
  if (stars) {
    stars.visible = s.stars > 0.01;
    (stars.material as PointsMaterial).opacity = s.stars;
  }
}

/** Per frame: the water's clock, the falls' slide and the dome's exposure (plain number writes). */
export function tickVillage(nodes: VillageNodes, seconds: number, exposure: number): void {
  if (nodes.water) nodes.water.uniforms.uTime!.value = seconds;
  if (nodes.falls) nodes.falls.map.offset.y = -nodes.falls.down * ((seconds * FALLS_SPEED) % 1);
  const inverse = nodes.sky?.userData.inverseTone as { uExposure: { value: number } } | undefined;
  if (inverse) inverse.uExposure.value = exposure;
}

/** Release what `prepareVillage` made (the shared model materials, geometry and textures stay with the loader's cache). */
export function disposeVillage(nodes: VillageNodes): void {
  for (const r of nodes.own) r.dispose();
  // The clone's InstancedMeshes own their instance buffers (InstancedMesh.copy makes new ones): the renderer frees
  // them on the mesh's "dispose" (Task 7 review I1). The geometry stays: it is the loader's.
  nodes.root.traverse((o) => {
    if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose();
  });
}

/**
 * Free the GPU side of the LOADED model itself (the loader's cached scene): its geometry, materials, their maps and
 * light maps, and its instance buffers, each once. Only when the village is left for good and the loader's cache entry
 * is cleared (villageRelease.ts), after every clone is gone.
 */
export function disposeVillageSource(scene: Object3D): void {
  const done = new Set<{ dispose(): void }>();
  const free = (r: { dispose(): void } | null | undefined): void => {
    if (!r || done.has(r)) return;
    done.add(r);
    if ((r as Texture).isTexture) freeTexture(r as Texture);
    else r.dispose();
  };
  scene.traverse((o) => {
    if (!isMesh(o)) return;
    free(o.geometry);
    for (const m of materialsOf(o)) {
      for (const key of COLOUR_MAPS) free((m as unknown as Record<string, Texture | null | undefined>)[key]);
      free((m as MeshBasicMaterial).lightMap);
      free(m);
    }
    if ((o as InstancedMesh).isInstancedMesh) free(o as InstancedMesh);
  });
}

/** The number of draw calls the model's meshes cost at most (an InstancedMesh counts once, whatever its count). */
export function drawCallBudget(root: Object3D): { meshes: number; instanced: number; instances: number } {
  let meshes = 0;
  let instanced = 0;
  let instances = 0;
  root.traverse((o) => {
    if (!isMesh(o) || !o.visible || o.name.startsWith(COLLIDER_PREFIX)) return;
    meshes += materialsOf(o).length;
    if ((o as InstancedMesh).isInstancedMesh) {
      instanced++;
      instances += (o as InstancedMesh).count;
    }
  });
  return { meshes, instanced, instances };
}
