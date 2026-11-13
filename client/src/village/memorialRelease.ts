import { useLoader } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { TextureLoader, type Texture } from "three";
import type { GLTF } from "three-stdlib";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { type CachedFile, releaseCachedFile } from "./loaderRelease";
import { SAMPLE_PHOTO_ATLAS } from "./sampleCubbies";
import { MEMORIAL_LIGHTMAP_URLS, MEMORIAL_MODEL_URL, MEMORIAL_PROPS_URL, disposeLoadedScene } from "./memorialModelPrep";
import { disposeHallNight } from "./hallNight";
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

/** The tier the hall was read for (its light map is the 2048 px one on "high", the 1024 px one on "low"). */
let tier: "high" | "low" = "high";

/** Every tier whose light map was read this visit (a graphics change in the hall reads another one; all of them are released). */
const readTiers = new Set<"high" | "low">();

/** MemorialHall says which light map it reads, so a release clears the same cache entries. */
export function setMemorialTier(t: "high" | "low"): void {
  tier = t;
  readTiers.add(t);
}

const texturesOf = (t: "high" | "low"): string[] => [MEMORIAL_LIGHTMAP_URLS[t], SAMPLE_PHOTO_ATLAS.url];

/** Every cached file of the hall (the textures follow the tier). */
export const MEMORIAL_FILES = {
  gltf: [MEMORIAL_MODEL_URL, MEMORIAL_PROPS_URL],
  get textures(): readonly [string, string] {
    return [MEMORIAL_LIGHTMAP_URLS[tier], SAMPLE_PHOTO_ATLAS.url];
  },
};

const textureEntry = (t: "high" | "low"): CachedFile => ({
  id: texturesOf(t).join("|"),
  read: () => readCache(TextureLoader, texturesOf(t)),
  clear: () => readCache.clear(TextureLoader, texturesOf(t)),
  free: (ts) => (ts as Texture[]).forEach(freeTexture),
});

const gltfEntries: readonly CachedFile[] = MEMORIAL_FILES.gltf.map(
  (url): CachedFile => ({
    id: url,
    read: () => useGLTF(url, DRACO_PATH),
    clear: () => useGLTF.clear(url),
    free: (g) => disposeLoadedScene((g as GLTF).scene),
  }),
);

/** The hall's cache entries: the two models and the textures of every tier read (one entry per tier, read as a list). */
export function memorialCache(): CachedFile[] {
  return [...gltfEntries, ...[...new Set([...readTiers, tier])].map(textureEntry)];
}

/** The hall is being read (MemorialHall renders): a release must free what it reads, even mid-load. */
export function noteMemorialRequested(): void {
  requested = true;
}

/** Forget the hall's models and textures in the loaders' caches (safe to call more than once; frees nothing). */
export function clearMemorialCaches(): void {
  for (const f of memorialCache()) f.clear();
}

function cancel(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
}

function releaseNow(): void {
  held = false;
  disposeHallNight();
  if (!requested) return;
  requested = false;
  const files = memorialCache();
  readTiers.clear();
  for (const f of files) releaseCachedFile(f, () => held);
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
