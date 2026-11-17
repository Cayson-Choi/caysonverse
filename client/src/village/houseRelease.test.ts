import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Group, Texture } from "three";

/** A stand-in for the loader's cache, keyed by url: only what was requested can be read. */
const h = vi.hoisted(() => {
  const cache = new Map<string, unknown>();
  const cleared: string[] = [];
  const preloaded: string[] = [];
  return { cache, cleared, preloaded };
});

vi.mock("@react-three/drei", () => {
  const useGLTF = (url: string) => {
    if (!h.cache.has(url)) throw new Error(`read of an entry that was never requested: ${url}`);
    return h.cache.get(url);
  };
  useGLTF.preload = (url: string) => {
    h.preloaded.push(url);
    h.cache.set(url, { scene: new Group() });
  };
  useGLTF.clear = (url: string) => {
    h.cleared.push(url);
    h.cache.delete(url);
  };
  return { useGLTF };
});

import { clearHouseCaches, heldHouses, holdHouseFiles, loadHouseTexture, noteHouseRequested, prefetchHouse, releaseHouseNow, requestedHouses } from "./houseRelease";

const url = (n: number) => `/models/village/houses/house_${n}.glb`;

beforeEach(() => {
  vi.useFakeTimers();
  h.cache.clear();
  h.cleared.length = 0;
  h.preloaded.length = 0;
});
afterEach(() => {
  for (const n of [1, 2, 3] as const) releaseHouseNow(n);
  vi.useRealTimers();
});

describe("houseRelease: prefetch, hold, release", () => {
  it("the village holds no house file until a door is near: prefetch starts exactly that house's model", () => {
    expect(requestedHouses()).toEqual([]);
    prefetchHouse(1);
    expect(h.preloaded).toEqual([url(1)]);
    expect(requestedHouses()).toEqual([1]);
    prefetchHouse(1); // again: the loader's cache answers, nothing is requested twice
    expect(h.preloaded).toEqual([url(1)]);
  });

  it("only one house stays in memory: asking for another lets the first go at once (unless it is held)", () => {
    prefetchHouse(1);
    prefetchHouse(2);
    expect(requestedHouses()).toEqual([2]);
    expect(h.cleared).toContain(url(1));
    const release = holdHouseFiles(2);
    prefetchHouse(3); // house 2 is held: it stays
    expect(requestedHouses().sort()).toEqual([2, 3]);
    expect(heldHouses()).toEqual([2]);
    release();
  });

  it("a house that is left is let go after 60 s, not before; held again meanwhile it stays", () => {
    prefetchHouse(1);
    const release = holdHouseFiles(1);
    release();
    vi.advanceTimersByTime(59_000);
    expect(h.cleared).not.toContain(url(1));
    const again = holdHouseFiles(1); // came back in
    vi.advanceTimersByTime(10_000);
    expect(h.cleared).not.toContain(url(1));
    again();
    vi.advanceTimersByTime(60_001);
    expect(h.cleared).toContain(url(1));
    expect(requestedHouses()).toEqual([]);
  });

  it("a visit that never prefetched (the scene read it itself) is released too, through noteHouseRequested", () => {
    h.cache.set(url(2), { scene: new Group() });
    noteHouseRequested(2);
    const release = holdHouseFiles(2);
    release();
    vi.advanceTimersByTime(60_001);
    expect(h.cleared).toContain(url(2));
  });

  it("clearHouseCaches forgets a failed model so the next visit downloads again", () => {
    prefetchHouse(1);
    clearHouseCaches(1);
    expect(h.cleared).toContain(url(1));
    expect(requestedHouses()).toEqual([]);
    prefetchHouse(1);
    expect(h.preloaded.filter((u) => u === url(1))).toHaveLength(2);
  });
});

describe("houseRelease: the shared albedo files (realism pass)", () => {
  it("a texture two houses asked for is freed only when the last of them lets it go", async () => {
    const made: Texture[] = [];
    const loader = { loadAsync: async () => { const t = new Texture<HTMLImageElement>(); made.push(t); return t; } };
    const url = "/textures/houses/hi/T_h_floor_oak.webp";
    const a = await loadHouseTexture(1, url, loader);
    const b = await loadHouseTexture(2, url, loader);
    expect(a).toBe(b);
    expect(made).toHaveLength(1);
    const freed = vi.spyOn(a as Texture, "dispose");
    releaseHouseNow(1);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(freed).not.toHaveBeenCalled();
    // house 2 still reads the same texture (no second download)
    expect(await loadHouseTexture(2, url, loader)).toBe(a);
    releaseHouseNow(2);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(freed).toHaveBeenCalled();
  });
});

