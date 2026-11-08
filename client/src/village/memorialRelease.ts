import { useLoader } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { TextureLoader, type Texture } from "three";
import type { GLTF } from "three-stdlib";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { type CachedFile, releaseCachedFile } from "./loaderRelease";
import { SAMPLE_PHOTO_ATLAS } from "./sampleCubbies";
import { MEMORIAL_LIGHTMAP_URL, MEMORIAL_MODEL_URL, MEMORIAL_PROPS_URL, disposeLoadedScene } from "./memorialModelPrep";
import { freeTexture } from "./villageModelPrep";

/**
 * Releasing the memorial hall's files when the player leaves the hall (케이슨 마을 Task 9), in the counselling room's
 * pattern (escape/counselRelease.ts, and villageRelease.ts for the village).
 *
 * The hall's files (memorial.glb, its light map, memorial_props.glb and the portrait atlas) load when the player enters
 * the hall and go when they leave: the hall's area component (which mounts at once, before the model's read suspends)
 * holds them, and its release clears the loaders' caches one tick after it unmounts — a remount in the same tick (React
 * StrictMode in dev, a reconnect's new scene) holds them again first. What was loaded is freed on the GPU too. A visit
 * that leaves while the files are still loading frees them when they arrive (loaderRelease.ts; final fix, the T9
 * review's "release mid-load" item).
 *
 * The light map and the atlas are ONE cache entry: MemorialHall reads them together (`useTexture([lm, atlas])`), and
 * the loaders key an entry by the whole list, so it is cleared by the same list (clearing each url alone missed it).
 */

// `useLoader` / `useGLTF` here are plain cache reads (no React hooks inside them), not hook calls.
const readCache = useLoader;

let held = false;
let requested = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Every cached file of the hall. */
export const MEMORIAL_FILES = {
  gltf: [MEMORIAL_MODEL_URL, MEMORIAL_PROPS_URL],
  textures: [MEMORIAL_LIGHTMAP_URL, SAMPLE_PHOTO_ATLAS.url],
} as const;

const textureList = [...MEMORIAL_FILES.textures];

/** The hall's cache entries: the two models and the textures (one entry, read as a list). */
export const MEMORIAL_CACHE: readonly CachedFile[] = [
  ...MEMORIAL_FILES.gltf.map(
    (url): CachedFile => ({
      id: url,
      read: () => useGLTF(url, DRACO_PATH),
      clear: () => useGLTF.clear(url),
      free: (g) => disposeLoadedScene((g as GLTF).scene),
    }),
  ),
  {
    id: textureList.join("|"),
    read: () => readCache(TextureLoader, textureList),
    clear: () => readCache.clear(TextureLoader, textureList),
    free: (ts) => (ts as Texture[]).forEach(freeTexture),
  },
];

/** The hall is being read (MemorialHall renders): a release must free what it reads, even mid-load. */
export function noteMemorialRequested(): void {
  requested = true;
}

/** Forget the hall's models and textures in the loaders' caches (safe to call more than once; frees nothing). */
export function clearMemorialCaches(): void {
  for (const f of MEMORIAL_CACHE) f.clear();
}

function cancel(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
}

function releaseNow(): void {
  held = false;
  if (!requested) return;
  requested = false;
  for (const f of MEMORIAL_CACHE) releaseCachedFile(f, () => held);
}

/**
 * Hold the hall's files while the player is in the hall (cancels a release still pending). Returns the release: the
 * caches are cleared and the loaded files freed one tick later, unless something holds them again first.
 */
export function holdMemorialFiles(): () => void {
  cancel();
  held = true;
  return () => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      releaseNow();
    }, 0);
  };
}
