import { describe, expect, it } from "vitest";
import { airCutoff, distanceLevel, noiseData, panFor, seededRandom, soundAllowed } from "./sfxKit";

describe("distanceLevel", () => {
  it("is 1 up to the near distance and 0 from the far one", () => {
    expect(distanceLevel(0, 5, 25)).toBe(1);
    expect(distanceLevel(5, 5, 25)).toBe(1);
    expect(distanceLevel(25, 5, 25)).toBe(0);
    expect(distanceLevel(80, 5, 25)).toBe(0);
    expect(distanceLevel(Infinity, 5, 25)).toBe(0);
    expect(distanceLevel(NaN, 5, 25)).toBe(0);
  });
  it("never rises with distance and stays in 0..1", () => {
    let prev = 2;
    for (let d = 0; d <= 40; d += 0.25) {
      const l = distanceLevel(d, 5.4, 25, 2.2);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(1);
      expect(l).toBeLessThanOrEqual(prev + 1e-12);
      prev = l;
    }
  });
});

describe("the air and the pan", () => {
  it("dulls with distance: open when near, closed when far", () => {
    expect(airCutoff(1)).toBeCloseTo(16000, 3);
    expect(airCutoff(0)).toBeCloseTo(1400, 3);
    expect(airCutoff(0.3)).toBeLessThan(airCutoff(0.6));
  });
  it("pans toward the side the source is on, centred when close", () => {
    expect(panFor(20, 0, 1, 0)).toBeGreaterThan(0.5); // to the right
    expect(panFor(-20, 0, 1, 0)).toBeLessThan(-0.5);
    expect(Math.abs(panFor(0, -20, 1, 0))).toBeLessThan(1e-9); // dead ahead
    expect(Math.abs(panFor(0.5, 0, 1, 0))).toBeLessThan(0.1);
    expect(panFor(0, 0, 1, 0)).toBe(0);
    expect(Math.abs(panFor(500, 0, 1, 0))).toBeLessThanOrEqual(0.85);
  });
});

describe("the toggles", () => {
  it("sound plays only when nothing mutes it", () => {
    expect(soundAllowed(false, false, false)).toBe(true);
    expect(soundAllowed(true, false, false)).toBe(false); // the menu's 소리 off
    expect(soundAllowed(false, true, false)).toBe(false); // the ride panel's mute
    expect(soundAllowed(false, false, true)).toBe(false); // a hidden tab
  });
});

describe("noise loops", () => {
  it("are finite, bounded, seeded and seamless at the loop's end", () => {
    for (const kind of ["white", "pink", "brown"] as const) {
      const a = noiseData(48000, kind, 3);
      const b = noiseData(48000, kind, 3);
      expect(a.length).toBeLessThan(48000);
      expect(Array.from(a.subarray(0, 50))).toEqual(Array.from(b.subarray(0, 50)));
      let max = 0;
      let finite = true;
      for (const v of a) {
        if (!Number.isFinite(v)) finite = false;
        max = Math.max(max, Math.abs(v));
      }
      expect(finite).toBe(true);
      expect(max).toBeLessThan(4);
      // the seam: the last sample and the first are close compared with the signal's own sample-to-sample step
      const step = Math.max(...Array.from({ length: 400 }, (_, i) => Math.abs(a[i + 1]! - a[i]!)));
      expect(Math.abs(a[a.length - 1]! - a[0]!)).toBeLessThan(Math.max(step * 8, 0.3));
    }
  });
  it("seededRandom repeats", () => {
    const r1 = seededRandom(9);
    const r2 = seededRandom(9);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
});
