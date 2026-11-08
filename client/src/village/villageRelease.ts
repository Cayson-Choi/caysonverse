import { useGLTF, useTexture } from "@react-three/drei";
import type { Object3D, Texture } from "three";
import {
  VILLAGE_LIGHTMAP_URL,
  VILLAGE_MODEL_URL,
  VILLAGE_NIGHT_LIGHTMAP_URL,
  disposeVillageSource,
  nightMapUniform,
} from "./villageModelPrep";

/**
 * Releasing 케이슨 마을's files when the player leaves the village scene (Task 7 review I1), in the counselling room's
 * pattern (escape/counselRelease.ts).
 *
 * `VillageModel` unmounts on every hop into the memorial hall and back, so it only releases its own clone
 * (`disposeVillage`); the loaders' caches keep `village.glb` and both light maps so coming back out is instant. The
 * village SCENE (which always mounts while the player is in the village or the hall) holds the files instead, and its
 * release clears the caches one tick after it unmounts — a remount in the same tick (React StrictMode in dev, a
 * reconnect's new scene) holds them again first. If the model was ever loaded, its GPU side (geometry, materials,
 * textures, instance buffers) is freed too: nobody will use that cache entry again. On a phone that is about 100 MB of
 * decoded bitmaps plus the parsed geometry.
 */

let loaded: { scene: Object3D; textures: Texture[] } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** The model has been read (VillageModel): what the release must free if it fires. The same files again are fine. */
export function noteVillageLoaded(scene: Object3D, textures: Texture[]): void {
  loaded = { scene, textures };
}

/** Forget the model and both light maps in the loaders' caches (safe to call more than once). */
export function clearVillageCaches(): void {
  useGLTF.clear(VILLAGE_MODEL_URL);
  useTexture.clear(VILLAGE_LIGHTMAP_URL);
  useTexture.clear(VILLAGE_NIGHT_LIGHTMAP_URL);
}

function cancel(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
}

function releaseNow(): void {
  clearVillageCaches();
  if (loaded) {
    disposeVillageSource(loaded.scene);
    for (const t of loaded.textures) t.dispose();
    loaded = null;
  }
  nightMapUniform.value = null;
}

/**
 * Hold the village's files while the village scene shows (cancels a release still pending). Returns the release: the
 * caches are cleared and the loaded model freed one tick later, unless something holds them again first.
 */
export function holdVillageFiles(): () => void {
  cancel();
  return () => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      releaseNow();
    }, 0);
  };
}
