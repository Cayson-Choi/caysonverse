import { describe, expect, it } from "vitest";
import {
  CAROUSEL_CENTER,
  CAROUSEL_CYCLE_MS,
  CAROUSEL_DWELL_MS,
  CAROUSEL_OMEGA_MAX,
  CAROUSEL_RIDE_ANGLE,
  CAROUSEL_RINGS,
  CAROUSEL_SEATS,
  carouselAt,
  carouselBoardingOpen,
  carouselOmega,
  carouselSeatPose,
  carouselSeatRing,
} from "./carousel";

const T0 = 1_900_000_000_000 - (1_900_000_000_000 % CAROUSEL_CYCLE_MS);

describe("carousel timeline", () => {
  it("has 24 seats on three rings", () => {
    expect(CAROUSEL_SEATS).toBe(CAROUSEL_RINGS.reduce((n, r) => n + r.seats, 0));
    expect(carouselSeatRing(0)).toEqual({ ring: 0, i: 0 });
    expect(carouselSeatRing(12)).toEqual({ ring: 1, i: 0 });
    expect(carouselSeatRing(23)).toEqual({ ring: 2, i: 3 });
  });
  it("stands while loading, speeds up, holds 4 rpm, slows and stops", () => {
    expect(carouselOmega(0)).toBe(0);
    expect(carouselOmega(5)).toBeGreaterThan(0);
    expect(carouselOmega(5)).toBeLessThan(CAROUSEL_OMEGA_MAX);
    expect(carouselOmega(50)).toBeCloseTo(CAROUSEL_OMEGA_MAX, 6);
    expect(carouselOmega(109)).toBeLessThan(CAROUSEL_OMEGA_MAX * 0.2);
    expect(carouselOmega(110)).toBe(0);
    expect(CAROUSEL_RIDE_ANGLE).toBeGreaterThan(30);
    expect(CAROUSEL_RIDE_ANGLE).toBeLessThan(45);
  });
  it("the angle only grows through a ride and is continuous at the cycle's edges", () => {
    let last = -1;
    for (let ms = CAROUSEL_DWELL_MS; ms < CAROUSEL_CYCLE_MS; ms += 500) {
      const a = carouselAt(T0 + ms).angle;
      expect(a).toBeGreaterThanOrEqual(last - 1e-9);
      last = Math.max(last, a);
    }
    // the next cycle's standing angle is where this one's ride ended (mod 2pi)
    const endA = carouselAt(T0 + CAROUSEL_CYCLE_MS - 1).angle % (Math.PI * 2);
    const nextA = carouselAt(T0 + CAROUSEL_CYCLE_MS + 1).angle % (Math.PI * 2);
    const d = Math.abs(endA - nextA);
    expect(Math.min(d, Math.PI * 2 - d)).toBeLessThan(0.02);
  });
  it("is boarding for 19 s of each cycle", () => {
    expect(carouselBoardingOpen(T0 + 1000)).toBe(false);
    expect(carouselBoardingOpen(T0 + 10_000)).toBe(true);
    expect(carouselBoardingOpen(T0 + CAROUSEL_DWELL_MS - 3000)).toBe(false);
    expect(carouselAt(T0 + CAROUSEL_DWELL_MS + 1000).status).toBe("riding");
  });
  it("seats stay on their rings, horses rise and fall (alternate ones opposite), the carriages hardly move", () => {
    const t = T0 + CAROUSEL_DWELL_MS + 50_000;
    for (let s = 0; s < CAROUSEL_SEATS; s++) {
      const p = carouselSeatPose(s, t);
      const { ring } = carouselSeatRing(s);
      const dist = Math.hypot(p.x - CAROUSEL_CENTER.x, p.z - CAROUSEL_CENTER.z);
      expect(Math.abs(dist - CAROUSEL_RINGS[ring]!.radius)).toBeLessThan(ring === 2 ? 0.5 : 0.01);
      expect(Math.hypot(p.fx, p.fz)).toBeCloseTo(1, 6);
    }
    const ys = [0, 1].map((s) => carouselSeatPose(s, t).y);
    expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThan(0.05);
    let lo = Infinity;
    let hi = -Infinity;
    for (let ms = 0; ms < 8000; ms += 100) {
      const y = carouselSeatPose(0, t + ms).y;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    expect(hi - lo).toBeGreaterThan(0.5);
    expect(hi - lo).toBeLessThan(0.8);
    let clo = Infinity;
    let chi = -Infinity;
    for (let ms = 0; ms < 8000; ms += 100) {
      const y = carouselSeatPose(21, t + ms).y;
      clo = Math.min(clo, y);
      chi = Math.max(chi, y);
    }
    expect(chi - clo).toBeLessThan(0.12);
  });
  it("travels clockwise (seen from above, z south): the facing is the direction the seat moves", () => {
    const t = T0 + CAROUSEL_DWELL_MS + 40_000;
    const a = carouselSeatPose(3, t);
    const b = carouselSeatPose(3, t + 200);
    const mx = b.x - a.x;
    const mz = b.z - a.z;
    expect(mx * a.fx + mz * a.fz).toBeGreaterThan(0);
  });
});
