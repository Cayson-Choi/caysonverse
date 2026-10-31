import { describe, it, expect } from "vitest";
import {
  pushSnapshot,
  remoteGaitSpeed,
  sample,
  exceedsSnapDistance,
  windowedSpeed,
  type Snapshot,
} from "./interpolation";
import { RUN_SPEED } from "@caysonverse/shared/constants";
import {
  EXTRAPOLATE_MAX_MS,
  EXTRAPOLATE_SETTLE_MS,
  RUN_ON_SPEED,
  SNAPSHOT_CAPACITY,
  SNAP_DISTANCE,
  SPEED_LONG_MIN_MS,
  SPEED_LONG_WINDOW_MS,
  SPEED_WINDOW_MS,
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

describe("sample — extrapolation (loss-hiding that converges to the rest pose)", () => {
  it("extrapolates at a real (sub-RUN_SPEED) segment velocity within the cap", () => {
    // 0.3m in x over 100ms => 3 m/s, BELOW RUN_SPEED (6.4) => passes through unclamped.
    const buf = [snap(0, 0, 0), snap(100, 0.3, 0)];
    // 100ms past the newest, inside the 250ms cap.
    const s = sample(buf, 200)!;
    expect(s.x).toBeCloseTo(0.6, 6); // 0.3 + 0.003 m/ms * 100ms
    expect(s.speed).toBeCloseTo(3, 4);
  });

  it("dead-reckons a running remote at its real speed — a RUN_SPEED segment is NOT clamped to the walk speed", () => {
    // 0.6m in x over 100ms => 6 m/s: a runner (above the 4 m/s walk speed, below RUN_SPEED).
    const buf = [snap(0, 0, 0), snap(100, 0.6, 0)];
    const s = sample(buf, 200)!;
    expect(s.x).toBeCloseTo(0.6 + 0.006 * 100, 6); // 1.2 — NOT 0.6 + 0.004*100 = 1.0
    expect(s.speed).toBeCloseTo(6, 4); // still reads above RUN_ON_SPEED (5.6) → run cycle
  });

  it("clamps a jitter-inflated segment velocity to RUN_SPEED (never flings through walls)", () => {
    // 0.4m received over 20ms READS as 20 m/s — receive-time burst, not real motion.
    const buf = [snap(0, 0, 0), snap(20, 0.4, 0)];
    // 100ms past the newest: clamped v = RUN_SPEED (6.4 m/s) = 0.0064 m/ms.
    const s = sample(buf, 120)!;
    expect(s.x).toBeCloseTo(0.4 + 0.0064 * 100, 6); // 1.04 — NOT 0.4 + 0.02*100 = 2.4
    expect(s.speed).toBeCloseTo(RUN_SPEED, 4);
    // Overshoot at the cap is bounded by RUN_SPEED * cap, not the inflated speed.
    const atCap = sample(buf, 20 + EXTRAPOLATE_MAX_MS)!;
    expect(atCap.x).toBeCloseTo(0.4 + (RUN_SPEED / 1000) * EXTRAPOLATE_MAX_MS, 6); // 2.0
  });

  it("eases back to the newest authoritative pose after the cap, then holds there", () => {
    const buf = [snap(0, 0, 0), snap(100, 1, 0)]; // 10 m/s => clamped to RUN_SPEED (6.4)
    const vClampMs = RUN_SPEED / 1000; // 0.0064 m/ms
    const overshootX = 1 + vClampMs * EXTRAPOLATE_MAX_MS; // 1 + 1.6 = 2.6 at the cap
    // Midway through the settle: partway back from the overshoot toward newest.x=1.
    const mid = sample(buf, 100 + EXTRAPOLATE_MAX_MS + EXTRAPOLATE_SETTLE_MS / 2)!;
    expect(mid.x).toBeCloseTo(overshootX + (1 - overshootX) * 0.5, 5);
    expect(mid.x).toBeGreaterThan(1); // still past, but heading home
    expect(mid.x).toBeLessThan(overshootX);
    expect(mid.speed).toBe(0); // a settling correction reads as idle, not a walk
    // After the settle completes: converged EXACTLY to the authoritative rest x=1.
    const settled = sample(buf, 100 + EXTRAPOLATE_MAX_MS + EXTRAPOLATE_SETTLE_MS + 500)!;
    expect(settled.x).toBeCloseTo(1, 6);
    expect(settled.z).toBeCloseTo(0, 6);
    expect(settled.speed).toBe(0);
  });

  it("converges an idle remote to its true stop point instead of freezing ~1m past it", () => {
    // The finding's trace: S1(1000,0), S2(1100,0.4 rest). The old code froze at x=1.4.
    const buf = [snap(1000, 0, 0), snap(1100, 0.4, 0)];
    // Long after the last patch (idle): must sit AT the authoritative rest x=0.4.
    const s = sample(buf, 1100 + EXTRAPOLATE_MAX_MS + EXTRAPOLATE_SETTLE_MS + 1000)!;
    expect(s.x).toBeCloseTo(0.4, 6);
    expect(s.speed).toBe(0);
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

/** A mover on the x axis sending one patch every 100 ms at `speed` m/s, for `count` patches from t=0. */
function steady(speed: number, count: number): Snapshot[] {
  return Array.from({ length: count }, (_, k) => snap(100 * k, speed * 0.1 * k, 0));
}

describe("windowedSpeed (path length over a trailing window)", () => {
  it("reads a steady mover's speed once the window is inside the buffer", () => {
    const buf = steady(4, 20);
    expect(windowedSpeed(buf, 1000, 300)).toBeCloseTo(4, 6);
    expect(windowedSpeed(buf, 1234, 300)).toBeCloseTo(4, 6);
    expect(windowedSpeed(steady(6.4, 20), 1000, 300)).toBeCloseTo(6.4, 6);
  });

  it("ramps up over the window when a move starts (the part before the first snapshot is still)", () => {
    const buf = steady(4, 20);
    expect(windowedSpeed(buf, 150, 300)).toBeCloseTo((4 * 0.15) / 0.3, 6); // 150 ms of the 300 ms window moved
    expect(windowedSpeed(buf, 300, 300)).toBeCloseTo(4, 6); // window just filled
    expect(windowedSpeed(buf, 0, 300)).toBe(0); // renderT at the first snapshot: nothing travelled yet
    expect(windowedSpeed(buf, -50, 300)).toBe(0);
  });

  it("decays linearly to 0 over the window after the last snapshot - dead reckoning past it never counts", () => {
    const buf = steady(4, 11); // last snapshot at t=1000
    expect(windowedSpeed(buf, 1000, 300)).toBeCloseTo(4, 6);
    expect(windowedSpeed(buf, 1100, 300)).toBeCloseTo((4 * 0.2) / 0.3, 6);
    expect(windowedSpeed(buf, 1250, 300)).toBeCloseTo((4 * 0.05) / 0.3, 6);
    expect(windowedSpeed(buf, 1300, 300)).toBe(0);
    expect(windowedSpeed(buf, 5000, 300)).toBe(0);
    // ...although the POSE keeps dead-reckoning past the newest snapshot (unchanged path):
    expect(sample(buf, 1100)!.x).toBeGreaterThan(buf[10].x);
  });

  it("counts path length, not net displacement - a runner circling at 6.4 m/s still reads as running", () => {
    const r = 1.2;
    const w = 6.4 / r; // rad/s
    const circle = Array.from({ length: 20 }, (_, k) => ({
      t: 100 * k,
      x: r * Math.cos(w * 0.1 * k),
      z: r * Math.sin(w * 0.1 * k),
      yaw: 0,
    }));
    for (const [windowMs, minDivisor] of [[SPEED_WINDOW_MS, SPEED_WINDOW_MS], [SPEED_LONG_WINDOW_MS, SPEED_LONG_MIN_MS]]) {
      const v = windowedSpeed(circle, 1000, windowMs, minDivisor);
      expect(v).toBeGreaterThan(6.3); // the polyline of the arc
      expect(v).toBeLessThanOrEqual(6.4 + 1e-9);
    }
    // Net displacement over the long window (6 steps = 3.2 rad round the circle) would read
    // far below RUN_OFF_SPEED - a runner doing laps would lose the run cycle.
    const chord = Math.hypot(circle[10].x - circle[4].x, circle[10].z - circle[4].z);
    expect(chord / 0.6).toBeLessThan(4.8);
  });

  it("divides by the larger of the elapsed span and minDivisorMs (no ramp-up for the long window)", () => {
    const buf = steady(4, 20);
    expect(windowedSpeed(buf, 400, 600, 150)).toBeCloseTo(4, 6); // 400 ms moved, divisor 400 ms
    expect(windowedSpeed(buf, 100, 600, 150)).toBeCloseTo((4 * 0.1) / 0.15, 6); // 100 ms moved, divisor floor 150 ms
    expect(windowedSpeed(buf, 400, 600)).toBeCloseTo((4 * 0.4) / 0.6, 6); // default divisor: the whole window
  });

  it("is 0 for fewer than two snapshots, a non-positive window, and zero-length time spans", () => {
    expect(windowedSpeed([], 100, 300)).toBe(0);
    expect(windowedSpeed([snap(0, 0, 0)], 100, 300)).toBe(0);
    expect(windowedSpeed(steady(4, 5), 200, 0)).toBe(0);
    const stacked = [snap(100, 0, 0), snap(100, 5, 0)]; // two patches with the same timestamp
    expect(windowedSpeed(stacked, 100, 300)).toBe(0);
    expect(Number.isNaN(windowedSpeed(stacked, 150, 300))).toBe(false);
  });

  it("measures the z axis and diagonals too", () => {
    const buf = [snap(0, 0, 0), snap(100, 0.3, 0.4), snap(200, 0.6, 0.8), snap(300, 0.9, 1.2)];
    expect(windowedSpeed(buf, 300, 300)).toBeCloseTo(5, 6); // 0.5 m per 100 ms
  });
});

describe("remoteGaitSpeed (smaller of the short and long windows)", () => {
  it("equals the plain speed for a steady mover", () => {
    expect(remoteGaitSpeed(steady(4, 20), 1000)).toBeCloseTo(4, 6);
    expect(remoteGaitSpeed(steady(6.4, 20), 1000)).toBeCloseTo(6.4, 6);
  });

  it("is not fooled by a stall-then-catch-up burst that the short window alone reads as a sprint", () => {
    // A 4 m/s walker whose patch was 320 ms late, then three patches queued behind it
    // arrived 10-30 ms apart: 0.4 m steps at 400 ms of wall-clock per 1.6 m.
    const buf = [
      snap(720, 2.4, 0),
      snap(730, 2.8, 0),
      snap(1050, 3.2, 0),
      snap(1150, 3.6, 0),
      snap(1160, 4.0, 0),
      snap(1170, 4.4, 0),
      snap(1200, 4.8, 0),
      snap(1300, 5.2, 0),
      snap(1400, 5.6, 0),
    ];
    const renderT = 1333;
    const short = windowedSpeed(buf, renderT, SPEED_WINDOW_MS);
    const long = windowedSpeed(buf, renderT, SPEED_LONG_WINDOW_MS, SPEED_LONG_MIN_MS);
    expect(short).toBeGreaterThan(RUN_ON_SPEED); // would promote a walker to run
    expect(long).toBeLessThan(RUN_ON_SPEED); // the long window contains the whole stall
    expect(remoteGaitSpeed(buf, renderT)).toBeCloseTo(long, 9);
  });

  it("still ramps and decays on the short window (the long reading must not delay stopping)", () => {
    const buf = steady(6.4, 11);
    expect(remoteGaitSpeed(buf, 1000)).toBeCloseTo(6.4, 6);
    expect(remoteGaitSpeed(buf, 1100)).toBeCloseTo((6.4 * 0.2) / 0.3, 6); // decaying: min picks the short window
    expect(remoteGaitSpeed(buf, 1300)).toBe(0);
    expect(remoteGaitSpeed(buf, 150)).toBeCloseTo((6.4 * 0.15) / 0.3, 6); // ramping
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
