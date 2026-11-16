// The real lake files dressed for the game (F, 2026-11-16): chunk A's `lake.glb` (ground, water, reeds, forest, the ridge round
// the valley; its day and night light maps on UV1) and chunk B's `lake_structures.glb` (pier, 좌대, office, pavilion, benches,
// chairs, lamps: lit materials with COLOR_0 for the hue and grey detail textures).
//
//  - `LM_*` (lake_ground): the village's light-map recipe as it is (configureLightmap + lightmapMaterial: channel 1, 1.6π, the
//    same GAME_GAIN the bake used) and the village's day/night light (liftMaterial) with the LAKE's own night map and weight.
//    LM_grass gets the village lawn's grade, so the seam at x 95.5 has no step in colour.
//  - Foliage (`M_plant`, `M_bark`, `M_leaf_green`): light in COLOR_0, the village's foliage tint and lift.
//  - `M_ridge`: unlit, its final light in COLOR_0 like the village backdrop: no fog, the haze tint of the time of day.
//  - `inst__lakehi_*`: the rich tier only.
//  - `lake_water`: the lake's runtime water (lakeWater.ts) reading COLOR_0 (r depth, g shallows, b distance from the shore).
//  - structures: `col__*`, `seat__*`, `spot__*`, `light__*`, `npc__*` helpers hidden; the lamps' and windows' emissive glow
//    follows the night; every lit-by-the-scene material of B's model (wood, metal, paint, siding, ...) is replaced by a
//    light-mapped one, like the terrain's: B's own day / night light maps (`lake_structures_lm*.webp`, UV1, baked with the
//    same sun, sky and lamps; art follow-up F2) give the pier, the huts and the office their ambient occlusion and the lamps'
//    light pools at night, on phones too. Emissive and glass materials stay as the loader made them. B's model now has the
//    lamps 2-4 where `LAKE_LAMPS` puts them (the old run-time vertex shift is gone).
//
// Everything here works on CLONES of the cached glTF scenes; the materials are the loader's, changed idempotently.

import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { LAKE_AREA } from "@caysonverse/shared/village/lakeLayout";
import { configureLightmap, lightmapMaterial } from "../game/hub/hubModelPrep";
import { GROUND_GRADE, GROUND_GRADE_NIGHT, liftMaterial, type VillageTier } from "../village/villageModelPrep";
import type { DayNightState } from "../village/dayNightBlend";

/** A rectangle of the village model the lake replaces (lake.glb `extras.lake.seam`). */
export interface SeamRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** What the village patch takes out of the village's clone once the real lake is drawn (lakeVillagePatch.ts). */
export interface LakeSeam {
  /** Triangles of the village wholly inside one of these go (the ground hole, the backdrop hole). */
  holes: readonly SeamRect[];
  /** The ridge's footprint: a set of 4 m cells (`cellKey`) it covers; the village's far forest instances inside are hidden. */
  ridgeCells: ReadonlySet<number>;
}

export const RIDGE_CELL = 4;
export const cellKey = (x: number, z: number): number => Math.floor(x / RIDGE_CELL) * 100003 + Math.floor(z / RIDGE_CELL);

/** The seam when lake.glb says nothing (or the greybox): the lake zone. */
export const DEFAULT_SEAM: LakeSeam = { holes: [LAKE_AREA], ridgeCells: new Set() };

export interface LakeDressed {
  /** The lake's water meshes (they get the runtime water material). */
  water: Mesh[];
  /** Emissive materials of the structures (lamps, windows, the shop's fluorescent tube): their day / night strength. */
  glows: Array<{ material: MeshStandardMaterial; strength: number }>;
  /** The ridge's material and the like: × the time of day's haze tint. */
  hazed: MeshBasicMaterial[];
  /** LM_grass: graded like the village's lawns, day to night. */
  graded: Array<{ material: MeshBasicMaterial; day: readonly number[]; night: readonly number[] }>;
  /** Lamp heads (x, z, y) after the move: for the water's long reflections. */
  lampHeads: Vector3[];
  seam: LakeSeam;
  /** Copies made here (released by `disposeLake`). */
  own: BufferGeometry[];
}

/** The lake's own night light map and its weight (the village's are for village.glb's atlas). */
export const lakeNightMap: { value: Texture | null } = { value: null };
export const lakeNightBlend = { value: 0 };
const LAKE_LIGHT = { nightMap: lakeNightMap, nightBlend: lakeNightBlend, key: "lake" };
/** The facilities' own night light map (UV1 of lake_structures.glb) and its light recipe (same weight as the terrain's). */
export const structuresNightMap: { value: Texture | null } = { value: null };
const STRUCT_LIGHT = { nightMap: structuresNightMap, nightBlend: lakeNightBlend, key: "lake-structures" };

/**
 * The lake's lawn (its own light map, its own vertex tint) next to the village's lawn at x 95.5: measured in the game at noon the
 * lake's grass was 7 % / 5 % / 14 % brighter (r, g, b) than the village's, a visible seam; the village's grade times this makes the
 * two lawns the same colour at the seam (measured again after the re-bake; east of x ~104 the build's vertex tint moves the lake
 * to the photos' muted olive).
 */
export const LAKE_GRASS_MATCH = [0.88, 0.93, 0.915] as const;
/** The same at night: the lake's night bake is lifted (photos of night fishing are not black), the village's lawn is darker, so the seam showed a step. */
export const LAKE_GRASS_MATCH_NIGHT = [0.4, 0.46, 0.45] as const;

const FOLIAGE = /^(M_plant|M_bark|M_leaf_)/;
const HELPER = /^(col__|seat__|spot__|light__|npc__)/;

function materialsOf(m: Mesh): Material[] {
  return Array.isArray(m.material) ? m.material : [m.material];
}

/** Dress a clone of lake.glb (A). */
export function prepareLakeTerrain(root: Object3D, day: Texture, night: Texture | null, tier: VillageTier, extras: unknown): Omit<LakeDressed, "glows" | "lampHeads" | "own"> {
  configureLightmap(day);
  if (night) configureLightmap(night);
  lakeNightMap.value = night;
  const water: Mesh[] = [];
  const hazed: MeshBasicMaterial[] = [];
  const graded: LakeDressed["graded"] = [];
  let ridge: Mesh | null = null;
  root.traverse((o) => {
    if (/^inst__lakehi_/.test(o.name) && tier !== "high") o.visible = false;
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    if (/water/i.test(mesh.name)) {
      water.push(mesh);
      return;
    }
    if (mesh.name === "lake_ridge") ridge = mesh;
    for (const m of materialsOf(mesh)) {
      if (m.name.startsWith("LM_")) {
        lightmapMaterial(m, day);
        liftMaterial(m, LAKE_LIGHT);
        const village = GROUND_GRADE[m.name];
        const grade = village && m.name === "LM_grass" ? ([village[0]! * LAKE_GRASS_MATCH[0], village[1]! * LAKE_GRASS_MATCH[1], village[2]! * LAKE_GRASS_MATCH[2]] as const) : village;
        const gnVillage = GROUND_GRADE_NIGHT[m.name];
        const gn = gnVillage && m.name === "LM_grass" ? ([gnVillage[0]! * LAKE_GRASS_MATCH_NIGHT[0], gnVillage[1]! * LAKE_GRASS_MATCH_NIGHT[1], gnVillage[2]! * LAKE_GRASS_MATCH_NIGHT[2]] as const) : gnVillage;
        if (grade) {
          (m as MeshBasicMaterial).color.setRGB(grade[0], grade[1], grade[2]);
          if (gn && !graded.some((g) => g.material === m)) graded.push({ material: m as MeshBasicMaterial, day: grade, night: gn });
        }
      } else if (FOLIAGE.test(m.name)) {
        liftMaterial(m, LAKE_LIGHT);
      } else if (m.name === "M_ridge") {
        const b = m as MeshBasicMaterial;
        if (b.fog) {
          b.fog = false;
          b.needsUpdate = true;
        }
        if (!hazed.includes(b)) hazed.push(b);
      }
    }
  });
  return { water, hazed, graded, seam: seamOf(extras, ridge) };
}

/** The seam rectangles of lake.glb's extras and the ridge's footprint. */
export function seamOf(extras: unknown, ridge: Mesh | null): LakeSeam {
  const lake = (extras as { lake?: { seam?: Record<string, SeamRect> } } | undefined)?.lake;
  const rects = Object.values(lake?.seam ?? {}).filter((r): r is SeamRect => !!r && [r.minX, r.maxX, r.minZ, r.maxZ].every((v) => typeof v === "number"));
  const cells = new Set<number>();
  if (ridge) {
    ridge.updateWorldMatrix(true, false);
    const pos = ridge.geometry.getAttribute("position") as BufferAttribute;
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(ridge.matrixWorld);
      cells.add(cellKey(v.x, v.z));
    }
  }
  return { holes: rects.length > 0 ? rects : DEFAULT_SEAM.holes, ridgeCells: cells };
}

/** The light-mapped copy of one of B's lit materials (one per source material, whatever clone asks). */
const lightMapped = new WeakMap<Material, MeshBasicMaterial>();

/** Emissive or see-through materials keep the loader's lit material (a lamp's bulb, a window: nothing to occlude). */
function keepsItsOwn(m: MeshStandardMaterial): boolean {
  return (m.emissive && m.emissive.r + m.emissive.g + m.emissive.b > 0.01) || m.transparent || m.alphaTest > 0 || /glass/i.test(m.name);
}

/** B's `MeshStandardMaterial` as a light-mapped basic one: the same texture, colour and vertex colours, the village's light recipe. */
export function structureMaterial(src: MeshStandardMaterial, day: Texture): MeshBasicMaterial {
  let m = lightMapped.get(src);
  if (!m) {
    m = new MeshBasicMaterial({ name: `LM_${src.name}`, map: src.map, color: src.color.clone(), vertexColors: src.vertexColors, side: src.side });
    lightMapped.set(src, m);
  }
  lightmapMaterial(m, day);
  liftMaterial(m, STRUCT_LIGHT);
  return m;
}

/** Dress a clone of lake_structures.glb (B). `day` / `night`: its light maps (null: the loader's lit materials stay). */
export function prepareLakeStructures(root: Object3D, day: Texture | null = null, night: Texture | null = null): Pick<LakeDressed, "glows" | "lampHeads" | "own"> {
  if (day) configureLightmap(day);
  if (night) configureLightmap(night);
  structuresNightMap.value = night;
  const glows: LakeDressed["glows"] = [];
  const own: BufferGeometry[] = [];
  const lampHeads: Vector3[] = [];
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (HELPER.test(o.name)) {
      o.visible = false;
      if (/^light__lake_lamp_(\d+)/.test(o.name)) {
        const p = new Vector3();
        o.getWorldPosition(p);
        lampHeads.push(p);
      }
      return;
    }
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const mats = materialsOf(mesh);
    const dressed = mats.map((m) => {
      const s = m as MeshStandardMaterial;
      if (!s.isMeshStandardMaterial) return m;
      if (s.emissive && (s.emissive.r + s.emissive.g + s.emissive.b > 0.01) && !glows.some((g) => g.material === s)) glows.push({ material: s, strength: s.emissiveIntensity });
      if (!day || keepsItsOwn(s) || !mesh.geometry.getAttribute("uv1")) return m;
      return structureMaterial(s, day);
    });
    mesh.material = Array.isArray(mesh.material) ? dressed : dressed[0]!;
  });
  return { glows, lampHeads, own };
}

/** Per frame: the time of day on the lake's own parts (the shared village uniforms are already written by the village). */
export function lakeDayNight(d: Pick<LakeDressed, "glows" | "hazed" | "graded">, s: DayNightState): void {
  lakeNightBlend.value = lakeNightMap.value || structuresNightMap.value ? s.night : 0;
  for (const m of d.hazed) m.color.setRGB(s.hazeTint[0], s.hazeTint[1], s.hazeTint[2]);
  for (const g of d.graded) {
    const n = s.night;
    g.material.color.setRGB(g.day[0]! + (g.night[0]! - g.day[0]!) * n, g.day[1]! + (g.night[1]! - g.day[1]!) * n, g.day[2]! + (g.night[2]! - g.day[2]!) * n);
  }
  // the lamps and windows are off by day, on from dusk (the village's `lights` weight)
  for (const g of d.glows) g.material.emissiveIntensity = g.strength * (0.04 + 0.96 * s.lights);
}

export function disposeLake(d: Pick<LakeDressed, "own">): void {
  for (const g of d.own) g.dispose();
  d.own.length = 0;
}
