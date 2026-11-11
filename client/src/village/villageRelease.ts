import { useLoader } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { TextureLoader, type Texture } from "three";
import type { GLTF } from "three-stdlib";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import type { AreaId } from "@caysonverse/shared/village/villageLayout";
import type { QualityTier } from "../game/quality";
import { type CachedFile, releaseCachedFile } from "./loaderRelease";
import {
  VILLAGE_LIGHTMAP_URL,
  VILLAGE_MODEL_URL,
  VILLAGE_NIGHT_LIGHTMAP_URL,
  disposeVillageSource,
  freeTexture,
  nightMapUniform,
} from "./villageModelPrep";
import { BUS_MODEL_URL } from "./villageBusPrep";
import { clearBus, readBus } from "./villageBusLoader";

/**
 * Releasing 케이슨 마을's files (Task 7 review I1; final review I2 for phones), in the counselling room's pattern
 * (escape/counselRelease.ts).
 *
 * `VillageModel` unmounts on every hop into the memorial hall and back, so it only releases its own clone
 * (`disposeVillage`). The village SCENE holds the files (`holdVillageFiles`) and its release clears the loaders' caches
 * one tick after it lets go — a re-hold in the same tick (React StrictMode in dev, a reconnect's new scene) keeps
 * them. What was loaded is freed on the GPU too (geometry, materials, textures, instance buffers; decoded bitmaps
 * closed). A file still loading when the release fires is freed when it arrives (loaderRelease.ts).
 *
 *  - Rich tier: the scene holds the files through every hall visit, so coming back out is instant.
 *  - Light (phone) tier: the scene lets go while the player is in the hall (`holdsVillageFiles`), so the village's
 *    ~140 MB of decoded textures are not resident next to the hall's; coming back out reloads them (an HTTP-cache hit
 *    and a re-decode).
 *  - The night light map has its own hold (`holdNightLightmap`, VillageModel's NightLightmap): it is loaded only when
 *    night is near (nightLightmap.ts) and goes when it is not wanted any more.
 *  - The village bus (`village_bus.glb`, VillageBus) goes with the village's files: the same hold, its own "requested"
 *    flag (a scene that never drew it reads nothing).
 */

// `useLoader` / `useGLTF` / `readBus` here are plain cache reads (no React hooks inside them), not hook calls.
const readCache = useLoader;

let held = false;
let requested = false;
let busRequested = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** The model and its day light map are being read (VillageModel renders): a release must free them. */
export function noteVillageRequested(): void {
  requested = true;
}

/** The village bus is being read (VillageBus renders): a release must free it. */
export function noteBusRequested(): void {
  busRequested = true;
}

/** The bus's cache entry (freed like the village model: geometry, materials, textures). */
export const BUS_CACHE: CachedFile = {
  id: BUS_MODEL_URL,
  read: () => readBus(),
  clear: () => clearBus(),
  free: (g) => disposeVillageSource((g as GLTF).scene),
};

/** The village's two cache entries (the night light map has its own, below). */
export const VILLAGE_CACHE: readonly CachedFile[] = [
  {
    id: VILLAGE_MODEL_URL,
    read: () => useGLTF(VILLAGE_MODEL_URL, DRACO_PATH),
    clear: () => useGLTF.clear(VILLAGE_MODEL_URL),
    free: (g) => disposeVillageSource((g as GLTF).scene),
  } satisfies CachedFile,
  {
    id: VILLAGE_LIGHTMAP_URL,
    read: () => readCache(TextureLoader, VILLAGE_LIGHTMAP_URL),
    clear: () => readCache.clear(TextureLoader, VILLAGE_LIGHTMAP_URL),
    free: (t) => freeTexture(t as Texture),
  } satisfies CachedFile,
];

export const NIGHT_LIGHTMAP_CACHE: CachedFile = {
  id: VILLAGE_NIGHT_LIGHTMAP_URL,
  read: () => readCache(TextureLoader, VILLAGE_NIGHT_LIGHTMAP_URL),
  clear: () => readCache.clear(TextureLoader, VILLAGE_NIGHT_LIGHTMAP_URL),
  free: (t) => freeTexture(t as Texture),
};

/** Whether the village scene holds the files in `area` on `tier` (the light tier lets go in the hall: final I2). */
export function holdsVillageFiles(tier: QualityTier, area: AreaId): boolean {
  return !(tier === "low" && area === "hall");
}

function cancel(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
}

function releaseNow(): void {
  held = false;
  releaseNight();
  if (requested) {
    requested = false;
    for (const f of VILLAGE_CACHE) releaseCachedFile(f, () => held);
  }
  if (busRequested) {
    busRequested = false;
    releaseCachedFile(BUS_CACHE, () => held);
  }
}

/**
 * Hold the village's files while the village scene wants them (cancels a release still pending). Returns the
 * release: the caches are cleared and the loaded model freed one tick later, unless something holds them again first.
 */
export function holdVillageFiles(): () => void {
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

// ── the night light map ──

let nightHeld = false;
let nightRequested = false;
let nightTimer: ReturnType<typeof setTimeout> | null = null;

/** The night light map is being read (NightLightmap renders). */
export function noteNightRequested(): void {
  nightRequested = true;
}

function releaseNight(): void {
  if (nightTimer !== null) {
    clearTimeout(nightTimer);
    nightTimer = null;
  }
  nightHeld = false;
  nightMapUniform.value = null;
  if (!nightRequested) return;
  nightRequested = false;
  releaseCachedFile(NIGHT_LIGHTMAP_CACHE, () => nightHeld);
}

/** Hold the night light map (NightLightmap mounts); the release frees it one tick later unless held again. */
export function holdNightLightmap(): () => void {
  if (nightTimer !== null) {
    clearTimeout(nightTimer);
    nightTimer = null;
  }
  nightHeld = true;
  return () => {
    if (nightTimer !== null) clearTimeout(nightTimer);
    nightTimer = setTimeout(() => {
      nightTimer = null;
      releaseNight();
    }, 0);
  };
}

/** Forget the bus's entry in the loader's cache (its load failed: the next try downloads again; frees nothing). */
export function clearBusCache(): void {
  BUS_CACHE.clear();
}

/** Forget every village entry in the loaders' caches (safe to call more than once; frees nothing). */
export function clearVillageCaches(): void {
  for (const f of VILLAGE_CACHE) f.clear();
  NIGHT_LIGHTMAP_CACHE.clear();
}
