import { describe, expect, it } from "vitest";
import { MeshBasicMaterial, Texture } from "three";
import { hallGardenNightUniform, hallNightMapUniform, hallNightReady, hallNightUniform, hallNightWeight, isSkylight, loadHallNight, skylightColour, disposeHallNight } from "./hallNight";

describe("hallNight — the hall's light follows the village's clock", () => {
  it("the weight is the village's night weight once the night files are in, and 0 until then (never dark for want of a file)", () => {
    expect(hallNightWeight(0.7, false)).toBe(0);
    expect(hallNightWeight(0.7, true)).toBe(0.7);
    expect(hallNightWeight(-1, true)).toBe(0);
    expect(hallNightWeight(2, true)).toBe(1);
  });

  it("the skylight is cool white by day and a deep blue at night, blended between", () => {
    const day = skylightColour(0);
    const night = skylightColour(1);
    expect(day[2]).toBeGreaterThan(0.95);
    expect(night[0]).toBeLessThan(0.05);
    expect(night[2]).toBeGreaterThan(night[0]);
    expect(skylightColour(0.5)[0]).toBeCloseTo((day[0] + night[0]) / 2, 9);
  });

  it("loads the night map and the night park once, configured like the day map, and frees them", async () => {
    const made: Texture[] = [];
    const loader = {
      loadAsync: async () => {
        const t = new Texture();
        made.push(t);
        return t as Texture<HTMLImageElement>;
      },
    };
    expect(hallNightReady()).toBe(false);
    await loadHallNight("high", loader);
    expect(hallNightReady()).toBe(true);
    expect(made).toHaveLength(2);
    expect(hallNightMapUniform.value!.flipY).toBe(false);
    expect(hallNightMapUniform.value!.channel).toBe(1);
    expect(hallGardenNightUniform.value!.flipY).toBe(false);
    await loadHallNight("high", loader); // again: nothing new
    expect(made).toHaveLength(2);
    hallNightUniform.value = 0.8;
    disposeHallNight();
    expect(hallNightReady()).toBe(false);
    expect(hallNightUniform.value).toBe(0);
  });

  it("finds the skylight material by name", () => {
    const m = new MeshBasicMaterial();
    m.name = "M_skylight";
    expect(isSkylight(m)).toBe(true);
    m.name = "M_lamp";
    expect(isSkylight(m)).toBe(false);
  });

  it("a load that is overtaken by leaving the hall frees its files instead of hanging them on the uniforms; another tier swaps the map", async () => {
    const made: Texture[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const loader = {
      loadAsync: async () => {
        await gate;
        const t = new Texture();
        made.push(t);
        return t as Texture<HTMLImageElement>;
      },
    };
    const pending = loadHallNight("high", loader);
    disposeHallNight(); // left while loading
    release();
    await pending;
    expect(hallNightReady()).toBe(false);
    expect(made).toHaveLength(2);

    const plain = { loadAsync: async () => new Texture() as Texture<HTMLImageElement> };
    await loadHallNight("low", plain);
    const first = hallNightMapUniform.value;
    await loadHallNight("low", plain); // same tier: nothing new
    expect(hallNightMapUniform.value).toBe(first);
    await loadHallNight("high", plain); // another tier: a new map
    expect(hallNightMapUniform.value).not.toBe(first);
    disposeHallNight();
  });
  it("a tier change while the other tier is still loading ends on the CURRENT tier's map (the old one freed)", async () => {
    disposeHallNight();
    const made: { url: string; t: Texture }[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const loader = {
      loadAsync: async (url: string) => {
        const t = new Texture();
        made.push({ url, t });
        if (made.length <= 2) await gate; // the first (high) load hangs until released
        return t as Texture<HTMLImageElement>;
      },
    };
    const high = loadHallNight("high", loader);
    const low = loadHallNight("low", loader);
    release();
    await high;
    await low;
    const lm = made.filter((m) => !m.url.includes("garden"));
    expect(lm).toHaveLength(2);
    expect(hallNightMapUniform.value).toBe(lm[1]!.t); // the low one stays
    expect(lm[1]!.url).not.toBe(lm[0]!.url);
    disposeHallNight();
  });

  it("high -> low -> high while the first high load is in flight ends on the high map (review 2026-11-15)", async () => {
    disposeHallNight();
    const made: { url: string; t: Texture }[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const loader = {
      loadAsync: async (url: string) => {
        const t = new Texture();
        made.push({ url, t });
        if (made.length <= 2) await gate;
        return t as Texture<HTMLImageElement>;
      },
    };
    const a = loadHallNight("high", loader);
    const b = loadHallNight("low", loader);
    const c = loadHallNight("high", loader);
    release();
    await Promise.all([a, b, c]);
    const lm = made.filter((m) => !m.url.includes("garden"));
    expect(hallNightMapUniform.value).toBe(lm[lm.length - 1]!.t);
    expect(lm[lm.length - 1]!.url).toBe(lm[0]!.url); // the high map, not the 1k one
    expect(lm.every((m) => m.url === lm[0]!.url)).toBe(true); // the low map was never even fetched
    disposeHallNight();
  });
});

describe("the cubby interiors' shared texture (round 6)", () => {
  it("blends its night half (0.5 to the right) by the night weight, once per material", async () => {
    const { MeshBasicMaterial } = await import("three");
    const { HALL_CUBBY_MATERIAL, patchHallCubbyMaterial, hallNightUniform } = await import("./hallNight");
    expect(HALL_CUBBY_MATERIAL).toBe("M_cubby_in");
    const m = new MeshBasicMaterial();
    patchHallCubbyMaterial(m);
    const first = m.onBeforeCompile;
    patchHallCubbyMaterial(m);
    expect(m.onBeforeCompile).toBe(first);
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader: "uniform vec3 diffuse;\nvoid main() {\n#include <map_fragment>\n}",
      vertexShader: "",
    };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.uHallNight).toBe(hallNightUniform);
    expect(shader.fragmentShader).toContain("vMapUv + vec2( 0.5, 0.0 )");
    expect(shader.fragmentShader).toContain("uniform float uHallNight;");
    expect(shader.fragmentShader).not.toContain("#include <map_fragment>");
  });
});
