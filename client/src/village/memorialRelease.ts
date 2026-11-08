import { useGLTF, useTexture } from "@react-three/drei";
import type { Object3D, Texture } from "three";
import { SAMPLE_PHOTO_ATLAS } from "./sampleCubbies";
import { MEMORIAL_LIGHTMAP_URL, MEMORIAL_MODEL_URL, MEMORIAL_PROPS_URL, disposeLoadedScene } from "./memorialModelPrep";

/**
 * Releasing the memorial hall's files when the player leaves the hall (케이슨 마을 Task 9), in the counselling room's
 * pattern (escape/counselRelease.ts, and villageRelease.ts for the village).
 *
 * The hall's files (memorial.glb, its light map, memorial_props.glb and the portrait atlas) load when the player enters
 * the hall and go when they leave: the hall's area component (which mounts at once, before the model's read suspends)
 * holds them, and its release clears the loaders' caches one tick after it unmounts — a remount in the same tick (React
 * StrictMode in dev, a reconnect's new scene) holds them again first. If the model was read, its GPU side is freed too:
 * nobody will use that cache entry again. A visit that leaves while the files are still loading only drops the caches.
 */

let loaded: { scenes: Object3D[]; textures: Texture[] } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Every cached file of the hall. */
export const MEMORIAL_FILES = {
  gltf: [MEMORIAL_MODEL_URL, MEMORIAL_PROPS_URL],
  textures: [MEMORIAL_LIGHTMAP_URL, SAMPLE_PHOTO_ATLAS.url],
} as const;

/** The hall has been read (MemorialHall): what the release must free if it fires. The same files again are fine. */
export function noteMemorialLoaded(scenes: Object3D[], textures: Texture[]): void {
  loaded = { scenes, textures };
}

/** Forget the hall's models and textures in the loaders' caches (safe to call more than once). */
export function clearMemorialCaches(): void {
  for (const url of MEMORIAL_FILES.gltf) useGLTF.clear(url);
  for (const url of MEMORIAL_FILES.textures) useTexture.clear(url);
}

function cancel(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
}

function releaseNow(): void {
  clearMemorialCaches();
  if (loaded) {
    for (const s of loaded.scenes) disposeLoadedScene(s);
    for (const t of loaded.textures) t.dispose();
    loaded = null;
  }
}

/**
 * Hold the hall's files while the player is in the hall (cancels a release still pending). Returns the release: the
 * caches are cleared and the loaded files freed one tick later, unless something holds them again first.
 */
export function holdMemorialFiles(): () => void {
  cancel();
  return () => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      releaseNow();
    }, 0);
  };
}
