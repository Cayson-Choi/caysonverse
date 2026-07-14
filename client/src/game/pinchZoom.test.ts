import { describe, it, expect } from "vitest";
import { applyPinchZoom } from "./pinchZoom";

// Same clamp band as the CAMERA orbit distance (min 2.5, max 10).
const RANGE = { speed: 0.02, min: 2.5, max: 10 };

/**
 * Two-finger pinch maps a change in finger spread (px) to a new orbit distance,
 * clamped into the existing zoom range. Spreading apart pulls the camera IN
 * (smaller distance); pinching together pushes it OUT.
 */
describe("applyPinchZoom", () => {
  it("spreading fingers apart zooms in (smaller distance)", () => {
    const next = applyPinchZoom(6, 100, 200, RANGE);
    expect(next).toBeLessThan(6);
    expect(next).toBeCloseTo(6 + (100 - 200) * 0.02, 6); // 6 - 2 = 4
  });

  it("pinching fingers together zooms out (larger distance)", () => {
    const next = applyPinchZoom(6, 200, 100, RANGE);
    expect(next).toBeGreaterThan(6);
    expect(next).toBeCloseTo(6 + (200 - 100) * 0.02, 6); // 6 + 2 = 8
  });

  it("clamps to the minimum distance (never nearer than min)", () => {
    expect(applyPinchZoom(3, 100, 1000, RANGE)).toBe(2.5);
  });

  it("clamps to the maximum distance (never farther than max)", () => {
    expect(applyPinchZoom(9, 1000, 100, RANGE)).toBe(10);
  });

  it("leaves the distance untouched when the spread does not change", () => {
    expect(applyPinchZoom(6, 150, 150, RANGE)).toBe(6);
  });
});
