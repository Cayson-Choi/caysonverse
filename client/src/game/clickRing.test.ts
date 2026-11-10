import { describe, it, expect } from "vitest";
import { GROUND_LAYER_OFFSET, VILLAGE_GROUND_DECAL } from "../village/villageModelPrep";
import { DEFAULT_DECAL_Y } from "./groundDecal";
import { RING_POLYGON_OFFSET, RING_RENDER_ORDER, ringLift, ringY } from "./clickRing";

describe("clickRing — the destination ring on the ground", () => {
  it("its polygon offset beats every village ground layer on both terms (the layers use factor -1)", () => {
    for (const units of Object.values(GROUND_LAYER_OFFSET)) expect(RING_POLYGON_OFFSET.units).toBeLessThan(units);
    expect(RING_POLYGON_OFFSET.factor).toBeLessThan(-1);
    // the same recipe as the village's other ground decals (blob shadows, shadow floor)
    expect(RING_POLYGON_OFFSET.factor).toBe(VILLAGE_GROUND_DECAL.polygonOffsetFactor);
    expect(RING_POLYGON_OFFSET.units).toBe(VILLAGE_GROUND_DECAL.polygonOffsetUnits);
  });

  it("it draws after the shadow floor and the decals", () => {
    expect(RING_RENDER_ORDER).toBeGreaterThan(2);
  });

  it("it lies on the clicked surface plus the scene's decal lift", () => {
    expect(ringLift(null)).toBe(DEFAULT_DECAL_Y);
    expect(ringLift(VILLAGE_GROUND_DECAL)).toBe(0.05);
    expect(ringY(0.03, VILLAGE_GROUND_DECAL)).toBeCloseTo(0.08, 9); // the forecourt: above it, not under it
    expect(ringY(0.036, null)).toBeCloseTo(0.066, 9); // the escape hall's rug
    expect(ringY(0, null)).toBeCloseTo(DEFAULT_DECAL_Y, 9);
  });
});
