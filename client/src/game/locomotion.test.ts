import { describe, it, expect } from "vitest";
import { MOVE_SPEED, RUN_SPEED } from "@caysonverse/shared/constants";
import { nextGait, nextWalking } from "./locomotion";
import {
  RUN_OFF_SPEED,
  RUN_ON_SPEED,
  WALK_OFF_SPEED,
  WALK_ON_SPEED,
} from "./constants";
import { sample } from "./interpolation";
import type { Snapshot } from "./interpolation";
import { advancePlayout, createPlayout, playoutGaitSpeed, receivePose } from "./playout";
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
    g = nextGait(g, RUN_OFF_SPEED + 0.2); // still above RUN_OFF → run
    expect(g).toBe("run");
    g = nextGait(g, RUN_OFF_SPEED - 0.5); // below RUN_OFF, above WALK_OFF → walk
    expect(g).toBe("walk");
    g = nextGait(g, 0.0); // stopped → idle
    expect(g).toBe("idle");
  });

  it("a remote walking at MOVE_SPEED with ±30% interpolation jitter never shows the run cycle", () => {
    let g: Gait = "walk";
    for (const s of [0.7, 1.3, 0.78, 1.25, 1.1].map((f) => MOVE_SPEED * f)) {
      g = nextGait(g, s);
      expect(g).not.toBe("run");
    }
    expect(g).toBe("walk");
  });

  it("a remote running at RUN_SPEED (6.4 m/s) keeps the run cycle through jitter dips that stay above RUN_OFF_SPEED", () => {
    let g: Gait = "walk";
    for (const s of [1, 0.92, 1.08, 0.86, 0.97, 0.78].map((f) => RUN_SPEED * f)) {
      g = nextGait(g, s);
    }
    expect(g).toBe("run");
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
 * so a late patch drags the ones behind it into a burst (>= `minGap` ms apart).
 */
function arrivals(
  speed: number,
  delays: readonly number[],
  count: number,
  minGap = 10,
): Arrival[] {
  const out: Arrival[] = [];
  let prevRecv = -Infinity;
  for (let k = 0; k < count; k++) {
    const recv = Math.max(100 * k + delays[k % delays.length], prevRecv + minGap);
    out.push({ recv, x: speed * 0.1 * k });
    prevRecv = recv;
  }
  return out;
}

interface Frame {
  now: number;
  speed: number;
  gait: Gait;
  /** Where the avatar is drawn (x) on this frame. */
  x: number;
}

/**
 * Drive the REAL remote pipeline the way RemotePlayer's frame does - receivePose on
 * each arrival, advancePlayout, sample, playoutGaitSpeed, nextGait - at 60 fps, and
 * return every frame (from the first patch on). These patches carry no mover clock:
 * this is the arrival-time fallback, the harder case for the gait (bursts stay in it).
 */
function simulate(patches: readonly Arrival[], endMs: number): Frame[] {
  const buf: Snapshot[] = [];
  const pl = createPlayout();
  const frames: Frame[] = [];
  let next = 0;
  let gait: Gait = "idle";
  for (let now = 0; now <= endMs; now += 1000 / 60) {
    while (next < patches.length && patches[next].recv <= now) {
      receivePose(pl, buf, patches[next].recv, 0, patches[next].x, 0, 0);
      next++;
    }
    if (buf.length === 0) continue;
    const renderT = advancePlayout(pl, buf, now);
    const speed = playoutGaitSpeed(pl, buf);
    gait = nextGait(gait, speed);
    frames.push({ now, speed, gait, x: sample(buf, renderT)!.x });
  }
  return frames;
}

/** The late-patch schedule: single and double 250 ms stalls, a 120 ms one, quiet stretches between. */
const STALLS = [0, 0, 250, 0, 0, 0, 120, 0, 250, 250, 0, 0, 0, 0];
const HEAVY_JITTER = [0, 30, 0, 50, 10, 0, 40];
const LIGHT_JITTER = [0, 15, 0, 25, 0, 10];

describe("remote gait end to end (interpolation windows + hysteresis)", () => {
  it("a MOVE_SPEED walker whose patches sometimes arrive 10 ms apart and sometimes 250 ms late never yields run", () => {
    const patches = arrivals(MOVE_SPEED, STALLS, 140, 10);
    const spans = patches.slice(1).map((p, i) => p.recv - patches[i].recv);
    expect(Math.min(...spans)).toBe(10); // the model really contains 10 ms bursts...
    expect(Math.max(...spans)).toBeGreaterThanOrEqual(250); // ...and 250 ms stalls
    const frames = simulate(patches, 13000);
    expect(frames.length).toBeGreaterThan(500);
    expect(frames.filter((f) => f.gait === "run")).toEqual([]);
    expect(frames.some((f) => f.gait === "walk")).toBe(true); // and it did walk
  });

  it.each([45, 60, 70, 71])(
    "a MOVE_SPEED walker whose burst patches arrive %i ms apart never yields run",
    (gap) => {
      const patches = arrivals(MOVE_SPEED, STALLS, 140, gap);
      const spans = patches.slice(1).map((p, i) => p.recv - patches[i].recv);
      expect(spans.filter((s) => s === gap).length).toBeGreaterThan(10); // the bursts really are `gap` ms apart
      const frames = simulate(patches, 13000);
      expect(frames.length).toBeGreaterThan(500);
      expect(frames.filter((f) => f.gait === "run")).toEqual([]);
    },
  );

  it.each([
    ["[0,30,0,50,10,0,40]", HEAVY_JITTER],
    ["[0,15,0,25,0,10]", LIGHT_JITTER],
  ])("a MOVE_SPEED walker under delivery delays %s ms never yields run", (_name, delays) => {
    const frames = simulate(arrivals(MOVE_SPEED, delays, 140), 13000);
    expect(frames.length).toBeGreaterThan(500);
    expect(frames.filter((f) => f.gait === "run")).toEqual([]);
    expect(frames.some((f) => f.gait === "walk")).toBe(true);
  });

  /**
   * A RUN_SPEED (6.4 m/s) runner sending 60 patches then stopping. `enterMs` = how long after
   * its first movement is rendered the run cycle starts; `fraction` = share of the
   * frames from then until the last patch is rendered that are in run.
   */
  function runnerOutcome(delays: readonly number[]): {
    enterMs: number;
    fraction: number;
    leaveMs: number;
  } {
    const patches = arrivals(RUN_SPEED, delays, 60);
    const endX = patches[patches.length - 1].x;
    const frames = simulate(patches, patches[patches.length - 1].recv + 1500);
    const moveStart = frames.find((f) => f.x > 0)!.now; // the avatar starts moving on screen
    const stopped = frames.find((f) => f.x >= endX)!.now; // ...and reaches the stop on screen
    const firstRun = frames.find((f) => f.gait === "run");
    expect(firstRun).toBeDefined();
    const whileRunning = frames.filter((f) => f.now >= firstRun!.now && f.now <= stopped);
    const left = frames.find((f) => f.now > stopped && f.gait !== "run");
    expect(left).toBeDefined();
    return {
      enterMs: firstRun!.now - moveStart,
      fraction: whileRunning.filter((f) => f.gait === "run").length / whileRunning.length,
      leaveMs: left!.now - stopped,
    };
  }

  it("a clean 6.4 m/s runner enters run within 400 ms and stays in it", () => {
    const o = runnerOutcome([0]);
    expect(o.enterMs).toBeLessThanOrEqual(400);
    expect(o.fraction).toBeGreaterThanOrEqual(0.99);
  });

  it("a 6.4 m/s runner under delivery delays [0,30,0,50,10,0,40] ms (full profile) enters run within 600 ms and is in run on >= 90% of frames after", () => {
    const o = runnerOutcome(HEAVY_JITTER);
    expect(o.enterMs).toBeLessThanOrEqual(600);
    expect(o.fraction).toBeGreaterThanOrEqual(0.9);
  });

  it("a 6.4 m/s runner under delivery delays [0,15,0,25,0,10] ms enters run within 400 ms and is in run on >= 95% of frames after", () => {
    const o = runnerOutcome(LIGHT_JITTER);
    expect(o.enterMs).toBeLessThanOrEqual(400);
    expect(o.fraction).toBeGreaterThanOrEqual(0.95);
  });

  it.each([
    ["clean", [0]],
    ["[0,30,0,50,10,0,40]", HEAVY_JITTER],
    ["[0,15,0,25,0,10]", LIGHT_JITTER],
  ])("a runner who stops (%s) leaves run within 150 ms of stopping on screen", (_name, delays) => {
    expect(runnerOutcome(delays).leaveMs).toBeLessThanOrEqual(150);
  });

  it("a runner who stops comes to idle without running again (straight from run: held on its last pose before its speed falls under RUN_OFF_SPEED)", () => {
    const patches = arrivals(RUN_SPEED, [0], 60);
    const last = patches[patches.length - 1].recv;
    const frames = simulate(patches, last + 2000).filter((f) => f.now > last);
    const order: Gait[] = [];
    for (const f of frames) if (order[order.length - 1] !== f.gait) order.push(f.gait);
    expect(order[0]).toBe("run");
    expect(order[order.length - 1]).toBe("idle");
    expect(order.slice(1).includes("run")).toBe(false);
  });
});
