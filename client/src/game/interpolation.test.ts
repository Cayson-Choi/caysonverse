import { describe, it, expect } from "vitest";
import {
  pushSnapshot,
  sample,
  exceedsSnapDistance,
  type Snapshot,
} from "./interpolation";
import {
  EXTRAPOLATE_MAX_MS,
  SNAPSHOT_CAPACITY,
  SNAP_DISTANCE,
} from "./constants";

const PI = Math.PI;

/** Build a snapshot tersely. */
const snap = (t: number, x: number, z: number, yaw = 0): Snapshot => ({ t, x, z, yaw });

describe("pushSnapshot (ring buffer)", () => {
  it("evicts the oldest once capacity is exceeded", () => {
    const buf: Snapshot[] = [];
    for (let i = 0; i < SNAPSHOT_CAPACITY + 2; i++) {
      pushSnapshot(buf, snap(i * 100, i, 0));
    }
    expect(buf).toHaveLength(SNAPSHOT_CAPACITY);
    // The first two (i=0, i=1) were evicted; the head is now i=2.
    expect(buf[0].x).toBe(2);
    expect(buf[buf.length - 1].x).toBe(SNAPSHOT_CAPACITY + 1);
  });

  it("honors a custom capacity", () => {
    const buf: Snapshot[] = [];
    for (let i = 0; i < 5; i++) pushSnapshot(buf, snap(i, i, 0), 3);
    expect(buf).toHaveLength(3);
    expect(buf.map((s) => s.x)).toEqual([2, 3, 4]);
  });
});

describe("sample — bracketing interpolation", () => {
  it("linearly interpolates x/z between two bracketing snapshots", () => {
    const buf = [snap(0, 0, 0), snap(100, 1, 2)];
    const s = sample(buf, 50)!;
    expect(s.x).toBeCloseTo(0.5, 6);
    expect(s.z).toBeCloseTo(1.0, 6);
    // 1m in x, 2m in z over 100ms => hypot(1,2)=2.236m over 0.1s => 22.36 m/s.
    expect(s.speed).toBeCloseTo(Math.hypot(1, 2) / 0.1, 4);
  });

  it("returns null for an empty buffer", () => {
    expect(sample([], 123)).toBeNull();
  });

  it("interpolates yaw the short way across the +/-PI seam", () => {
    // -3.1 -> +3.1 midpoint should sit near -PI (short arc through -PI), not 0.
    const buf = [snap(0, 0, 0, -3.1), snap(100, 0, 0, 3.1)];
    const s = sample(buf, 50)!;
    expect(Math.abs(s.yaw)).toBeCloseTo(PI, 2);
    expect(Math.abs(s.yaw)).toBeGreaterThan(3.0); // definitely near +/-PI, not near 0
  });
});

describe("sample — clamp to oldest", () => {
  it("returns the oldest snapshot (idle) when renderT precedes it", () => {
    const buf = [snap(1000, 5, 6, 1), snap(1100, 7, 8, 1)];
    const s = sample(buf, 900)!;
    expect(s.x).toBe(5);
    expect(s.z).toBe(6);
    expect(s.speed).toBe(0);
  });
});

describe("sample — extrapolation", () => {
  it("extrapolates at last-segment velocity within the cap and reports moving speed", () => {
    // 1m in x over 100ms => v = 10 m/s.
    const buf = [snap(0, 0, 0), snap(100, 1, 0)];
    // 100ms past the newest, inside the 250ms cap.
    const s = sample(buf, 200)!;
    expect(s.x).toBeCloseTo(2, 6); // 1 + 0.01 m/ms * 100ms
    expect(s.speed).toBeCloseTo(10, 4);
  });

  it("caps extrapolation at EXTRAPOLATE_MAX_MS and then freezes (idle)", () => {
    const buf = [snap(0, 0, 0), snap(100, 1, 0)];
    const cappedX = 1 + 0.01 * EXTRAPOLATE_MAX_MS; // frozen position at the cap
    // Far past the cap.
    const s = sample(buf, 100 + EXTRAPOLATE_MAX_MS + 500)!;
    expect(s.x).toBeCloseTo(cappedX, 6);
    expect(s.speed).toBe(0); // frozen -> reads as idle
  });

  it("holds still (speed 0) when only one snapshot exists", () => {
    const buf = [snap(0, 3, 4, 0.5)];
    const s = sample(buf, 999)!;
    expect(s.x).toBe(3);
    expect(s.z).toBe(4);
    expect(s.yaw).toBeCloseTo(0.5, 6);
    expect(s.speed).toBe(0);
  });
});

describe("exceedsSnapDistance", () => {
  it("is true when the gap is larger than SNAP_DISTANCE", () => {
    expect(exceedsSnapDistance(0, 0, SNAP_DISTANCE + 1, 0)).toBe(true);
  });
  it("is false at or under SNAP_DISTANCE", () => {
    expect(exceedsSnapDistance(0, 0, 2, 0)).toBe(false);
    expect(exceedsSnapDistance(0, 0, SNAP_DISTANCE, 0)).toBe(false);
  });
});
