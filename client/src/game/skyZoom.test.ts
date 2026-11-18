import { describe, expect, it, beforeEach } from "vitest";
import { SKY_FOV_MIN, setSkyZoomGoal, viewState, zoomSkyBy } from "./viewState";

describe("star finder zoom goal", () => {
  beforeEach(() => {
    viewState.skyFovBase = 55;
    viewState.skyZoomGoal = 1;
  });

  it("never goes wider than the normal view", () => {
    setSkyZoomGoal(3);
    expect(viewState.skyZoomGoal).toBe(1);
    zoomSkyBy(2);
    expect(viewState.skyZoomGoal).toBe(1);
  });

  it("stops at the narrowest lens (20 degrees)", () => {
    for (let i = 0; i < 40; i++) zoomSkyBy(1 / 1.4);
    expect(viewState.skyZoomGoal * viewState.skyFovBase).toBeCloseTo(SKY_FOV_MIN, 6);
  });

  it("steps by the factor in between", () => {
    zoomSkyBy(0.5);
    expect(viewState.skyZoomGoal).toBeCloseTo(0.5, 6);
    zoomSkyBy(1.2);
    expect(viewState.skyZoomGoal).toBeCloseTo(0.6, 6);
  });
});
