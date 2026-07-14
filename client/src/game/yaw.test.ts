import { describe, it, expect } from "vitest";
import { normalizeAngle, stepYaw } from "./yaw";

const PI = Math.PI;

describe("normalizeAngle", () => {
  it("wraps angles into [-PI, PI]", () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 6);
    expect(Math.abs(normalizeAngle(3 * PI))).toBeCloseTo(PI, 6); // +/-PI are the same point
    expect(Math.abs(normalizeAngle(-3 * PI))).toBeCloseTo(PI, 6);
    expect(normalizeAngle((-3 * PI) / 2)).toBeCloseTo(PI / 2, 6);
    expect(normalizeAngle(2 * PI + 0.5)).toBeCloseTo(0.5, 6);
  });
});

describe("stepYaw", () => {
  it("snaps to target when within maxDelta", () => {
    expect(stepYaw(0, 0.1, 1)).toBeCloseTo(0.1, 6);
    expect(stepYaw(0.1, 0.1, 0.5)).toBeCloseTo(0.1, 6);
  });

  it("steps toward the target by maxDelta when farther away", () => {
    expect(stepYaw(0, 1, 0.1)).toBeCloseTo(0.1, 6);
    expect(stepYaw(0, -1, 0.1)).toBeCloseTo(-0.1, 6);
  });

  it("takes the shortest arc across the +/-PI seam", () => {
    // From 3.0 toward -3.0 the short way is UP through +PI (diff ~ +0.283).
    expect(stepYaw(3.0, -3.0, 0.1)).toBeCloseTo(3.1, 6);
    // Symmetric: from -3.0 toward 3.0 goes DOWN through -PI.
    expect(stepYaw(-3.0, 3.0, 0.1)).toBeCloseTo(-3.1, 6);
  });

  it("keeps its result normalized when the shortest arc wraps past the seam", () => {
    const out = stepYaw(3.1, -3.1, 0.2); // short arc of ~0.08 -> snaps to target
    expect(out).toBeCloseTo(-3.1, 6);
    expect(out).toBeGreaterThanOrEqual(-PI);
    expect(out).toBeLessThanOrEqual(PI);
  });
});
