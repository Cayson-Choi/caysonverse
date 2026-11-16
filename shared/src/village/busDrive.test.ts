import { describe, expect, it } from "vitest";
import {
  BUS_DRIVER,
  BusDriver,
  busDriveMotion,
  busDriveTrip,
  busLimitAhead,
  scheduledDrive,
} from "./busDrive";
import { TRANSIT, TRANSIT_HOLDS, buildTripTimeline, busTripAt, routeLength, routePoseAtDistance, signalAt, type TransitPoint, type TransitPose } from "./transit";

const SLOT = Date.UTC(2026, 10, 15, 3, 0, 0); // a departure on the 10-minute grid
const DT = BUS_DRIVER.tickMs;
const HALF_L = TRANSIT.busLengthM / 2;
const HALF_W = BUS_DRIVER.halfWidthM;
const R = BUS_DRIVER.avatarRadiusM;

/** Clearance (m) between the bus's body (a 9 x 2.5 m rectangle at `pose`) and an avatar's body at `p`: < 0 is an overlap. */
function clearance(pose: TransitPose, p: TransitPoint): number {
  const fx = Math.sin(pose.yaw);
  const fz = Math.cos(pose.yaw);
  const rx = p.x - pose.x;
  const rz = p.z - pose.z;
  const along = rx * fx + rz * fz;
  const side = -rx * fz + rz * fx;
  const dx = Math.max(0, Math.abs(along) - HALF_L);
  const dz = Math.max(0, Math.abs(side) - HALF_W);
  return Math.hypot(dx, dz) - R;
}

/** An avatar standing in the middle of the bus's lane `distance` m along the lap. */
const onLane = (distance: number): TransitPoint => {
  const p = routePoseAtDistance(distance);
  return { x: p.x, z: p.z };
};

/** Drive a fresh driver from `from` to `to` in server ticks, with `who(t)` on the road; returns every tick's trip. */
function run(from: number, to: number, who: (t: number) => TransitPoint[], driver = new BusDriver(from)) {
  const out: { t: number; trip: ReturnType<typeof busDriveTrip>; distance: number; speed: number; blocked: boolean }[] = [];
  for (let t = from; t <= to; t += DT) {
    driver.step(t, who(t));
    const m = busDriveMotion(driver.drive, t);
    out.push({ t, trip: busDriveTrip(driver.drive, t), distance: m.distance, speed: m.speed, blocked: driver.blocked });
  }
  return { out, driver };
}

describe("bus driver: nobody on the road", () => {
  it("drives the timetable exactly (the same pose, status and countdown as busTripAt) through a whole 10-minute cycle", () => {
    const { out } = run(SLOT - 5000, SLOT + TRANSIT.departureEveryMs + 5000, () => []);
    for (const { t, trip } of out) {
      const want = busTripAt(t);
      expect(trip.status, `t+${t - SLOT}`).toBe(want.status);
      expect(trip.tripId).toBe(want.tripId);
      expect(trip.nextStartMs).toBe(want.nextStartMs);
      expect(trip.pose.x).toBeCloseTo(want.pose.x, 6);
      expect(trip.pose.z).toBeCloseTo(want.pose.z, 6);
      expect(trip.pose.yaw).toBeCloseTo(want.pose.yaw, 6);
    }
  });

  it("someone on the pavement beside the lane (kerb at r 37, body centre at r 37.5) or on the waiting pad is passed, not stopped for", () => {
    const length = routeLength();
    const people: TransitPoint[] = [];
    for (let s = 20; s < length - 20; s += 15) {
      const p = routePoseAtDistance(s);
      const r = Math.hypot(p.x, p.z);
      people.push({ x: (p.x / r) * 37.5, z: (p.z / r) * 37.5 });
    }
    people.push({ x: 39.5, z: -6.5 }, { x: 39.5, z: -2 });
    const { out } = run(SLOT, SLOT + 90_000, () => people);
    expect(out.some((o) => o.blocked)).toBe(false);
    expect(busTripAt(SLOT + 90_000).status).toBe(out.at(-1)!.trip.status);
  });

  it("the timetable's drive at any instant is the same as the timetable", () => {
    for (let t = SLOT - 60_000; t < SLOT + 120_000; t += 777) {
      const a = busDriveTrip(scheduledDrive(t), t);
      const b = busTripAt(t);
      expect(a.status).toBe(b.status);
      expect(a.pose.x).toBeCloseTo(b.pose.x, 9);
      expect(a.pose.z).toBeCloseTo(b.pose.z, 9);
    }
  });
});

describe("bus driver: someone standing on the road", () => {
  // past the pull-out, on the ring, between the stop and the first light's line
  const spot = (): number => {
    const first = TRANSIT_HOLDS[0]?.distance ?? routeLength();
    return Math.min(45, first - 8);
  };

  it("slows down smoothly, stands a gap short of them, never touches them, toots, and drives on once they step aside", () => {
    const at = onLane(spot());
    const leaveAt = SLOT + 25_000;
    const { out, driver } = run(SLOT, SLOT + 120_000, (t) => (t < leaveAt ? [at] : []));
    let prevSpeed = 0;
    let minGap = Number.POSITIVE_INFINITY;
    for (const o of out) {
      if (o.t < leaveAt) minGap = Math.min(minGap, clearance(o.trip.pose, at));
      // never an overlap while they stand there
      if (o.t < leaveAt) expect(clearance(o.trip.pose, at), `t+${o.t - SLOT}`).toBeGreaterThan(0);
      // no jump in speed: at most the comfortable brake (or the timetable's own ease) per tick
      expect(Math.abs(o.speed - prevSpeed), `speed step at t+${o.t - SLOT}`).toBeLessThanOrEqual(BUS_DRIVER.comfortDecel * 1.6 * (DT / 1000) + 0.05);
      prevSpeed = o.speed;
    }
    // it stopped with about the gap between its nose and their body
    expect(minGap).toBeGreaterThan(BUS_DRIVER.gapM - 0.5);
    expect(minGap).toBeLessThan(BUS_DRIVER.gapM + 1.5);
    const standing = out.filter((o) => o.t > SLOT + 15_000 && o.t < leaveAt);
    expect(standing.length).toBeGreaterThan(50);
    expect(standing.every((o) => o.speed === 0 && o.blocked && o.trip.status === "inTransit")).toBe(true);
    expect(driver.horn).toBeGreaterThanOrEqual(1);
    // they step aside: it drives on and is back at the stop well before the next departure; the timetable holds
    const back = out.find((o) => o.t > leaveAt && o.trip.status !== "inTransit");
    expect(back).toBeDefined();
    expect(back!.trip.nextStartMs).toBe(SLOT + TRANSIT.departureEveryMs);
    expect(out.at(-1)!.trip.pose.x).toBeCloseTo(TRANSIT.stop.x, 6);
  });

  it("the bus's position never jumps along the lap (distance changes at most the cruise per tick)", () => {
    const at = onLane(spot());
    const { out } = run(SLOT, SLOT + 90_000, (t) => (t < SLOT + 20_000 ? [at] : []));
    const cruise = routeLength() / TRANSIT.lapMs; // m/ms
    for (let i = 1; i < out.length; i++) {
      const d = out[i]!.distance - out[i - 1]!.distance;
      if (out[i]!.trip.status !== "inTransit" || out[i - 1]!.trip.status !== "inTransit") continue;
      expect(d).toBeGreaterThanOrEqual(-1e-9);
      expect(d).toBeLessThanOrEqual(cruise * DT * 1.6 + 1e-6);
    }
  });

  it("someone stepping right in front stops it on the spot: it never drives into them", () => {
    // they appear 1 m ahead of the nose while it cruises
    const driver = new BusDriver(SLOT);
    let t = SLOT;
    for (; t < SLOT + 12_000; t += DT) driver.step(t, []);
    const m = busDriveMotion(driver.drive, t);
    expect(m.speed).toBeGreaterThan(1);
    const at = onLane(m.distance + HALF_L + R + 0.6);
    for (let k = 0; k < 100; k++, t += DT) {
      driver.step(t, [at]);
      expect(clearance(busDriveTrip(driver.drive, t).pose, at)).toBeGreaterThan(0);
    }
    expect(busDriveMotion(driver.drive, t).speed).toBe(0);
  });

  it("a remote avatar and the own one count alike, and the riders' bodies are not the bus's business (the room filters them)", () => {
    const d = 50;
    expect(busLimitAhead(d - 15, [onLane(d)])).toBeLessThan(d);
    expect(busLimitAhead(d - 15, [])).toBe(Number.POSITIVE_INFINITY);
    // behind the bus: not in its way
    expect(busLimitAhead(d + 10, [onLane(d)])).toBe(Number.POSITIVE_INFINITY);
  });

  it("a long hold moves the next departure to a later 10-minute slot at once, so the stop's countdown never runs out on a missing bus", () => {
    const at = onLane(spot());
    const { out } = run(SLOT, SLOT + 2 * TRANSIT.departureEveryMs, (t) => (t < SLOT + 9.5 * 60_000 ? [at] : []));
    // while it is held past the point it could be back for its boarding half minute, the departure it shows is a later slot
    const late = out.find((o) => o.t > SLOT + 9 * 60_000)!;
    expect(late.trip.status).toBe("inTransit");
    expect(late.trip.nextStartMs).toBe(SLOT + 2 * TRANSIT.departureEveryMs);
    // the countdown it shows never goes below the boarding half minute while the bus is still out
    for (const o of out) if (o.trip.status === "inTransit") expect(o.trip.nextStartMs - o.t).toBeGreaterThan(TRANSIT.boardingMs - 1);
    // the bus is back and boards for that later slot, then leaves on it
    const boarding = out.find((o) => o.trip.status === "boarding")!;
    expect(boarding.trip.startMs).toBe(SLOT + 2 * TRANSIT.departureEveryMs);
  });

  it("re-planned from a stop line on a red, it waits for the green before it moves (never runs the red after a hold)", () => {
    const h = TRANSIT_HOLDS[0];
    if (!h) return;
    // find a moment the light is red for the bus
    let t = SLOT;
    while (signalAt(t, h.offsetMs).color !== "red") t += 500;
    const tl = buildTripTimeline(t, h.distance);
    expect(tl.legs[0]!.fromMs).toBeGreaterThan(t);
    expect(signalAt(tl.legs[0]!.fromMs, h.offsetMs).color).toBe("green");
  });
});
