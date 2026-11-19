import { describe, expect, it } from "vitest";
import {
  CREST_Y,
  DROP_DEG,
  STATION_Y,
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
import { coasterSupports, FOOT_Y } from "./coasterSupports";
import { CAROUSEL_PAD, COASTER_PAD, DROP_PAD, MOON_BOAT_PAD, PARK_BOUNDS, PARK_EXIT_PAD, PARK_PLATFORM, WHEEL_PAD } from "../village/parkArea";

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
  it("climbs a very tall lift (owner 2026-11-19: \"아주 높이\"): 60-70 m over the station, and never goes under the ground", () => {
    expect(track.box[4] - STATION_Y).toBeGreaterThan(60);
    expect(track.box[4]).toBeLessThan(70);
    expect(track.box[4]).toBeCloseTo(CREST_Y, 0);
    expect(track.box[1]).toBeGreaterThan(1.2);
  });
  it("drops at 75-85 degrees off the crest", () => {
    let steepest = 0;
    for (let i = track.liftTo; i < (track.marks.dropTo ?? track.liftTo + 300); i++) steepest = Math.min(steepest, Math.asin(track.tan[3 * i + 1]!));
    const deg = (-steepest * 180) / Math.PI;
    expect(deg).toBeGreaterThan(75);
    expect(deg).toBeLessThan(85);
    expect(deg).toBeCloseTo(DROP_DEG, 0);
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
  it("stays in the family-thrill envelope at the riders' hearts (vertical -1..4.5 g, lateral < 0.6 g)", () => {
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
    expect(maxV).toBeGreaterThan(3.5); // the pull-out and the loop pull hard
    expect(minV).toBeGreaterThan(-1);
    expect(minV).toBeLessThan(-0.4); // and the hills throw you out of the seat
    expect(maxL).toBeLessThan(0.6); // banked (about the heartline) for the speed: little sideways push
  });
  it("is smooth sample by sample: no step in the curvature, the bank or the g-forces", () => {
    const g = { lat: 0, vert: 1, long: 0 };
    let pv = 1;
    let pl = 0;
    let dV = 0;
    let dL = 0;
    for (let s = 12; s < track.length - 8; s += 0.5) {
      rideGForce(track, s, g);
      if (s > 12) {
        dV = Math.max(dV, Math.abs(g.vert - pv));
        dL = Math.max(dL, Math.abs(g.lat - pl));
      }
      pv = g.vert;
      pl = g.lat;
    }
    expect(dV).toBeLessThan(0.35); // per half metre (a step would be a whole g)
    expect(dL).toBeLessThan(0.3);
    // the curvature (turn of the tangent per metre) changes by less than 0.01 /m from one sample to the next
    let pk = -1;
    let dK = 0;
    const kAt = (i: number): number => {
      const a = 3 * ((i - 1 + track.n) % track.n);
      const b = 3 * ((i + 1) % track.n);
      const d = track.tan[a]! * track.tan[b]! + track.tan[a + 1]! * track.tan[b + 1]! + track.tan[a + 2]! * track.tan[b + 2]!;
      return Math.acos(Math.min(1, d)) / (2 * track.ds);
    };
    for (let i = 0; i < track.n; i++) {
      const k = kAt(i);
      if (pk >= 0) dK = Math.max(dK, Math.abs(k - pk));
      pk = k;
    }
    expect(dK).toBeLessThan(0.01);
  });
  it("starts and ends at rest; the lift is slow and the drop is fast", () => {
    expect(speedAt(track, 0)).toBe(0);
    expect(speedAt(track, track.length)).toBe(0);
    expect(speedAt(track, (track.liftFrom + track.liftTo) * track.ds * 0.5)).toBeCloseTo(4.0, 1);
    let top = 0;
    for (let s = 0; s < track.length; s += 1) top = Math.max(top, speedAt(track, s));
    expect(top).toBeGreaterThan(33); // ~125 km/h at the foot of the drop
    expect(top).toBeLessThan(38);
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
  it("lasts about 95 s and the time table is monotonic", () => {
    expect(track.duration).toBeGreaterThan(85);
    expect(track.duration).toBeLessThan(105);
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
    expect(COASTER_CYCLE_MS).toBe(136_000); // 2026-11-19: the tall lift and the new back half (was 130 s)
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
  it("seats: 12, two to a car, filled from the front", () => {
    expect(COASTER_SEATS).toBe(COASTER_CARS * 2);
    expect(seatCar(0)).toEqual({ car: 0, side: 0 }); // the front row of the front car first (owner: "맨 앞자리")
    expect(seatCar(1)).toEqual({ car: 0, side: 1 });
    expect(seatCar(2)).toEqual({ car: 1, side: 0 }); // then row by row to the back
    expect(seatCar(10)).toEqual({ car: 5, side: 0 });
    expect(seatCar(11)).toEqual({ car: 5, side: 1 });
    expect(new Set(Array.from({ length: COASTER_SEATS }, (_, i) => `${seatCar(i).car}:${seatCar(i).side}`)).size).toBe(COASTER_SEATS);
    expect(carArc(20, 2)).toBeCloseTo(20 - 2 * CAR_PITCH, 6);
  });
});

describe("coaster back half (owner 2026-11-19: \"뒷 부분은 그냥 밋밋해\")", () => {
  it("has two inversions (the loop and the zero-g roll), each upside down once, both after the turnaround", () => {
    const runs: number[] = [];
    let inside = false;
    for (let i = 0; i < track.n; i++) {
      const inv = track.up[3 * i + 1]! < -0.9;
      if (inv && !inside) runs.push(i);
      inside = inv;
    }
    expect(runs.length).toBe(2);
    expect(runs[0]!).toBeGreaterThan(track.marks.loopFrom!);
    expect(runs[0]!).toBeLessThan(track.marks.loopTo!);
    expect(runs[1]!).toBeGreaterThan(track.marks.rollFrom!);
    expect(runs[1]!).toBeLessThan(track.marks.rollTo!);
    expect(track.marks.loopFrom!).toBeGreaterThan(track.marks.trimTo!);
  });
  it("throws airtime over three bunny hops", () => {
    const g = { lat: 0, vert: 1, long: 0 };
    let crests = 0;
    let low = false;
    for (let i = track.marks.hopsFrom!; i < track.marks.hopsTo!; i++) {
      rideGForce(track, i * track.ds, g);
      if (g.vert < -0.3 && !low) crests++;
      low = g.vert < -0.3 ? true : g.vert > 0.5 ? false : low;
    }
    expect(crests).toBe(3);
  });
  it("turns a 540 degree ground helix, steeply banked", () => {
    let yaw = 0;
    for (let i = track.marks.helixFrom!; i < track.marks.helixTo!; i++) {
      const a = 3 * i;
      const b = 3 * (i + 1);
      yaw += Math.atan2(track.tan[a]! * track.tan[b + 2]! - track.tan[a + 2]! * track.tan[b]!, track.tan[a]! * track.tan[b]! + track.tan[a + 2]! * track.tan[b + 2]!);
    }
    expect(Math.abs((yaw * 180) / Math.PI)).toBeGreaterThan(520);
    expect(Math.abs((yaw * 180) / Math.PI)).toBeLessThan(560);
    const mid = Math.round((track.marks.helixFrom! + track.marks.helixTo!) / 2);
    expect(track.up[3 * mid + 1]!).toBeLessThan(0.55); // banked past 57 degrees
  });
  it("shoots through the tunnel at speed, at ground level", () => {
    const a = track.marks.tunnelFrom!;
    const b = track.marks.tunnelTo!;
    expect((b - a) * track.ds).toBeGreaterThan(25);
    for (let i = a; i < b; i++) {
      expect(track.pos[3 * i + 1]!).toBeLessThan(3);
      expect(track.speed[i]!).toBeGreaterThan(18);
    }
  });
  it("has no straight longer than 40 m in the second half of the lap before the brake run", () => {
    let run = 0;
    let longest = 0;
    for (let i = track.marks.trimTo!; i < track.marks.helixTo!; i++) {
      const a = 3 * i;
      const b = 3 * (i + 1);
      const d = track.tan[a]! * track.tan[b]! + track.tan[a + 1]! * track.tan[b + 1]! + track.tan[a + 2]! * track.tan[b + 2]!;
      run = Math.acos(Math.min(1, d)) / track.ds < 0.002 ? run + track.ds : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThan(40);
  });
});

describe("coaster footprint", () => {
  it("stays on the coaster's own ground: south of the park's lawn (z -2.2), inside the fairground and the skyline's extent", () => {
    for (let i = 0; i < track.n; i++) {
      const x = track.pos[3 * i]!;
      const z = track.pos[3 * i + 2]!;
      expect(z).toBeGreaterThan(PARK_BOUNDS.maxZ + 1.5);
      expect(z).toBeLessThan(70);
      expect(x).toBeGreaterThan(-135);
      expect(x).toBeLessThan(360);
    }
  });
  it("keeps clear of the boarding pad, the platform and every other ride's pad", () => {
    const pads = [COASTER_PAD, CAROUSEL_PAD, WHEEL_PAD, MOON_BOAT_PAD, DROP_PAD, PARK_EXIT_PAD];
    for (let i = 0; i < track.n; i++) {
      const x = track.pos[3 * i]!;
      const z = track.pos[3 * i + 2]!;
      for (const p of pads) expect(Math.hypot(x - p.x, z - p.z)).toBeGreaterThan(p.radius + 6);
      // the platform is beside the track (z -6.8 .. -1.4), never under it
      expect(x > PARK_PLATFORM.minX && x < PARK_PLATFORM.maxX && z > PARK_PLATFORM.minZ - 0.5 && z < PARK_PLATFORM.maxZ + 0.6).toBe(false);
    }
  });
});

describe("coaster supports", () => {
  for (const detail of ["full", "light"] as const) {
    const sups = coasterSupports(track, detail);
    it(`${detail}: hold the whole circuit up: no unsupported stretch longer than 30 m above 4 m, lattice towers under the lift`, () => {
      const held = new Set(sups.map((s) => s.i));
      let gap = 0;
      let worst = 0;
      for (let k = 0; k < 2 * track.n; k++) {
        const i = k % track.n;
        if (held.has(i) || track.pos[3 * i + 1]! < 4) gap = 0;
        else gap += track.ds;
        worst = Math.max(worst, gap);
      }
      expect(worst).toBeLessThan(30);
      const tall = sups.filter((s) => s.kind === "column" && s.spine[1] > 50);
      expect(tall.length).toBeGreaterThanOrEqual(3);
      for (const s of tall) {
        const xs = s.legs.map((l) => l.foot[0] * s.lat[0] + l.foot[2] * s.lat[2]);
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(9);
      }
    });
    it(`${detail}: every leg keeps clear of the train elsewhere on the circuit and stands off the park's lawn`, () => {
      for (const s of sups) {
        for (const leg of s.legs) {
          expect(leg.foot[2]).toBeGreaterThan(PARK_BOUNDS.maxZ);
          expect(leg.foot[1]).toBeCloseTo(FOOT_Y, 6);
          // an independent check: the leg every 0.5 m against every track sample 8 m or more away along the circuit
          const len = Math.hypot(leg.top[0] - leg.foot[0], leg.top[1] - leg.foot[1], leg.top[2] - leg.foot[2]);
          let worst = Infinity;
          for (let f = 0; f <= 1; f += 0.5 / len) {
            const p = [leg.foot[0] + (leg.top[0] - leg.foot[0]) * f, leg.foot[1] + (leg.top[1] - leg.foot[1]) * f, leg.foot[2] + (leg.top[2] - leg.foot[2]) * f];
            for (let j = 0; j < track.n; j += 2) {
              let d = Math.abs(j - s.i);
              d = Math.min(d, track.n - d);
              if (d * track.ds < 8) continue;
              const dy = p[1]! - track.pos[3 * j + 1]!;
              if (dy > -1 && dy < 1.6) worst = Math.min(worst, Math.hypot(p[0]! - track.pos[3 * j]!, p[2]! - track.pos[3 * j + 2]!));
            }
          }
          expect(worst).toBeGreaterThan(1.9);
        }
      }
    });
  }
});
