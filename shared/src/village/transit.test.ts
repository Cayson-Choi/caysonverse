import { describe, expect, it } from "vitest";
import { TRANSIT, busTripAt, routePoseAt, signalAt } from "./transit";

describe("village transit schedule", () => {
  it("starts a new trip at each exact hour and completes one lap at the stop", () => {
    const hour = Date.UTC(2026, 10, 12, 3, 0, 0);
    const start = busTripAt(hour);
    expect(start.status).toBe("inTransit");
    expect(start.progress).toBe(0);
    expect(start.pose.x).toBeCloseTo(TRANSIT.stop.x, 6);
    expect(start.pose.z).toBeCloseTo(TRANSIT.stop.z, 6);

    const returned = busTripAt(hour + TRANSIT.lapMs);
    expect(returned.status).toBe("atStop");
    expect(returned.progress).toBe(1);
    expect(returned.pose.x).toBeCloseTo(TRANSIT.stop.x, 6);
    expect(returned.pose.z).toBeCloseTo(TRANSIT.stop.z, 6);
  });

  it("opens boarding before the next exact-hour departure", () => {
    const hour = Date.UTC(2026, 10, 12, 3, 0, 0);
    const boarding = busTripAt(hour + TRANSIT.hourMs - TRANSIT.boardingMs);
    expect(boarding.status).toBe("boarding");
    expect(boarding.startMs).toBe(hour + TRANSIT.hourMs);
    expect(boarding.nextStartMs).toBe(hour + TRANSIT.hourMs * 2);
  });

  it("interpolates route position and heading without leaving the route bounds", () => {
    const first = routePoseAt(0);
    const middle = routePoseAt(0.5);
    const last = routePoseAt(1);
    expect(first.x).toBeCloseTo(last.x, 6);
    expect(first.z).toBeCloseTo(last.z, 6);
    expect(Number.isFinite(middle.yaw)).toBe(true);
    expect(middle.x).toBeGreaterThanOrEqual(-34.1);
    expect(middle.x).toBeLessThanOrEqual(34.3);
    expect(middle.z).toBeGreaterThanOrEqual(-34.1);
    expect(middle.z).toBeLessThanOrEqual(34.1);
  });
});

describe("traffic signals", () => {
  it("allows the bus only during the green phase", () => {
    expect(signalAt(0).color).toBe("green");
    expect(signalAt(0).canBusProceed).toBe(true);
    expect(signalAt(TRANSIT.signalGreenMs).color).toBe("amber");
    expect(signalAt(TRANSIT.signalGreenMs).canBusProceed).toBe(false);
    expect(signalAt(TRANSIT.signalGreenMs + TRANSIT.signalAmberMs).color).toBe("red");
    expect(signalAt(TRANSIT.signalGreenMs + TRANSIT.signalAmberMs).canBusProceed).toBe(false);
  });

  it("supports a deterministic phase offset for another crossing", () => {
    expect(signalAt(0, TRANSIT.signalCycleMs - 1).color).toBe("red");
    expect(signalAt(TRANSIT.signalCycleMs, TRANSIT.signalCycleMs).color).toBe("green");
  });
});
