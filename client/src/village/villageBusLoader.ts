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
 * `/draco/` path, so the browser's cache serves them).
 */
export const busLoadingManager = new LoadingManager();

/** GLTFLoader on the bus's own loading manager (R3F memoizes one instance per class). */
export class BusGLTFLoader extends GLTFLoader {
  constructor() {
    super(busLoadingManager);
  }
}

let draco: DRACOLoader | null = null;

/** The loader's set-up before each load: the bus's Draco decoder (made once). */
export function withBusDraco(loader: GLTFLoader): void {
  if (!draco) {
    draco = new DRACOLoader(busLoadingManager);
    draco.setDecoderPath(DRACO_PATH);
    draco.setWorkerLimit(1);
  }
  loader.setDRACOLoader(draco);
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
