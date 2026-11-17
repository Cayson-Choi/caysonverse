import { describe, expect, it } from "vitest";
import {
  CAR_PITCH,
  COASTER_CARS,
  COASTER_CYCLE_MS,
  COASTER_DWELL_MS,
  COASTER_RIDE_MS,
  COASTER_SEATS,
  arcAtRideTime,
  carArc,
  coasterAt,
  coasterBoardingOpen,
  coasterTrack,
  emptyFrame,
  frameAt,
  rideGForce,
  seatCar,
  speedAt,
} from "./coaster";

const track = coasterTrack();

describe("coaster track", () => {
  it("is a closed circuit of a sensible size", () => {
    expect(track.length).toBeGreaterThan(900);
    expect(track.length).toBeLessThan(1400);
    const n = track.n;
    const gap = Math.hypot(track.pos[0]! - track.pos[3 * (n - 1)]!, track.pos[1]! - track.pos[3 * (n - 1) + 1]!, track.pos[2]! - track.pos[3 * (n - 1) + 2]!);
    expect(gap).toBeLessThan(track.ds * 1.2);
    // up closes too (no twist left at the join)
    const dUp = Math.hypot(track.up[0]! - track.up[3 * (n - 1)]!, track.up[1]! - track.up[3 * (n - 1) + 1]!, track.up[2]! - track.up[3 * (n - 1) + 2]!);
    expect(dUp).toBeLessThan(0.02);
  });
  it("climbs to 30-42 m and never goes under the ground", () => {
    expect(track.box[4]).toBeGreaterThan(30);
    expect(track.box[4]).toBeLessThan(42);
    expect(track.box[1]).toBeGreaterThan(1);
  });
  it("starts level in the station and the frames are orthonormal", () => {
    const f = frameAt(track, 0);
    expect(f.uy).toBeGreaterThan(0.99);
    expect(Math.abs(f.ty)).toBeLessThan(0.02);
    const o = emptyFrame();
    for (let s = 0; s < track.length; s += 7.3) {
      frameAt(track, s, o);
      expect(Math.hypot(o.tx, o.ty, o.tz)).toBeCloseTo(1, 3);
      expect(Math.hypot(o.ux, o.uy, o.uz)).toBeCloseTo(1, 3);
      expect(o.tx * o.ux + o.ty * o.uy + o.tz * o.uz).toBeCloseTo(0, 3);
    }
  });
  it("has no frame flip: the up vector turns smoothly (< 0.12 rad per half metre) even through the loop", () => {
    const a = emptyFrame();
    const b = emptyFrame();
    for (let s = 0; s < track.length - 0.5; s += 0.5) {
      frameAt(track, s, a);
      frameAt(track, s + 0.5, b);
      const d = a.ux * b.ux + a.uy * b.uy + a.uz * b.uz;
      expect(Math.acos(Math.min(1, d))).toBeLessThan(0.12);
    }
  });
});

describe("coaster physics", () => {
  it("stays in the comfort envelope (vertical -0.5..4.5 g, lateral < 1.4 g)", () => {
    const g = { lat: 0, vert: 1, long: 0 };
    let maxV = -9;
    let minV = 9;
    let maxL = 0;
    for (let s = 12; s < track.length - 8; s += 0.5) {
      rideGForce(track, s, g);
      maxV = Math.max(maxV, g.vert);
      minV = Math.min(minV, g.vert);
      maxL = Math.max(maxL, Math.abs(g.lat));
    }
    expect(maxV).toBeLessThan(4.5);
    expect(maxV).toBeGreaterThan(2.5); // a real loop pulls
    expect(minV).toBeGreaterThan(-0.5);
    expect(minV).toBeLessThan(0.3); // and a real hill lifts
    expect(maxL).toBeLessThan(1.4);
  });
  it("starts and ends at rest; the lift is slow and the drop is fast", () => {
    expect(speedAt(track, 0)).toBe(0);
    expect(speedAt(track, track.length)).toBe(0);
    expect(speedAt(track, (track.liftFrom + track.liftTo) * track.ds * 0.5)).toBeCloseTo(3.4, 1);
    let top = 0;
    for (let s = 0; s < track.length; s += 1) top = Math.max(top, speedAt(track, s));
    expect(top).toBeGreaterThan(22);
    expect(top).toBeLessThan(30);
  });
  it("keeps a safe speed over the vertical loop's top", () => {
    // the loop's top is the highest point after the first drop with a pitch of 90 degrees: find the highest sample of the loop run
    let best = -1;
    let bestY = 0;
    for (let i = track.liftTo + 40; i < track.n; i++) {
      // inside the loop the up vector points down (uy < -0.9)
      if (track.up[3 * i + 1]! < -0.9 && track.pos[3 * i + 1]! > bestY) {
        bestY = track.pos[3 * i + 1]!;
        best = i;
      }
    }
    expect(best).toBeGreaterThan(0);
    const v = track.speed[best]!;
    expect(v * v / 9.81).toBeGreaterThan(7); // v^2 / g above the top's radius (about 7 m): the rider stays in the seat
  });
  it("lasts about 90 s and the time table is monotonic", () => {
    expect(track.duration).toBeGreaterThan(70);
    expect(track.duration).toBeLessThan(110);
    for (let i = 0; i < track.n; i++) expect(track.time[i + 1]!).toBeGreaterThan(track.time[i]!);
    expect(arcAtRideTime(track, 0)).toBe(0);
    expect(arcAtRideTime(track, track.duration + 5)).toBeCloseTo(track.length, 3);
    const mid = arcAtRideTime(track, track.duration / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(track.length);
  });
});

describe("coaster schedule", () => {
  it("is one train, a lap per cycle, the same on every machine", () => {
    expect(COASTER_CYCLE_MS).toBe(COASTER_DWELL_MS + COASTER_RIDE_MS);
    // pinned: a change of the layout moves every rider's timeline, so it must be a decision
    expect(COASTER_CYCLE_MS).toBe(130_000);
    const t0 = 1_900_000_000_000 - (1_900_000_000_000 % COASTER_CYCLE_MS);
    expect(coasterAt(t0 + 1000).status).toBe("unloading");
    expect(coasterAt(t0 + 10_000).status).toBe("boarding");
    expect(coasterAt(t0 + COASTER_DWELL_MS - 3000).status).toBe("gate");
    expect(coasterAt(t0 + COASTER_DWELL_MS + 10_000).status).toBe("riding");
    expect(coasterAt(t0 + COASTER_DWELL_MS + 10_000).s).toBeGreaterThan(0);
    expect(coasterAt(t0 + COASTER_CYCLE_MS - 1).s).toBeCloseTo(track.length, 1);
    expect(coasterAt(t0 + COASTER_CYCLE_MS + 100).cycle).toBe(coasterAt(t0).cycle + 1);
    expect(coasterBoardingOpen(t0 + 10_000)).toBe(true);
    expect(coasterBoardingOpen(t0 + COASTER_DWELL_MS + 1000)).toBe(false);
  });
  it("seats: 12, two to a car, the front car first", () => {
    expect(COASTER_SEATS).toBe(COASTER_CARS * 2);
    expect(seatCar(0)).toEqual({ car: 0, side: 0 });
    expect(seatCar(1)).toEqual({ car: 0, side: 1 });
    expect(seatCar(11)).toEqual({ car: 5, side: 1 });
    expect(carArc(20, 2)).toBeCloseTo(20 - 2 * CAR_PITCH, 6);
  });
});
