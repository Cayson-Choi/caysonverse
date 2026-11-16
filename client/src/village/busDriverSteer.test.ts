import { describe, expect, it } from "vitest";
import { steerWeights, stepYawRate, type SteerState } from "./busDriverSteer";

describe("bus driver steering weights", () => {
  it("weights always sum to 1 and lean to the turning side", () => {
    for (const s of [-1.5, -1, -0.4, 0, 0.3, 1, 2]) {
      const w = steerWeights(s);
      expect(w.drive + w.left + w.right).toBeCloseTo(1, 6);
      expect(w.left > 0).toBe(s > 0);
      expect(w.right > 0).toBe(s < 0);
    }
  });

  it("a steady left turn (yaw growing) winds the wheel left, straight driving brings it back", () => {
    const st: SteerState = { yaw: Number.NaN, rate: 0, s: 0 };
    let yaw = 0;
    for (let i = 0; i < 120; i += 1) {
      yaw += 0.4 / 60;
      stepYawRate(st, yaw, 1 / 60);
    }
    expect(st.s).toBeGreaterThan(0.8);
    for (let i = 0; i < 180; i += 1) stepYawRate(st, yaw, 1 / 60);
    expect(Math.abs(st.s)).toBeLessThan(0.05);
  });

  it("ignores a jump of the pose across the wrap and a teleport", () => {
    const st: SteerState = { yaw: Math.PI - 0.001, rate: 0, s: 0 };
    stepYawRate(st, -Math.PI + 0.001, 1 / 60);
    expect(Math.abs(st.rate)).toBeLessThan(0.2);
    stepYawRate(st, 1.5, 1 / 60);
    expect(Math.abs(st.rate)).toBeLessThan(0.2);
  });
});
