import { useLoader } from "@react-three/fiber";
import { FileLoader, LoadingManager, TextureLoader, type Texture } from "three";
import { DRACOLoader, GLTFLoader, type GLTF } from "three-stdlib";
import { DRACO_PATH } from "../../game/hub/hubModelPrep";
import type { CachedFile } from "../loaderRelease";
import { disposeVillageSource, freeTexture } from "../villageModelPrep";
import { HOUSE_TEXTURES_URL, VILLAGE_HOUSES_URL, type HouseTextureMeta } from "./housesPrep";

/**
 * Loading the houses' model and their tiling sets off the village's critical path (집 외관 A8, X3), the bus's way
 * (villageBusLoader.ts): their own loading manager (a slow or failed house file never holds the "불러오는 중…" overlay over
 * a drawn village — until the houses are in, the old houses baked into village.glb stand), their own Draco decoder (one
 * worker, let go once every request has settled). The village's release (villageRelease.ts) frees them with its own files.
 */
export const housesLoadingManager = new LoadingManager(() => releaseHousesDraco());

export class HousesGLTFLoader extends GLTFLoader {
  constructor() {
    super(housesLoadingManager);
  }
}
export class HousesTextureLoader extends TextureLoader {
  constructor() {
    super(housesLoadingManager);
  }
}
export class HousesFileLoader extends FileLoader {
  constructor() {
    super(housesLoadingManager);
  }
}

let draco: DRACOLoader | null = null;
let dracoUser: GLTFLoader | null = null;

function withHousesDraco(loader: GLTFLoader): void {
  if (!draco) {
    draco = new DRACOLoader(housesLoadingManager);
    draco.setDecoderPath(DRACO_PATH);
    draco.setWorkerLimit(1);
  }
  loader.setDRACOLoader(draco);
  dracoUser = loader;
}

function releaseHousesDraco(): void {
  if (!draco) return;
  const d = draco;
  draco = null;
  d.dispose();
  const url = (d as unknown as { workerSourceURL?: string }).workerSourceURL;
  if (url) URL.revokeObjectURL(url);
  if (dracoUser?.dracoLoader === d) dracoUser.dracoLoader = null;
  dracoUser = null;
}

/** The texture URLs read so far (a release frees each). */
const textureUrls = new Set<string>();

/** Read the houses' model (suspends while it loads, throws if it failed). */
export function readHouses(): GLTF {
  return useLoader(HousesGLTFLoader, VILLAGE_HOUSES_URL, withHousesDraco) as GLTF;
}

/** Read the tiling sets' manifest. */
export function readHouseTextureMeta(): HouseTextureMeta {
  const text = useLoader(HousesFileLoader, HOUSE_TEXTURES_URL) as unknown as string;
  return JSON.parse(text) as HouseTextureMeta;
}

/**
 * Read the maps (in the order given), one cache entry each (so a release frees each by its own key). The list's length is
 * fixed per tier: VillageHouses is keyed by the tier.
 */
export function readHouseMaps(urls: readonly string[]): Texture[] {
  for (const u of urls) {
    textureUrls.add(u);
    useLoader.preload(HousesTextureLoader, u); // all at once, not one after another as each read suspends
  }
  return urls.map((u) => useLoader(HousesTextureLoader, u) as Texture);
}

/** Start the model's and the manifest's download (VillageModel, beside the village's). */
export function preloadHouses(): void {
  useLoader.preload(HousesGLTFLoader, VILLAGE_HOUSES_URL, withHousesDraco);
  useLoader.preload(HousesFileLoader, HOUSE_TEXTURES_URL);
}

const readCache = useLoader;

/** The houses' cache entries now (the model, the manifest, every map read). */
export function housesCache(): CachedFile[] {
  return [
    {
      id: VILLAGE_HOUSES_URL,
      read: () => readCache(HousesGLTFLoader, VILLAGE_HOUSES_URL, withHousesDraco),
      clear: () => readCache.clear(HousesGLTFLoader, VILLAGE_HOUSES_URL),
      free: (g) => disposeVillageSource((g as GLTF).scene),
    },
    {
      id: HOUSE_TEXTURES_URL,
      read: () => readCache(HousesFileLoader, HOUSE_TEXTURES_URL),
      clear: () => readCache.clear(HousesFileLoader, HOUSE_TEXTURES_URL),
      free: () => {},
    },
    ...[...textureUrls].map(
      (u): CachedFile => ({
        id: u,
        read: () => readCache(HousesTextureLoader, u),
        clear: () => readCache.clear(HousesTextureLoader, u),
        free: (t) => freeTexture(t as Texture),
      }),
    ),
  ];
}

/** Forget the cache entries (a failed load: the next read downloads again; frees nothing). */
export function clearHousesCache(): void {
  for (const f of housesCache()) f.clear();
  textureUrls.clear();
}

/** After a release: the textures read so far are gone. */
export function forgetHouseTextures(): void {
  textureUrls.clear();
}
