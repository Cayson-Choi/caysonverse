import { describe, it, expect } from "vitest";
import { mixerCadence, decideMixerTick } from "./mixerThrottle";
import { MIXER_FAR_DIST, MIXER_NEAR_DIST } from "./constants";

describe("mixerCadence (distance bands)", () => {
  it("updates every frame within the near band (< NEAR)", () => {
    expect(mixerCadence(0)).toBe(1);
    expect(mixerCadence(MIXER_NEAR_DIST - 0.01)).toBe(1);
  });

  it("updates every 3rd frame in the mid band (NEAR..FAR inclusive)", () => {
    expect(mixerCadence(MIXER_NEAR_DIST)).toBe(3);
    expect(mixerCadence(17)).toBe(3);
    expect(mixerCadence(MIXER_FAR_DIST)).toBe(3);
  });

  it("updates every 6th frame in the far band (> FAR)", () => {
    expect(mixerCadence(MIXER_FAR_DIST + 0.01)).toBe(6);
    expect(mixerCadence(100)).toBe(6);
  });
});

describe("decideMixerTick", () => {
  it("ticks every frame when near, passing the accumulated delta", () => {
    const d = decideMixerTick(5, 1, 0.016);
    expect(d.update).toBe(true);
    expect(d.delta).toBeCloseTo(0.016, 6);
  });

  it("withholds mid-band ticks until the 3rd frame, then passes accumulated delta", () => {
    expect(decideMixerTick(15, 1, 0.016).update).toBe(false);
    expect(decideMixerTick(15, 2, 0.032).update).toBe(false);
    const third = decideMixerTick(15, 3, 0.048);
    expect(third.update).toBe(true);
    expect(third.delta).toBeCloseTo(0.048, 6); // three frames' worth, accumulated
  });

  it("withholds far-band ticks until the 6th frame", () => {
    for (let f = 1; f <= 5; f++) {
      expect(decideMixerTick(40, f, f * 0.016).update).toBe(false);
    }
    const sixth = decideMixerTick(40, 6, 6 * 0.016);
    expect(sixth.update).toBe(true);
    expect(sixth.delta).toBeCloseTo(6 * 0.016, 6);
  });

  it("reports delta 0 when not updating", () => {
    expect(decideMixerTick(40, 2, 0.5).delta).toBe(0);
  });
});
