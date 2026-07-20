import { describe, it, expect } from "vitest";
import { detectTouchDevice } from "./device";

/**
 * Pure detection: the PRIMARY pointer (coarse media query) decides; the
 * touch-point count is only a fallback when matchMedia is unavailable. No UA
 * sniffing — the environment is fully injected so the matrix is deterministic.
 */
describe("detectTouchDevice", () => {
  it("is true when the primary pointer is coarse (phone/tablet)", () => {
    expect(detectTouchDevice({ matchMedia: () => ({ matches: true }), maxTouchPoints: 5 })).toBe(
      true,
    );
  });

  it("is false on a fine-pointer, no-touch environment", () => {
    expect(detectTouchDevice({ matchMedia: () => ({ matches: false }), maxTouchPoints: 0 })).toBe(
      false,
    );
  });

  it("treats a touchscreen laptop (fine primary pointer, touch points > 0) as DESKTOP", () => {
    // Design 30 후속: Windows digitizer drivers report touch points on mouse-driven
    // PCs; the primary pointer wins so the desktop UI slots apply.
    expect(detectTouchDevice({ matchMedia: () => ({ matches: false }), maxTouchPoints: 10 })).toBe(
      false,
    );
  });

  it("falls back to maxTouchPoints when matchMedia is unavailable", () => {
    expect(detectTouchDevice({ maxTouchPoints: 2 })).toBe(true);
    expect(detectTouchDevice({ maxTouchPoints: 0 })).toBe(false);
  });

  it("defaults to false when nothing is provided (non-DOM / SSR safe)", () => {
    expect(detectTouchDevice({})).toBe(false);
  });
});
