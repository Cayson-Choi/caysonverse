import { Matrix4, Vector3, type InstancedMesh, type Material, type Mesh, type MeshBasicMaterial, type Object3D, type Texture } from "three";
import { COLLIDER_PREFIX, LIGHTMAP_MATERIAL_PREFIX, configureLightmap, isMesh, lightmapMaterial, materialsOf } from "../game/hub/hubModelPrep";
import { HOUSE_FLOORS, HOUSE_NODE, houseFiles, type HouseFloor, type HouseNumber } from "@caysonverse/shared/village/houseAreas";
import { freeTexture } from "./villageModelPrep";

/**
 * A house's interior (`house_N.glb`, 집 실내 G) dressed for the game — the pure part, like memorialModelPrep.ts.
 *
 * The file's contract (docs/designs/houses-interior/contract.md ch. 5; checked by scripts/check-school-glb.ts kind `house`): both floors
 * are in ONE file at their world coordinates; the visible meshes of a floor hang under `floor__h<N>_<F>`, the stair / door / spawn
 * markers, the `seat__` empties and the `col__` collision boxes are root nodes, and `ceil__h<N>_<F>` is that floor's ceiling slab.
 * The game shows ONE floor at a time (`prepareHouse` hides the other floor's group and ceiling), hides the collision boxes, and puts
 * the baked light on the `LM_*` materials when the file has any — the blockout (and a house with no light bake yet) has only `M_*`
 * materials: they are drawn as loaded, lit by the village's indoor light.
 *
 * `prepareHouse` works on a CLONE of the cached scene; the loader's materials are changed idempotently (the light map), so nothing is
 * copied and `disposeHouse` only frees the clone's instance buffers. A house keeps the same file for both floors, so going up or down
 * stairs prepares a new clone of the same cached scene (no download).
 */

/** The window panorama's material: the model's window-view cards use this name (day on the image's top half, night on its bottom half). */
export const HOUSE_VIEW_MATERIAL = "M_view";

export interface HouseNodes {
  root: Object3D;
  /** The light-mapped materials (empty for a model without a light bake). */
  lightmapped: Material[];
  /** The window panorama materials (`M_view`), if the model has any. */
  views: Material[];
}

/** The file URLs of house N (houseAreas.ts `houseFiles`), the light map and the night map by quality tier. */
export function houseUrls(n: HouseNumber, tier: "high" | "low") {
  const f = houseFiles(n);
  return {
    glb: f.glb,
    lightmapDay: tier === "high" ? f.lightmapDay : f.lightmapDay1k,
    lightmapNight: tier === "high" ? f.lightmapNight : f.lightmapNight1k,
    view: f.view,
  };
}

/** Whether a loaded house scene has `LM_*` materials, i.e. wants a light map. */
export function houseWantsLightmap(scene: Object3D): boolean {
  let wants = false;
  scene.traverse((o) => {
    if (wants || !isMesh(o)) return;
    for (const m of materialsOf(o)) if (m.name.startsWith(LIGHTMAP_MATERIAL_PREFIX)) wants = true;
  });
  return wants;
}

/** Whether a loaded house scene has a window-view material. */
export function houseWantsView(scene: Object3D): boolean {
  let wants = false;
  scene.traverse((o) => {
    if (wants || !isMesh(o)) return;
    for (const m of materialsOf(o)) if (m.name === HOUSE_VIEW_MATERIAL) wants = true;
  });
  return wants;
}

/**
 * Dress a clone of the loaded house for `floor`: the other floor's group and ceiling and every `col__` box hidden, the light map (when
 * given) on every `LM_*` material.
 */
export function prepareHouse(source: Object3D, n: HouseNumber, floor: HouseFloor, lightmap: Texture | null): HouseNodes {
  const root = source.clone(true);
  if (lightmap) configureLightmap(lightmap);
  const hidden = new Set<string>();
  for (const f of HOUSE_FLOORS) {
    if (f === floor) continue;
    hidden.add(HOUSE_NODE.floor(n, f));
    hidden.add(HOUSE_NODE.ceiling(n, f));
  }
  const lightmapped: Material[] = [];
  const views: Material[] = [];
  root.traverse((o) => {
    if (o.name.startsWith(COLLIDER_PREFIX) || hidden.has(o.name)) {
      o.visible = false;
      return;
    }
    if (!isMesh(o)) return;
    for (const m of materialsOf(o)) {
      if (m.name === HOUSE_VIEW_MATERIAL && !views.includes(m)) views.push(m);
      if (!lightmap || !m.name.startsWith(LIGHTMAP_MATERIAL_PREFIX)) continue;
      lightmapMaterial(m, lightmap);
      if (!lightmapped.includes(m)) lightmapped.push(m);
    }
  });
  root.updateMatrixWorld(true);
  return { root, lightmapped, views };
}

/** Free what the clone owns: its InstancedMeshes' instance buffers (the geometry and materials are the loader's). */
export function disposeHouse(nodes: HouseNodes): void {
  nodes.root.traverse((o) => {
    if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose();
  });
}

/**
 * Every visible solid triangle of the prepared floor as a flat world-space array (x y z × 3 per triangle), for the camera's solid index
 * (hallSolidIndex.ts): what is hidden is skipped (the collision boxes, the other floor), glass (transparent) is no wall, and an
 * instanced mesh adds each instance. The same walk as the memorial hall's.
 */
export function solidTriangles(root: Object3D): Float32Array {
  root.updateMatrixWorld(true);
  const tris: number[] = [];
  const v = new Vector3();
  const each = new Matrix4();
  const walk = (o: Object3D): void => {
    if (!o.visible) return;
    const m = o as Mesh;
    if (m.isMesh && !Array.isArray(m.material) && !(m.material as Material).transparent) {
      const pos = m.geometry.getAttribute("position");
      if (pos) {
        const idx = m.geometry.getIndex();
        const count = idx ? idx.count : pos.count;
        const inst = m as unknown as InstancedMesh;
        const copies = inst.isInstancedMesh ? inst.count : 1;
        for (let c = 0; c < copies; c++) {
          if (inst.isInstancedMesh) {
            inst.getMatrixAt(c, each);
            each.premultiply(m.matrixWorld);
          } else each.copy(m.matrixWorld);
          for (let i = 0; i + 2 < count; i += 3)
            for (let k = 0; k < 3; k++) {
              v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(each);
              tris.push(v.x, v.y, v.z);
            }
        }
      }
    }
    for (const child of o.children) walk(child);
  };
  walk(root);
  return Float32Array.from(tris);
}

/**
 * Free the GPU side of a LOADED scene itself (the loader's cached house): geometry, materials, their maps and light maps, instance
 * buffers, each once. Only when the house is let go and the cache entry is cleared (houseRelease.ts).
 */
export function disposeLoadedHouse(scene: Object3D): void {
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
      free((m as MeshBasicMaterial).map);
      free((m as MeshBasicMaterial).lightMap);
      free(m);
    }
    if ((o as InstancedMesh).isInstancedMesh) free(o as InstancedMesh);
  });
}
