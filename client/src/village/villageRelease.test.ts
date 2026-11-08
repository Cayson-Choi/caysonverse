import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoxGeometry, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Texture } from "three";

const h = vi.hoisted(() => ({ gltfClear: vi.fn(), textureClear: vi.fn() }));
vi.mock("@react-three/drei", () => ({
  useGLTF: { clear: h.gltfClear },
  useTexture: { clear: h.textureClear },
}));

import { VILLAGE_LIGHTMAP_URL, VILLAGE_MODEL_URL, VILLAGE_NIGHT_LIGHTMAP_URL, nightMapUniform } from "./villageModelPrep";
import { clearVillageCaches, holdVillageFiles, noteVillageLoaded } from "./villageRelease";

function loadedModel() {
  const scene = new Object3D();
  const material = new MeshBasicMaterial();
  const geometry = new BoxGeometry(1, 1, 1);
  const instanced = new InstancedMesh(geometry, material, 4);
  scene.add(new Mesh(geometry, material), instanced);
  const day = new Texture();
  const night = new Texture();
  const disposed = new Set<unknown>();
  type Disposable = { addEventListener(type: "dispose", listener: () => void): void };
  for (const r of [material, geometry, instanced, day, night] as unknown as Disposable[]) r.addEventListener("dispose", () => disposed.add(r));
  return { scene, textures: [day, night], parts: [material, geometry, instanced, day, night], disposed };
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

describe("villageRelease — the village's files go when the player leaves the village scene (T7 review I1)", () => {
  it("leaving clears the model and both light maps from the loaders' caches one tick later, and frees the loaded model on the GPU", () => {
    const m = loadedModel();
    const release = holdVillageFiles();
    noteVillageLoaded(m.scene, m.textures);
    nightMapUniform.value = m.textures[1]!;
    release();
    expect(h.gltfClear).not.toHaveBeenCalled();
    expect(m.disposed.size).toBe(0);
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toHaveBeenCalledExactlyOnceWith(VILLAGE_MODEL_URL);
    expect(h.textureClear).toHaveBeenCalledWith(VILLAGE_LIGHTMAP_URL);
    expect(h.textureClear).toHaveBeenCalledWith(VILLAGE_NIGHT_LIGHTMAP_URL);
    for (const r of m.parts) expect(m.disposed.has(r)).toBe(true);
    expect(nightMapUniform.value).toBeNull();
  });

  it("a remount in the same tick (StrictMode, a reconnect's new scene) keeps the files and the model", () => {
    const m = loadedModel();
    const first = holdVillageFiles();
    noteVillageLoaded(m.scene, m.textures);
    first();
    const second = holdVillageFiles();
    vi.advanceTimersByTime(10);
    expect(h.gltfClear).not.toHaveBeenCalled();
    expect(m.disposed.size).toBe(0);
    second();
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toHaveBeenCalledTimes(1);
    expect(m.disposed.size).toBe(m.parts.length);
  });

  it("leaving before the model ever arrived clears the caches and frees nothing", () => {
    const release = holdVillageFiles();
    release();
    release(); // twice: one clear
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toHaveBeenCalledTimes(1);
  });

  it("the hall hop does not release: only the scene's hold does (the model alone unmounting frees nothing)", () => {
    const m = loadedModel();
    const release = holdVillageFiles();
    noteVillageLoaded(m.scene, m.textures);
    noteVillageLoaded(m.scene, m.textures); // the model mounts again after a hall visit: same files
    vi.advanceTimersByTime(100);
    expect(h.gltfClear).not.toHaveBeenCalled();
    expect(m.disposed.size).toBe(0);
    release();
    vi.advanceTimersByTime(0);
    expect(m.disposed.size).toBe(m.parts.length);
  });

  it("clearVillageCaches clears all three cache entries (safe to repeat)", () => {
    clearVillageCaches();
    clearVillageCaches();
    expect(h.gltfClear).toHaveBeenCalledTimes(2);
    expect(h.textureClear).toHaveBeenCalledWith(VILLAGE_LIGHTMAP_URL);
    expect(h.textureClear).toHaveBeenCalledWith(VILLAGE_NIGHT_LIGHTMAP_URL);
  });
});
