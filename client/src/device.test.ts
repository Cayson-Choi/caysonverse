import { describe, it, expect } from "vitest";
import { detectTouchDevice } from "./device";

/**
 * Pure detection: coarse-pointer media query OR a positive maxTouchPoints. No UA
 * sniffing — the environment is fully injected so the matrix is deterministic.
 */
describe("detectTouchDevice", () => {
  it("is true when the pointer is coarse", () => {
    expect(detectTouchDevice({ matchMedia: () => ({ matches: true }), maxTouchPoints: 0 })).toBe(
      true,
    );
  });

  it("is true when maxTouchPoints > 0 even if the pointer query reports fine", () => {
    expect(detectTouchDevice({ matchMedia: () => ({ matches: false }), maxTouchPoints: 5 })).toBe(
      true,
    );
  });

  it("is false on a fine-pointer, no-touch environment", () => {
    expect(detectTouchDevice({ matchMedia: () => ({ matches: false }), maxTouchPoints: 0 })).toBe(
      false,
    );
  });

  it("treats a touchscreen laptop (fine media but touch points) as touch", () => {
    // Hybrid device: coarse media false, yet the panel reports touch points.
    expect(detectTouchDevice({ matchMedia: () => ({ matches: false }), maxTouchPoints: 2 })).toBe(
      true,
    );
  });

  it("defaults to false when nothing is provided (non-DOM / SSR safe)", () => {
    expect(detectTouchDevice({})).toBe(false);
  });
});
