import { useLoader } from "@react-three/fiber";
import { LoadingManager } from "three";
import { DRACOLoader, GLTFLoader, type GLTF } from "three-stdlib";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { BUS_MODEL_URL } from "./villageBusPrep";

/**
 * Loading the village bus (`village_bus.glb`) off the village's critical path (bus review r3, M2).
 *
 * The bus is decoration: the village must never wait for it. Its read suspends inside a Suspense of its own
 * (VillageScene), and its download goes through a loading manager of its own, not three's default one: the default
 * manager's progress is what drives the "불러오는 중…" overlay (PlayShell, drei `useProgress`), so a bus request that is
 * never answered would have left that overlay over a village that is already drawn. A stalled or failed bus is no bus.
 *
 * R3F keeps one loader per loader class: `BusGLTFLoader` is the bus's alone (the village's and the avatars' GLTFLoader
 * keeps the default manager). Its Draco decoder is its own too (one worker; the decoder files come from the same
 * `/draco/` path, so the browser's cache serves them), and it lives only while a bus request is in flight (bus review
 * r4, P5): once every request on the bus's manager has settled (the bus is in, or the file failed), the decoder goes,
 * its worker with the ~16 MiB wasm heap inside it and the decoder files it held. A later load (a retry, the village
 * read again after the memorial hall on a phone) makes a new one. A request that never answers never reaches the
 * decoder (it starts with the file's parse), so a stalled bus holds no worker either.
 */
export const busLoadingManager = new LoadingManager(() => releaseBusDraco());

/** GLTFLoader on the bus's own loading manager (R3F memoizes one instance per class). */
export class BusGLTFLoader extends GLTFLoader {
  constructor() {
    super(busLoadingManager);
  }
}

let draco: DRACOLoader | null = null;
let dracoUser: GLTFLoader | null = null;

/** The loader's set-up before each load: the bus's Draco decoder (made when none is alive, shared by loads in flight). */
export function withBusDraco(loader: GLTFLoader): void {
  if (!draco) {
    draco = new DRACOLoader(busLoadingManager);
    draco.setDecoderPath(DRACO_PATH);
    draco.setWorkerLimit(1);
  }
  loader.setDRACOLoader(draco);
  dracoUser = loader;
}

/**
 * Let the bus's Draco decoder go (the manager calls this once every bus request has settled): its worker is
 * terminated, the worker's source URL revoked and the loader's reference dropped, so the decoder files it read go too.
 */
export function releaseBusDraco(): void {
  if (!draco) return;
  const d = draco;
  draco = null;
  d.dispose();
  const url = (d as unknown as { workerSourceURL?: string }).workerSourceURL;
  if (url) URL.revokeObjectURL(url);
  if (dracoUser?.dracoLoader === d) dracoUser.dracoLoader = null;
  dracoUser = null;
}

/** Read the bus (suspends while it loads, throws if it failed): a hook call inside VillageBus, a plain cache read elsewhere. */
export function readBus(): GLTF {
  return useLoader(BusGLTFLoader, BUS_MODEL_URL, withBusDraco) as GLTF;
}

/** Start the bus's download now (VillageModel: beside the village's own, so it is usually in when the village is). */
export function preloadBus(): void {
  useLoader.preload(BusGLTFLoader, BUS_MODEL_URL, withBusDraco);
}

/** Forget the bus's cache entry (a failed load: the next read downloads again; frees nothing). */
export function clearBus(): void {
  useLoader.clear(BusGLTFLoader, BUS_MODEL_URL);
}
