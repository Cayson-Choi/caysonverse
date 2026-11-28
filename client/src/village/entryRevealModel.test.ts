import { describe, expect, it } from "vitest";
import { Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, Texture } from "three";
import { REVEAL_TIMING, nextCleanStreak, sceneryQuiet, sceneryShare, texturesToUpload, uploadTextures } from "./entryRevealModel";

function tex(img: unknown = { width: 2, height: 2 }): Texture {
  const t = new Texture(img as never);
  t.needsUpdate = true; // version 1: has data
  return t;
}

describe("the entry reveal's stages (entryRevealModel)", () => {
  it("the scenery is in once nothing is in flight and nothing moved for quietMs", () => {
    expect(sceneryQuiet(1000, 1, 0, 500)).toBe(false);
    expect(sceneryQuiet(1000, 0, 700, 500)).toBe(false);
    expect(sceneryQuiet(1200, 0, 700, 500)).toBe(true);
  });

  it("its share is ended / started, 1 when nothing started", () => {
    expect(sceneryShare(0, 0)).toBe(1);
    expect(sceneryShare(10, 4)).toBe(0.4);
    expect(sceneryShare(10, 12)).toBe(1);
  });

  it("a clean frame: the gate held nothing in it, has nothing queued, and no file is loading", () => {
    expect(nextCleanStreak(0, 5, 5, 0, 0)).toBe(1);
    expect(nextCleanStreak(2, 5, 5, 0, 0)).toBe(3);
    expect(nextCleanStreak(2, 5, 6, 0, 0)).toBe(0);
    expect(nextCleanStreak(2, 5, 5, 1, 0)).toBe(0);
    expect(nextCleanStreak(2, 5, 5, 0, 2)).toBe(0);
  });

  it("collects each texture once, only those with data and not uploaded yet", () => {
    const a = tex();
    const b = tex();
    const empty = new Texture(); // version 0: no data yet
    const done = tex();
    const root = new Object3D();
    const m1 = new MeshStandardMaterial({ map: a, normalMap: b });
    const m2 = new MeshStandardMaterial({ map: a, roughnessMap: empty, aoMap: done });
    root.add(new Mesh(new PlaneGeometry(), m1), new Mesh(new PlaneGeometry(), [m1, m2]));
    const list = texturesToUpload(root, (t) => t === done);
    expect(new Set(list)).toEqual(new Set([a, b]));
    expect(list.length).toBe(2);
  });

  it("uploads in slices across frames and reports progress to the end", async () => {
    const up = new Set<Texture>();
    const gl = { initTexture: (t: Texture) => void up.add(t), properties: { get: (t: Texture) => ({ __webglInit: up.has(t) }) } };
    const list = [tex(), tex(), tex(), tex()];
    let clock = 0;
    const frames: Array<() => void> = [];
    const seen: Array<[number, number]> = [];
    const p = uploadTextures(gl as never, list, 1, (d, n) => seen.push([d, n]), () => false, (fn) => frames.push(fn), () => (clock += 1));
    while (frames.length) frames.shift()!();
    await p;
    expect(up.size).toBe(4);
    expect(seen.at(-1)).toEqual([4, 4]);
    expect(seen.length).toBeGreaterThan(1);
  });

  it("the phone waits longer for quiet than the PC, and every stage has a cap", () => {
    expect(REVEAL_TIMING.phone.quietMs).toBeGreaterThan(REVEAL_TIMING.pc.quietMs);
    for (const t of [REVEAL_TIMING.pc, REVEAL_TIMING.phone]) expect(t.sceneryCapMs + t.warmCapMs).toBeLessThan(45000);
  });
});
