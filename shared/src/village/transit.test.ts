import { describe, expect, it } from "vitest";
import { TRANSIT, TRANSIT_HOLDS, busTripAt, nextGreenAt, pedestrianSignalAt, routeLength, routePoseAt, signalAt, tripTimeline } from "./transit";

describe("village transit schedule", () => {
  it("starts a new trip at each exact hour and completes one lap at the stop", () => {
    const hour = Date.UTC(2026, 10, 12, 3, 0, 0);
    const start = busTripAt(hour);
    expect(start.status).toBe("inTransit");
    expect(start.progress).toBe(0);
    expect(start.pose.x).toBeCloseTo(TRANSIT.stop.x, 6);
    expect(start.pose.z).toBeCloseTo(TRANSIT.stop.z, 6);

    const returned = busTripAt(tripTimeline(hour).endMs);
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
    expect(middle.x).toBeGreaterThanOrEqual(-34.7);
    expect(middle.x).toBeLessThanOrEqual(34.7);
    expect(middle.z).toBeGreaterThanOrEqual(-34.7);
    expect(middle.z).toBeLessThanOrEqual(34.7);
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

  it("walks pedestrians only while the vehicles are red", () => {
    const seen = new Set<string>();
    for (let t = 0; t < TRANSIT.signalCycleMs; t += 100) {
      const v = signalAt(t).color;
      const p = pedestrianSignalAt(t).color;
      seen.add(`${v}/${p}`);
      if (p === "walk" || p === "flashing") expect(v).toBe("red");
    }
    expect([...seen].sort()).toEqual(["amber/stop", "green/stop", "red/flashing", "red/stop", "red/walk"]);
    expect(pedestrianSignalAt(TRANSIT.pedestrianStartMs).color).toBe("walk");
    expect(pedestrianSignalAt(TRANSIT.pedestrianStartMs + TRANSIT.pedestrianWalkMs).color).toBe("flashing");
    expect(pedestrianSignalAt(TRANSIT.pedestrianStartMs + TRANSIT.pedestrianWalkMs + TRANSIT.pedestrianFlashingMs).color).toBe("stop");
    expect(pedestrianSignalAt(0).remainingMs).toBe(TRANSIT.pedestrianStartMs);
  });
});

describe("the bus at the crosswalks' signals", () => {
  const hour = Date.UTC(2026, 10, 12, 3, 0, 0);
  const speed = routeLength() / TRANSIT.lapMs;

  it("has a stop line before each of the two signalised crossings", () => {
    expect(TRANSIT_HOLDS.map((h) => h.id)).toEqual(["north", "bus"]);
    for (const h of TRANSIT_HOLDS) expect(h.distance).toBeGreaterThan(0);
  });

  it("waits at a red signal and goes on at green, never crossing against the signal", () => {
    const tl = tripTimeline(hour);
    expect(tl.holds.some((h) => h.releaseMs > h.arriveMs)).toBe(true); // at least one real wait per lap
    for (const h of tl.holds) {
      expect(signalAt(h.releaseMs).color).toBe("green");
      if (h.releaseMs > h.arriveMs) {
        const mid = busTripAt((h.arriveMs + h.releaseMs) / 2);
        expect(mid.waiting).toBe(true);
        expect(mid.progress * routeLength()).toBeCloseTo(h.distance, 6);
        expect(signalAt((h.arriveMs + h.releaseMs) / 2).canBusProceed).toBe(false);
      }
      expect(busTripAt(h.releaseMs + 1_000).waiting).toBe(false);
      expect(busTripAt(h.releaseMs + 1_000).progress * routeLength()).toBeCloseTo(h.distance + speed * 1_000, 6);
    }
    expect(tl.endMs - hour).toBeGreaterThan(TRANSIT.lapMs);
    expect(tl.endMs).toBeLessThan(hour + TRANSIT.hourMs - TRANSIT.boardingMs);
  });

  it("nextGreenAt is the same instant when green and the next cycle's start otherwise", () => {
    expect(nextGreenAt(5_000)).toBe(5_000);
    expect(nextGreenAt(30_000)).toBe(40_000);
  });

  it("never has the bus on a crosswalk when the pedestrians' walk begins (review r1)", () => {
    const stripes = (TRANSIT.stopLineM + 2.35 + TRANSIT.busLengthM) / speed; // nose on the stop line -> tail past the zebra
    for (let off = 0; off < TRANSIT.signalCycleMs; off += 500) {
      const tl = tripTimeline(hour + off);
      for (const h of tl.holds) {
        const clearAt = h.releaseMs + stripes;
        // vehicles are still green when the bus's tail leaves the crosswalk
        expect(signalAt(clearAt - 1).color).toBe("green");
        // and no walk phase (24-34 s) starts while it is on the zebra
        for (let t = h.releaseMs; t < clearAt; t += 250) expect(pedestrianSignalAt(t).canCross).toBe(false);
      }
    }
  });

  it("runs the same trip every hour", () => {
    const a = tripTimeline(hour);
    const b = tripTimeline(hour + 7 * TRANSIT.hourMs);
    expect(b.endMs - (hour + 7 * TRANSIT.hourMs)).toBe(a.endMs - hour);
  });
});
