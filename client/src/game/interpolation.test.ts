import { describe, it, expect } from "vitest";
import {
  pushSnapshot,
  sample,
  exceedsSnapDistance,
  type Snapshot,
} from "./interpolation";
import { RUN_SPEED } from "@caysonverse/shared/constants";
import {
  EXTRAPOLATE_MAX_MS,
  EXTRAPOLATE_SETTLE_MS,
  SNAPSHOT_CAPACITY,
  SNAP_DISTANCE,
  SPEED_MIN_SPAN_MS,
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
    // 0.6m received over SPEED_MIN_SPAN_MS (the shortest span that still counts as a
    // speed sample) READS as 8.6 m/s — a receive-time burst, not real motion.
    const span = SPEED_MIN_SPAN_MS;
    const buf = [snap(0, 0, 0), snap(span, 0.6, 0)];
    // 100ms past the newest: clamped v = RUN_SPEED (6.4 m/s) = 0.0064 m/ms.
    const s = sample(buf, span + 100)!;
    expect(s.x).toBeCloseTo(0.6 + 0.0064 * 100, 6); // 1.24 — NOT 0.6 + (0.6/70)*100 = 1.46
    expect(s.speed).toBeCloseTo(RUN_SPEED, 4);
    // Overshoot at the cap is bounded by RUN_SPEED * cap, not the inflated speed.
    const atCap = sample(buf, span + EXTRAPOLATE_MAX_MS)!;
    expect(atCap.x).toBeCloseTo(0.6 + (RUN_SPEED / 1000) * EXTRAPOLATE_MAX_MS, 6); // 2.2
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

describe("sample — burst spans never produce a speed sample", () => {
  it("holds the previous speed for a bracket shorter than SPEED_MIN_SPAN_MS (position still interpolates)", () => {
    // Two patches 10ms apart (0.4m) would read 40 m/s — a receive-time burst.
    // (45-60ms gaps read 6.7-8.9 m/s and are held for the same reason.)
    const buf = [snap(0, 0, 0), snap(10, 0.4, 0)];
    const held = sample(buf, 5, 3.5)!;
    expect(held.speed).toBe(3.5); // the caller's previous speed, NOT 40 m/s
    expect(held.x).toBeCloseTo(0.2, 6); // the pose itself is still the linear interpolation
    // With nothing held yet (default), a burst bracket reads idle rather than a huge speed.
    expect(sample(buf, 5)!.speed).toBe(0);
  });

  it("the shortest span that still counts is exactly SPEED_MIN_SPAN_MS", () => {
    expect(SPEED_MIN_SPAN_MS).toBe(70);
    const justShort = [snap(0, 0, 0), snap(SPEED_MIN_SPAN_MS - 1, 0.4, 0)];
    expect(sample(justShort, 10, 2)!.speed).toBe(2); // 69ms: held
    const exactly = [snap(0, 0, 0), snap(SPEED_MIN_SPAN_MS, 0.4, 0)];
    expect(sample(exactly, 10, 2)!.speed).toBeCloseTo(0.4 / 0.07, 6); // 70ms: a real sample (0.4m / 0.07s)
  });

  it("extrapolating off a burst last segment holds the previous speed but still dead-reckons the position", () => {
    const buf = [snap(0, 0, 0), snap(10, 0.4, 0)]; // 40 m/s on paper
    const s = sample(buf, 60, 4.2)!; // 50ms past the newest, inside the extrapolation window
    expect(s.speed).toBe(4.2); // held — a walker is not promoted to a runner for 250ms
    expect(s.x).toBeCloseTo(0.4 + (RUN_SPEED / 1000) * 50, 6); // position behaviour unchanged (clamped to RUN_SPEED)
  });

  it("a settling correction after the window still reads idle whatever speed was held", () => {
    const buf = [snap(0, 0, 0), snap(10, 0.4, 0)];
    const s = sample(buf, 10 + EXTRAPOLATE_MAX_MS + EXTRAPOLATE_SETTLE_MS + 500, 4.2)!;
    expect(s.speed).toBe(0);
    expect(s.x).toBeCloseTo(0.4, 6);
  });

  it("a normal 100ms bracket ignores the held speed and measures its own", () => {
    const buf = [snap(0, 0, 0), snap(100, 0.4, 0)];
    expect(sample(buf, 50, 9.9)!.speed).toBeCloseTo(4, 6);
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
