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

import { BusGLTFLoader, busLoadingManager, clearBus, preloadBus, readBus, withBusDraco } from "./villageBusLoader";
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

  it("its Draco decoder is made once, on the bus's manager, from the app's decoder path, one worker", () => {
    const a = new BusGLTFLoader();
    const b = new BusGLTFLoader();
    withBusDraco(a);
    withBusDraco(b);
    const da = (a as unknown as { dracoLoader: { manager: unknown; decoderPath: string; workerLimit: number } }).dracoLoader;
    const db = (b as unknown as { dracoLoader: unknown }).dracoLoader;
    expect(da).toBeTruthy();
    expect(db).toBe(da);
    expect(da.manager).toBe(busLoadingManager);
    expect(da.decoderPath).toBe(DRACO_PATH);
    expect(da.workerLimit).toBe(1);
  });
});
