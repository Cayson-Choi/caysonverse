/**
 * Boarding happens only with the vehicle in its station, and a rider is put off only after it has come to rest there (owner 2026-11-20:
 * "급행타기 눌러놓으면 열차가 도착하기도 전에 타버리는 문제", "급행이 타 끝나기도 전에 내려버리는 문제"). Every ride's timetable is a pure function of the clock,
 * so the whole circuit can be scanned: wherever a ride's status is "boarding" its vehicle stands still at the platform, and the moment the
 * cycle that carried a rider ends the vehicle is already at rest.
 */
import { describe, expect, it } from "vitest";
import { RIDES, rideByKey, rideScheduleKey } from "./rides";
import {
  COASTER_CARS,
  COASTER_SEATS,
  CAR_PITCH,
  carArc,
  seatCar,
  COASTER_CYCLE_MS,
  COASTER_DWELL_MS,
  COASTER_GATE_MS,
  COASTER_RIDE_MS,
  COASTER_UNLOAD_MS,
  coasterAt,
  coasterTrack,
  emptyFrame,
  frameAt,
  speedAt,
} from "./coaster";
import { CAROUSEL_CYCLE_MS, carouselAt } from "./carousel";
import { MOON_CYCLE_MS, moonBoatAt } from "./moonBoat";
import { DROP_CYCLE_MS, DROP_STATION_Y, dropAt } from "./dropTower";
import { WHEEL_N, WHEEL_STEP_MS, WHEEL_BOARD_HALF_MS, boardingSeatsOfWheel, wheelAt, wheelPivot } from "./wheel";

const T0 = 1_900_000_000_000 - (1_900_000_000_000 % (COASTER_CYCLE_MS * CAROUSEL_CYCLE_MS * 2));

describe("the coaster's timetable follows the track's own timing", () => {
  const track = coasterTrack();
  const station = frameAt(track, 0, emptyFrame());
  const at = (t: number) => {
    const st = coasterAt(t);
    const f = frameAt(track, st.s, emptyFrame());
    return { st, d: Math.hypot(f.x - station.x, f.y - station.y, f.z - station.z), v: st.status === "riding" ? speedAt(track, st.s) : 0 };
  };

  it("derives every constant from the track: the ride is the track's duration plus the roll-in second, the cycle is dwell + ride", () => {
    expect(COASTER_RIDE_MS).toBe(Math.ceil(track.duration + 1) * 1000);
    expect(COASTER_CYCLE_MS).toBe(COASTER_DWELL_MS + COASTER_RIDE_MS);
    expect(COASTER_RIDE_MS / 1000).toBeGreaterThanOrEqual(track.duration);
    expect(COASTER_UNLOAD_MS + COASTER_GATE_MS).toBeLessThan(COASTER_DWELL_MS);
  });

  it("there is no seat while the train is more than 0.5 m from its stop: in every boarding sample the head stands at the station, at rest", () => {
    let boarding = 0;
    for (let t = T0; t < T0 + 3 * COASTER_CYCLE_MS; t += 100) {
      const { st, d, v } = at(t);
      if (st.status !== "boarding") continue;
      boarding++;
      expect(d).toBeLessThan(0.5);
      expect(v).toBeLessThan(0.05);
    }
    expect(boarding).toBeGreaterThan(800);
  });

  it("the train has come to a full stop before the cycle that carried the riders ends (they are put off only then)", () => {
    for (let k = 1; k <= 3; k++) {
      const end = T0 + k * COASTER_CYCLE_MS;
      // the moment of the unload (the next cycle's first ms) and every instant before it down to the stop
      expect(at(end).d).toBeLessThan(0.5);
      expect(coasterAt(end - 1).status).toBe("riding");
      const stopAt = Math.ceil(track.duration * 1000) + 5;
      // the track's own stop is before the ride window closes, and from the stop on the head does not move
      expect(stopAt).toBeLessThanOrEqual(COASTER_RIDE_MS);
      const sStop = coasterAt(end - COASTER_RIDE_MS + stopAt).s;
      expect(sStop).toBeCloseTo(track.length, 1);
      expect(coasterAt(end - 1).s).toBeCloseTo(sStop, 3);
      // before the stop the train is still rolling: the last 0.5 m of the track is not boarding or unloading time
      const rolling = coasterAt(end - COASTER_RIDE_MS + stopAt - 600);
      expect(rolling.status).toBe("riding");
    }
  });

  it("the boarding window opens only after the train has been standing: the unload alone is at least a second after the stop", () => {
    const stopMsBeforeCycleEnd = COASTER_RIDE_MS - track.duration * 1000;
    expect(stopMsBeforeCycleEnd + COASTER_UNLOAD_MS).toBeGreaterThan(5000);
    // the first boarding sample
    let t = T0 + COASTER_CYCLE_MS;
    while (coasterAt(t).status !== "boarding") t += 50;
    expect(at(t).d).toBeLessThan(0.05);
  });
});

describe("every ride: boarding means the vehicle is at rest in its station", () => {
  it("the carousel turns only while riding, and is still at the cycle's end", () => {
    for (let t = T0; t < T0 + 2 * CAROUSEL_CYCLE_MS; t += 200) {
      const s = carouselAt(t);
      if (s.status !== "riding") expect(Math.abs(s.omega)).toBeLessThan(1e-6);
    }
    expect(Math.abs(carouselAt(T0 + CAROUSEL_CYCLE_MS - 1).omega)).toBeLessThan(0.02);
  });
  it("the moon boat hangs level while loading, and is still at the cycle's end", () => {
    for (let t = T0; t < T0 + 2 * MOON_CYCLE_MS; t += 200) {
      const s = moonBoatAt(t);
      if (s.status !== "riding") {
        expect(Math.abs(s.angle)).toBeLessThan(1e-6);
        expect(Math.abs(s.omega)).toBeLessThan(1e-6);
      }
    }
    const e = moonBoatAt(T0 + MOON_CYCLE_MS - 1);
    expect(Math.abs(e.angle)).toBeLessThan(0.01);
    expect(Math.abs(e.omega)).toBeLessThan(0.02);
  });
  it("the drop tower's car is at the station while loading, and has come to rest there at the cycle's end", () => {
    for (let t = T0; t < T0 + 2 * DROP_CYCLE_MS; t += 200) {
      const s = dropAt(t);
      if (s.status !== "riding") expect(s.y).toBeCloseTo(DROP_STATION_Y, 6);
    }
    const e = dropAt(T0 + DROP_CYCLE_MS - 1);
    expect(e.stage).toBe("rest");
    expect(e.y).toBeCloseTo(DROP_STATION_Y, 6);
  });
  it("the wheel seats only the gondola at the platform: its pivot is at the bottom of the wheel through the whole boarding window", () => {
    const bottom = wheelPivot(0, 0).y;
    let seen = 0;
    for (let t = T0; t < T0 + 3 * WHEEL_STEP_MS; t += 100) {
      const w = wheelAt(t);
      if (w.status !== "boarding") continue;
      seen++;
      const seats = boardingSeatsOfWheel(t);
      const g = Math.floor(seats[0]! / 4);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThan(WHEEL_N);
      const p = wheelPivot(g, w.angle);
      // the gondola stays within a few metres of the very bottom, and within the half-window's arc of it
      expect(p.y - Math.min(bottom, p.y)).toBeLessThan(0.6);
      expect(Math.abs(p.x - wheelPivot(g, 0).x)).toBeLessThan(0.1 + 2 * ((WHEEL_BOARD_HALF_MS / 1000) * 10));
    }
    expect(seen).toBeGreaterThan(10);
  });
});

describe("the ride table", () => {
  it("lists every ride once, with the coaster first", () => {
    expect(RIDES[0]!.key).toBe("coaster");
    expect(rideByKey("coaster")!.statusAt(T0).cycle).toBe(coasterAt(T0).cycle);
  });
  it("has a stable timetable fingerprint (the server sends it so a page on another timetable does not board)", () => {
    expect(rideScheduleKey()).toMatch(/^[0-9a-f]+$/);
    expect(rideScheduleKey()).toBe(rideScheduleKey());
  });
});

describe("the coaster fills from the FRONT (owner 2026-11-20: \"급행은 맨앞쪽에 먼저 앉아야해\")", () => {
  it("seats 0 and 1 are the front car's two seats, and each next pair is one car farther back", () => {
    for (let seat = 0; seat < COASTER_SEATS; seat++) expect(seatCar(seat).car).toBe(Math.floor(seat / 2));
    expect(seatCar(0)).toEqual({ car: 0, side: 0 });
    expect(seatCar(1)).toEqual({ car: 0, side: 1 });
  });
  it("car 0 is the head of the train: farther back means a smaller arc length, so the lowest free seat is always the frontmost", () => {
    for (let car = 1; car < COASTER_CARS; car++) expect(carArc(100, car)).toBeLessThan(carArc(100, car - 1));
    expect(carArc(100, 1)).toBeCloseTo(100 - CAR_PITCH, 9);
  });
  it("the server hands out the lowest free seat for the coaster (no boardingSeats override that could skip the front)", () => {
    expect(rideByKey("coaster")!.boardingSeats).toBeUndefined();
  });
});
