import { describe, expect, it } from "vitest";
import { MOVE_SPEED, RUN_SPEED } from "@caysonverse/shared/constants";
import { APPEARANCE_PRESETS, DEFAULT_APPEARANCE, applyPreset } from "@caysonverse/shared/appearance";
import { lookFromAppearance, type AvatarLook } from "./characterLook";
import { ANIM_FADE, RUN_OFF_SPEED, RUN_ON_SPEED } from "./constants";
import type { Gait } from "./gait";
import {
  BACKSTEP_COS,
  BACKSTEP_MS,
  FORESTEP_COS,
  LOOP_START_FADE,
  LOOP_START_SPEED,
  LOOP_SWITCH_FADE,
  LOOP_STOP_MS,
  LOOP_STOP_SPEED,
  LOOP_STRIDE,
  MAX_LOOP_SCALE,
  MAX_STEP_SPEED,
  REMOTE_SPEED_SMOOTH_S,
  alongFacing,
  createLoopDriver,
  handoverTime,
  loopFade,
  loopSpeed,
  lookStride,
  loopRate,
  loopTimeScale,
  stepFacing,
  stepLoop,
  type LookStride,
  type LoopStride,
} from "./stride";

const preset = (id: string): AvatarLook => {
  const p = APPEARANCE_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`no preset ${id}`);
  return lookFromAppearance(applyPreset(DEFAULT_APPEARANCE, p));
};
const PANTS = lookStride(lookFromAppearance(DEFAULT_APPEARANCE));
const FAIRY = lookStride(preset("fairy")); // petal_skirt -> *_ShortSkirt
const PRINCESS = lookStride(preset("princess")); // longskirt -> *_LongSkirt
const LOOKS: [string, LookStride][] = [
  ["pants", PANTS],
  ["fairy (petal_skirt)", FAIRY],
  ["princess (longskirt)", PRINCESS],
];
const FRAME = 1 / 60;
/** Clip lengths (s) of the walk and run loops in character.glb (every variant keeps its base loop's timing). */
const WALK_D = 1.0417;
const RUN_D = 0.7917;

/** Steps a second (two a loop) of a loop of stride `s` and `duration` s played at ground speed `v`. */
function cadence(s: LoopStride, v: number, duration: number): number {
  let t = 0;
  for (let k = 0; k < 1000; k++) t += duration / 1000 / loopRate(s, v, (k + 0.5) / 1000);
  return 2 / t;
}

/** Run `stepLoop` over `frames` frames of the same reading; returns the loop after each. */
function drive(start: Gait, moving: boolean, speeds: readonly number[], smoothS = 0): Gait[] {
  const d = createLoopDriver();
  let loop = start;
  return speeds.map((v) => (loop = stepLoop(d, loop, moving, v, FRAME, smoothS)));
}

describe("the speeds (발주자 2026-11-10: slow the walk so the steps carry the body)", () => {
  it("walks at 2 m/s and still runs at 6.4 m/s", () => {
    expect(MOVE_SPEED).toBe(2);
    expect(RUN_SPEED).toBe(6.4);
  });
});

describe("lookStride", () => {
  it("gives each look the strides of the loops it actually plays (clipFor)", () => {
    expect(PANTS).toEqual({ walk: LOOP_STRIDE.Walking_A, run: LOOP_STRIDE.Running_A });
    expect(FAIRY).toEqual({ walk: LOOP_STRIDE.Walking_A_ShortSkirt, run: LOOP_STRIDE.Running_A_ShortSkirt });
    expect(PRINCESS).toEqual({ walk: LOOP_STRIDE.Walking_A_LongSkirt, run: LOOP_STRIDE.Running_A_LongSkirt });
  });
});

describe("stepLoop: which loop is on the body", () => {
  it("is Idle whenever the avatar is not moving, whatever the speed", () => {
    for (const cur of ["idle", "walk", "run"] as Gait[]) {
      expect(stepLoop(createLoopDriver(), cur, false, RUN_SPEED, FRAME)).toBe("idle");
    }
  });

  it("walks with the walk cycle and runs with the run cycle, for every look", () => {
    expect(drive("idle", true, [MOVE_SPEED])).toEqual(["walk"]);
    expect(drive("idle", true, [RUN_SPEED])).toEqual(["run"]);
    expect(drive("walk", true, [RUN_SPEED])).toEqual(["run"]);
    expect(drive("run", true, [MOVE_SPEED])).toEqual(["walk"]);
  });

  it("shows the run cycle on a tab still walking at the old 4 m/s (only it keeps its feet at that speed)", () => {
    expect(drive("idle", true, [4])).toEqual(["run"]);
    expect(drive("walk", true, [4.1])).toEqual(["run"]);
  });

  it("switches walk -> run above RUN_ON_SPEED and back below RUN_OFF_SPEED, holding in between", () => {
    const mid = (RUN_ON_SPEED + RUN_OFF_SPEED) / 2;
    expect(drive("walk", true, [mid, RUN_ON_SPEED + 0.01])).toEqual(["walk", "run"]);
    expect(drive("run", true, [mid, RUN_OFF_SPEED - 0.01])).toEqual(["run", "walk"]);
  });

  it("steps off from Idle only once the body goes faster than LOOP_START_SPEED", () => {
    expect(drive("idle", true, [LOOP_START_SPEED, LOOP_START_SPEED + 0.01])).toEqual(["idle", "walk"]);
  });

  it("holds a loop through a few frames the body did not move, then stands in Idle (pushed into a wall)", () => {
    const frames = Math.ceil(LOOP_STOP_MS / 1000 / FRAME);
    const loops = drive("walk", true, Array(frames + 1).fill(0));
    expect(loops.slice(0, frames - 1).every((l) => l === "walk")).toBe(true);
    expect(loops[loops.length - 1]).toBe("idle");
    // ...and a slow slide along the wall keeps stepping (slowly)
    expect(drive("walk", true, Array(60).fill(LOOP_STOP_SPEED + 0.05)).every((l) => l === "walk")).toBe(true);
  });

  it("a remote's smoothed speed: it steps off walking, runs once the smoothed speed gets there, and a one-frame hold neither stops nor resets it", () => {
    const d = createLoopDriver();
    // A remote's drawn pose steps off at MOVE_SPEED (interpolation restTailStart): it steps off on the walk cycle
    expect(stepLoop(d, "idle", true, RUN_SPEED, FRAME, REMOTE_SPEED_SMOOTH_S)).toBe("walk");
    expect(d.speed).toBe(MOVE_SPEED);
    // ...and a body that really goes at run speed is on the run cycle within a few frames (under 0.1 s)
    const loops = [];
    let loop: Gait = "walk";
    for (let k = 0; k < 6; k++) loops.push((loop = stepLoop(d, loop, true, RUN_SPEED, FRAME, REMOTE_SPEED_SMOOTH_S)));
    expect(loops.slice(-1)).toEqual(["run"]);
    for (let k = 0; k < 60; k++) stepLoop(d, "run", true, RUN_SPEED, FRAME, REMOTE_SPEED_SMOOTH_S);
    expect(d.speed).toBeCloseTo(RUN_SPEED, 2);
    expect(stepLoop(d, "run", true, 0, FRAME, REMOTE_SPEED_SMOOTH_S)).toBe("run");
    expect(d.speed).toBe(0); // the body held its pose this frame: so do the feet
    stepLoop(d, "run", true, RUN_SPEED * 1.1, FRAME, REMOTE_SPEED_SMOOTH_S);
    expect(d.speed).toBeGreaterThan(RUN_SPEED); // eased from where it was, not from 0
    expect(d.speed).toBeLessThan(RUN_SPEED * 1.1);
  });

  it("takes no step from a reading no body moves at (a remote's drawn pose re-seeded: 12-24 m/s for a frame)", () => {
    // from standing: stays in Idle (no run cycle at up to 4.5x), and the next real reading steps off as usual
    const d = createLoopDriver();
    expect(stepLoop(d, "idle", true, 20, FRAME, REMOTE_SPEED_SMOOTH_S)).toBe("idle");
    expect(d.speed).toBe(0);
    expect(stepLoop(d, "idle", true, MOVE_SPEED, FRAME, REMOTE_SPEED_SMOOTH_S)).toBe("walk");
    expect(d.speed).toBe(MOVE_SPEED);
    // while walking: the frame holds the pose and leaves the smoothed speed alone
    expect(stepLoop(d, "walk", true, MAX_STEP_SPEED + 1, FRAME, REMOTE_SPEED_SMOOTH_S)).toBe("walk");
    expect(d.speed).toBe(0);
    expect(d.ema).toBe(MOVE_SPEED);
    // every real reading is under the line: a running remote drawn 10 percent fast, with jitter; a stale 4 m/s tab
    expect(MAX_STEP_SPEED).toBeGreaterThan(RUN_SPEED * 1.1 * 1.3);
    expect(drive("idle", true, [RUN_SPEED * 1.1])).toEqual(["run"]);
  });

  // Review 2026-11-10 (round 2), measured: a viewer that has just joined draws a walking remote jerkily for its first
  // frames (shaders still compiling, its data catching up): one to three frames read 4-15 m/s. Stepping off at once
  // from that reading put the run cycle on a walker for 0.1-0.2 s, in 5 of 22 joins.
  it("a remote just mounted does not step off on the run cycle from a few jerky frames of a walker", () => {
    for (const burst of [[8.56, 4.93, 3.11], [14.45, 4.32], [5.98, 16, 0.79], [9.3, 6.7, 0.4]]) {
      const d = createLoopDriver();
      let loop: Gait = "idle";
      const loops = [...burst, ...Array(30).fill(MOVE_SPEED)].map((v) => (loop = stepLoop(d, loop, true, v, FRAME, REMOTE_SPEED_SMOOTH_S)));
      expect(loops.includes("run")).toBe(false);
      expect(loops.at(-1)).toBe("walk");
    }
    // the local player's own speed is exact: a start at run speed is on the run cycle from the first frame
    expect(drive("idle", true, [RUN_SPEED])).toEqual(["run"]);
  });

  it("smooths frame-rate independently", () => {
    const a = createLoopDriver();
    const b = createLoopDriver();
    stepLoop(a, "idle", true, MOVE_SPEED, FRAME, REMOTE_SPEED_SMOOTH_S);
    stepLoop(b, "idle", true, MOVE_SPEED, FRAME, REMOTE_SPEED_SMOOTH_S);
    stepLoop(a, "walk", true, 3, 2 * FRAME, REMOTE_SPEED_SMOOTH_S);
    stepLoop(b, "walk", true, 3, FRAME, REMOTE_SPEED_SMOOTH_S);
    stepLoop(b, "walk", true, 3, FRAME, REMOTE_SPEED_SMOOTH_S);
    expect(b.speed).toBeCloseTo(a.speed, 9);
  });
});

describe("loopRate / loopTimeScale", () => {
  /** The mean rate a loop plays at ground speed `v`: v / its natural speed, under its ceiling (the long skirt's). */
  const meanRate = (s: LoopStride, v: number) => Math.min(v / s.speed, s.maxScale ?? MAX_LOOP_SCALE);

  it("runs at ground speed / the loop's natural speed, so the sole on the ground keeps pace with the ground", () => {
    for (const [, stride] of LOOKS) {
      expect(stride.run.warp).toBe(0);
      for (const phase of [0, 0.3, 0.77]) {
        expect(loopTimeScale("run", RUN_SPEED, stride, phase, 1)).toBeCloseTo(meanRate(stride.run, RUN_SPEED), 9);
      }
    }
    expect(loopRate(LOOP_STRIDE.Running_A, RUN_SPEED, 0.4)).toBeCloseTo(6.4 / 4.56, 9); // about 1.4x
  });

  it("walks at ground speed / natural speed on average over the loop, swinging within each step by the warp", () => {
    for (const [, stride] of LOOKS) {
      const { warp, warpPeak } = stride.walk;
      const mean = meanRate(stride.walk, MOVE_SPEED);
      expect(warp).toBeGreaterThan(0);
      // fastest at the peak and half a loop later (the other foot's step), slowest a quarter loop from there
      expect(loopRate(stride.walk, MOVE_SPEED, warpPeak)).toBeCloseTo(mean * (1 + warp), 9);
      expect(loopRate(stride.walk, MOVE_SPEED, warpPeak + 0.5)).toBeCloseTo(mean * (1 + warp), 9);
      expect(loopRate(stride.walk, MOVE_SPEED, warpPeak + 0.25)).toBeCloseTo(mean * (1 - warp), 9);
      let sum = 0;
      for (let k = 0; k < 360; k++) sum += loopRate(stride.walk, MOVE_SPEED, k / 360);
      expect(sum / 360).toBeCloseTo(mean, 9);
      // loopTimeScale reads the phase off the clip time
      const D = 1.0417;
      expect(loopTimeScale("walk", MOVE_SPEED, stride, warpPeak * D, D)).toBeCloseTo(mean * (1 + warp), 9);
    }
  });

  it("follows the speed: half the speed, half the rate", () => {
    expect(loopRate(LOOP_STRIDE.Walking_A, MOVE_SPEED / 2, 0.1)).toBeCloseTo(loopRate(LOOP_STRIDE.Walking_A, MOVE_SPEED, 0.1) / 2, 9);
  });

  it("holds the pose on a frame the body did not move; Idle always plays at 1", () => {
    expect(loopTimeScale("walk", 0, PANTS, 0.3, 1)).toBe(0);
    expect(loopTimeScale("run", 0, PANTS, 0.3, 1)).toBe(0);
    expect(loopTimeScale("idle", RUN_SPEED, PANTS, 0.3, 1)).toBe(1);
  });

  it("never plays a loop's mean rate above MAX_LOOP_SCALE", () => {
    expect(loopRate(LOOP_STRIDE.Running_A, 100, 0)).toBe(MAX_LOOP_SCALE);
    expect(loopRate(LOOP_STRIDE.Walking_A, 100, LOOP_STRIDE.Walking_A.warpPeak + 0.25)).toBeCloseTo(
      MAX_LOOP_SCALE * (1 - LOOP_STRIDE.Walking_A.warp),
      9,
    );
  });

  it.each([["pants", PANTS], ["fairy (petal_skirt)", FAIRY]] as const)(
    "%s: both game speeds play their loop under its ceiling (no clamped, sliding loop)",
    (_id, stride) => {
      expect(stride.walk.maxScale ?? MAX_LOOP_SCALE).toBe(MAX_LOOP_SCALE);
      expect(stride.run.maxScale ?? MAX_LOOP_SCALE).toBe(MAX_LOOP_SCALE);
      expect(MOVE_SPEED / stride.walk.speed).toBeLessThan(MAX_LOOP_SCALE);
      expect(RUN_SPEED / stride.run.speed).toBeLessThan(MAX_LOOP_SCALE);
    },
  );

  it("pants and skirts walk at about 4 steps a second at MOVE_SPEED (2 steps a loop)", () => {
    for (const stride of [PANTS, FAIRY]) {
      expect(cadence(stride.walk, MOVE_SPEED, WALK_D)).toBeGreaterThan(3.6);
      expect(cadence(stride.walk, MOVE_SPEED, WALK_D)).toBeLessThan(4.4);
    }
  });

  // Review 2026-11-10: the long skirt's loops step about half as far, so planting its (hidden) feet took ~7.5 steps a
  // second, arms and hem pumping twice as fast as everyone else's. Its loops are capped to the others' pace instead.
  it("the long skirt steps at about the pace of the other looks, not twice as fast (its own rate ceiling)", () => {
    const { walk, run } = PRINCESS;
    expect(walk.maxScale).toBeLessThan(MOVE_SPEED / walk.speed); // capped below the planting rate at both speeds
    expect(run.maxScale).toBeLessThan(RUN_SPEED / run.speed);
    const pantsWalk = cadence(PANTS.walk, MOVE_SPEED, WALK_D);
    const princessWalk = cadence(walk, MOVE_SPEED, WALK_D);
    expect(princessWalk / pantsWalk).toBeGreaterThan(0.95);
    expect(princessWalk / pantsWalk).toBeLessThan(1.15);
    const princessRun = cadence(run, RUN_SPEED, RUN_D);
    expect(princessRun).toBeGreaterThan(cadence(PANTS.run, RUN_SPEED, RUN_D));
    expect(princessRun).toBeLessThan(1.05 * cadence(FAIRY.run, RUN_SPEED, RUN_D));
    // the cap is the loop's own: the mean rate stops there at any speed
    expect(loopRate(walk, 100, walk.warpPeak + 0.125)).toBeCloseTo(walk.maxScale!, 9);
    expect(loopRate(run, RUN_SPEED, 0.4)).toBeCloseTo(run.maxScale!, 9);
  });

  it("plays backward at a negative speed, mirroring the forward rate (a body backing up)", () => {
    for (const s of [LOOP_STRIDE.Walking_A, LOOP_STRIDE.Running_A, LOOP_STRIDE.Walking_A_LongSkirt]) {
      for (const phase of [0.05, 0.3, 0.8]) {
        expect(loopRate(s, -MOVE_SPEED, phase)).toBeCloseTo(-loopRate(s, MOVE_SPEED, phase), 9);
      }
    }
    expect(loopRate(LOOP_STRIDE.Running_A, -100, 0)).toBe(-MAX_LOOP_SCALE);
    expect(loopRate(LOOP_STRIDE.Walking_A, Number.NaN, 0)).toBe(0);
  });
});

describe("handoverTime", () => {
  const walk = LOOP_STRIDE.Walking_A;
  const run = LOOP_STRIDE.Running_A;
  const W = 1.0417;
  const R = 0.7917;

  it("starts a loop from Idle with its left foot mid-contact (planted under the body)", () => {
    expect(handoverTime(null, 0, 0, run, R)).toBeCloseTo(run.leftContact * R, 9);
    expect(handoverTime(null, 0, 0, walk, W)).toBeCloseTo(walk.leftContact * W, 9);
  });

  it("carries the step over a walk <-> run handover: the same foot, the run taking over as it pushes off", () => {
    // walk -> run: the body is at run speed at once and the walk's planted foot cannot keep up with it; the run takes
    // over `handoverLead` past that foot's contact (pushing off), so the foot leaves the ground instead of skating
    expect(walk.handoverLead).toBe(0);
    expect(run.handoverLead).toBeGreaterThan(0.05);
    expect(run.handoverLead).toBeLessThan(0.15);
    expect(handoverTime(walk, walk.leftContact * W, W, run, R)).toBeCloseTo((run.leftContact + run.handoverLead) * R, 9);
    // run -> walk: the same foot at the same point of its contact
    const t = handoverTime(run, (run.leftContact + 0.5) * R, R, walk, W);
    expect(t / W).toBeCloseTo(walk.leftContact + 0.5, 9);
    // from standing there is no step to carry on: the left foot mid-contact, whatever the lead
    expect(handoverTime(null, 0, 0, run, R)).toBeCloseTo(run.leftContact * R, 9);
  });

  it("always lands inside the loop [0, duration)", () => {
    for (let k = 0; k < 40; k++) {
      const t = handoverTime(walk, (k / 40) * W * 3, W, run, R);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(R);
    }
  });
});

describe("loopFade", () => {
  it("steps off from Idle and switches walk <-> run quickly (the outgoing feet cannot keep pace), the rest at ANIM_FADE", () => {
    expect(LOOP_START_FADE).toBeLessThan(ANIM_FADE);
    expect(LOOP_SWITCH_FADE).toBeLessThan(ANIM_FADE);
    expect(loopFade("idle", "walk")).toBe(LOOP_START_FADE);
    expect(loopFade("idle", "run")).toBe(LOOP_START_FADE);
    expect(loopFade("walk", "run")).toBe(LOOP_SWITCH_FADE);
    expect(loopFade("run", "walk")).toBe(LOOP_SWITCH_FADE);
    for (const [from, to] of [["walk", "idle"], ["run", "idle"], [null, "walk"], [null, "idle"]] as const) {
      expect(loopFade(from, to)).toBe(ANIM_FADE);
    }
  });
});

describe("alongFacing / stepFacing / loopSpeed: a body backing up steps backward", () => {
  const yaw = 0.7; // faces (sin, cos) of it
  const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };

  it("alongFacing is the cosine between the frame's motion and the facing (NaN when it did not move)", () => {
    expect(alongFacing(fwd.x * 0.03, fwd.z * 0.03, yaw)).toBeCloseTo(1, 9);
    expect(alongFacing(-fwd.x, -fwd.z, yaw)).toBeCloseTo(-1, 9);
    expect(alongFacing(fwd.z, -fwd.x, yaw)).toBeCloseTo(0, 9);
    expect(alongFacing(0, 0, yaw)).toBeNaN();
  });

  /** Drive the facing over frames of the given `along`; returns the signed loop speed after each. */
  function back(alongs: readonly number[]): number[] {
    const d = createLoopDriver();
    return alongs.map((a) => {
      stepFacing(d, a, FRAME);
      d.speed = MOVE_SPEED;
      return loopSpeed(d);
    });
  }

  it("plays forward while the body goes forward, sideways or turns around (a reversal in third person)", () => {
    expect(back(Array(60).fill(1)).every((v) => v === MOVE_SPEED)).toBe(true);
    expect(back(Array(60).fill(0)).every((v) => v === MOVE_SPEED)).toBe(true); // strafing: never flickers
    // a third-person 180-degree turn at TURN_SPEED (12 rad/s): backward of the facing for well under BACKSTEP_MS
    const turn = Array.from({ length: 20 }, (_, k) => Math.cos(Math.max(0, Math.PI - 12 * FRAME * k)));
    expect(back(turn).every((v) => v === MOVE_SPEED)).toBe(true);
  });

  it("plays backward once the body has gone backward of its facing for BACKSTEP_MS (first person: S)", () => {
    const frames = Math.ceil(BACKSTEP_MS / 1000 / FRAME);
    const speeds = back([...Array(frames + 2).fill(-1), -0.6, -0.3, FORESTEP_COS + 0.01]);
    expect(speeds.slice(0, frames - 1).every((v) => v === MOVE_SPEED)).toBe(true);
    expect(speeds[frames + 1]).toBe(-MOVE_SPEED);
    // holds through a diagonal back-step and a nearly sideways one, forward again past FORESTEP_COS
    expect(speeds[frames + 2]).toBe(-MOVE_SPEED);
    expect(speeds[frames + 3]).toBe(-MOVE_SPEED);
    expect(speeds[frames + 4]).toBe(MOVE_SPEED);
    expect(BACKSTEP_COS).toBeLessThan(FORESTEP_COS);
  });

  it("keeps the direction over a frame the body did not move", () => {
    const d = createLoopDriver();
    for (let k = 0; k < 30; k++) stepFacing(d, -1, FRAME);
    stepFacing(d, Number.NaN, FRAME);
    d.speed = MOVE_SPEED;
    expect(loopSpeed(d)).toBe(-MOVE_SPEED);
  });
});
