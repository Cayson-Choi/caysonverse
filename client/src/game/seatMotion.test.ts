import { describe, expect, it } from "vitest";
import {
  SIT_GLIDE,
  SIT_LIFT,
  STAND_GLIDE,
  STAND_LIFT,
  glideAt,
  glideDone,
  sitDownLift,
  smooth,
  standUpLift,
  windowProgress,
  type Glide,
} from "./seatMotion";

const DUR = 0.792; // Sit_Chair_Down / Sit_Chair_StandUp

describe("seatMotion — the bench lift", () => {
  it("sitting down: none while the clip still stands on its feet, all of it once the butt is on the seat", () => {
    expect(sitDownLift(0.055, 0, DUR)).toBe(0);
    expect(sitDownLift(0.055, DUR * SIT_LIFT.from, DUR)).toBe(0);
    expect(sitDownLift(0.055, DUR * SIT_LIFT.to, DUR)).toBeCloseTo(0.055, 9);
    expect(sitDownLift(0.055, DUR, DUR)).toBeCloseTo(0.055, 9);
    const mid = sitDownLift(0.055, DUR * (SIT_LIFT.from + SIT_LIFT.to) / 2, DUR);
    expect(mid).toBeCloseTo(0.0275, 6);
  });

  it("getting up: all of it at the start, none once the feet are down (and after)", () => {
    expect(standUpLift(0.055, 0, DUR)).toBeCloseTo(0.055, 9);
    expect(standUpLift(0.055, DUR * STAND_LIFT.to, DUR)).toBe(0);
    expect(standUpLift(0.055, DUR, DUR)).toBe(0);
  });

  it("never overshoots or goes negative, and is monotone through the window", () => {
    let prev = -1;
    for (let k = 0; k <= 40; k++) {
      const v = sitDownLift(0.08, (DUR * k) / 40, DUR);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0.08 + 1e-12);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });

  it("a missing clip length counts as finished (no NaN)", () => {
    expect(windowProgress(0.1, 0, SIT_LIFT)).toBe(1);
    expect(sitDownLift(0.05, 0.1, 0)).toBe(0.05);
    expect(smooth(-1)).toBe(0);
    expect(smooth(2)).toBe(1);
  });
});

describe("seatMotion — the glides", () => {
  const g: Glide = { fromX: 0, fromZ: 0, fromYaw: 3.0, toX: 1, toZ: -1, toYaw: -3.0, window: STAND_GLIDE };

  it("starts where it was, ends exactly on the target, and turns the short way round", () => {
    const out = { x: NaN, z: NaN, yaw: NaN };
    glideAt(g, 0, DUR, out);
    expect(out).toEqual({ x: 0, z: 0, yaw: 3.0 });
    glideAt(g, DUR * STAND_GLIDE.to, DUR, out);
    expect(out.x).toBeCloseTo(1, 9);
    expect(out.z).toBeCloseTo(-1, 9);
    expect(Math.abs(Math.atan2(Math.sin(out.yaw + 3.0), Math.cos(out.yaw + 3.0)))).toBeLessThan(1e-9);
    glideAt(g, DUR * 0.4, DUR, out);
    // across the ±PI seam: never through 0
    expect(Math.abs(out.yaw)).toBeGreaterThan(3.0 - 1e-9);
  });

  it("is done at the end of its window, not before", () => {
    expect(glideDone(g, DUR * (STAND_GLIDE.to - 0.01), DUR)).toBe(false);
    expect(glideDone(g, DUR * STAND_GLIDE.to, DUR)).toBe(true);
    expect(glideDone({ ...g, window: SIT_GLIDE }, DUR * SIT_GLIDE.to, DUR)).toBe(true);
    expect(glideDone(g, 0.1, 0)).toBe(true);
  });

  it("walks onto the seat while the sit-down clip still stands (before the lift starts)", () => {
    expect(SIT_GLIDE.to).toBeLessThanOrEqual(SIT_LIFT.to);
    expect(STAND_LIFT.to).toBeLessThanOrEqual(STAND_GLIDE.to);
  });
});
