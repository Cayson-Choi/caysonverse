import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoxGeometry, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Texture } from "three";

/**
 * A stand-in for the loaders' cache: an entry per url, `ready` (a value), `loading` (a promise the read throws) or
 * absent. The read never creates an entry (a real read would start a download: the test fails loudly instead).
 */
const h = vi.hoisted(() => {
  type Entry = { state: "ready"; value: unknown } | { state: "loading"; promise: Promise<void>; resolve: (v: unknown) => void };
  const cache = new Map<string, Entry>();
  const read = (url: string) => {
    const e = cache.get(url);
    if (!e) throw new Error(`read of an entry that was never requested: ${url}`);
    if (e.state === "loading") throw e.promise;
    return e.value;
  };
  const clear = (url: string) => void cache.delete(url);
  const loading = (url: string) => {
    let resolve!: (v: unknown) => void;
    const promise = new Promise<void>((res) => {
      resolve = (v) => {
        cache.set(url, { state: "ready", value: v });
        res();
      };
    });
    cache.set(url, { state: "loading", promise, resolve });
    return resolve;
  };
  return { cache, read, clear, loading, gltfClear: [] as string[], textureClear: [] as string[] };
});

vi.mock("@react-three/drei", () => {
  const useGLTF = (url: string) => h.read(url);
  useGLTF.clear = (url: string) => {
    h.gltfClear.push(url);
    h.clear(url);
  };
  return { useGLTF, useTexture: { clear: () => {} } };
});
vi.mock("@react-three/fiber", () => {
  const useLoader = (_: unknown, url: string) => h.read(url);
  // The bus has a GLTF loader of its own (villageBusLoader.ts): its clears count with the GLTF ones.
  useLoader.clear = (loader: { name?: string }, url: string) => {
    (loader?.name === "BusGLTFLoader" ? h.gltfClear : h.textureClear).push(url);
    h.clear(url);
  };
  return { useLoader };
});

import { VILLAGE_LIGHTMAP_URL, VILLAGE_MODEL_URL, VILLAGE_NIGHT_LIGHTMAP_URL, nightMapUniform } from "./villageModelPrep";
import { BUS_MODEL_URL } from "./villageBusPrep";
import {
  clearBusCache,
  clearVillageCaches,
  holdNightLightmap,
  holdVillageFiles,
  holdsVillageFiles,
  noteBusRequested,
  noteNightRequested,
  noteVillageRequested,
} from "./villageRelease";

type Disposable = { addEventListener(type: "dispose", listener: () => void): void };

function model() {
  const scene = new Object3D();
  const material = new MeshBasicMaterial();
  material.map = new Texture();
  const geometry = new BoxGeometry(1, 1, 1);
  const instanced = new InstancedMesh(geometry, material, 4);
  scene.add(new Mesh(geometry, material), instanced);
  const parts = [material, material.map, geometry, instanced];
  const disposed = new Set<unknown>();
  for (const r of parts as unknown as Disposable[]) r.addEventListener("dispose", () => disposed.add(r));
  return { gltf: { scene }, parts, disposed };
}

function texture() {
  const t = new Texture();
  let closed = false;
  t.image = { width: 4, height: 4, close: () => void (closed = true) };
  let disposed = false;
  t.addEventListener("dispose", () => void (disposed = true));
  return { t, disposed: () => disposed, closed: () => closed };
}

/** Both village files in the cache, loaded. */
function loaded() {
  const m = model();
  const day = texture();
  h.cache.set(VILLAGE_MODEL_URL, { state: "ready", value: m.gltf });
  h.cache.set(VILLAGE_LIGHTMAP_URL, { state: "ready", value: day.t });
  return { m, day };
}

beforeEach(() => {
  vi.useFakeTimers();
  h.cache.clear();
  h.gltfClear.length = 0;
  h.textureClear.length = 0;
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("villageRelease — the village's files go when the village scene lets go of them (T7 review I1, final I2)", () => {
  it("leaving clears the model and the day light map one tick later and frees them on the GPU (bitmaps closed)", () => {
    const { m, day } = loaded();
    const release = holdVillageFiles();
    noteVillageRequested();
    release();
    expect(h.gltfClear).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toEqual([VILLAGE_MODEL_URL]);
    expect(h.textureClear).toContain(VILLAGE_LIGHTMAP_URL);
    for (const r of m.parts) expect(m.disposed.has(r)).toBe(true);
    expect(day.disposed()).toBe(true);
    expect(day.closed()).toBe(true);
    expect(h.cache.size).toBe(0);
  });

  it("a remount in the same tick (StrictMode, a reconnect's new scene) keeps the files and the model", () => {
    const { m } = loaded();
    const first = holdVillageFiles();
    noteVillageRequested();
    first();
    const second = holdVillageFiles();
    vi.advanceTimersByTime(10);
    expect(h.gltfClear).toEqual([]);
    expect(m.disposed.size).toBe(0);
    second();
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toHaveLength(1);
    expect(m.disposed.size).toBe(m.parts.length);
  });

  it("leaving before the model was ever requested reads and clears nothing", () => {
    const release = holdVillageFiles();
    release();
    release();
    expect(() => vi.advanceTimersByTime(0)).not.toThrow();
    expect(h.gltfClear).toEqual([]);
  });

  it("leaving while the files still load: they are freed when they arrive (late textures are not orphaned)", async () => {
    const resolveModel = h.loading(VILLAGE_MODEL_URL);
    const resolveDay = h.loading(VILLAGE_LIGHTMAP_URL);
    const release = holdVillageFiles();
    noteVillageRequested();
    release();
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toEqual([]); // not cleared mid-load: the result would be orphaned
    const m = model();
    const day = texture();
    resolveModel(m.gltf);
    resolveDay(day.t);
    await flush();
    expect(h.gltfClear).toEqual([VILLAGE_MODEL_URL]);
    expect(h.textureClear).toContain(VILLAGE_LIGHTMAP_URL);
    expect(m.disposed.size).toBe(m.parts.length);
    expect(day.disposed()).toBe(true);
  });

  it("leaving mid-load and coming back before it arrives: the new hold keeps what arrives", async () => {
    const resolveModel = h.loading(VILLAGE_MODEL_URL);
    h.cache.set(VILLAGE_LIGHTMAP_URL, { state: "ready", value: texture().t });
    const first = holdVillageFiles();
    noteVillageRequested();
    first();
    vi.advanceTimersByTime(0); // the day map was ready: freed; the model waits
    const second = holdVillageFiles();
    noteVillageRequested();
    const m = model();
    resolveModel(m.gltf);
    await flush();
    expect(h.gltfClear).toEqual([]);
    expect(m.disposed.size).toBe(0);
    expect(h.cache.get(VILLAGE_MODEL_URL)?.state).toBe("ready");
    second();
  });

  it("the light tier lets go in the hall; the rich tier and the village keep the files", () => {
    expect(holdsVillageFiles("low", "hall")).toBe(false);
    expect(holdsVillageFiles("low", "village")).toBe(true);
    expect(holdsVillageFiles("high", "hall")).toBe(true);
    expect(holdsVillageFiles("high", "village")).toBe(true);
  });

  it("clearVillageCaches clears all three entries (safe to repeat)", () => {
    clearVillageCaches();
    clearVillageCaches();
    expect(h.gltfClear).toEqual([VILLAGE_MODEL_URL, VILLAGE_MODEL_URL]);
    expect(h.textureClear).toContain(VILLAGE_LIGHTMAP_URL);
    expect(h.textureClear).toContain(VILLAGE_NIGHT_LIGHTMAP_URL);
  });
});

describe("villageRelease — the night light map has its own hold (final fix I2b)", () => {
  it("its release takes it off the materials and frees it one tick later; a re-hold in the tick keeps it", () => {
    const night = texture();
    h.cache.set(VILLAGE_NIGHT_LIGHTMAP_URL, { state: "ready", value: night.t });
    const first = holdNightLightmap();
    noteNightRequested();
    nightMapUniform.value = night.t;
    first();
    const second = holdNightLightmap();
    vi.advanceTimersByTime(0);
    expect(night.disposed()).toBe(false);
    second();
    vi.advanceTimersByTime(0);
    expect(night.disposed()).toBe(true);
    expect(nightMapUniform.value).toBeNull();
    expect(h.textureClear).toEqual([VILLAGE_NIGHT_LIGHTMAP_URL]);
  });

  it("the scene's release frees the night map too", () => {
    loaded();
    const night = texture();
    h.cache.set(VILLAGE_NIGHT_LIGHTMAP_URL, { state: "ready", value: night.t });
    const scene = holdVillageFiles();
    noteVillageRequested();
    holdNightLightmap();
    noteNightRequested();
    scene();
    vi.advanceTimersByTime(0);
    expect(night.disposed()).toBe(true);
    expect(h.cache.size).toBe(0);
  });

  it("never requested (a day visit): its release reads nothing", () => {
    const release = holdNightLightmap();
    release();
    expect(() => vi.advanceTimersByTime(0)).not.toThrow();
    expect(h.textureClear).toEqual([]);
  });
});

describe("villageRelease — the village bus (village_bus.glb) goes with the village's files", () => {
  it("drawn: released with them one tick after the scene lets go, its geometry, materials and textures freed", () => {
    loaded();
    const bus = model();
    h.cache.set(BUS_MODEL_URL, { state: "ready", value: bus.gltf });
    const release = holdVillageFiles();
    noteVillageRequested();
    noteBusRequested();
    release();
    expect(h.gltfClear).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toEqual([VILLAGE_MODEL_URL, BUS_MODEL_URL]);
    for (const r of bus.parts) expect(bus.disposed.has(r)).toBe(true);
    expect(h.cache.size).toBe(0);
  });

  it("a re-hold in the same tick keeps it; once released, a later release reads nothing of it", () => {
    const bus = model();
    h.cache.set(BUS_MODEL_URL, { state: "ready", value: bus.gltf });
    const release = holdVillageFiles();
    noteBusRequested();
    release();
    const again = holdVillageFiles();
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toEqual([]);
    expect(bus.disposed.size).toBe(0);
    again();
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toEqual([BUS_MODEL_URL]);
    expect(bus.disposed.size).toBe(bus.parts.length);
    const r2 = holdVillageFiles();
    r2();
    expect(() => vi.advanceTimersByTime(0)).not.toThrow(); // the stand-in throws on a read of an absent entry
    expect(h.gltfClear).toEqual([BUS_MODEL_URL]);
  });

  it("clearBusCache forgets a failed download, so the bus's boundary fetches it again", () => {
    clearBusCache();
    expect(h.gltfClear).toEqual([BUS_MODEL_URL]);
  });
});
