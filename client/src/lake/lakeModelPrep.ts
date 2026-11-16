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
//    follows the night; lamps 2-4 are moved onto the pier edge (D1 put their posts in the water; `LAKE_LAMPS` now stands
//    them on the deck) by offsetting their vertices of the merged `lake_lamps` mesh at run time (art follow-up: B's model).
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
import { LAKE_AREA, LAKE_LAMPS } from "@caysonverse/shared/village/lakeLayout";
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

/** Where B's model has the posts of lamps 2-4 (D1's first layout, in the water); `LAKE_LAMPS` has the new ones. */
export const B_LAMP_POSTS: Readonly<Record<number, { x: number; z: number }>> = {
  1: { x: 120, z: -15.2 },
  2: { x: 130, z: -15.2 },
  3: { x: 140, z: -19 },
};
/** The lamps' arms reach this far toward +z from the post, and this far around it (m): every lake_lamps vertex of a lamp. */
const LAMP_REACH = { back: 0.6, ahead: 2.4, side: 0.9 };

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
        const grade = GROUND_GRADE[m.name];
        const gn = GROUND_GRADE_NIGHT[m.name];
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

/** Which of B's lamps (0-based index into LAKE_LAMPS) a vertex of `lake_lamps` belongs to, among the moved ones; -1 none. */
export function movedLampOf(x: number, z: number): number {
  for (const [k, post] of Object.entries(B_LAMP_POSTS)) {
    const dz = z - post.z;
    if (Math.abs(x - post.x) <= LAMP_REACH.side && dz >= -LAMP_REACH.back && dz <= LAMP_REACH.ahead) return Number(k);
  }
  return -1;
}

/** Dress a clone of lake_structures.glb (B). */
export function prepareLakeStructures(root: Object3D): Pick<LakeDressed, "glows" | "lampHeads" | "own"> {
  const glows: LakeDressed["glows"] = [];
  const own: BufferGeometry[] = [];
  const lampHeads: Vector3[] = [];
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (HELPER.test(o.name)) {
      o.visible = false;
      if (/^light__lake_lamp_(\d+)/.test(o.name)) {
        const k = Number(/^light__lake_lamp_(\d+)/.exec(o.name)![1]) - 1;
        const p = new Vector3();
        o.getWorldPosition(p);
        const post = B_LAMP_POSTS[k];
        const to = LAKE_LAMPS[k];
        if (post && to) p.add(new Vector3(to.x - post.x, 0, to.z - post.z));
        lampHeads.push(p);
      }
      return;
    }
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    for (const m of materialsOf(mesh)) {
      const s = m as MeshStandardMaterial;
      if (s.isMeshStandardMaterial && s.emissive && (s.emissive.r + s.emissive.g + s.emissive.b > 0.01) && !glows.some((g) => g.material === s)) glows.push({ material: s, strength: s.emissiveIntensity });
    }
    if (/^lake_lamps(_\d+)?$/.test(mesh.name)) {
      const moved = moveLamps(mesh.geometry);
      if (moved) {
        own.push(moved);
        mesh.geometry = moved;
      }
    }
  });
  return { glows, lampHeads, own };
}

/** A copy of the lamps' geometry with lamps 2-4 moved onto the pier edge (null when nothing moves). */
export function moveLamps(geo: BufferGeometry): BufferGeometry | null {
  const src = geo.getAttribute("position") as BufferAttribute | undefined;
  if (!src) return null;
  const pos = src.clone();
  let moved = 0;
  for (let i = 0; i < pos.count; i++) {
    const k = movedLampOf(pos.getX(i), pos.getZ(i));
    if (k < 0) continue;
    const post = B_LAMP_POSTS[k]!;
    const to = LAKE_LAMPS[k]!;
    pos.setXYZ(i, pos.getX(i) + to.x - post.x, pos.getY(i), pos.getZ(i) + to.z - post.z);
    moved++;
  }
  if (moved === 0) return null;
  const out = geo.clone();
  out.setAttribute("position", pos);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Per frame: the time of day on the lake's own parts (the shared village uniforms are already written by the village). */
export function lakeDayNight(d: Pick<LakeDressed, "glows" | "hazed" | "graded">, s: DayNightState): void {
  lakeNightBlend.value = lakeNightMap.value ? s.night : 0;
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
