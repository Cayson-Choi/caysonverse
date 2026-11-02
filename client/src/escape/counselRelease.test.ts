import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ gltfClear: vi.fn(), textureClear: vi.fn() }));
vi.mock("@react-three/drei", () => ({
  useGLTF: { clear: h.gltfClear },
  useTexture: { clear: h.textureClear },
}));

import { COUNSEL_LIGHTMAP_URL } from "./counselModelPrep";
import { clearCounselCaches, holdCounselFiles } from "./counselRelease";

const GLB = "/models/school/counsel.glb";

beforeEach(() => {
  vi.useFakeTimers();
  h.gltfClear.mockReset();
  h.textureClear.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("counselRelease — the room's files go when the team leaves, mounted or not (final fix B6)", () => {
  it("leaving clears the glTF and light-map caches one tick later, even though no model ever mounted", () => {
    const release = holdCounselFiles(GLB); // the scene shows the room; the model is still loading (suspended)
    release(); // the player leaves before it arrived
    expect(h.gltfClear).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toHaveBeenCalledExactlyOnceWith(GLB);
    expect(h.textureClear).toHaveBeenCalledExactlyOnceWith(COUNSEL_LIGHTMAP_URL);
  });

  it("a remount in the same tick (StrictMode, a reconnect's new scene) keeps the files", () => {
    const first = holdCounselFiles(GLB);
    first();
    const second = holdCounselFiles(GLB); // held again before the tick
    vi.advanceTimersByTime(10);
    expect(h.gltfClear).not.toHaveBeenCalled();
    second();
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toHaveBeenCalledTimes(1);
  });

  it("two releases in a row clear once", () => {
    const release = holdCounselFiles(GLB);
    release();
    release();
    vi.advanceTimersByTime(0);
    expect(h.gltfClear).toHaveBeenCalledTimes(1);
  });

  it("clearCounselCaches clears both caches (and is safe to repeat)", () => {
    clearCounselCaches(GLB);
    clearCounselCaches(GLB);
    expect(h.gltfClear).toHaveBeenCalledTimes(2);
    expect(h.textureClear).toHaveBeenCalledWith(COUNSEL_LIGHTMAP_URL);
  });
});
