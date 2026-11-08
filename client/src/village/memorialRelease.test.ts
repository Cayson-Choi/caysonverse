import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Texture } from "three";

/** A stand-in for the loaders' cache, keyed like r3f: one entry per url, or per url list. */
const h = vi.hoisted(() => {
  type Entry = { state: "ready"; value: unknown } | { state: "loading"; promise: Promise<void> };
  const cache = new Map<string, Entry>();
  const key = (input: string | readonly string[]) => (Array.isArray(input) ? input.join("|") : (input as string));
  const read = (input: string | readonly string[]) => {
    const e = cache.get(key(input));
    if (!e) throw new Error(`read of an entry that was never requested: ${key(input)}`);
    if (e.state === "loading") throw e.promise;
    return e.value;
  };
  const cleared: string[] = [];
  const clear = (input: string | readonly string[]) => {
    cleared.push(key(input));
    cache.delete(key(input));
  };
  const loading = (k: string) => {
    let resolve!: (v: unknown) => void;
    const promise = new Promise<void>((res) => {
      resolve = (v) => {
        cache.set(k, { state: "ready", value: v });
        res();
      };
    });
    cache.set(k, { state: "loading", promise });
    return resolve;
  };
  return { cache, key, read, clear, cleared, loading };
});

vi.mock("@react-three/drei", () => {
  const useGLTF = (url: string) => h.read(url);
  useGLTF.clear = (url: string) => h.clear(url);
  return { useGLTF, useTexture: { clear: () => {} } };
});
vi.mock("@react-three/fiber", () => {
  const useLoader = (_: unknown, input: string | string[]) => h.read(input);
  useLoader.clear = (_: unknown, input: string | string[]) => h.clear(input);
  return { useLoader };
});

import { MEMORIAL_LIGHTMAP_URL, MEMORIAL_MODEL_URL, MEMORIAL_PROPS_URL, disposeMemorial, prepareMemorial } from "./memorialModelPrep";
import { MEMORIAL_FILES, clearMemorialCaches, holdMemorialFiles, noteMemorialRequested } from "./memorialRelease";
import { SAMPLE_PHOTO_ATLAS } from "./sampleCubbies";

type Disposable = { addEventListener(type: "dispose", listener: () => void): void };
const TEXTURES = h.key([MEMORIAL_LIGHTMAP_URL, SAMPLE_PHOTO_ATLAS.url]);

function hallFiles() {
  const scene = new Object3D();
  const material = new MeshBasicMaterial();
  const geometry = new BoxGeometry(1, 1, 1);
  scene.add(new Mesh(geometry, material), new InstancedMesh(geometry, material, 3));
  const props = new Object3D();
  const propMaterial = new MeshBasicMaterial();
  props.add(new Mesh(new BoxGeometry(0.1, 0.1, 0.1), propMaterial));
  const lm = new Texture();
  const atlas = new Texture();
  const parts = [material, geometry, propMaterial, lm, atlas];
  const disposed = new Set<unknown>();
  for (const r of parts as unknown as Disposable[]) r.addEventListener("dispose", () => disposed.add(r));
  return { hall: { scene }, props: { scene: props }, textures: [lm, atlas], parts, disposed };
}

function loaded() {
  const m = hallFiles();
  h.cache.set(MEMORIAL_MODEL_URL, { state: "ready", value: m.hall });
  h.cache.set(MEMORIAL_PROPS_URL, { state: "ready", value: m.props });
  h.cache.set(TEXTURES, { state: "ready", value: m.textures });
  return m;
}

beforeEach(() => {
  vi.useFakeTimers();
  h.cache.clear();
  h.cleared.length = 0;
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("memorialRelease — the hall's files load on entering and go on leaving (Task 9, the counselRelease pattern)", () => {
  it("the files are the hall, its light map, the props and the portrait atlas", () => {
    expect(MEMORIAL_FILES.gltf).toEqual([MEMORIAL_MODEL_URL, MEMORIAL_PROPS_URL]);
    expect(MEMORIAL_FILES.textures).toEqual([MEMORIAL_LIGHTMAP_URL, SAMPLE_PHOTO_ATLAS.url]);
  });

  it("leaving clears every cache entry one tick later (the textures by their list, as they were read) and frees them", () => {
    const m = loaded();
    const release = holdMemorialFiles();
    noteMemorialRequested();
    release();
    expect(h.cleared).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(h.cleared).toEqual(expect.arrayContaining([MEMORIAL_MODEL_URL, MEMORIAL_PROPS_URL, TEXTURES]));
    expect(h.cache.size).toBe(0);
    for (const r of m.parts) expect(m.disposed.has(r)).toBe(true);
  });

  it("a remount in the same tick keeps the files; the later release frees them once", () => {
    const m = loaded();
    const first = holdMemorialFiles();
    noteMemorialRequested();
    first();
    const second = holdMemorialFiles();
    vi.advanceTimersByTime(10);
    expect(h.cleared).toEqual([]);
    expect(m.disposed.size).toBe(0);
    second();
    vi.advanceTimersByTime(0);
    expect(h.cleared).toHaveLength(3);
    expect(m.disposed.size).toBe(m.parts.length);
  });

  it("leaving while the files still load frees them when they arrive (T9 review: late textures)", async () => {
    const resolvers = [MEMORIAL_MODEL_URL, MEMORIAL_PROPS_URL, TEXTURES].map((k) => h.loading(k));
    const release = holdMemorialFiles();
    noteMemorialRequested();
    release();
    vi.advanceTimersByTime(0);
    expect(h.cleared).toEqual([]);
    const m = hallFiles();
    resolvers[0]!(m.hall);
    resolvers[1]!(m.props);
    resolvers[2]!(m.textures);
    await flush();
    expect(h.cache.size).toBe(0);
    for (const r of m.parts) expect(m.disposed.has(r)).toBe(true);
  });

  it("leaving before anything was requested reads nothing; clearing is safe to repeat", () => {
    const release = holdMemorialFiles();
    release();
    release();
    expect(() => vi.advanceTimersByTime(0)).not.toThrow();
    expect(h.cleared).toEqual([]);
    clearMemorialCaches();
    clearMemorialCaches();
    expect(h.cleared).toHaveLength(6);
  });
});

describe("prepareMemorial — the hall dressed for the game", () => {
  it("puts the light map on every LM_ material of a clone, hides col__ boxes, leaves other materials alone", () => {
    const source = new Group();
    const lmMat = new MeshBasicMaterial({ name: "LM_plaster" });
    const lamp = new MeshBasicMaterial({ name: "M_lamp" });
    const wall = new Mesh(new BoxGeometry(1, 1, 1), lmMat);
    const fx = new Mesh(new BoxGeometry(1, 1, 1), lamp);
    const col = new Mesh(new BoxGeometry(1, 1, 1), lamp);
    col.name = "col__bench";
    const inst = new InstancedMesh(new BoxGeometry(1, 1, 1), lamp, 4);
    source.add(wall, fx, col, inst);
    const lm = new Texture();
    const nodes = prepareMemorial(source, lm);
    expect(nodes.root).not.toBe(source);
    expect(nodes.lightmapped).toEqual([lmMat]);
    expect(lmMat.lightMap).toBe(lm);
    expect(lmMat.lightMapIntensity).toBeCloseTo(1.6 * Math.PI, 6);
    expect(lm.channel).toBe(1);
    expect(lm.flipY).toBe(false);
    expect(lamp.lightMap).toBeNull();
    expect(nodes.root.getObjectByName("col__bench")!.visible).toBe(false);
    let freed = 0;
    nodes.root.traverse((o) => {
      if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).addEventListener("dispose", () => (freed += 1));
    });
    disposeMemorial(nodes);
    expect(freed).toBe(1);
  });
});
