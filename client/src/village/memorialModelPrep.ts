import { type InstancedMesh, type Material, type MeshBasicMaterial, type Object3D, type Texture } from "three";
import { COLLIDER_PREFIX, LIGHTMAP_MATERIAL_PREFIX, configureLightmap, isMesh, lightmapMaterial, materialsOf } from "../game/hub/hubModelPrep";
import { HALL_CUBBY_MATERIAL, isSkylight, patchHallCubbyMaterial, patchHallGardenMaterial, patchHallLightmapMaterial } from "./hallNight";
import { isHallGlass, patchHallGlassMaterial } from "./hallGlass";

/**
 * The memorial hall's interior (`memorial.glb`, 케이슨 마을 Task 8) dressed for the game (Task 9) — the pure part.
 *
 * The file's contract (Task 8 report, checked by scripts/check-school-glb.ts `memorial`):
 *  - `LM_*` materials are unlit with the baked light on the second UV set (`memorial_lm.webp`): the village's recipe as
 *    it is (configureLightmap + lightmapMaterial: channel 1, flipY off, sRGB, `lightMapIntensity` 1.6π). Since the
 *    2026-11-13 rebuild each one also blends the night light map by the village's night weight (hallNight.ts).
 *  - `hall_fx` (the cove's slits, the downlights, the skylight, the window glass, the garden card) and the LED strips
 *    (`inst__led_*`, GPU instances) are left as loaded; the garden card blends the night park, the skylight goes dark.
 *  - `door__leaf_l` / `door__leaf_r`: the sliding glass leaves of the door, their own nodes (the game slides them, see
 *    PublicAutoDoor.tsx); `prepareMemorial` hands them back in `doorLeaves`.
 *  - `M_cubby_in` (round 6): the white lacquer cubby interiors, unlit, one shared baked texture with day | night halves blended
 *    by the night weight (hallNight.ts patchHallCubbyMaterial).
 *  - `col__*` boxes (shared/…/generated/memorialColliders.ts is generated from them) are hidden; `ceil__hall` and the
 *    `anchor__cubby_*` nodes are empties.
 *
 * `prepareMemorial` works on a CLONE of the cached scene; the loader's materials are changed idempotently (the light
 * map), so nothing is copied and `disposeMemorial` only frees the clone's instance buffers.
 */

export const MEMORIAL_MODEL_URL = "/models/village/memorial.glb";
/** The day light map: 2048 px on the rich tier, 1024 px on the light one (phones; a quarter of the memory). */
export const MEMORIAL_LIGHTMAP_URLS = { high: "/models/village/memorial_lm.webp", low: "/models/village/memorial_lm_1k.webp" } as const;
export const MEMORIAL_LIGHTMAP_URL = MEMORIAL_LIGHTMAP_URLS.high;
export const MEMORIAL_PROPS_URL = "/models/village/memorial_props.glb";

export interface MemorialNodes {
  root: Object3D;
  /** The light-mapped materials (for checks). */
  lightmapped: Material[];
  /** The sliding glass leaves of the door (left, right), or null where the model has none. */
  doorLeaves: { left: Object3D; right: Object3D } | null;
  /** The skylight diffuser's material (it goes dark at night), when the model has one. */
  skylight: MeshBasicMaterial | null;
}

/** Dress a clone of the loaded hall: light map on every `LM_*` material, collision boxes hidden. */
export function prepareMemorial(source: Object3D, lightmap: Texture): MemorialNodes {
  const root = source.clone(true);
  configureLightmap(lightmap);
  const lightmapped: Material[] = [];
  let skylight: MeshBasicMaterial | null = null;
  root.traverse((o) => {
    if (o.name.startsWith(COLLIDER_PREFIX)) {
      o.visible = false;
      return;
    }
    if (!isMesh(o)) return;
    for (const m of materialsOf(o)) {
      if (m.name === "M_garden") patchHallGardenMaterial(m);
      if (m.name === HALL_CUBBY_MATERIAL) patchHallCubbyMaterial(m); // the cubby interiors' shared day | night texture (round 6)
      if (isHallGlass(m.name)) patchHallGlassMaterial(m); // reflective glass (hallGlass.ts, round 5)
      if (isSkylight(m)) skylight = m;
      if (!m.name.startsWith(LIGHTMAP_MATERIAL_PREFIX)) continue;
      lightmapMaterial(m, lightmap);
      patchHallLightmapMaterial(m);
      if (!lightmapped.includes(m)) lightmapped.push(m);
    }
  });
  root.updateMatrixWorld(true);
  const left = root.getObjectByName("door__leaf_l");
  const right = root.getObjectByName("door__leaf_r");
  return { root, lightmapped, doorLeaves: left && right ? { left, right } : null, skylight };
}

/** Free what the clone owns: its InstancedMeshes' instance buffers (the geometry and materials are the loader's). */
export function disposeMemorial(nodes: MemorialNodes): void {
  nodes.root.traverse((o) => {
    if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose();
  });
}

/**
 * Free the GPU side of a LOADED scene itself (the loader's cached hall or props): geometry, materials, their maps and
 * light maps, instance buffers, each once. Only when the hall is left and the cache entry is cleared (memorialRelease.ts).
 */
export function disposeLoadedScene(scene: Object3D): void {
  const done = new Set<{ dispose(): void }>();
  const free = (r: { dispose(): void } | null | undefined): void => {
    if (!r || done.has(r)) return;
    done.add(r);
    r.dispose();
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
