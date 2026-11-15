import { describe, expect, it } from "vitest";
import { MARKER_MIN_RING_PX, blinkOpacity, markerRadiusMetres, metresPerPixel, ripplePhase } from "./mapMarker";

const FOV = (50 * Math.PI) / 180;

describe("overview self marker", () => {
  it("covers the same number of screen pixels from any height", () => {
    const vh = 812;
    for (const h of [120, 209, 260]) {
      const r = markerRadiusMetres(h, FOV, vh);
      expect(r / metresPerPixel(h, FOV, vh)).toBeCloseTo(30, 3);
    }
  });

  it("is far bigger than the old 1.75 m ring on a whole-map view", () => {
    expect(markerRadiusMetres(209, FOV, 812)).toBeGreaterThan(5);
    // never below the old size, never NaN, whatever the inputs
    expect(markerRadiusMetres(0, FOV, 812)).toBe(1.75);
    expect(markerRadiusMetres(100, FOV, 0)).toBe(1.75);
    expect(markerRadiusMetres(100, NaN, 800)).toBe(1.75);
    expect(MARKER_MIN_RING_PX).toBeLessThanOrEqual(30);
  });

  it("blinks between dim and bright, within 0.35..1, hitting both ends", () => {
    let lo = 1;
    let hi = 0;
    for (let t = 0; t < 2; t += 0.01) {
      const o = blinkOpacity(t);
      expect(o).toBeGreaterThanOrEqual(0.349);
      expect(o).toBeLessThanOrEqual(1.001);
      lo = Math.min(lo, o);
      hi = Math.max(hi, o);
    }
    expect(lo).toBeLessThan(0.4);
    expect(hi).toBeGreaterThan(0.95);
  });

  it("the ripple runs 0..1 and repeats", () => {
    expect(ripplePhase(0)).toBe(0);
    expect(ripplePhase(0.8)).toBeCloseTo(0.5);
    expect(ripplePhase(1.6)).toBeCloseTo(0);
    expect(ripplePhase(-0.4)).toBeGreaterThanOrEqual(0);
  });
});
