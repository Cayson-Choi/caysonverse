import { describe, expect, it } from "vitest";
import { MOVE_SPEED, RUN_SPEED } from "@caysonverse/shared/constants";
import { APPEARANCE_PRESETS, DEFAULT_APPEARANCE, applyPreset } from "@caysonverse/shared/appearance";
import { lookFromAppearance, type AvatarLook } from "./characterLook";
import { ANIM_FADE, RUN_OFF_SPEED, RUN_ON_SPEED } from "./constants";
import type { Gait } from "./gait";
import {
  LOOP_START_FADE,
  LOOP_START_SPEED,
  LOOP_STOP_MS,
  LOOP_STOP_SPEED,
  LOOP_STRIDE,
  MAX_LOOP_SCALE,
  REMOTE_SPEED_SMOOTH_S,
  createLoopDriver,
  handoverTime,
  loopFade,
  lookStride,
  loopRate,
  loopTimeScale,
  stepLoop,
  type LookStride,
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

  it("a remote's smoothed speed: a start is taken at once, a one-frame hold neither stops nor resets it", () => {
    const d = createLoopDriver();
    expect(stepLoop(d, "idle", true, RUN_SPEED, FRAME, REMOTE_SPEED_SMOOTH_S)).toBe("run");
    expect(d.speed).toBe(RUN_SPEED);
    expect(stepLoop(d, "run", true, 0, FRAME, REMOTE_SPEED_SMOOTH_S)).toBe("run");
    expect(d.speed).toBe(0); // the body held its pose this frame: so do the feet
    stepLoop(d, "run", true, RUN_SPEED * 1.1, FRAME, REMOTE_SPEED_SMOOTH_S);
    expect(d.speed).toBeGreaterThan(RUN_SPEED); // eased from where it was, not from 0
    expect(d.speed).toBeLessThan(RUN_SPEED * 1.1);
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
  it("runs at ground speed / the loop's natural speed, so the sole on the ground keeps pace with the ground", () => {
    for (const [, stride] of LOOKS) {
      expect(stride.run.warp).toBe(0);
      for (const phase of [0, 0.3, 0.77]) {
        expect(loopTimeScale("run", RUN_SPEED, stride, phase, 1)).toBeCloseTo(RUN_SPEED / stride.run.speed, 9);
      }
    }
    expect(loopRate(LOOP_STRIDE.Running_A, RUN_SPEED, 0.4)).toBeCloseTo(6.4 / 4.56, 9); // about 1.4x
  });

  it("walks at ground speed / natural speed on average over the loop, swinging within each step by the warp", () => {
    for (const [, stride] of LOOKS) {
      const { speed, warp, warpPeak } = stride.walk;
      const mean = MOVE_SPEED / speed;
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

  it.each(LOOKS)("%s: both game speeds play their loop under the ceiling (no clamped, sliding loop)", (_id, stride) => {
    expect(MOVE_SPEED / stride.walk.speed).toBeLessThanOrEqual(MAX_LOOP_SCALE);
    expect(RUN_SPEED / stride.run.speed).toBeLessThanOrEqual(MAX_LOOP_SCALE);
  });

  it("pants and skirts walk at about 4 steps a second at MOVE_SPEED (2 steps a loop)", () => {
    for (const stride of [PANTS, FAIRY]) {
      // time to play one loop of 1.0417 s at the warped rate: the integral of dt = d(clip time) / rate
      const D = 1.0417;
      let t = 0;
      for (let k = 0; k < 1000; k++) t += D / 1000 / loopRate(stride.walk, MOVE_SPEED, (k + 0.5) / 1000);
      expect(2 / t).toBeGreaterThan(3.6);
      expect(2 / t).toBeLessThan(4.4);
    }
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

  it("carries the step over a walk <-> run handover: the same foot at the same point of its contact", () => {
    expect(handoverTime(walk, walk.leftContact * W, W, run, R)).toBeCloseTo(run.leftContact * R, 9);
    const t = handoverTime(run, (run.leftContact + 0.5) * R, R, walk, W);
    expect(t / W).toBeCloseTo(walk.leftContact + 0.5, 9);
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
  it("steps off from Idle quickly (Idle's feet go along with the body while it shows), every other handover at ANIM_FADE", () => {
    expect(LOOP_START_FADE).toBeLessThan(ANIM_FADE);
    expect(loopFade("idle", "walk")).toBe(LOOP_START_FADE);
    expect(loopFade("idle", "run")).toBe(LOOP_START_FADE);
    for (const [from, to] of [["walk", "run"], ["run", "walk"], ["walk", "idle"], ["run", "idle"], [null, "walk"], [null, "idle"]] as const) {
      expect(loopFade(from, to)).toBe(ANIM_FADE);
    }
  });
});
