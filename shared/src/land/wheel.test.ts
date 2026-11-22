import { describe, expect, it } from "vitest";
import {
  WHEEL_BOARD_HALF_MS,
  WHEEL_BOARD_REACH_M,
  WHEEL_BOTTOM_SPEED,
  WHEEL_HUB_Y,
  WHEEL_N,
  WHEEL_OMEGA,
  WHEEL_R,
  WHEEL_REV_MS,
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
  wheelSway,
} from "./wheel";

const T0 = 1_900_000_000_000 - (1_900_000_000_000 % WHEEL_REV_MS);

describe("sky lantern wheel (it never stops)", () => {
  it("has 32 seats, a step of 45 degrees and one revolution in 2.5 minutes", () => {
    expect(WHEEL_SEATS).toBe(32);
    expect(WHEEL_STEP).toBeCloseTo(Math.PI / 4, 9);
    expect(WHEEL_REV_MS).toBe(150_000);
    expect(WHEEL_STEP_MS).toBe(18_750);
    expect(WHEEL_BOTTOM_SPEED).toBeGreaterThan(0.8);
    expect(WHEEL_BOTTOM_SPEED).toBeLessThan(1.0);
  });
  it("turns at a constant speed, always: the angle grows evenly and the speed never drops", () => {
    let prev = wheelAt(T0).angle;
    for (let t = T0 + 100; t < T0 + WHEEL_REV_MS + 5000; t += 100) {
      const s = wheelAt(t);
      expect(s.angle - prev).toBeCloseTo(WHEEL_OMEGA * 0.1, 6);
      expect(s.omega).toBeCloseTo(WHEEL_OMEGA, 12);
      expect(s.alpha).toBe(0);
      prev = s.angle;
    }
    expect(wheelAt(T0 + WHEEL_REV_MS).angle - wheelAt(T0).angle).toBeCloseTo(Math.PI * 2, 6);
  });
  it("opens the station for 6.5 s every 18.75 s, centred on the gondola's pass", () => {
    expect(2 * WHEEL_BOARD_HALF_MS).toBeGreaterThan(6000);
    expect(2 * WHEEL_BOARD_HALF_MS).toBeLessThan(7000);
    let open = 0;
    let transitions = 0;
    let last = wheelAt(T0).status;
    for (let t = T0; t < T0 + WHEEL_REV_MS; t += 50) {
      const s = wheelAt(t);
      if (s.status === "boarding") open += 50;
      if (s.status !== last) transitions++;
      last = s.status;
    }
    expect(open / WHEEL_N).toBeCloseTo(2 * WHEEL_BOARD_HALF_MS, -2);
    expect(transitions).toBeGreaterThanOrEqual(2 * WHEEL_N - 1);
    // at the centre of pass k the bottom gondola's pivot is at the platform's middle; at the window's edge it is WHEEL_BOARD_REACH_M off
    for (let k = 0; k < 12; k++) {
      const g = wheelBottomGondola(k);
      const centre = T0 + k * WHEEL_STEP_MS;
      expect(wheelAt(centre).status).toBe("boarding");
      expect(wheelPivot(g, wheelAt(centre).angle).x).toBeCloseTo(WHEEL_SITE.x, 6);
      expect(wheelPivot(g, wheelAt(centre).angle).y).toBeCloseTo(WHEEL_HUB_Y - WHEEL_R, 6);
      const edge = wheelAt(centre - WHEEL_BOARD_HALF_MS + 1);
      expect(Math.abs(wheelPivot(g, edge.angle).x - WHEEL_SITE.x)).toBeCloseTo(WHEEL_BOARD_REACH_M, 1);
      expect(wheelAt(centre + WHEEL_BOARD_HALF_MS + 5).status).toBe("riding");
      expect(wheelAt(centre - WHEEL_BOARD_HALF_MS - 5).status).toBe("riding");
      expect(wheelBottomGondola(k + WHEEL_N)).toBe(g);
    }
  });
  it("offers only the gondola at the platform's four seats, and lets a rider off only there (when its window opens)", () => {
    const centre = T0 + 3 * WHEEL_STEP_MS;
    const seats = boardingSeatsOfWheel(centre);
    expect(seats.length).toBe(4);
    expect(wheelSeatAtPlatform(seats[0]!, centre)).toBe(true);
    expect(wheelSeatAtPlatform(seats[0]!, centre + 8000)).toBe(false);
    expect(wheelSeatAtPlatform((seats[0]! + 4) % WHEEL_SEATS, centre)).toBe(false);
    // the cycle that puts a rider off (one revolution after boarding) begins exactly when the same gondola's window opens
    const boarded = wheelAt(centre).cycle;
    const off = wheelAt(centre + WHEEL_REV_MS - WHEEL_BOARD_HALF_MS + 1);
    expect(off.cycle).toBe(boarded + WHEEL_N);
    expect(wheelSeatAtPlatform(seats[0]!, centre + WHEEL_REV_MS - WHEEL_BOARD_HALF_MS + 1)).toBe(true);
  });
  it("hangs level: no swing at any moment", () => {
    for (let t = T0; t < T0 + WHEEL_REV_MS; t += 777) {
      const s = wheelAt(t);
      for (let g = 0; g < WHEEL_N; g++) expect(wheelSway(g, s)).toBe(0);
      expect(wheelSeatPose(Math.floor(t / 1000) % 32, t).sway).toBe(0);
    }
  });
  it("seats sit inside their gondola, facing south, and rise and fall with the wheel", () => {
    const at = T0 + 3 * WHEEL_STEP_MS;
    const low = wheelSeatPose(boardingSeatsOfWheel(at)[0]!, at);
    expect(low.y).toBeGreaterThan(0.9);
    expect(low.y).toBeLessThan(2.2);
    expect(low.fz).toBe(1);
    expect(low.z).toBeGreaterThan(WHEEL_SITE.z + 2);
    const top = wheelSeatPose(boardingSeatsOfWheel(at)[0]!, at + WHEEL_REV_MS / 2);
    expect(top.y).toBeGreaterThan(WHEEL_HUB_Y + WHEEL_R - 4);
  });
});

