import { describe, expect, it } from "vitest";
import { FAR_STEEL, farFade, farOffset } from "./farSteel";

describe("far steel (the coaster's rails seen from the wheel)", () => {
  it("a part wider than the screen's minimum is not grown", () => {
    // 1 px = 5 cm: a 13 cm rail (6.5 cm half width) is already 2.6 px
    expect(farOffset(0.05, 0.065)).toBe(0);
  });
  it("a rail thinner than a pixel is widened to the minimum, never past the cap", () => {
    const px = 0.22; // ~170 m
    const half = 0.065 + farOffset(px, 0.065);
    expect(half * 2 / px).toBeCloseTo(FAR_STEEL.minPx, 5);
    expect(farOffset(12, 0.065)).toBe(FAR_STEEL.maxOffsetM);
  });
  it("the fade is 0 near, 1 far, smooth between", () => {
    expect(farFade(FAR_STEEL.fadeFrom - 1)).toBe(0);
    expect(farFade(FAR_STEEL.fadeTo + 1)).toBe(1);
    const mid = farFade((FAR_STEEL.fadeFrom + FAR_STEEL.fadeTo) / 2);
    expect(mid).toBeGreaterThan(0.45);
    expect(mid).toBeLessThan(0.55);
  });
});
