import {
  Box3,
  BufferGeometry,
  InstancedMesh,
  Matrix3,
  Matrix4,
  MeshBasicMaterial,
  Vector3,
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
  ACES_IN_INV,
  ACES_OUT_INV,
  FLAT_SKY_MAPPING,
  INVERSE_TONE_GLSL,
  createWaterMaterial,
  makeRippleTexture,
  type SkyMapping,
} from "./villageWater";
import type { ToneCurve } from "../game/quality";

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
 *  - `M_window`, `M_lamp` and `M_glass` stay as they are (Task 7A drives the windows and lamps at night).
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

/**
 * The village camera's planes (m): the sky dome is 1.4 km out (and the far range 1.1 km), so the far plane is past
 * it. The near plane is twice the school's 0.1: the ground's 1-2 cm layers then keep their depth order twice as far
 * (the depth buffer's resolution goes with the near plane, not the far one), and no camera gets that close to a wall.
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
 * frame's brightness. The pale granite plaza a little darker, so its paving pattern holds under the exposure.
 */
export const GROUND_GRADE: Readonly<Record<string, readonly [number, number, number]>> = {
  LM_grass: [1.4, 1.34, 1.05],
  LM_lawn: [1.4, 1.34, 1.05],
  LM_plaza: [0.86, 0.86, 0.86],
};

/** The village's own foliage and trunks: their light is in COLOR_0 (no light map). */
export const FOLIAGE_MATERIALS: readonly string[] = ["M_leaf_green", "M_leaf_cherry", "M_leaf_flora", "M_bark"];

/** The lift's uniform: one for every patched material, so a later change reaches them all. */
export const liftUniform = { value: LIGHT_LIFT };
const lifted = new WeakSet<Material>();

const LIFT_PARS = /* glsl */ `uniform float uVillageLift;
void main() {`;
/** The albedo before COLOR_0 (which is the light on the foliage, a tint on the light-mapped materials). */
const LIFT_ALBEDO = /* glsl */ `vec3 villageAlbedo = diffuseColor.rgb;
#include <color_fragment>`;
const LIFT_LIGHT = /* glsl */ `#ifdef USE_LIGHTMAP
  reflectedLight.indirectDiffuse += vec3( uVillageLift );
#else
  diffuseColor.rgb += villageAlbedo * uVillageLift;
#endif
#include <aomap_fragment>`;

/**
 * Add the lift to a material's light (idempotent): light-mapped, `light map + lift`; vertex-lit (no light map),
 * `COLOR_0 + lift`. Both times multiplied by the albedo, as the light is.
 */
export function liftMaterial(material: Material): void {
  if (lifted.has(material)) return;
  lifted.add(material);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVillageLift = liftUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", LIFT_PARS)
      .replace("#include <color_fragment>", LIFT_ALBEDO)
      .replace("#include <aomap_fragment>", LIFT_LIGHT);
  };
  material.customProgramCacheKey = () => "village-lift";
  material.needsUpdate = true;
}

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
  /** Materials and textures this call made (and nothing else): dispose them with the scene. */
  own: Array<Material | Texture>;
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
export function prepareVillage(source: Object3D, lightmap: Texture, tier: VillageTier, curve: ToneCurve = "neutral"): VillageNodes {
  const root = source.clone(true);
  configureLightmap(lightmap);
  const own: VillageNodes["own"] = [];
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
        if (grade) (m as MeshBasicMaterial).color.setRGB(grade[0], grade[1], grade[2]);
        const offset = GROUND_LAYER_OFFSET[m.name];
        if (offset !== undefined && (!m.polygonOffset || m.polygonOffsetUnits !== offset)) {
          m.polygonOffset = true;
          m.polygonOffsetFactor = -1;
          m.polygonOffsetUnits = offset;
          m.needsUpdate = true;
        }
      } else if (m.name === MATERIAL.backdrop && (m as MeshBasicMaterial).fog) {
        (m as MeshBasicMaterial).fog = false;
        m.needsUpdate = true;
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
        forestCopies.set(m, c);
        copy = c;
      }
      return copy;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });

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
    swapMaterial(root, MATERIAL.waterfall, material);
    falls = { map, down: fallsDown(sheets) };
  }

  return { root, water, falls, sky, skyMapping, own };
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
