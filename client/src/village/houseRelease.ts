import { useGLTF } from "@react-three/drei";
import { TextureLoader, type Texture } from "three";
import type { GLTF } from "three-stdlib";
import { HOUSE_BUDGET, HOUSE_NUMBERS, type HouseNumber } from "@caysonverse/shared/village/houseAreas";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { type CachedFile, releaseCachedFile } from "./loaderRelease";
import { disposeLoadedHouse, houseUrls } from "./houseModelPrep";
import { freeTexture } from "./villageModelPrep";

/**
 * Getting a house's files before the player needs them, and letting them go after (집 실내 G; design 7.5, contract 8):
 *
 *  - The village's first load holds NO house file. A house's `house_N.glb` is fetched when the player comes within the keypad's 2 m
 *    of its door or opens its keypad (`prefetchHouse`), so that by the time the code is typed the model is usually in.
 *  - While the player is in the house the files are held (`holdHouseFiles`); one that leaves releases them after
 *    `HOUSE_BUDGET.unloadAfterSeconds` (60 s: coming back in soon needs no new download, the browser's cache covers the rest), unless
 *    the house is held again by then. Only one house stays in memory: asking for another house lets the others go at once.
 *  - The light maps (day, night) and the window panorama are plain textures read outside React (a file the house does not have is
 *    a miss, never a crash); they are freed with the model.
 *
 * Module state, like memorialRelease.ts.
 */

/** Houses whose files were asked for (a release must free what was read, even while it is still loading). */
const requested = new Set<HouseNumber>();
/** Houses someone holds now (the scene shows one of them). */
const held = new Set<HouseNumber>();
const timers = new Map<HouseNumber, ReturnType<typeof setTimeout>>();
/** Textures by url: a promise of the texture, or null when the file is not there / failed. */
const textures = new Map<string, Promise<Texture | null>>();
/** The urls of every texture asked for per house, so a release frees them. */
const textureUrls = new Map<HouseNumber, Set<string>>();

/** Which houses have files in the loaders' caches (tests, dev probes). */
export function requestedHouses(): HouseNumber[] {
  return [...requested].sort((a, b) => a - b);
}

export function heldHouses(): HouseNumber[] {
  return [...held].sort((a, b) => a - b);
}

const gltfEntry = (n: HouseNumber): CachedFile => {
  const url = houseUrls(n, "high").glb;
  return {
    id: url,
    read: () => useGLTF(url, DRACO_PATH),
    clear: () => useGLTF.clear(url),
    free: (g) => disposeLoadedHouse((g as GLTF).scene),
  };
};

/** The model's cache entry of house N. */
export function houseGltfEntry(n: HouseNumber): CachedFile {
  return gltfEntry(n);
}

/** A texture of house N by url (cached, read once; null when the file is missing). Resolves null for a url that fails. */
export function loadHouseTexture(n: HouseNumber, url: string, loader: Pick<TextureLoader, "loadAsync"> = new TextureLoader()): Promise<Texture | null> {
  let p = textures.get(url);
  if (!p) {
    p = loader.loadAsync(url).then(
      (t) => t,
      () => null,
    );
    textures.set(url, p);
  }
  // every house that asked for the url holds it (the shared albedo files of /textures/houses/ are asked for by every house)
  let set = textureUrls.get(n);
  if (!set) textureUrls.set(n, (set = new Set()));
  set.add(url);
  return p;
}

function cancelTimer(n: HouseNumber): void {
  const t = timers.get(n);
  if (t !== undefined) clearTimeout(t);
  timers.delete(n);
}

/** Free house N now: its model (once it has loaded) and its textures. */
export function releaseHouseNow(n: HouseNumber): void {
  cancelTimer(n);
  const wasRequested = requested.delete(n);
  for (const url of textureUrls.get(n) ?? []) {
    // a shared file another house still holds stays
    if ([...textureUrls].some(([m, urls]) => m !== n && urls.has(url))) continue;
    const p = textures.get(url);
    textures.delete(url);
    void p?.then((t) => {
      if (t && !held.has(n)) freeTexture(t);
    });
  }
  textureUrls.delete(n);
  if (!wasRequested) return;
  releaseCachedFile(gltfEntry(n), () => held.has(n));
}

/** Let every house but `keep` go at once (only one house in memory). */
function releaseOthers(keep: HouseNumber): void {
  for (const n of HOUSE_NUMBERS) {
    if (n === keep || held.has(n)) continue;
    if (requested.has(n) || textureUrls.has(n)) releaseHouseNow(n);
  }
}

/**
 * Start fetching house N's model (the player is at its door, or has its keypad open). Cheap to call again: the loader's cache answers.
 * The other houses' files go, so that only one stays in memory.
 */
export function prefetchHouse(n: HouseNumber): void {
  cancelTimer(n);
  releaseOthers(n);
  if (!requested.has(n)) {
    requested.add(n);
    try {
      useGLTF.preload(houseUrls(n, "high").glb, DRACO_PATH);
    } catch {
      // a failed start is retried by the scene's own read
    }
  }
}

/** The house scene reads house N: a release must free it, even mid-load. */
export function noteHouseRequested(n: HouseNumber): void {
  requested.add(n);
}

/**
 * Hold house N's files while the player is in it (cancels a release still pending). Returns the release: a timer of
 * `HOUSE_BUDGET.unloadAfterSeconds`, after which the files go unless the house is held again.
 */
export function holdHouseFiles(n: HouseNumber, unloadAfterMs: number = HOUSE_BUDGET.unloadAfterSeconds * 1000): () => void {
  cancelTimer(n);
  held.add(n);
  releaseOthers(n);
  return () => {
    held.delete(n);
    cancelTimer(n);
    timers.set(
      n,
      setTimeout(() => {
        timers.delete(n);
        if (!held.has(n)) releaseHouseNow(n);
      }, unloadAfterMs),
    );
  };
}

/** Forget a failed model so the next visit downloads again (the load boundary's reset). */
export function clearHouseCaches(n: HouseNumber): void {
  try {
    gltfEntry(n).clear();
  } catch {
    // ignore
  }
  requested.delete(n);
}
