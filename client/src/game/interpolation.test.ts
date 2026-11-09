import { describe, it, expect } from "vitest";
import { MOVE_SPEED } from "@caysonverse/shared/constants";
import {
  isResting,
  motionStart,
  pushSnapshot,
  remoteGaitSpeed,
  restTailStart,
  sample,
  exceedsSnapDistance,
  turnStart,
  windowedSpeed,
  type Snapshot,
} from "./interpolation";
import {
  TURN_SPEED,
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

describe("sample — never past the newest snapshot (no dead reckoning: fix/remote-move-snapback)", () => {
  it("holds the newest pose once renderT reaches it — a stopped walker does not run on and slide back", () => {
    // A 4 m/s walker's last two patches: the stop pose is x = 0.4. The old code dead-reckoned to x = 1.4
    // over the next 250 ms (4 m/s) and then eased back to 0.4: the reported "goes ahead, comes back".
    const buf = [snap(1000, 0, 0, 0.3), snap(1100, 0.4, 0, 0.5)];
    for (const renderT of [1100, 1101, 1150, 1250, 1350, 1500, 5000]) {
      const s = sample(buf, renderT)!;
      expect(s.x).toBe(0.4);
      expect(s.z).toBe(0);
      expect(s.yaw).toBe(0.5);
      expect(s.speed).toBe(0);
    }
  });

  it("a runner's drawn x is non-decreasing frame by frame and never exceeds the newest server x", () => {
    // 6.4 m/s on x, a patch every 100 ms, then a stop: sample every 16 ms well past the end.
    const buf = Array.from({ length: 8 }, (_, k) => snap(100 * k, 0.64 * k, 0));
    let prev = -Infinity;
    for (let renderT = 0; renderT <= 1500; renderT += 16) {
      const x = sample(buf, renderT)!.x;
      expect(x).toBeGreaterThanOrEqual(prev);
      expect(x).toBeLessThanOrEqual(buf[buf.length - 1].x);
      prev = x;
    }
    expect(prev).toBeCloseTo(0.64 * 7, 9); // ends exactly on the server's stop
  });

  it("a late patch makes the avatar wait on the newest pose, then continue from there (no overshoot, no step back)", () => {
    const buf = [snap(0, 0, 0), snap(100, 0.4, 0)];
    const waiting = sample(buf, 180)!; // the next patch is late: hold
    expect(waiting.x).toBe(0.4);
    buf.push(snap(260, 0.8, 0)); // it arrives
    const after = sample(buf, 181)!;
    expect(after.x).toBeGreaterThanOrEqual(waiting.x); // forward from where it waited
    expect(after.x).toBeLessThan(0.8);
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

describe("sample — a resting pair (a stop and the next start, or a join and the first move)", () => {
  it("stands on the first pose, then steps off at MOVE_SPEED just in time to reach the second", () => {
    // 0.4 m after a 1 s pause: a straight line would creep through the whole pause.
    const buf = [snap(0, 0, 0, 0), snap(1000, 0.4, 0, 1)];
    const stepOff = 1000 - (0.4 / MOVE_SPEED) * 1000; // 900
    expect(restTailStart(buf[0], buf[1])).toBeCloseTo(stepOff, 9);
    expect(sample(buf, 500)!.x).toBe(0);
    expect(sample(buf, stepOff)!.x).toBe(0);
    expect(sample(buf, 950)!.x).toBeCloseTo(0.2, 9);
    expect(sample(buf, 950)!.speed).toBeCloseTo(MOVE_SPEED, 9);
    expect(sample(buf, 1000)!.x).toBe(0.4);
    // The facing turns with the step-off, not across the whole pause (it used to be half-way round at 500 ms).
    expect(sample(buf, 500)!.yaw).toBe(0);
    expect(sample(buf, stepOff)!.yaw).toBe(0);
    expect(sample(buf, 950)!.yaw).toBeCloseTo(0.5, 9);
    expect(sample(buf, 1000)!.yaw).toBe(1);
  });

  it("is resting when slow or long; a moving pair - merged patches included - is a straight line", () => {
    expect(isResting(snap(0, 0, 0), snap(300, 0.1, 0))).toBe(true); // 0.33 m/s
    expect(isResting(snap(0, 0, 0), snap(1200, 0.75, 0))).toBe(true); // a join, then a run's first patch
    expect(isResting(snap(0, 0, 0), snap(117, 0.47, 0))).toBe(false); // a walk step
    expect(isResting(snap(0, 0, 0), snap(234, 1.5, 0))).toBe(false); // two run steps merged into one patch
    expect(restTailStart(snap(0, 0, 0), snap(117, 0.47, 0))).toBe(0);
    expect(isResting(snap(0, 0, 0), snap(1000, 6, 0))).toBe(true); // long...
    expect(restTailStart(snap(0, 0, 0), snap(1000, 6, 0))).toBe(0); // ...but a long hop moves the whole way
  });
});

describe("sample — the facing across a pause turns with the step-off (fix: remote sit/stand)", () => {
  it("stands still facing the old way, then turns at most at TURN_SPEED just before it steps off", () => {
    // Stood still 3 s facing +x (yaw PI/2), then a first walk step 0.4 m along -x (yaw -PI/2): a 180° turn.
    const a = snap(0, 0, 0, PI / 2);
    const b = snap(3000, -0.4, 0, -PI / 2);
    const turnMs = (PI / TURN_SPEED) * 1000; // 262 ms: longer than the 100 ms step-off
    expect(turnStart(a, b)).toBeCloseTo(3000 - turnMs, 6);
    expect(motionStart(a, b)).toBeCloseTo(3000 - turnMs, 6);
    // The old sample turned across the whole 3 s pause: at 2750 ms (where a skipping render time lands) it already
    // faced 165° round — the one-frame spin viewers saw.
    expect(Math.abs(sample([a, b], 2700)!.yaw - PI / 2)).toBeLessThan(1e-9);
    // Over the turn, never faster than TURN_SPEED.
    let prev = sample([a, b], 2700)!.yaw;
    for (let t = 2700 + 1000 / 60; t <= 3000; t += 1000 / 60) {
      const yaw = sample([a, b], t)!.yaw;
      expect(Math.abs(Math.atan2(Math.sin(yaw - prev), Math.cos(yaw - prev)))).toBeLessThanOrEqual((TURN_SPEED * 1000) / 60 / 1000 + 1e-9);
      prev = yaw;
    }
    expect(sample([a, b], 3000)!.yaw).toBeCloseTo(-PI / 2, 9);
  });

  it("consecutive moves (a turn on the spot, e.g. pushing against a wall) still turn across the whole pair", () => {
    const a = snap(0, 0, 0, 0);
    const b = snap(100, 0, 0, 0.6);
    expect(isResting(a, b)).toBe(true); // no ground speed...
    expect(turnStart(a, b)).toBe(0); // ...but one send interval apart: a smooth turn
    expect(sample([a, b], 50)!.yaw).toBeCloseTo(0.3, 9);
  });
});

describe("sample — a placed pose (the server put the avatar on a seat / its dismount spot)", () => {
  it("is not walked to: the previous pose (position and facing) holds up to it, then it is there", () => {
    const a = snap(0, 1, 2, 0.5);
    const b: Snapshot = { t: 300, x: 2.2, z: 2, yaw: -2.6, placed: true };
    expect(isResting(a, b)).toBe(true);
    expect(restTailStart(a, b)).toBe(300);
    expect(turnStart(a, b)).toBe(300);
    for (const t of [0, 100, 250, 299.9]) expect(sample([a, b], t)).toEqual({ x: 1, z: 2, yaw: 0.5, speed: 0 });
    expect(sample([a, b], 300)).toEqual({ x: 2.2, z: 2, yaw: -2.6, speed: 0 });
    // (The old sample walked the 1.2 m from the step-off on: through a legacy chair's back.)
  });

  it("counts for no ground speed (the gait does not walk the avatar onto a seat)", () => {
    const buf: Snapshot[] = [snap(0, 0, 0), snap(100, 0.4, 0), { t: 150, x: 1.6, z: 0, yaw: 0, placed: true }];
    expect(windowedSpeed(buf, 150, 150)).toBeCloseTo(0.4 / 0.15, 9); // only the real step
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
    // ...and the POSE holds the newest snapshot meanwhile (no dead reckoning past it):
    expect(sample(buf, 1100)!.x).toBe(buf[10].x);
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
