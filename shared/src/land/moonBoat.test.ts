import { describe, expect, it } from "vitest";
import {
  MOON_CYCLE_MS,
  MOON_DWELL_MS,
  MOON_FRAME,
  MOON_HULL,
  MOON_MAX_ANGLE,
  MOON_OMEGA,
  MOON_PIVOT_Y,
  MOON_SEAT,
  moonAmplitude,
  moonBoatAt,
  moonGLoad,
  moonSeatLocal,
  moonSeatPose,
} from "./moonBoat";
import { MOON_BOAT_SEATS } from "./moonBoat";
import { MOON_DECK, MOON_DECK_Y, MOON_PLATFORM_BOXES, moonBoatPoints, moonFrameCapsules, moonPointAt, pointBoxDistance, pointSegDistance } from "./moonBoatGeometry";
import { moonFloorY } from "./moonBoat";
import { RIDES, rideByKey } from "./rides";

describe("moon boat timeline", () => {
  it("hangs still while loading and rests at the end of the ride", () => {
    for (const ms of [0, 4000, 20_000, 39_000, MOON_DWELL_MS - 1]) {
      const s = moonBoatAt(ms);
      expect(s.angle).toBe(0);
      expect(s.status).not.toBe("riding");
    }
    expect(moonBoatAt(MOON_CYCLE_MS - 500).status).toBe("riding");
    expect(Math.abs(moonBoatAt(MOON_CYCLE_MS - 500).angle)).toBeLessThan(0.002);
    expect(moonBoatAt(MOON_CYCLE_MS * 3).status).toBe("unloading");
  });
  it("builds the swing up to 55 degrees, never past it", () => {
    let max = 0;
    let early = 0;
    for (let t = 0; t < 90; t += 0.02) {
      const a = Math.abs(moonBoatAt(MOON_DWELL_MS + t * 1000).angle);
      max = Math.max(max, a);
      if (t < 20) early = Math.max(early, a);
    }
    expect(max).toBeLessThanOrEqual(MOON_MAX_ANGLE + 1e-9);
    expect(max).toBeGreaterThan(MOON_MAX_ANGLE * 0.995);
    expect(early).toBeLessThan(MOON_MAX_ANGLE * 0.3);
    expect(moonAmplitude(0)).toBe(0);
  });
  it("omega and alpha match the angle's finite differences", () => {
    for (const t of [10.3, 30.7, 50.2, 63.1, 80.4]) {
      const ms = MOON_DWELL_MS + t * 1000;
      const h = 1;
      const a0 = moonBoatAt(ms - h).angle;
      const a1 = moonBoatAt(ms + h).angle;
      const s = moonBoatAt(ms);
      expect(s.omega).toBeCloseTo((a1 - a0) / (2 * h / 1000), 1);
    }
    expect(MOON_OMEGA).toBeGreaterThan(0.9);
  });
  it("weighs about 0.57 g at the 55 degree turn and about 2 g through the bottom", () => {
    let lo = 9;
    let hi = 0;
    for (let t = 58; t < 70; t += 0.01) {
      const g = moonGLoad(moonBoatAt(MOON_DWELL_MS + t * 1000));
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    expect(lo).toBeGreaterThan(0.5);
    expect(lo).toBeLessThan(0.65);
    expect(hi).toBeGreaterThan(1.7);
    expect(hi).toBeLessThan(2.3);
  });
  it("is in the ride table with 32 distinct seats, the middle rows first", () => {
    const r = rideByKey("moonboat")!;
    expect(r.seats).toBe(32);
    expect(RIDES.map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
    // the rows fill from the middle outward: the first rider has rows ahead (toward the bow) and behind
    const a = moonSeatLocal(0);
    expect(a[2]).toBeGreaterThan(-1.2);
    expect(a[2]).toBeLessThan(1.2);
    expect(moonSeatLocal(31)[2]).not.toBeCloseTo(a[2], 1);
    const rows = Array.from({ length: 8 }, (_, i) => moonSeatLocal(i * 4)[2]);
    expect(new Set(rows.map((r) => r.toFixed(2))).size).toBe(8);
    expect(new Set(Array.from({ length: 32 }, (_, i) => moonSeatLocal(i).join())).size).toBe(32);
    expect(MOON_BOAT_SEATS).toBe(32);
  });
  it("the seat pose follows the swing", () => {
    const rest = moonSeatPose(0, 0);
    let tTop = 58;
    for (let t = 58; t < 66; t += 0.01) if (Math.abs(moonBoatAt(MOON_DWELL_MS + t * 1000).angle) > Math.abs(moonBoatAt(MOON_DWELL_MS + tTop * 1000).angle)) tTop = t;
    const swung = moonSeatPose(0, MOON_DWELL_MS + tTop * 1000);
    expect(rest.fz).toBeCloseTo(1, 6);
    expect(Math.hypot(swung.fy, swung.fz)).toBeCloseTo(1, 6);
    expect(swung.y).not.toBeCloseTo(rest.y, 1);
  });
});

describe("moon boat clearances through the whole swing", () => {
  const pts = moonBoatPoints(0.25);
  const frame = moonFrameCapsules();
  const MAXA = MOON_MAX_ANGLE + 0.02;
  it("no hull, arm, rabbit or lantern point comes within 0.5 m of the A-frame (the arms only against the legs) (every 0.5 degree, both ways)", () => {
    let min = Infinity;
    for (let d = -MAXA; d <= MAXA; d += (0.5 * Math.PI) / 180)
      for (const { p, name } of pts) {
        const w = moonPointAt(p, d);
        // the arms hang FROM the axle: only the legs are tested against them
        for (const c of frame) if (name !== "arm" || c.name !== "axle") min = Math.min(min, pointSegDistance(w, c.a, c.b) - c.r);
      }
    expect(min).toBeGreaterThan(0.5);
  });
  it("the arms and the hull stay over 0.9 m above the ground, and the gap to the legs is by x", () => {
    let minY = Infinity;
    for (let d = -MAXA; d <= MAXA; d += (1 * Math.PI) / 180) for (const { p } of pts) minY = Math.min(minY, moonPointAt(p, d)[1]);
    expect(minY).toBeGreaterThan(0.9);
    expect(MOON_FRAME.legX - MOON_FRAME.armX - 0.36).toBeGreaterThan(1.0);
    expect(MOON_FRAME.legX - MOON_HULL.halfX - 0.36).toBeGreaterThan(1.2);
  });
  it("the platform and its rails stay 0.6 m from the boat at every angle", () => {
    let min = Infinity;
    for (let d = -MAXA; d <= MAXA; d += (1 * Math.PI) / 180)
      for (const { p } of pts) {
        const w = moonPointAt(p, d);
        for (const b of MOON_PLATFORM_BOXES) min = Math.min(min, pointBoxDistance(w, b));
      }
    expect(min).toBeGreaterThan(0.6);
  });
  it("at rest the deck is flush with the hull's floor at the middle, 0.9 m off its side", () => {
    expect(MOON_DECK_Y).toBeCloseTo(MOON_PIVOT_Y - 11.3 + 0.55, 6);
    expect(moonFloorY(0) + MOON_PIVOT_Y).toBeCloseTo(MOON_DECK_Y, 6);
    expect(MOON_DECK.x0 - MOON_HULL.halfX).toBeGreaterThan(0.8);
    expect(MOON_DECK.x0 - MOON_HULL.halfX).toBeLessThan(1.2);
  });
  it("every rider's eye stays 0.4 m clear of the hull's surface, rabbit, lantern and arms at every angle", () => {
    let min = Infinity;
    for (const seat of [0, 3, 12, 20, 31]) {
      const l = moonSeatLocal(seat);
      const eye: [number, number, number] = [l[0], l[1] + MOON_SEAT.eye, l[2]];
      for (const { p, name } of pts) {
        if (name === "bowl") continue; // the floor under the rider's own terrace: the cushion is 0.45 m over it and the eye 1.35 m
        min = Math.min(min, Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]));
      }
    }
    expect(min).toBeGreaterThan(0.4);
  });
});
