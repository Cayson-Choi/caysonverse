import { describe, expect, it, vi } from "vitest";
import { DefaultLoadingManager, LoadingManager } from "three";
import { GLTFLoader } from "three-stdlib";

/** R3F's loader cache, recorded: which loader class and url each call used, and the set-up it ran on a loader. */
const h = vi.hoisted(() => ({ calls: [] as { kind: string; loader: unknown; url: unknown; ext?: (l: unknown) => void }[] }));
vi.mock("@react-three/fiber", () => {
  const useLoader = (loader: unknown, url: unknown, ext?: (l: unknown) => void) => {
    h.calls.push({ kind: "read", loader, url, ext });
    return { scene: null };
  };
  useLoader.preload = (loader: unknown, url: unknown, ext?: (l: unknown) => void) => void h.calls.push({ kind: "preload", loader, url, ext });
  useLoader.clear = (loader: unknown, url: unknown) => void h.calls.push({ kind: "clear", loader, url });
  return { useLoader };
});

import { BusGLTFLoader, busLoadingManager, clearBus, preloadBus, readBus, releaseBusDraco, withBusDraco } from "./villageBusLoader";
import { BUS_MODEL_URL } from "./villageBusPrep";
import { DRACO_PATH } from "../game/hub/hubModelPrep";

describe("villageBusLoader — the bus loads off the village's critical path (bus review r3, M2)", () => {
  it("its GLTF loader is a class of its own on a loading manager of its own, not three's default one", () => {
    const loader = new BusGLTFLoader();
    expect(loader).toBeInstanceOf(GLTFLoader);
    expect(BusGLTFLoader).not.toBe(GLTFLoader); // R3F memoizes one loader per class: the village's keeps the default manager
    expect(busLoadingManager).toBeInstanceOf(LoadingManager);
    expect(busLoadingManager).not.toBe(DefaultLoadingManager);
    expect(loader.manager).toBe(busLoadingManager);
    // ... so a bus request never shows in the default manager's progress (drei's useProgress: the "불러오는 중…" overlay)
    const onStart = vi.fn();
    const prev = DefaultLoadingManager.onStart;
    DefaultLoadingManager.onStart = onStart;
    try {
      loader.manager.itemStart(BUS_MODEL_URL);
      expect(onStart).not.toHaveBeenCalled();
      loader.manager.itemEnd(BUS_MODEL_URL);
    } finally {
      DefaultLoadingManager.onStart = prev;
    }
  });

  it("read, preload and clear all use the bus's loader and url (one cache entry)", () => {
    h.calls.length = 0;
    preloadBus();
    readBus();
    clearBus();
    expect(h.calls.map((c) => c.kind)).toEqual(["preload", "read", "clear"]);
    for (const c of h.calls) {
      expect(c.loader).toBe(BusGLTFLoader);
      expect(c.url).toBe(BUS_MODEL_URL);
    }
    expect(h.calls[0]!.ext).toBe(withBusDraco);
    expect(h.calls[1]!.ext).toBe(withBusDraco);
  });

  it("its Draco decoder is made on the bus's manager, from the app's decoder path, one worker, shared by the loads in flight", () => {
    releaseBusDraco();
    const a = new BusGLTFLoader();
    const b = new BusGLTFLoader();
    withBusDraco(a);
    withBusDraco(b);
    const da = a.dracoLoader as unknown as { manager: unknown; decoderPath: string; workerLimit: number };
    expect(da).toBeTruthy();
    expect(b.dracoLoader).toBe(a.dracoLoader);
    expect(da.manager).toBe(busLoadingManager);
    expect(da.decoderPath).toBe(DRACO_PATH);
    expect(da.workerLimit).toBe(1);
    releaseBusDraco();
  });
});

/** A worker as DRACOLoader keeps them (its pool), recording whether it was terminated. */
function fakeWorker() {
  return { terminated: false, terminate() { this.terminated = true; } };
}
type Pooled = { workerPool: ReturnType<typeof fakeWorker>[]; workerSourceURL: string };

describe("villageBusLoader — the bus's Draco decoder lives only while a bus request is in flight (bus review r4, P5)", () => {
  it("once every bus request has settled (loaded), its worker is terminated and the next load makes a new decoder", () => {
    const loader = new BusGLTFLoader();
    const url = "/models/village/village_bus.glb";
    busLoadingManager.itemStart(url); // the request starts (GLTFLoader.load)
    withBusDraco(loader);
    const first = loader.dracoLoader!;
    const w = fakeWorker();
    (first as unknown as Pooled).workerPool.push(w); // what decoding the file spawned
    busLoadingManager.itemStart("/draco/draco_decoder.wasm"); // the decoder's own files, on the same manager
    busLoadingManager.itemEnd("/draco/draco_decoder.wasm");
    expect(w.terminated).toBe(false); // the bus is still being read: the decoder stays
    expect(loader.dracoLoader).toBe(first);
    busLoadingManager.itemEnd(url); // parsed and decoded: the bus is in
    expect(w.terminated).toBe(true);
    expect((first as unknown as Pooled).workerPool).toHaveLength(0);
    expect(loader.dracoLoader).toBeNull(); // nothing keeps the old decoder (and the decoder files it read)
    withBusDraco(loader); // a later load (a retry, the village read again after the hall)
    expect(loader.dracoLoader).toBeTruthy();
    expect(loader.dracoLoader).not.toBe(first);
    releaseBusDraco();
  });

  it("a failed request lets it go too (the manager's end follows its error); a request still pending keeps it", () => {
    const loader = new BusGLTFLoader();
    const url = "/models/village/village_bus.glb";
    busLoadingManager.itemStart(url);
    busLoadingManager.itemStart(url + "?late");
    withBusDraco(loader);
    const d = loader.dracoLoader!;
    const w = fakeWorker();
    (d as unknown as Pooled).workerPool.push(w);
    busLoadingManager.itemError(url); // a 404: GLTFLoader reports the error, then ends the item
    busLoadingManager.itemEnd(url);
    expect(w.terminated).toBe(false); // the other request is still out
    busLoadingManager.itemEnd(url + "?late");
    expect(w.terminated).toBe(true);
    expect(loader.dracoLoader).toBeNull();
  });

  it("the worker's source URL is revoked with it; releasing twice is harmless", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    try {
      const loader = new BusGLTFLoader();
      withBusDraco(loader);
      (loader.dracoLoader as unknown as Pooled).workerSourceURL = "blob:bus-draco";
      releaseBusDraco();
      releaseBusDraco();
      expect(revoke).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith("blob:bus-draco");
    } finally {
      revoke.mockRestore();
    }
  });
});
