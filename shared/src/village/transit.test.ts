import { describe, expect, it } from "vitest";
import { BUS_LANE_RADIUS, BUS_RAMP_MS, TRANSIT, busFootprint, boardingOpensWords, TRANSIT_HOLDS, busMotionAt, busTripAt, clearCrosswalkMs, legSpeedAt, nextGreenAt, pedestrianSignalAt, routeDistanceAtAngle, routeLength, routePoseAt, routePoseAtDistance, signalAt, tripTimeline } from "./transit";
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
    expect(Math.hypot(middle.x, middle.z)).toBeCloseTo(BUS_LANE_RADIUS, 2);
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

describe("signal phases: pedestrians go only while the vehicles are red, with all-red clearance (A4)", () => {
  const STEP = 50;
  const offsets = [0, 7_000, 13_500, 29_000, TRANSIT.signalCycleMs - 1];

  it("never shows a vehicle green (or amber) together with a pedestrian walk/flashing, at every 50 ms of a cycle and any offset", () => {
    for (const off of offsets) {
      for (let t = 0; t < TRANSIT.signalCycleMs * 2; t += STEP) {
        const v = signalAt(t, off);
        const p = pedestrianSignalAt(t, off);
        if (v.color !== "red") expect(p.color).toBe("stop");
        if (p.color !== "stop") expect(v.color).toBe("red");
        expect(v.canBusProceed && p.canCross).toBe(false);
      }
    }
  });

  it("has an all-red clearance of at least 2 s after the amber and before the next green", () => {
    const clear = TRANSIT.signalAllRedMs;
    // amber ends -> walk starts
    expect(TRANSIT.pedestrianStartMs - (TRANSIT.signalGreenMs + TRANSIT.signalAmberMs)).toBeGreaterThanOrEqual(clear);
    // flashing ends -> green starts
    const pedEnd = TRANSIT.pedestrianStartMs + TRANSIT.pedestrianWalkMs + TRANSIT.pedestrianFlashingMs;
    expect(TRANSIT.signalCycleMs - pedEnd).toBeGreaterThanOrEqual(clear);
    for (let t = 0; t < TRANSIT.signalCycleMs; t += STEP) {
      const v = signalAt(t).color;
      const p = pedestrianSignalAt(t).color;
      if (t >= TRANSIT.signalGreenMs + TRANSIT.signalAmberMs && t < TRANSIT.pedestrianStartMs) expect(`${v}/${p}`).toBe("red/stop");
      if (t >= pedEnd) expect(`${v}/${p}`).toBe("red/stop");
    }
  });

  it("runs the sequence green, amber, all-red, walk, flashing, all-red in order with the timing table", () => {
    const seq: string[] = [];
    for (let t = 0; t < TRANSIT.signalCycleMs; t += STEP) {
      const k = `${signalAt(t).color}/${pedestrianSignalAt(t).color}`;
      if (seq[seq.length - 1] !== k) seq.push(k);
    }
    expect(seq).toEqual(["green/stop", "amber/stop", "red/stop", "red/walk", "red/flashing", "red/stop"]);
    expect(signalAt(25_999).color).toBe("green");
    expect(signalAt(26_000).color).toBe("amber");
    expect(signalAt(29_000).color).toBe("red");
    expect(pedestrianSignalAt(30_999).color).toBe("stop");
    expect(pedestrianSignalAt(31_000).color).toBe("walk");
    expect(pedestrianSignalAt(43_000).color).toBe("flashing");
    expect(pedestrianSignalAt(47_999).color).toBe("flashing");
    expect(pedestrianSignalAt(48_000).color).toBe("stop");
    expect(signalAt(49_999).color).toBe("red");
    expect(signalAt(50_000).color).toBe("green");
    expect(TRANSIT.departureEveryMs % TRANSIT.signalCycleMs).toBe(0);
  });

  it("keeps the bus off the crosswalk whenever the pedestrians may walk or are flashing, at every departure phase and crossing", () => {
    const hour = Date.UTC(2026, 10, 12, 3, 0, 0);
    const speed = routeLength() / TRANSIT.lapMs;
    for (let off = 0; off < TRANSIT.signalCycleMs; off += 500) {
      const tl = tripTimeline(hour + off);
      for (const g of TRANSIT_HOLDS) {
        for (let t = hour + off; t < tl.endMs; t += 250) {
          const { distance } = busMotionAt(t, hour + off);
          // the bus's body overlaps the zebra (2.5 m half-depth) when its centre is within half a bus + the zebra of the crossing
          const crosswalkAt = g.distance + TRANSIT.busLengthM / 2 + TRANSIT.stopLineM;
          const onZebra = Math.abs(distance - crosswalkAt) < TRANSIT.busLengthM / 2 + 2.35 - 0.01;
          if (onZebra) expect(pedestrianSignalAt(t, g.offsetMs).color).toBe("stop");
        }
      }
      expect(speed).toBeGreaterThan(0);
    }
  });
});

describe("the bus at the crosswalks' signals", () => {
  const hour = Date.UTC(2026, 10, 12, 3, 0, 0);
  const speed = routeLength() / TRANSIT.lapMs;

  it("has a stop line before each of the two signalised crossings", () => {
    expect(TRANSIT_HOLDS.map((h) => h.id)).toEqual(["north", "bus"]);
    for (const h of TRANSIT_HOLDS) expect(h.distance).toBeGreaterThan(0);
  });

  it("waits at a red signal and goes on at green, never crossing against the signal (at every phase of the departure)", () => {
    let waits = 0;
    for (let off = 0; off < TRANSIT.signalCycleMs; off += 1_000) {
      const start = hour + off;
      const tl = tripTimeline(start);
      for (const h of tl.holds) {
        expect(signalAt(h.releaseMs).color).toBe("green");
        if (h.releaseMs <= h.arriveMs) continue;
        waits++;
        const mid = busMotionAt((h.arriveMs + h.releaseMs) / 2, start);
        expect(mid.waiting).toBe(true);
        expect(mid.distance).toBeCloseTo(h.distance, 6);
        expect(signalAt((h.arriveMs + h.releaseMs) / 2).canBusProceed).toBe(false);
        expect(busMotionAt(h.releaseMs + 1_000, start).waiting).toBe(false);
        // it pulls away gently (eased from rest: well under the cruise in the first second) and is at the cruise a ramp later
        const moved = busMotionAt(h.releaseMs + 1_000, start).distance - h.distance;
        expect(moved).toBeGreaterThan(0);
        expect(moved).toBeLessThan(speed * 1_000 * 0.1);
        const leg = tl.legs.find((l) => l.fromMs === h.releaseMs)!;
        // at the cruise half a second after its pull-away ramp, unless the leg is too short to hold it that long
        if (leg.toDistance - leg.fromDistance >= leg.speed * (BUS_RAMP_MS + 500)) expect(legSpeedAt(leg, h.releaseMs + BUS_RAMP_MS + 500)).toBeCloseTo(leg.speed, 12);
      }
      expect(tl.endMs - start).toBeGreaterThan(TRANSIT.lapMs);
    }
    expect(waits).toBeGreaterThan(0); // red lights are met at some departures
  });

  it("a lap, signal waits and ramps included, ends well before the next boarding", () => {
    // the worst case: a wait of nearly a whole signal cycle at each of the two holds, plus the ramps
    const worst = TRANSIT.lapMs + 2 * TRANSIT.signalCycleMs + 3 * BUS_RAMP_MS;
    for (let off = 0; off < TRANSIT.signalCycleMs; off += 500) {
      const start = hour + off;
      expect(tripTimeline(start).endMs - start).toBeLessThanOrEqual(worst);
    }
    expect(worst).toBeLessThan((TRANSIT.departureEveryMs - TRANSIT.boardingMs) / 2);
  });

  it("boarding opens 3 min before each departure, with the bus already parked at the stop for all of it (owner 2026-11-15)", () => {
    expect(TRANSIT.boardingMs).toBe(3 * 60 * 1000);
    expect(TRANSIT.departureEveryMs).toBe(10 * 60 * 1000);
    expect(boardingOpensWords()).toBe("3분");
    expect(boardingOpensWords(30_000)).toBe("30초");
    expect(boardingOpensWords(90_000)).toBe("1분 30초");
    // every departure over a whole signal-phase sweep (each lap meets the red lights differently)
    for (let k = 0; k < 40; k++) {
      const start = hour + k * TRANSIT.departureEveryMs;
      const next = start + TRANSIT.departureEveryMs;
      const opens = next - TRANSIT.boardingMs;
      // the lap is over (the bus parked) well before boarding opens
      expect(tripTimeline(start).endMs).toBeLessThan(opens - 60_000);
      for (let t = opens; t < next; t += 5_000) {
        const trip = busTripAt(t);
        expect(trip.status).toBe("boarding");
        expect(trip.tripId).toBe(next);
        expect(trip.pose).toEqual(busTripAt(opens).pose); // parked, still
        expect(trip.progress).toBe(0);
      }
      expect(busTripAt(opens - 1).status).toBe("atStop");
      expect(busTripAt(next).status).toBe("inTransit"); // it leaves on the minute: still every 10 minutes
    }
  });

  it("nextGreenAt is the same instant when green and the next cycle's start otherwise", () => {
    expect(nextGreenAt(5_000)).toBe(5_000);
    expect(nextGreenAt(30_000)).toBe(TRANSIT.signalCycleMs);
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
        // and no walk phase (31-43 s) starts while it is on the zebra
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
    // the last chord arrives heading the way the bus is parked (along the lane), the first leaves that way
    const last = Math.atan2(r[r.length - 1]!.x - r[r.length - 2]!.x, r[r.length - 1]!.z - r[r.length - 2]!.z);
    const first = Math.atan2(r[1]!.x - r[0]!.x, r[1]!.z - r[0]!.z);
    const off = (y: number) => Math.abs(Math.atan2(Math.sin(y - TRANSIT.parked.yaw), Math.cos(y - TRANSIT.parked.yaw))) * (180 / Math.PI);
    for (const y of [last, first]) expect(off(y)).toBeLessThan(0.3);
    const end = tripTimeline(hour).endMs;
    expect(off(busTripAt(end - 300).pose.yaw)).toBeLessThan(0.3);
    expect(busTripAt(end + 1).pose.yaw).toBe(TRANSIT.parked.yaw);
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
    // a 35 m circle turns 0.4 degrees per 0.25 m, nowhere a corner (the stop is on the circle: no pull-in swing)
    expect(worst * (180 / Math.PI)).toBeLessThan(0.5);
    // the bus's lane: every point of the lap, the stop included, is at the lane radius
    for (let d = 0; d <= len; d += 1) {
      const p = routePoseAtDistance(d);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(BUS_LANE_RADIUS, 2);
      // clockwise tangent of the circle: the heading is (sin a, -cos a) with a the position's angle
      const a = Math.atan2(p.z, p.x);
      expect(Math.abs(wrap(p.yaw - Math.atan2(Math.sin(a), -Math.cos(a)))) * (180 / Math.PI)).toBeLessThan(0.3);
    }
  });

  it("starts and ends parked, heading along the lane, with no turn at either end", () => {
    expect(routePoseAtDistance(0).yaw).toBe(TRANSIT.parked.yaw);
    expect(Math.abs(wrap(routePoseAtDistance(routeLength()).yaw - TRANSIT.parked.yaw))).toBeLessThan(1e-9);
    expect(Math.abs(wrap(routePoseAtDistance(0.3).yaw - TRANSIT.parked.yaw)) * (180 / Math.PI)).toBeLessThan(0.6);
    expect(Math.abs(wrap(routePoseAtDistance(routeLength() - 0.3).yaw - TRANSIT.parked.yaw)) * (180 / Math.PI)).toBeLessThan(0.6);
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

describe("owner 2026-11-15: the bus stands and runs inside its own lane (to the road's width, not over the centre line)", () => {
  /** The road: R 31..37, its yellow centre line R 34 +- 0.075 (make_textures.py), the outer kerb's face at R 37. */
  const CENTRE_LINE = 34;
  const PAINT_HALF = 0.075;
  const KERB = 37;
  /** Distance from the plaza's centre to a segment (the nearest point of a straight side of the bus). */
  const segDist = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, -(a.x * dx + a.z * dz) / (dx * dx + dz * dz)));
    return Math.hypot(a.x + t * dx, a.z + t * dz);
  };
  /** The bus's nearest reach to the plaza's centre (its inner, left side) and its farthest (a door-side corner). */
  const reach = (pose: { x: number; z: number; yaw: number }) => {
    const [fl, fr, rr, rl] = busFootprint(pose);
    return {
      inner: Math.min(segDist(fl!, rl!), segDist(fl!, fr!), segDist(rr!, rl!)),
      outer: Math.max(...[fl!, fr!, rr!, rl!].map((p) => Math.hypot(p.x, p.z))),
      doorMid: Math.hypot((fr!.x + rr!.x) / 2, (fr!.z + rr!.z) / 2),
    };
  };

  it("parked: wholly in the stop-side lane, clear of the centre line's paint, parallel to the kerb about 0.35 m off it", () => {
    const p = TRANSIT.parked;
    const r = reach(p);
    expect(r.inner).toBeGreaterThanOrEqual(CENTRE_LINE + PAINT_HALF);
    expect(r.outer).toBeLessThanOrEqual(KERB - 0.05);
    expect(KERB - r.doorMid).toBeGreaterThanOrEqual(0.25);
    expect(KERB - r.doorMid).toBeLessThanOrEqual(0.45);
    // parallel to the kerb: the heading is the circle's tangent at the bus's centre
    const a = Math.atan2(p.z, p.x);
    const tangent = Math.atan2(Math.sin(a), -Math.cos(a));
    expect(Math.abs(Math.atan2(Math.sin(p.yaw - tangent), Math.cos(p.yaw - tangent)))).toBeLessThan(1e-9);
    expect(Math.hypot(p.x - TRANSIT.stop.x, p.z - TRANSIT.stop.z)).toBe(0);
  });

  it("parked: its tail 1 m short of the bus crossing's zebra (4 m along the road), its nose clear of every crossing", () => {
    for (const c of SIGNAL_CROSSINGS) {
      // signed distance along the road from the crossing's centre line, toward the bus's side (angle decreasing)
      const along = (q: { x: number; z: number }) => q.x * Math.sin(c.angle) - q.z * Math.cos(c.angle);
      const corners = busFootprint(TRANSIT.parked);
      const near = Math.min(...corners.map((q) => Math.abs(along(q))));
      const side = Math.sign(along(corners[0]!));
      expect(corners.every((q) => Math.sign(along(q)) === side), c.id).toBe(true);
      expect(near - 2, c.id).toBeGreaterThanOrEqual(c.id === "bus" ? 1 : 10);
    }
  });

  it("along the whole lap, the approach and the pull-away included, the bus never crosses the centre line nor touches the kerb", () => {
    const len = routeLength();
    for (let d = 0; d <= len; d += 0.25) {
      const r = reach(routePoseAtDistance(d));
      expect(r.inner, `at ${d.toFixed(2)} m`).toBeGreaterThanOrEqual(CENTRE_LINE + PAINT_HALF);
      expect(r.outer, `at ${d.toFixed(2)} m`).toBeLessThanOrEqual(KERB - 0.05);
    }
    // and the trip's own poses as it rolls in to the stop and pulls away (the timeline's last and first seconds)
    const hour = Date.UTC(2026, 10, 12, 3, 0, 0);
    const end = tripTimeline(hour).endMs;
    for (let t = -8000; t <= 8000; t += 100) {
      const pose = busTripAt(t < 0 ? end + t : hour + t).pose;
      const r = reach(pose);
      expect(r.inner).toBeGreaterThanOrEqual(CENTRE_LINE + PAINT_HALF);
      expect(r.outer).toBeLessThanOrEqual(KERB - 0.05);
    }
  });

  it("rolls into the parked pose with no snap: the last moving pose meets it in place and heading", () => {
    const hour = Date.UTC(2026, 10, 12, 3, 0, 0);
    const end = tripTimeline(hour).endMs;
    const a = busTripAt(end - 1).pose;
    const b = busTripAt(end + 1).pose;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.001);
    expect(Math.abs(Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw)))).toBeLessThan(0.001);
    const c = busTripAt(hour + 1).pose;
    expect(Math.hypot(c.x - b.x, c.z - b.z)).toBeLessThan(0.001);
  });
});
