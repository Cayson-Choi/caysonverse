import { describe, expect, it } from "vitest";
import { TRANSIT, TRANSIT_HOLDS, busTripAt, nextGreenAt, pedestrianSignalAt, routeDistanceAtAngle, routeLength, routePoseAt, signalAt, tripTimeline } from "./transit";
import { SIGNAL_CROSSINGS, crossingPoint } from "./crossings";
import { VILLAGE_LAYOUT } from "./villageLayout";

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
    const boarding = busTripAt(hour + TRANSIT.departureEveryMs - TRANSIT.boardingMs);
    expect(boarding.status).toBe("boarding");
    expect(boarding.startMs).toBe(hour + TRANSIT.departureEveryMs);
    expect(boarding.nextStartMs).toBe(hour + TRANSIT.departureEveryMs * 2);
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
      // on its way again (at the lap's speed, or a little slower on a leg where it eases off for the next light)
      const moved = busTripAt(h.releaseMs + 1_000).progress * routeLength() - h.distance;
      expect(moved).toBeGreaterThan(speed * 1_000 * 0.8);
      expect(moved).toBeLessThanOrEqual(speed * 1_000 + 1e-6);
    }
    expect(tl.endMs - hour).toBeGreaterThan(TRANSIT.lapMs);
    expect(tl.endMs).toBeLessThan(hour + TRANSIT.departureEveryMs - TRANSIT.boardingMs);
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
    const b = tripTimeline(hour + 7 * TRANSIT.departureEveryMs);
    expect(b.endMs - (hour + 7 * TRANSIT.departureEveryMs)).toBe(a.endMs - hour);
  });
});

describe("review r2: the bus never stands under a green, on a crosswalk, or turns on the spot", () => {
  const hour = Date.UTC(2026, 10, 12, 3, 0, 0);

  it("never waits at a stop line while its light is green, at any departure phase", () => {
    for (let off = 0; off < TRANSIT.signalCycleMs; off += 1_000) {
      const tl = tripTimeline(hour + off);
      for (const h of tl.holds) {
        if (h.releaseMs > h.arriveMs) expect(signalAt(h.arriveMs).color).not.toBe("green");
        for (let t = h.arriveMs + 100; t < h.releaseMs; t += 500) expect(signalAt(t).color).not.toBe("green");
      }
    }
  });

  it("eases off (never stops) on a leg where the green would be too short to clear the crosswalk", () => {
    const tl = tripTimeline(hour);
    const speed = routeLength() / TRANSIT.lapMs;
    for (const h of tl.holds) {
      const legSpeed = (h.distance - h.fromDistance) / (h.arriveMs - h.fromMs);
      expect(legSpeed).toBeLessThanOrEqual(speed + 1e-9);
      expect(legSpeed).toBeGreaterThan(speed * 0.85); // a gentle easing, not a crawl
    }
  });

  it("no crosswalk lies under the bus while it waits at a stop line (review r2 blocker: the school lane's zebra)", () => {
    const len = routeLength();
    // every lane's crossing of the ring (where make_textures.py paints a zebra, but for lane_plot_e: XW_SKIP)
    const zebras = VILLAGE_LAYOUT.lanes
      .filter((l) => l.id !== "lane_plot_e")
      .map((l) => {
        const [a, b] = [l.points[0]!, l.points[1]!];
        const dx = b.x - a.x, dz = b.z - a.z;
        const A = dx * dx + dz * dz, B = 2 * (a.x * dx + a.z * dz), C = a.x * a.x + a.z * a.z - 34 * 34;
        const t = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
        return { id: l.id, x: a.x + t * dx, z: a.z + t * dz };
      });
    for (const h of TRANSIT_HOLDS) {
      const p = routePoseAt(h.distance / len);
      const f = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
      for (const c of zebras) {
        const along = (c.x - p.x) * f.x + (c.z - p.z) * f.z;
        const side = Math.abs((c.x - p.x) * f.z - (c.z - p.z) * f.x);
        if (side > 4) continue;
        // the bus is +-4.5 m along, the zebra +-2 m: at least 0.5 m clear
        expect(Math.abs(along), `${h.id} hold vs ${c.id}`).toBeGreaterThanOrEqual(4.5 + 2 + 0.5);
      }
    }
  });

  it("the waiting bus's nose is on its stop line, short of its own crossing", () => {
    const len = routeLength();
    for (const c of SIGNAL_CROSSINGS) {
      const h = TRANSIT_HOLDS.find((x) => x.id === c.id)!;
      expect(routeDistanceAtAngle(c.angle) - h.distance).toBeCloseTo(TRANSIT.stopLineM + TRANSIT.busLengthM / 2, 6);
      const p = routePoseAt(h.distance / len);
      const centre = crossingPoint(c, 0, 0);
      expect(Math.hypot(centre.x - p.x, centre.z - p.z)).toBeGreaterThan(TRANSIT.stopLineM + TRANSIT.busLengthM / 2 - 1.5);
    }
  });

  it("turns at most 5 degrees from one chord to the next, pulling in and out of the stop too (review r2: 16 and 19)", () => {
    const r = TRANSIT.route;
    for (let i = 1; i + 1 < r.length; i++) {
      const y1 = Math.atan2(r[i]!.x - r[i - 1]!.x, r[i]!.z - r[i - 1]!.z);
      const y2 = Math.atan2(r[i + 1]!.x - r[i]!.x, r[i + 1]!.z - r[i]!.z);
      let d = Math.abs(y2 - y1);
      if (d > Math.PI) d = Math.PI * 2 - d;
      expect(d * (180 / Math.PI)).toBeLessThanOrEqual(5.0001);
    }
    // the last chord arrives heading north, as the bus is parked; the first leaves heading north
    const last = Math.atan2(r[r.length - 1]!.x - r[r.length - 2]!.x, r[r.length - 1]!.z - r[r.length - 2]!.z);
    const first = Math.atan2(r[1]!.x - r[0]!.x, r[1]!.z - r[0]!.z);
    for (const y of [last, first]) expect(Math.abs(Math.abs(y) - Math.PI) * (180 / Math.PI)).toBeLessThan(3);
    const end = tripTimeline(hour).endMs;
    expect(Math.abs(Math.abs(busTripAt(end - 300).pose.yaw) - Math.PI) * (180 / Math.PI)).toBeLessThan(3);
    expect(busTripAt(end + 1).pose.yaw).toBe(Math.PI);
  });
});
