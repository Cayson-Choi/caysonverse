import { describe, it, expect } from "vitest";
import { createRunGate, nextGait, nextGaitTimed, nextWalking } from "./locomotion";
import {
  RENDER_DELAY_MS,
  RUN_ENTER_MS,
  RUN_OFF_SPEED,
  RUN_ON_SPEED,
  WALK_OFF_SPEED,
  WALK_ON_SPEED,
} from "./constants";
import { pushSnapshot, sample } from "./interpolation";
import type { Snapshot } from "./interpolation";
import type { Gait } from "./gait";

describe("nextWalking (hysteresis)", () => {
  it("starts walking only above the ON threshold", () => {
    expect(nextWalking(false, WALK_ON_SPEED + 0.05)).toBe(true);
    expect(nextWalking(false, WALK_ON_SPEED)).toBe(false); // strictly above required
    expect(nextWalking(false, 0)).toBe(false);
  });

  it("stops walking only below the OFF threshold", () => {
    expect(nextWalking(true, WALK_OFF_SPEED - 0.05)).toBe(false);
    expect(nextWalking(true, WALK_OFF_SPEED)).toBe(true); // strictly below required
    expect(nextWalking(true, 5)).toBe(true);
  });

  it("holds the current state inside the hysteresis band", () => {
    const mid = (WALK_ON_SPEED + WALK_OFF_SPEED) / 2;
    expect(nextWalking(true, mid)).toBe(true);
    expect(nextWalking(false, mid)).toBe(false);
  });

  it("does not flap when speed jitters around the threshold", () => {
    // Simulate snapshot-boundary jitter oscillating within the band.
    let walking = false;
    const jitter = [0.35, 0.2, 0.25, 0.18, 0.22, 0.16]; // crosses ON once, then wobbles
    const states = jitter.map((v) => (walking = nextWalking(walking, v)));
    // Turned on at 0.35, then STAYS on through the sub-0.3 wobble (never < 0.15).
    expect(states).toEqual([true, true, true, true, true, true]);
  });

  it("turns off once speed clearly drops below OFF", () => {
    let walking = true;
    walking = nextWalking(walking, 0.1);
    expect(walking).toBe(false);
    walking = nextWalking(walking, 0.2); // band -> stays off
    expect(walking).toBe(false);
  });
});

describe("nextGait (idle / walk / run hysteresis)", () => {
  it("nextGait: walk→run above RUN_ON_SPEED, back below RUN_OFF_SPEED, holds in the band", () => {
    expect(nextGait("walk", RUN_ON_SPEED + 0.01)).toBe("run");
    expect(nextGait("run", (RUN_ON_SPEED + RUN_OFF_SPEED) / 2)).toBe("run");
    expect(nextGait("run", RUN_OFF_SPEED - 0.01)).toBe("walk");
    expect(nextGait("run", 0.1)).toBe("idle");
  });

  it("needs a speed STRICTLY above RUN_ON_SPEED to start running, strictly below RUN_OFF_SPEED to stop", () => {
    expect(nextGait("walk", RUN_ON_SPEED)).toBe("walk");
    expect(nextGait("run", RUN_OFF_SPEED)).toBe("run");
  });

  it("holds walk inside the run band (between RUN_OFF and RUN_ON)", () => {
    expect(nextGait("walk", (RUN_ON_SPEED + RUN_OFF_SPEED) / 2)).toBe("walk");
  });

  it("keeps the walk/idle hysteresis exactly as nextWalking defines it", () => {
    const mid = (WALK_ON_SPEED + WALK_OFF_SPEED) / 2;
    expect(nextGait("idle", WALK_ON_SPEED + 0.05)).toBe("walk");
    expect(nextGait("idle", WALK_ON_SPEED)).toBe("idle");
    expect(nextGait("idle", mid)).toBe("idle");
    expect(nextGait("walk", mid)).toBe("walk");
    expect(nextGait("walk", WALK_OFF_SPEED - 0.05)).toBe("idle");
    expect(nextGait("walk", WALK_OFF_SPEED)).toBe("walk");
  });

  it("a runner that starts from standing still goes straight to run", () => {
    expect(nextGait("idle", RUN_ON_SPEED + 0.5)).toBe("run");
  });

  it("a stopping runner drops through walk to idle without ever skipping the walk band", () => {
    let g: Gait = "run";
    g = nextGait(g, 5.0); // still above RUN_OFF → run
    expect(g).toBe("run");
    g = nextGait(g, 4.0); // below RUN_OFF, above WALK_OFF → walk
    expect(g).toBe("walk");
    g = nextGait(g, 0.0); // stopped → idle
    expect(g).toBe("idle");
  });

  it("a remote walking at MOVE_SPEED with ±30% interpolation jitter never shows the run cycle", () => {
    let g: Gait = "walk";
    for (const s of [2.8, 5.2, 3.1, 5.0, 4.4]) {
      g = nextGait(g, s);
      expect(g).not.toBe("run");
    }
    expect(g).toBe("walk");
  });

  it("a remote running at RUN_SPEED (6.4 m/s) keeps the run cycle through jitter dips that stay above RUN_OFF_SPEED", () => {
    let g: Gait = "walk";
    for (const s of [6.4, 5.9, 6.9, 5.5, 6.2, 5.0]) {
      g = nextGait(g, s);
    }
    expect(g).toBe("run");
  });
});

describe("nextGaitTimed (entering run needs a sustained speed)", () => {
  it("promotes to run only after the speed stayed above RUN_ON_SPEED for RUN_ENTER_MS", () => {
    expect(RUN_ENTER_MS).toBe(150);
    const gate = createRunGate();
    let g: Gait = "walk";
    g = nextGaitTimed(g, 6.4, 1000, gate); // first frame above RUN_ON: the clock starts
    expect(g).toBe("walk");
    g = nextGaitTimed(g, 6.4, 1000 + RUN_ENTER_MS - 1, gate); // 149 ms: still not enough
    expect(g).toBe("walk");
    g = nextGaitTimed(g, 6.4, 1000 + RUN_ENTER_MS, gate); // 150 ms: run
    expect(g).toBe("run");
  });

  it("a single frame at or below RUN_ON_SPEED restarts the clock", () => {
    const gate = createRunGate();
    let g: Gait = "walk";
    g = nextGaitTimed(g, 6.4, 0, gate);
    g = nextGaitTimed(g, 6.4, 100, gate);
    g = nextGaitTimed(g, RUN_ON_SPEED, 120, gate); // exactly ON is not "above": restart
    expect(g).toBe("walk");
    g = nextGaitTimed(g, 6.4, 140, gate); // clock restarts here
    g = nextGaitTimed(g, 6.4, 140 + RUN_ENTER_MS - 1, gate);
    expect(g).toBe("walk"); // 149 ms since the restart (289 ms since the first frame)
    g = nextGaitTimed(g, 6.4, 140 + RUN_ENTER_MS, gate);
    expect(g).toBe("run");
  });

  it("a runner starting from standing still shows walk first, then run once sustained", () => {
    const gate = createRunGate();
    let g: Gait = "idle";
    g = nextGaitTimed(g, 6.4, 0, gate);
    expect(g).toBe("walk"); // above WALK_ON, run not yet earned
    g = nextGaitTimed(g, 6.4, RUN_ENTER_MS, gate);
    expect(g).toBe("run");
  });

  it("leaving run is immediate and keeps the nextGait hysteresis band", () => {
    const gate = createRunGate();
    let g: Gait = "run";
    g = nextGaitTimed(g, (RUN_ON_SPEED + RUN_OFF_SPEED) / 2, 0, gate);
    expect(g).toBe("run"); // in the band: held
    g = nextGaitTimed(g, RUN_OFF_SPEED - 0.01, 10, gate);
    expect(g).toBe("walk"); // no delay when leaving run
    g = nextGaitTimed("run", 0.1, 20, gate);
    expect(g).toBe("idle");
  });

  it("matches nextGait everywhere except the run entry (walk / idle behaviour unchanged)", () => {
    const gate = createRunGate();
    const speeds = [0, 0.1, 0.2, 0.31, 1, 2.8, 4, 5.2, RUN_ON_SPEED, 4.9, 0.14, 0];
    let timed: Gait = "idle";
    let plain: Gait = "idle";
    speeds.forEach((s, i) => {
      timed = nextGaitTimed(timed, s, i * 16, gate);
      plain = nextGait(plain, s);
      expect(timed).toBe(plain);
    });
  });

  it("a stale clock cannot promote after the gate is reset (seat / respawn)", () => {
    const gate = createRunGate();
    nextGaitTimed("walk", 6.4, 0, gate);
    gate.aboveSince = -1; // what RemotePlayer does when the avatar sits down
    expect(nextGaitTimed("walk", 6.4, 5000, gate)).toBe("walk"); // clock restarted at 5000
  });
});

/** One scripted patch arrival for the end-to-end remote simulations below. */
interface Arrival {
  recv: number;
  x: number;
}

/**
 * A straight-line mover sending a patch every 100 ms (PATCH_RATE_MS) at `speed`
 * m/s. `delays[k % delays.length]` is how late patch k is; delivery is in order,
 * so a late patch drags the ones behind it into a burst (>= 10 ms apart).
 */
function arrivals(speed: number, delays: readonly number[], count: number): Arrival[] {
  const out: Arrival[] = [];
  let prevRecv = -Infinity;
  for (let k = 0; k < count; k++) {
    const recv = Math.max(100 * k + delays[k % delays.length], prevRecv + 10);
    out.push({ recv, x: speed * 0.1 * k });
    prevRecv = recv;
  }
  return out;
}

interface Frame {
  now: number;
  speed: number;
  gait: Gait;
}

/**
 * Drive the REAL remote pipeline the way RemotePlayer's frame does — sample the
 * buffer RENDER_DELAY_MS in the past, hold the previous speed, feed nextGaitTimed —
 * at 60 fps, and return every frame.
 */
function simulate(patches: readonly Arrival[], endMs: number): Frame[] {
  const buf: Snapshot[] = [];
  const gate = createRunGate();
  const frames: Frame[] = [];
  let next = 0;
  let held = 0;
  let gait: Gait = "idle";
  for (let now = 0; now <= endMs; now += 1000 / 60) {
    while (next < patches.length && patches[next].recv <= now) {
      pushSnapshot(buf, { t: patches[next].recv, x: patches[next].x, z: 0, yaw: 0 });
      next++;
    }
    const s = sample(buf, now - RENDER_DELAY_MS, held);
    if (s) {
      held = s.speed;
      gait = nextGaitTimed(gait, s.speed, now, gate);
      frames.push({ now, speed: s.speed, gait });
    }
  }
  return frames;
}

describe("remote gait end to end (interpolation + hold + run gate)", () => {
  it("a 4 m/s walker whose patches sometimes arrive 10 ms apart and sometimes 250 ms late never yields run", () => {
    // Late-then-burst delivery: 250 ms late patches are followed by patches 10 ms
    // apart (0.4 m each = 40 m/s on paper), and 120 / double-250 variants too.
    const delays = [0, 0, 250, 0, 0, 0, 120, 0, 250, 250, 0, 0, 0, 0];
    const patches = arrivals(4, delays, 140);
    const spans = patches.slice(1).map((p, i) => p.recv - patches[i].recv);
    expect(Math.min(...spans)).toBe(10); // the model really contains 10 ms bursts...
    expect(Math.max(...spans)).toBeGreaterThanOrEqual(250); // ...and 250 ms stalls
    const frames = simulate(patches, 13000);
    expect(frames.length).toBeGreaterThan(500);
    expect(frames.filter((f) => f.gait === "run")).toEqual([]);
    expect(Math.max(...frames.map((f) => f.speed))).toBeLessThanOrEqual(RUN_ON_SPEED); // not even a speed reading
    expect(frames.some((f) => f.gait === "walk")).toBe(true); // and it did walk
  });

  it("a real 6.4 m/s runner enters run within 200 ms of first reading above RUN_ON_SPEED", () => {
    const frames = simulate(arrivals(6.4, [0], 60), 5000);
    const firstFast = frames.find((f) => f.speed > RUN_ON_SPEED);
    const firstRun = frames.find((f) => f.gait === "run");
    expect(firstFast).toBeDefined();
    expect(firstRun).toBeDefined();
    const lag = firstRun!.now - firstFast!.now;
    expect(lag).toBeGreaterThanOrEqual(RUN_ENTER_MS);
    expect(lag).toBeLessThanOrEqual(200);
    // ...and it keeps running for the rest of the run (no flapping back to walk).
    expect(frames.filter((f) => f.now >= firstRun!.now).every((f) => f.gait === "run")).toBe(true);
  });

  it("a runner with ±25 ms delivery jitter (segments read 5.1-8.5 m/s, all above RUN_OFF_SPEED) reaches run and holds it", () => {
    const frames = simulate(arrivals(6.4, [0, 15, 0, 25, 0, 10], 60), 5000);
    const firstRun = frames.findIndex((f) => f.gait === "run");
    expect(firstRun).toBeGreaterThan(-1);
    expect(frames.slice(firstRun + 5).every((f) => f.gait === "run")).toBe(true);
  });
});
