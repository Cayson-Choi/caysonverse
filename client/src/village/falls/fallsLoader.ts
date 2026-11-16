import { LoadingManager, TextureLoader, type Object3D, type Texture } from "three";
import { DRACOLoader, GLTFLoader } from "three-stdlib";
import { DRACO_PATH } from "../../game/hub/hubModelPrep";
import { FALLS_LIGHTMAP_URL, FALLS_MODEL_URL, FALLS_NIGHT_LIGHTMAP_URL, fileBuilt } from "./fallsConfig";

/**
 * Loading `waterfall.glb` late (design §6: "마을이 뜬 뒤 늦게 받음"). The village is drawn first; `FallsModel` starts
 * this a moment after it mounts. Like the bus (villageBusLoader.ts) it goes through a loading manager of its own so
 * the "불러오는 중…" overlay (which follows three's default manager) never waits for the falls, and its Draco decoder
 * lives only while the file is in flight. A failed or missing file is no falls: the caller shows nothing.
 *
 * Nothing is cached here: the component that asked owns what it got and frees it (`disposeFalls`); a visit to the
 * memorial hall and back reads the file again from the browser's cache.
 */

export interface LoadedFalls {
  root: Object3D;
  lightmap: Texture | null;
}

/** Whether a falls model can be loaded (it was there at build time). */
export function fallsModelBuilt(): boolean {
  return fileBuilt(FALLS_MODEL_URL);
}

export function loadFallsModel(): Promise<LoadedFalls> {
  let draco: DRACOLoader | null = null;
  const release = (): void => {
    if (!draco) return;
    const d = draco;
    draco = null;
    d.dispose();
    const url = (d as unknown as { workerSourceURL?: string }).workerSourceURL;
    if (url) URL.revokeObjectURL(url);
  };
  const manager = new LoadingManager();
  const loader = new GLTFLoader(manager);
  draco = new DRACOLoader(manager);
  draco.setDecoderPath(DRACO_PATH);
  draco.setWorkerLimit(1);
  loader.setDRACOLoader(draco);
  const model = new Promise<Object3D>((resolve, reject) => {
    loader.load(
      FALLS_MODEL_URL,
      (gltf) => resolve(gltf.scene),
      undefined,
      (e) => reject(e instanceof Error ? e : new Error(String(e))),
    );
  });
  const lightmap = fileBuilt(FALLS_LIGHTMAP_URL) ? loadTexture(FALLS_LIGHTMAP_URL) : Promise.resolve(null);
  return Promise.all([model, lightmap]).then(
    ([root, lm]) => {
      release();
      return { root, lightmap: lm };
    },
    (e: unknown) => {
      release();
      throw e;
    },
  );
}

export function loadTexture(url: string): Promise<Texture | null> {
  return new Promise((resolve) => {
    new TextureLoader().load(
      url,
      (t) => resolve(t),
      undefined,
      () => resolve(null),
    );
  });
}

/** The night light map's file, or null when the build has none. */
export function nightLightmapUrl(): string | null {
  return fileBuilt(FALLS_NIGHT_LIGHTMAP_URL) ? FALLS_NIGHT_LIGHTMAP_URL : null;
}
