import { describe, expect, it } from "vitest";
import { BUS_RAMP_MS, TRANSIT, TRANSIT_HOLDS, busMotionAt, busTripAt, clearCrosswalkMs, legSpeedAt, nextGreenAt, pedestrianSignalAt, routeDistanceAtAngle, routeLength, routePoseAt, routePoseAtDistance, signalAt, tripTimeline } from "./transit";
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
      // it pulls away gently (eased from rest: well under the cruise in the first second) and is at the cruise a ramp later
      if (h.releaseMs > h.arriveMs) {
        const moved = busTripAt(h.releaseMs + 1_000).progress * routeLength() - h.distance;
        expect(moved).toBeGreaterThan(0);
        expect(moved).toBeLessThan(speed * 1_000 * 0.1);
        const leg = tl.legs.find((l) => l.fromMs === h.releaseMs)!;
        expect(legSpeedAt(leg, h.releaseMs + BUS_RAMP_MS + 500)).toBeCloseTo(leg.speed, 12);
      }
    }
    expect(tl.endMs - hour).toBeGreaterThan(TRANSIT.lapMs);
    expect(tl.endMs).toBeLessThan(hour + TRANSIT.departureEveryMs - TRANSIT.boardingMs);
  });

  it("nextGreenAt is the same instant when green and the next cycle's start otherwise", () => {
    expect(nextGreenAt(5_000)).toBe(5_000);
    expect(nextGreenAt(30_000)).toBe(40_000);
  });

  it("never has the bus on a crosswalk when the pedestrians' walk begins (review r1)", () => {
    // nose on the stop line -> tail past the zebra: from rest it takes half a ramp longer than at speed
    const stripes = (TRANSIT.stopLineM + 2.35 + TRANSIT.busLengthM) / speed + BUS_RAMP_MS / 2;
    for (let off = 0; off < TRANSIT.signalCycleMs; off += 500) {
      const tl = tripTimeline(hour + off);
      for (const h of tl.holds) {
        // a hold it drives through is crossed at the leg's cruise, no ramp
        const leg = tl.legs.find((l) => h.arriveMs >= l.fromMs && h.arriveMs <= l.toMs)!;
        const clearAt = h.releaseMs + (h.stops ? stripes : (TRANSIT.stopLineM + 2.35 + TRANSIT.busLengthM) / leg.speed);
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

  it("cruises a little slower (never stops under the green) on a leg where the green would be too short to clear the crosswalk", () => {
    const speed = routeLength() / TRANSIT.lapMs;
    for (let off = 0; off < TRANSIT.signalCycleMs; off += 500) {
      const tl = tripTimeline(hour + off);
      for (const leg of tl.legs) {
        expect(leg.speed).toBeLessThanOrEqual(speed + 1e-9);
        expect(leg.speed).toBeGreaterThan(speed * 0.6); // a gentle easing, not a crawl
      }
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

  it("turns at most 1 degree from one chord to the next, pulling in and out of the stop too (review r2: 16 and 19)", () => {
    const r = TRANSIT.route;
    for (let i = 1; i + 1 < r.length; i++) {
      const y1 = Math.atan2(r[i]!.x - r[i - 1]!.x, r[i]!.z - r[i - 1]!.z);
      const y2 = Math.atan2(r[i + 1]!.x - r[i]!.x, r[i + 1]!.z - r[i]!.z);
      let d = Math.abs(y2 - y1);
      if (d > Math.PI) d = Math.PI * 2 - d;
      expect(d * (180 / Math.PI)).toBeLessThanOrEqual(1.0001);
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

describe("fix/bus-smooth: the bus moves and turns without a step", () => {
  const hour = Date.UTC(2026, 10, 12, 3, 0, 0);
  const wrap = (d: number): number => {
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  };

  it("the route's heading is continuous: no jump between samples 0.25 m apart, and the ring is a true circle", () => {
    const len = routeLength();
    let prev = routePoseAtDistance(0);
    let worst = 0;
    for (let d = 0.25; d <= len; d += 0.25) {
      const p = routePoseAtDistance(d);
      worst = Math.max(worst, Math.abs(wrap(p.yaw - prev.yaw)));
      expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThanOrEqual(0.2501);
      prev = p;
    }
    // a 35 m circle turns 0.4 degrees per 0.25 m; the eased pull-out and pull-in a little more, nowhere a corner
    expect(worst * (180 / Math.PI)).toBeLessThan(1.5);
    // the lane's middle: every point of the ring part is at the lane radius
    for (let d = 15; d < len - 15; d += 1) {
      const p = routePoseAtDistance(d);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(35.3, 2);
      // clockwise tangent of the circle: the heading is (sin a, -cos a) with a the position's angle
      const a = Math.atan2(p.z, p.x);
      expect(Math.abs(wrap(p.yaw - Math.atan2(Math.sin(a), -Math.cos(a)))) * (180 / Math.PI)).toBeLessThan(0.3);
    }
  });

  it("starts and ends parked, heading north, with no turn at either end", () => {
    expect(routePoseAtDistance(0).yaw).toBe(Math.PI);
    expect(Math.abs(wrap(routePoseAtDistance(routeLength()).yaw - Math.PI))).toBeLessThan(1e-9);
    expect(Math.abs(wrap(routePoseAtDistance(0.3).yaw - Math.PI)) * (180 / Math.PI)).toBeLessThan(2);
  });

  it("the speed is continuous over the whole trip: eased out of the stop and the lights, flat at the cruise, no jump", () => {
    const cruise = routeLength() / TRANSIT.lapMs; // m/ms
    const dtMs = 100;
    // the biggest acceleration of a ramp is vp * pi / (2 T): the most the speed may change in one step
    const maxStep = ((cruise * 1000 * Math.PI) / (2 * (BUS_RAMP_MS / 1000))) * (dtMs / 1000);
    for (const off of [0, 7_000, 13_000, 21_000, 33_000]) {
      const start = hour + off;
      const tl = tripTimeline(start);
      let prevV = 0;
      let prev = routePoseAtDistance(0);
      let sawCruise = false;
      for (let t = start + dtMs; t <= tl.endMs + 2_000; t += dtMs) {
        const p = routePoseAtDistance(busMotionAt(t, start).distance); // the trip's own timeline, at any phase of the signals
        const v = (Math.hypot(p.x - prev.x, p.z - prev.z) / dtMs) * 1000; // m/s
        expect(Math.abs(v - prevV), `off ${off} t=${t - start}`).toBeLessThan(maxStep * 1.2 + 0.01);
        expect(v).toBeLessThanOrEqual(cruise * 1000 * 1.02);
        if (v > cruise * 1000 * 0.98) sawCruise = true;
        prevV = v;
        prev = p;
      }
      expect(sawCruise).toBe(true);
      expect(prevV).toBe(0); // parked at the end
    }
  });

  it("is at rest exactly at the start and the end of each leg and moving in between; a gap between legs is a wait at a red", () => {
    const tl = tripTimeline(hour);
    for (const leg of tl.legs) {
      expect(legSpeedAt(leg, leg.fromMs)).toBe(0);
      expect(legSpeedAt(leg, leg.toMs)).toBe(0);
      for (let k = 1; k < 20; k++) expect(legSpeedAt(leg, leg.fromMs + ((leg.toMs - leg.fromMs) * k) / 20)).toBeGreaterThan(0);
    }
    for (let i = 1; i < tl.legs.length; i++) {
      const gap = tl.legs[i]!.fromMs - tl.legs[i - 1]!.toMs;
      expect(gap).toBeGreaterThanOrEqual(0);
      const h = tl.holds.find((x) => x.stops && x.releaseMs === tl.legs[i]!.fromMs)!;
      expect(h.releaseMs - h.arriveMs).toBe(gap);
    }
    expect(busMotionAt(tl.endMs + 5_000, hour).speed).toBe(0);
  });

  it("eases to a halt before a stop line (the last ramp covers half a ramp's cruise) and at the end of the lap", () => {
    const tl = tripTimeline(hour);
    const first = tl.legs[0]!;
    const inLastRamp = first.toDistance - busMotionAt(first.toMs - BUS_RAMP_MS, hour).distance;
    expect(inLastRamp).toBeCloseTo((first.speed * BUS_RAMP_MS) / 2, 6);
    const last = tl.legs.at(-1)!;
    expect(last.toMs).toBe(tl.endMs);
    expect(last.toDistance).toBeCloseTo(routeLength(), 6);
  });

  it("does not slow down for a green it can drive through (such a hold has no stop)", () => {
    let throughs = 0;
    for (let off = 0; off < TRANSIT.signalCycleMs; off += 1_000) {
      const tl = tripTimeline(hour + off);
      for (const h of tl.holds) {
        if (h.stops) continue;
        throughs++;
        expect(h.arriveMs).toBe(h.releaseMs);
        expect(signalAt(h.arriveMs).color).toBe("green");
        expect(legSpeedAt(tl.legs.find((l) => h.arriveMs > l.fromMs && h.arriveMs < l.toMs)!, h.arriveMs)).toBeGreaterThan(0);
      }
    }
    expect(throughs).toBeGreaterThan(0);
  });

  it("clearCrosswalkMs counts the pull-away from rest", () => {
    const speed = routeLength() / TRANSIT.lapMs;
    expect(clearCrosswalkMs(speed)).toBeCloseTo((TRANSIT.stopLineM + 2.5 + TRANSIT.busLengthM) / speed + BUS_RAMP_MS / 2, 6);
  });
});
