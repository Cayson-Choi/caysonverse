/**
 * Which way a seated rider FACES on every ride, as the avatar is actually turned (the quaternion the local body and every remote rider are drawn with),
 * against how people sit on the real rides (owner 2026-11-21: "달배의 의자 방향이 반대잖아. 바이킹을 봐봐 사람들이 어느방향을 보고 앉아있는지"):
 *  - 달배 (a swinging ship: HUSS Pirate Ship, Intamin Spanish Pirate Ship): benches across the hull, the two halves FACING EACH OTHER toward the middle;
 *  - 구름 낙하탑 (Intamin Gyro Drop, S&S): backs to the column, facing OUT;
 *  - 달빛 회전목마: nose first, the way the platform turns;
 *  - 별똥별 급행: forward along the track;
 *  - 하늘 등불 바퀴: this wheel's own cabin (one bench along the cabin's back wall, the wheel behind it): facing out of the wheel's plane.
 * The avatar's own forward is +z of its root (the sit pose looks along +z).
 */
import { Quaternion, Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { RIDE } from "@caysonverse/shared/land/rides";
import { MOON_BOAT_SEATS, MOON_BOAT_SITE, MOON_DWELL_MS, moonBoatAt, moonSeatCell, moonSeatLocal } from "@caysonverse/shared/land/moonBoat";
import { DROP_DWELL_MS, DROP_SEATS, DROP_SITE } from "@caysonverse/shared/land/dropTower";
import { CAROUSEL_CENTER, CAROUSEL_SEATS, carouselAt } from "@caysonverse/shared/land/carousel";
import { COASTER_DWELL_MS, COASTER_SEATS, coasterAt } from "@caysonverse/shared/land/coaster";
import { WHEEL_SEATS, WHEEL_SITE } from "@caysonverse/shared/land/wheel";
import { resetRideClock, setRideClockForTests } from "./rideClock";
import { carouselRiderPose, dropRiderPose, moonBoatRiderPose, rideSeatPose, wheelRiderPose } from "./rideSeats";

const pos = new Vector3();
const quat = new Quaternion();
const pos2 = new Vector3();
const quat2 = new Quaternion();
const fwd = (q: Quaternion): Vector3 => new Vector3(0, 0, 1).applyQuaternion(q);
const up = (q: Quaternion): Vector3 => new Vector3(0, 1, 0).applyQuaternion(q);

afterEach(() => resetRideClock());

describe("the 달배: the two halves face each other, like a real Viking", () => {
  it("at rest every rider faces the middle of the boat, level, and the two middle benches look at each other", () => {
    for (let seat = 0; seat < MOON_BOAT_SEATS; seat++) {
      moonBoatRiderPose(seat, 0, pos, quat);
      const f = fwd(quat);
      const toMiddle = Math.sign(MOON_BOAT_SITE.z - pos.z);
      expect(f.z * toMiddle).toBeGreaterThan(0.999);
      expect(Math.abs(f.x)).toBeLessThan(1e-6);
      expect(up(quat).y).toBeGreaterThan(0.999);
      // the bow half (rows 0-3, z > 0 in the boat) looks at the stern, the stern half at the bow
      expect(f.z).toBeCloseTo(moonSeatCell(seat).row < 4 ? -1 : 1, 6);
      expect(Math.sign(moonSeatLocal(seat)[2])).toBe(moonSeatCell(seat).row < 4 ? 1 : -1);
    }
  });
  it("swung, a rider is still turned toward the middle and tips with the hull (head toward the axle)", () => {
    for (let t = 20; t < 100; t += 0.37) {
      const now = MOON_DWELL_MS + t * 1000;
      const st = moonBoatAt(now);
      for (const seat of [0, 5, 13, 24, 28, 31]) {
        moonBoatRiderPose(seat, now, pos, quat);
        const f = fwd(quat);
        const u = up(quat);
        const face = moonSeatCell(seat).row < 4 ? -1 : 1;
        // the facing is the boat's own length, swung by the hull's angle
        expect(f.y).toBeCloseTo(Math.sin(st.angle) * face, 6);
        expect(f.z).toBeCloseTo(Math.cos(st.angle) * face, 6);
        // the body's up is the hull's up (toward the axle)
        expect(u.y).toBeCloseTo(Math.cos(st.angle), 6);
        expect(u.z).toBeCloseTo(-Math.sin(st.angle), 6);
        expect(Math.abs(f.x) + Math.abs(u.x)).toBeLessThan(1e-6);
      }
    }
  });
});

describe("the 구름 낙하탑: backs to the column, facing out over the park", () => {
  it("every rider faces straight away from the tower's axis, upright, at the station and at the top", () => {
    for (const now of [0, DROP_DWELL_MS + 22_000]) {
      for (let seat = 0; seat < DROP_SEATS; seat++) {
        dropRiderPose(seat, now, pos, quat);
        const f = fwd(quat);
        const face = Math.floor(seat / 4);
        const n = new Vector3(Math.cos((face * Math.PI) / 2), 0, Math.sin((face * Math.PI) / 2));
        expect(f.dot(n)).toBeGreaterThan(0.999);
        // and the seat is on that side of the tower (the column is behind the rider)
        expect((pos.x - DROP_SITE.x) * n.x + (pos.z - DROP_SITE.z) * n.z).toBeGreaterThan(2);
        expect(up(quat).y).toBeGreaterThan(0.999);
      }
    }
  });
});

describe("the 달빛 회전목마: nose first, the way it turns", () => {
  it("every horse rider faces the direction the seat is moving, across the radius", () => {
    // well into the ride (full speed)
    let now = 0;
    for (let t = 0; t < 400_000; t += 500) if (carouselAt(t).status === "riding" && carouselAt(t).omega > 0.2) { now = t; break; }
    expect(carouselAt(now).omega).toBeGreaterThan(0.2);
    for (let seat = 0; seat < CAROUSEL_SEATS; seat++) {
      const a = carouselRiderPose(seat, now, pos, quat);
      const ax = a.x;
      const az = a.z;
      const b = carouselRiderPose(seat, now + 100, pos2, quat2);
      const v = new Vector3(b.x - ax, 0, b.z - az).normalize();
      carouselRiderPose(seat, now, pos, quat);
      const f = fwd(quat);
      f.y = 0;
      f.normalize();
      expect(f.dot(v)).toBeGreaterThan(0.99);
      const radial = new Vector3(ax - CAROUSEL_CENTER.x, 0, az - CAROUSEL_CENTER.z).normalize();
      expect(Math.abs(f.dot(radial))).toBeLessThan(0.12);
    }
  });
});

describe("the 별똥별 급행: forward along the track", () => {
  it("every rider faces the way the train is going", () => {
    let now = 0;
    setRideClockForTests(() => now);
    for (const t of [20_000, 45_000, 70_000]) {
      now = COASTER_DWELL_MS + t;
      const s0 = coasterAt(now);
      for (const seat of [0, 1, Math.floor(COASTER_SEATS / 2), COASTER_SEATS - 1]) {
        rideSeatPose(RIDE.coaster, seat, pos, quat);
        now += 120;
        rideSeatPose(RIDE.coaster, seat, pos2, quat2);
        now -= 120;
        const v = pos2.clone().sub(pos);
        if (v.length() < 0.05) continue; // standing (the lift's top, the brakes)
        expect(fwd(quat).dot(v.normalize())).toBeGreaterThan(0.97);
      }
      void s0;
    }
  });
});

describe("the 하늘 등불 바퀴: one bench along the cabin's back wall, looking out of the wheel's plane", () => {
  it("every rider faces south (away from the wheel, toward the cabin's open glass), upright all the way round", () => {
    for (const now of [0, 30_000, 75_000, 120_000]) {
      for (let seat = 0; seat < WHEEL_SEATS; seat++) {
        wheelRiderPose(seat, now, pos, quat);
        const f = fwd(quat);
        expect(f.z).toBeGreaterThan(0.999);
        // the cabin hangs south of the wheel's plane: the wheel is behind the rider
        expect(pos.z).toBeGreaterThan(WHEEL_SITE.z + 2);
        expect(up(quat).y).toBeGreaterThan(0.999);
      }
    }
  });
});
