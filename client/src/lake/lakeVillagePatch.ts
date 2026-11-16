// Design 11.1: the village model is NOT rebuilt for the lake. Once the lake is drawn this patch edits the loaded clone of
// village.glb (the file stays as it is): what the old model drew inside the lake's zone R is taken out of the clone —
//  - every mesh: the triangles that lie wholly inside R (the old backdrop lake and its basin, the old 호숫가 정자 and 짧은 잔교);
//  - the old water quads (they are huge, a few triangles, the lake disc): the triangles whose centre is inside R;
//  - instanced forest (`inst__*`): the instances inside R.
// What the design calls by node name (lake_pavilion, lake_pier, backdrop_water, ground_outer, backdrop_near) is merged into
// per-cell meshes in the shipped village.glb (village_lm_21, village_water_2x, village_backdrop...), so the patch works on
// positions, not names: it knows only the rectangle R. The waterfall's pool and the creek lie outside R and are never touched.
//
// Geometry is never edited in place (the loader's cache owns it): a trimmed mesh gets a copy sharing the attributes with a new
// index, and `restore()` puts the original back and disposes the copy. Idempotent: patching a clone twice does nothing more.

import { BufferAttribute, BufferGeometry, Matrix4, Uint16BufferAttribute, Uint32BufferAttribute, type InstancedMesh, type Mesh, type Object3D } from "three";
import { LAKE_AREA } from "@caysonverse/shared/village/lakeLayout";
import { DEFAULT_SEAM, cellKey, type LakeSeam, type SeamRect } from "./lakeModelPrep";

/** The zone R: the lake area (the greybox's cut; lake.glb brings its own seam rectangles, `extras.lake.seam`). */
export const LAKE_CUT = LAKE_AREA;

/** The village's far forest on the backdrop hills: hidden under lake.glb's ridge (`lake_ridge` covers them). */
const FAR_FOREST = /^inst__far_/;

/** Meshes the patch never touches (the sky, the moon, the invisible collision boxes). */
const KEEP = /^(village_sky|fountain_moon|col__|light__|seat__)/;
/** The old water: cut by the triangle's centre, not wholly (its quads reach far past R). */
const WATER = /^village_water_/;

export interface PatchStats {
  meshes: number;
  trianglesRemoved: number;
  instancesRemoved: number;
}

export interface VillagePatch {
  stats: PatchStats;
  restore(): void;
}

let holes: readonly SeamRect[] = [LAKE_CUT];
const inRect = (r: SeamRect, x: number, z: number): boolean => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;
const inside = (x: number, z: number): boolean => holes.some((r) => inRect(r, x, z));

/**
 * A copy of `geo` without the triangles `drop` says (by the three vertices' world x and z; `tx`, `tz` = the mesh's offset),
 * or null when none is dropped. Whole index groups (multi-material meshes) are kept intact with their ranges recomputed.
 */
export function trimGeometry(
  geo: BufferGeometry,
  tx: number,
  tz: number,
  mode: "wholly" | "centre",
): { geometry: BufferGeometry; removed: number } | null {
  const pos = geo.getAttribute("position") as BufferAttribute | undefined;
  if (!pos) return null;
  const index = geo.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const get = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const groups = geo.groups.length > 0 ? geo.groups : [{ start: 0, count: triCount * 3, materialIndex: 0 }];
  const kept: number[] = [];
  const newGroups: Array<{ start: number; count: number; materialIndex: number }> = [];
  let removed = 0;
  for (const g of groups) {
    const start = kept.length;
    const t0 = g.start / 3;
    const t1 = (g.start + g.count) / 3;
    for (let t = t0; t < t1; t++) {
      const a = get(t, 0);
      const b = get(t, 1);
      const c = get(t, 2);
      const ax = pos.getX(a) + tx, az = pos.getZ(a) + tz;
      const bx = pos.getX(b) + tx, bz = pos.getZ(b) + tz;
      const cx = pos.getX(c) + tx, cz = pos.getZ(c) + tz;
      const drop = mode === "wholly" ? inside(ax, az) && inside(bx, bz) && inside(cx, cz) : inside((ax + bx + cx) / 3, (az + bz + cz) / 3);
      if (drop) removed++;
      else kept.push(a, b, c);
    }
    newGroups.push({ start, count: kept.length - start, materialIndex: g.materialIndex ?? 0 });
  }
  if (removed === 0) return null;
  const out = new BufferGeometry();
  for (const name of Object.keys(geo.attributes)) out.setAttribute(name, geo.getAttribute(name));
  for (const [name, list] of Object.entries(geo.morphAttributes)) (out.morphAttributes as Record<string, unknown>)[name] = list;
  const big = pos.count > 65535;
  out.setIndex(big ? new Uint32BufferAttribute(kept, 1) : new Uint16BufferAttribute(kept, 1));
  if (geo.groups.length > 0) for (const g of newGroups) out.addGroup(g.start, g.count, g.materialIndex);
  out.boundingSphere = geo.boundingSphere?.clone() ?? null;
  out.boundingBox = geo.boundingBox?.clone() ?? null;
  return { geometry: out, removed };
}

const m4 = new Matrix4();
const ZERO = new Matrix4().makeScale(0, 0, 0);

/** Patch a clone of the village model. Safe to call again on the same clone (the second call finds nothing to take out). */
export function patchVillage(root: Object3D, seam: LakeSeam = DEFAULT_SEAM): VillagePatch {
  holes = seam.holes;
  const stats: PatchStats = { meshes: 0, trianglesRemoved: 0, instancesRemoved: 0 };
  const undo: Array<() => void> = [];
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || KEEP.test(mesh.name)) return;
    const inst = o as InstancedMesh;
    if (inst.isInstancedMesh) {
      const attr = inst.instanceMatrix;
      const saved: Array<[number, Float32Array]> = [];
      for (let i = 0; i < inst.count; i++) {
        m4.fromArray(attr.array, i * 16);
        // the instance's world position: its translation plus the node's offset (the clone's nodes carry their own transform)
        const x = m4.elements[12] + inst.matrixWorld.elements[12];
        const z = m4.elements[14] + inst.matrixWorld.elements[14];
        const underRidge = FAR_FOREST.test(inst.name) && seam.ridgeCells.has(cellKey(x, z));
        if (!inside(x, z) && !underRidge) continue;
        saved.push([i, Float32Array.from(attr.array.slice(i * 16, i * 16 + 16))]);
        ZERO.toArray(attr.array as unknown as number[], i * 16);
      }
      if (saved.length > 0) {
        attr.needsUpdate = true;
        stats.instancesRemoved += saved.length;
        undo.push(() => {
          for (const [i, v] of saved) (attr.array as Float32Array).set(v, i * 16);
          attr.needsUpdate = true;
        });
      }
      return;
    }
    const geo = mesh.geometry;
    const t = trimGeometry(geo, mesh.matrixWorld.elements[12], mesh.matrixWorld.elements[14], WATER.test(mesh.name) ? "centre" : "wholly");
    if (!t) return;
    mesh.geometry = t.geometry;
    stats.meshes++;
    stats.trianglesRemoved += t.removed;
    undo.push(() => {
      mesh.geometry = geo;
      t.geometry.dispose();
    });
  });
  return {
    stats,
    restore() {
      for (const u of undo.reverse()) u();
      undo.length = 0;
    },
  };
}
