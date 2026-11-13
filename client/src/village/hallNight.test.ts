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
});
