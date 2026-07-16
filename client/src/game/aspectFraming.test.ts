import { describe, it, expect } from "vitest";
import { aspectDistanceScale, PORTRAIT_MAX_SCALE } from "./aspectFraming";

describe("aspectDistanceScale", () => {
  it("leaves landscape and square viewports untouched", () => {
    expect(aspectDistanceScale(1920 / 1080)).toBe(1); // desktop wide
    expect(aspectDistanceScale(1280 / 800)).toBe(1); // desktop / e2e viewport
    expect(aspectDistanceScale(1)).toBe(1); // square
    expect(aspectDistanceScale(1.0001)).toBe(1);
  });

  it("pulls the camera back on portrait phones", () => {
    const iphone = aspectDistanceScale(390 / 664);
    const pixel = aspectDistanceScale(412 / 839);
    // Both must back off, and the taller/narrower screen backs off more.
    expect(iphone).toBeGreaterThan(1);
    expect(pixel).toBeGreaterThan(iphone);
    // Sanity: a ~30-45% pull-back, not a teleport to orbit.
    expect(iphone).toBeCloseTo(1.305, 2);
    expect(pixel).toBeCloseTo(1.427, 2);
  });

  it("keeps the default 6m follow distance inside the 10m zoom ceiling", () => {
    // The pull-back must not silently exceed CAMERA.maxDistance for a default view.
    expect(6 * aspectDistanceScale(390 / 664)).toBeLessThan(10);
    expect(6 * PORTRAIT_MAX_SCALE).toBeLessThanOrEqual(10);
  });

  it("caps the pull-back on absurdly narrow viewports", () => {
    expect(aspectDistanceScale(0.2)).toBe(PORTRAIT_MAX_SCALE);
    expect(aspectDistanceScale(0.01)).toBe(PORTRAIT_MAX_SCALE);
  });

  it("is monotonic: narrower never backs off less", () => {
    const samples = [0.3, 0.4, 0.5, 0.6, 0.8, 0.95, 1, 1.5, 2];
    for (let i = 1; i < samples.length; i++) {
      expect(aspectDistanceScale(samples[i])).toBeLessThanOrEqual(
        aspectDistanceScale(samples[i - 1]),
      );
    }
  });

  it("falls back to 1 for invalid input rather than breaking the camera", () => {
    expect(aspectDistanceScale(0)).toBe(1);
    expect(aspectDistanceScale(-2)).toBe(1);
    expect(aspectDistanceScale(NaN)).toBe(1);
    expect(aspectDistanceScale(Infinity)).toBe(1);
  });
});
