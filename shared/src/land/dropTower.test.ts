import { describe, expect, it } from "vitest";
import {
  DROP_BRAKE_A,
  DROP_BRAKE_S,
  DROP_BRAKE_Y,
  DROP_CAR,
  DROP_CYCLE_MS,
  DROP_DECK_Y,
  DROP_DWELL_MS,
  DROP_FALL_S,
  DROP_FALL_V,
  DROP_G,
  DROP_RIDE_MS,
  DROP_SEATS,
  DROP_STATION_Y,
  DROP_TOP_Y,
  dropAt,
  dropCanLeave,
  dropGLoad,
  dropMotion,
  dropSeatLocal,
  dropSeatPose,
  type DropStage,
} from "./dropTower";
import { DROP_COLUMN, DROP_CROWN, DROP_PLATFORM_BOXES, dropRidingPoints, pointBoxDistance } from "./dropTowerGeometry";
import { RIDES, rideByKey } from "./rides";

const motion = (t: number): { y: number; v: number; a: number; stage: DropStage } => {
  const m = { y: 0, v: 0, a: 0, stage: "idle" as DropStage };
  dropMotion(t, m);
  return m;
};

describe("drop tower timeline", () => {
  it("waits at the station while loading and is back there at the end of the cycle", () => {
    for (const ms of [0, 3000, 20_000, DROP_DWELL_MS - 1]) {
      const s = dropAt(ms);
      expect(s.y).toBe(DROP_STATION_Y);
      expect(s.status).not.toBe("riding");
    }
    const end = dropAt(DROP_CYCLE_MS - 200);
    expect(end.status).toBe("riding");
    expect(end.y).toBeCloseTo(DROP_STATION_Y, 6);
    expect(dropAt(DROP_CYCLE_MS * 4).status).toBe("unloading");
    expect(DROP_RIDE_MS / 1000).toBeGreaterThan(22.3);
  });
  it("lifts slowly to 42 m, holds, free-falls at g, brakes at about 1.3 g, and the height is continuous", () => {
    let prev = DROP_STATION_Y;
    let maxUp = 0;
    let maxDown = 0;
    let top = 0;
    let holdSeen = false;
    let minA = 0;
    let maxA = 0;
    for (let t = 0; t <= DROP_RIDE_MS / 1000; t += 0.005) {
      const m = motion(t);
      expect(Math.abs(m.y - prev)).toBeLessThan(0.15);
      prev = m.y;
      top = Math.max(top, m.y);
      maxUp = Math.max(maxUp, m.v);
      maxDown = Math.min(maxDown, m.v);
      if (m.stage === "hold") holdSeen = true;
      if (m.stage === "fall") expect(m.a).toBeCloseTo(-DROP_G, 6);
      minA = Math.min(minA, m.a);
      maxA = Math.max(maxA, m.a);
    }
    expect(top).toBeCloseTo(DROP_TOP_Y, 3);
    expect(holdSeen).toBe(true);
    expect(maxUp).toBeLessThan(4.6); // a slow lift
    expect(-maxDown).toBeCloseTo(DROP_FALL_V, 1);
    expect(DROP_BRAKE_A / DROP_G).toBeGreaterThan(1.1);
    expect(DROP_BRAKE_A / DROP_G).toBeLessThan(1.5);
    expect(DROP_FALL_S).toBeGreaterThan(2);
    expect(DROP_BRAKE_S).toBeGreaterThan(1.4);
    expect(dropGLoad({ a: -DROP_G })).toBeCloseTo(0, 9);
    expect(dropGLoad({ a: maxA })).toBeLessThan(2.4);
    expect(minA).toBeCloseTo(-DROP_G, 6);
    expect(DROP_BRAKE_Y).toBeGreaterThan(DROP_STATION_Y + 10);
  });
  it("only lets a rider off with the car at the station", () => {
    expect(dropCanLeave(0, 10_000)).toBe(true);
    expect(dropCanLeave(0, DROP_DWELL_MS + 16_000)).toBe(false);
    expect(dropCanLeave(0, DROP_CYCLE_MS - 100)).toBe(true);
  });
  it("is in the ride table with 16 seats, four to a face, all distinct", () => {
    const r = rideByKey("droptower")!;
    expect(r.seats).toBe(16);
    expect(RIDES.some((x) => x.id === r.id)).toBe(true);
    const cells = new Set(Array.from({ length: DROP_SEATS }, (_, i) => dropSeatLocal(i).map((v) => v.toFixed(2)).join()));
    expect(cells.size).toBe(16);
    expect(dropSeatPose(0, 0).fx).toBeCloseTo(1, 6);
    expect(dropSeatPose(4, 0).fz).toBeCloseTo(1, 6);
    expect(dropSeatPose(8, 0).fx).toBeCloseTo(-1, 6);
  });
});

describe("drop tower clearances through the whole ride", () => {
  const dt = 0.05;
  it("no rider, harness or car floor point comes within 0.5 m of the tower column or 3 m of the crown", () => {
    let minCol = Infinity;
    let minCrown = Infinity;
    for (let t = 0; t <= DROP_RIDE_MS / 1000; t += dt) {
      const m = motion(t);
      for (const { p } of dropRidingPoints(m.y)) {
        minCol = Math.min(minCol, pointBoxDistance(p, DROP_COLUMN));
        minCrown = Math.min(minCrown, pointBoxDistance(p, DROP_CROWN));
      }
    }
    expect(minCol).toBeGreaterThan(0.5);
    expect(minCrown).toBeGreaterThan(3);
  });
  it("the car's floor stays flush with or above the deck, and 0.25 m clear of its inner edge", () => {
    let minFloorY = Infinity;
    let minGap = Infinity;
    for (let t = 0; t <= DROP_RIDE_MS / 1000; t += dt) {
      const m = motion(t);
      minFloorY = Math.min(minFloorY, m.y - DROP_CAR.floorBelow);
      for (const { p, name } of dropRidingPoints(m.y)) if (name === "floor") for (const b of DROP_PLATFORM_BOXES) minGap = Math.min(minGap, pointBoxDistance(p, b));
    }
    expect(minFloorY).toBeGreaterThanOrEqual(DROP_DECK_Y - 1e-9);
    expect(minGap).toBeGreaterThan(0.25);
  });
});
