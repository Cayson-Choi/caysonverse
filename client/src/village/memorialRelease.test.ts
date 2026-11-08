import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Texture } from "three";

const h = vi.hoisted(() => ({ gltfClear: vi.fn(), textureClear: vi.fn() }));
vi.mock("@react-three/drei", () => ({
  useGLTF: { clear: h.gltfClear },
  useTexture: { clear: h.textureClear },
}));

import { MEMORIAL_LIGHTMAP_URL, MEMORIAL_MODEL_URL, MEMORIAL_PROPS_URL, disposeMemorial, prepareMemorial } from "./memorialModelPrep";
import { MEMORIAL_FILES, clearMemorialCaches, holdMemorialFiles, noteMemorialLoaded } from "./memorialRelease";
import { SAMPLE_PHOTO_ATLAS } from "./sampleCubbies";

type Disposable = { addEventListener(type: "dispose", listener: () => void): void };

function loadedHall() {
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
  return { scenes: [scene, props], textures: [lm, atlas], parts, disposed };
}

beforeEach(() => {
  vi.useFakeTimers();
  h.gltfClear.mockReset();
  h.textureClear.mockReset();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("memorialRelease — the hall's files load on entering and go on leaving (Task 9, the counselRelease pattern)", () => {
  it("the files are the hall, its light map, the props and the portrait atlas", () => {
    expect(MEMORIAL_FILES.gltf).toEqual([MEMORIAL_MODEL_URL, MEMORIAL_PROPS_URL]);
    expect(MEMORIAL_FILES.textures).toEqual([MEMORIAL_LIGHTMAP_URL, SAMPLE_PHOTO_ATLAS.url]);
  });

  it("leaving clears every cache entry one tick later and frees what was loaded", () => {
    const m = loadedHall();
    const release = holdMemorialFiles();
    noteMemorialLoaded(m.scenes, m.textures);
    release();
    expect(h.gltfClear).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toHaveBeenCalledWith(MEMORIAL_MODEL_URL);
    expect(h.gltfClear).toHaveBeenCalledWith(MEMORIAL_PROPS_URL);
    expect(h.textureClear).toHaveBeenCalledWith(MEMORIAL_LIGHTMAP_URL);
    expect(h.textureClear).toHaveBeenCalledWith(SAMPLE_PHOTO_ATLAS.url);
    for (const r of m.parts) expect(m.disposed.has(r)).toBe(true);
  });

  it("a remount in the same tick keeps the files; the later release frees them once", () => {
    const m = loadedHall();
    const first = holdMemorialFiles();
    noteMemorialLoaded(m.scenes, m.textures);
    first();
    const second = holdMemorialFiles();
    vi.advanceTimersByTime(10);
    expect(h.gltfClear).not.toHaveBeenCalled();
    expect(m.disposed.size).toBe(0);
    second();
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toHaveBeenCalledTimes(2);
    expect(m.disposed.size).toBe(m.parts.length);
  });

  it("leaving before anything arrived clears the caches and frees nothing; clearing is safe to repeat", () => {
    const release = holdMemorialFiles();
    release();
    release();
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toHaveBeenCalledTimes(2);
    clearMemorialCaches();
    expect(h.gltfClear).toHaveBeenCalledTimes(4);
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
