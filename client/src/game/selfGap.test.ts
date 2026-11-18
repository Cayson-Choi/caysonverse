import { describe, expect, it } from "vitest";
import { SELF_CAPSULE, SELF_GAP, SELF_GAP_OUTDOOR, SELF_HEAD_CENTRE, selfGap, stepSelfGapHidden } from "./selfGap";
import { CAMERA, HEAD_HEIGHT } from "./constants";

describe("the camera's gap to the own avatar (owner 2026-11-18: the zoomed-in camera inside the head at the bus stop)", () => {
  it("is 0 inside the head and the body, and grows with the distance from them", () => {
    expect(selfGap(0, SELF_HEAD_CENTRE, 0, 0, 0, SELF_HEAD_CENTRE)).toBe(0);
    expect(selfGap(0.3, 1.4, 0, 0, 0, SELF_HEAD_CENTRE)).toBe(0);
    expect(selfGap(2, SELF_HEAD_CENTRE - 0.5, 0, 0, 0, SELF_HEAD_CENTRE)).toBeCloseTo(2 - SELF_CAPSULE.radius);
    // straight above the head: from the capsule's top
    expect(selfGap(0, SELF_HEAD_CENTRE + 2, 0, 0, 0, SELF_HEAD_CENTRE)).toBeCloseTo(2 + SELF_CAPSULE.top - SELF_CAPSULE.radius);
    // the body's position and height move it
    expect(selfGap(10, 5 + SELF_HEAD_CENTRE, 3, 10, 3, 5 + SELF_HEAD_CENTRE)).toBe(0);
  });

  it("the spring arm pulled to the head hides the body; the player's own least zoom never does, at any tilt", () => {
    // the bus stop's measured worst case (before the fix): the lens 0.1 m from the follow point
    expect(stepSelfGapHidden(false, selfGap(0.1, HEAD_HEIGHT + 0.05, 0, 0, 0, SELF_HEAD_CENTRE))).toBe(true);
    for (let pitch = CAMERA.minPitch; pitch <= CAMERA.maxPitch + 1e-9; pitch += 0.05) {
      const d = CAMERA.minDistance;
      const gap = selfGap(d * Math.cos(pitch), HEAD_HEIGHT + d * Math.sin(pitch), 0, 0, 0, SELF_HEAD_CENTRE);
      expect(stepSelfGapHidden(false, gap), `pitch ${pitch}`).toBe(false);
      expect(stepSelfGapHidden(false, gap, SELF_GAP_OUTDOOR), `outdoors, pitch ${pitch}`).toBe(false);
    }
  });

  it("has a hysteresis: hidden under 0.6 m, shown again only past 0.75 m (no flicker at the edge)", () => {
    expect(SELF_GAP.hide).toBeCloseTo(0.6);
    expect(stepSelfGapHidden(false, 0.59)).toBe(true);
    expect(stepSelfGapHidden(false, 0.61)).toBe(false);
    expect(stepSelfGapHidden(true, 0.7)).toBe(true);
    expect(stepSelfGapHidden(true, 0.76)).toBe(false);
    // outdoors the margin is wider (a lens pulled in by the parked bus)
    expect(stepSelfGapHidden(false, 0.8, SELF_GAP_OUTDOOR)).toBe(true);
    expect(stepSelfGapHidden(true, 1.1, SELF_GAP_OUTDOOR)).toBe(false);
  });
});
