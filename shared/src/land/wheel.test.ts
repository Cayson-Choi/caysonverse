import { describe, expect, it } from "vitest";
import {
  WHEEL_BOARD_END_MS,
  WHEEL_HUB_Y,
  WHEEL_N,
  WHEEL_R,
  WHEEL_SEATS,
  WHEEL_SITE,
  WHEEL_STEP,
  WHEEL_STEP_MS,
  boardingSeatsOfWheel,
  wheelAt,
  wheelBottomGondola,
  wheelPivot,
  wheelSeatAtPlatform,
  wheelSeatPose,
} from "./wheel";

const T0 = 1_900_000_000_000 - (1_900_000_000_000 % (WHEEL_STEP_MS * WHEEL_N));

describe("sky lantern wheel", () => {
  it("has 40 seats and a step of 36 degrees", () => {
    expect(WHEEL_SEATS).toBe(40);
    expect(WHEEL_STEP).toBeCloseTo(Math.PI / 5, 9);
  });
  it("loads, gates, turns one step and stands again", () => {
    expect(wheelAt(T0 + 1000).status).toBe("unloading");
    expect(wheelAt(T0 + 10_000).status).toBe("boarding");
    expect(wheelAt(T0 + 19_000).status).toBe("gate");
    expect(wheelAt(T0 + 26_000).status).toBe("riding");
    expect(wheelAt(T0 + 26_000).omega).toBeGreaterThan(0.05);
    expect(wheelAt(T0 + WHEEL_STEP_MS + 100).angle).toBeCloseTo(WHEEL_STEP, 6);
    expect(wheelAt(T0 + WHEEL_STEP_MS * WHEEL_N + 100).angle % (Math.PI * 2)).toBeCloseTo(0, 6);
  });
  it("turns smoothly (the angle never jumps)", () => {
    let prev = wheelAt(T0).angle;
    for (let t = T0; t < T0 + WHEEL_STEP_MS * 3; t += 50) {
      const a = wheelAt(t).angle;
      expect(a - prev).toBeGreaterThanOrEqual(-1e-9);
      expect(a - prev).toBeLessThan(0.02);
      prev = a;
    }
  });
  it("puts the bottom gondola at the lowest point, and it is back after a revolution", () => {
    for (let c = 0; c < 12; c++) {
      const g = wheelBottomGondola(c);
      const st = wheelAt(T0 + c * WHEEL_STEP_MS + 5000);
      const p = wheelPivot(g, st.angle);
      expect(p.y).toBeCloseTo(WHEEL_HUB_Y - WHEEL_R, 6);
      expect(p.x).toBeCloseTo(WHEEL_SITE.x, 6);
      expect(wheelBottomGondola(c + WHEEL_N)).toBe(g);
    }
  });
  it("offers only the bottom gondola's four seats, and lets a rider off only there", () => {
    const seats = boardingSeatsOfWheel(T0 + 5000);
    expect(seats.length).toBe(4);
    expect(wheelSeatAtPlatform(seats[0]!, T0 + 5000)).toBe(true);
    expect(wheelSeatAtPlatform(seats[0]!, T0 + 26_000)).toBe(false);
    expect(wheelSeatAtPlatform((seats[0]! + 4) % WHEEL_SEATS, T0 + 5000)).toBe(false);
    expect(WHEEL_BOARD_END_MS).toBeLessThan(WHEEL_STEP_MS);
  });
  it("seats sit inside their gondola, facing east or west, and rise and fall with the wheel", () => {
    const low = wheelSeatPose(boardingSeatsOfWheel(T0 + 5000)[0]!, T0 + 5000);
    expect(low.y).toBeGreaterThan(0.9);
    expect(low.y).toBeLessThan(2.2);
    expect(Math.abs(low.fx)).toBe(1);
    const top = wheelSeatPose(boardingSeatsOfWheel(T0 + 5000)[0]!, T0 + 5000 + 5 * WHEEL_STEP_MS);
    expect(top.y).toBeGreaterThan(WHEEL_HUB_Y + WHEEL_R - 4);
  });
});
