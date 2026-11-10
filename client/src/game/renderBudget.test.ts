import { describe, expect, it } from "vitest";
import { DPR_STEPS, FrameGovernor, GOVERNOR, budgetSteps, rangeDpr, startLevel, stepScale, useRenderBudget } from "./renderBudget";

type PerLevel = number | ((level: number, t: number) => number);
const at = (v: PerLevel, level: number, t: number) => (typeof v === "number" ? v : v(level, t));

/**
 * Feed `ms` of frames; the interval and the main thread's busy time may depend on the level in force (a GPU-bound frame
 * gets faster with fewer pixels, a CPU-bound one or a browser's 30 fps cap does not). Returns the level changes.
 */
function run(g: FrameGovernor, from: number, ms: number, interval: PerLevel, busy: PerLevel, stopAtChange = false) {
  const changes: { at: number; level: number }[] = [];
  let t = from;
  while (t < from + ms) {
    const dt = at(interval, g.level, t);
    t += dt;
    const next = g.sample(t, dt, at(busy, g.level, t));
    if (next !== null) {
      changes.push({ at: t, level: next });
      if (stopAtChange) break;
    }
  }
  return { changes, end: t, levels: changes.map((c) => c.level) };
}

/** A GPU-bound frame on the vsync's ladder: `ms` of GPU work at the top step, fewer pixels at the lower ones (dpr 1.5). */
const gpuBound = (ms: number) => (level: number) => {
  const pixels = [1, (1.25 / 1.5) ** 2, (1 / 1.5) ** 2][Math.min(level, 2)]!;
  return Math.ceil((ms * pixels) / 16.7) * 16.7;
};

describe("budgetSteps: the rich tier's steps for a screen", () => {
  it("a 150 % laptop panel (dpr 1.5): 1.5 -> 1.25 -> 1", () => {
    expect(budgetSteps([1, 2], 1.5)).toEqual([{ dpr: 1.5 }, { dpr: 1.25 }, { dpr: 1 }]);
  });

  it("skips a cap that would not lower the dpr: a 100 % screen has nothing to give, a 125 % one has one step", () => {
    expect(budgetSteps([1, 2], 1)).toEqual([{ dpr: 1 }]);
    expect(budgetSteps([1, 2], 1.25)).toEqual([{ dpr: 1.25 }, { dpr: 1 }]);
  });

  it("a retina screen keeps its dpr 2 at the top and has one more step (the canvas is never held under the tier's range)", () => {
    expect(rangeDpr([1, 2], 2)).toBe(2);
    expect(budgetSteps([1, 2], 2)).toEqual([{ dpr: 2 }, { dpr: 1.5 }, { dpr: 1.25 }, { dpr: 1 }]);
    expect(budgetSteps([1, 2], 3)[0]).toEqual({ dpr: 2 });
    expect(DPR_STEPS[0]).toBe(1.5);
  });

  it("stepScale: the share of the canvas the scene is drawn at, held to the steps there are", () => {
    const desk = budgetSteps([1, 2], 1.5);
    expect(stepScale(desk, 0)).toBe(1);
    expect(stepScale(desk, 1)).toBeCloseTo(1.25 / 1.5, 12);
    expect(stepScale(desk, 2)).toBeCloseTo(1 / 1.5, 12);
    expect(stepScale(desk, 9)).toBeCloseTo(1 / 1.5, 12);
    expect(stepScale(desk, -1)).toBe(1);
    const retina = budgetSteps([1, 2], 2);
    expect(retina.map((_, i) => stepScale(retina, i))).toEqual([1, 0.75, 0.625, 0.5]);
    // a 100 % screen has nothing to step: any level is the whole canvas
    expect(stepScale(budgetSteps([1, 2], 1), 2)).toBe(1);
    expect(stepScale([], 0)).toBe(1);
  });

  it("the level is kept per setting: the next scene starts where this one ended up, a new choice from the top", () => {
    useRenderBudget.getState().setLevel("auto", 1);
    expect(startLevel("auto")).toBe(1);
    expect(startLevel("high")).toBe(0);
    useRenderBudget.getState().setLevel("high", 0);
    expect(startLevel("auto")).toBe(0);
  });
});

describe("FrameGovernor", () => {
  it("steps down while the GPU cannot keep up, and stays where the frames got fast (the old chain: 30 ms of GPU)", () => {
    const g = new FrameGovernor(3, 0, 0);
    // 33 ms at 1.5, still 33 at 1.25 (the vsync's ladder), 17 at 1: the descent pays at its second step
    // (15 s: the try back up comes after 10 s of fast frames, below)
    const { changes } = run(g, 0, 15_000, gpuBound(30), 6);
    expect(changes.map((c) => c.level)).toEqual([1, 2]);
    // Not before the warm-up and a full window, then one step per settle + window.
    expect(changes[0]!.at).toBeGreaterThanOrEqual(GOVERNOR.warmupMs + GOVERNOR.windowMs * 0.9);
    expect(changes[1]!.at - changes[0]!.at).toBeGreaterThanOrEqual(GOVERNOR.settleMs + GOVERNOR.windowMs * 0.9);
    expect(g.level).toBe(2);
  });

  it("the measured cases: the old chain and a shared GPU wait on the GPU, a 4x-throttled CPU does not", () => {
    // medians from headless Chrome on the Radeon 680M (interval, the previous frame's JS)
    expect(run(new FrameGovernor(3, 0, 0), 0, 8000, (l) => (l === 0 ? 37.5 : 16.7), 9).levels).toEqual([1]); // old chain
    expect(run(new FrameGovernor(3, 0, 0), 0, 8000, (l) => (l === 0 ? 43.4 : 25), 6.9).levels).toEqual([1]); // + 2 windows
    expect(run(new FrameGovernor(3, 0, 0), 0, 30_000, 34.1, 27.3).changes).toEqual([]); // 4x CPU throttling
  });

  it("a shared GPU (12 fps, 9 ms of JS: the owner's case) steps down until the frames get faster", () => {
    const g = new FrameGovernor(3, 0, 0);
    run(g, 0, 20_000, (l) => [84, 67, 50][l]!, 9);
    expect(g.level).toBe(2);
  });

  it("leaves a CPU-bound frame alone: fewer pixels would only blur it (4x throttled: 50 ms frames, 42 ms of JS)", () => {
    expect(run(new FrameGovernor(4, 0, 0), 0, 30_000, 50, 42).changes).toEqual([]);
  });

  it("the browser's own work after the callbacks is CPU time too (4x throttled: 25 ms of callbacks + 12 ms of paint and commit)", () => {
    // busy = everything before the main thread was free again: the governor leaves these 50 ms frames alone...
    expect(run(new FrameGovernor(3, 0, 0), 0, 30_000, 50, 37).changes).toEqual([]);
    // ...where counting the callbacks alone read the 12 ms as a wait on the GPU and tried a step down for nothing
    // (now taken back, as the frames did not get faster: below).
    expect(run(new FrameGovernor(3, 0, 0), 0, 30_000, 50, 25).changes.length).toBeGreaterThan(0);
  });

  it("21 ms of JS is two refreshes: 33 ms frames from it are the CPU's, not the GPU's", () => {
    const g = new FrameGovernor(4, 0, 0);
    g.sample(1, 16.7, 4); // (inside the warm-up: ignored)
    expect(run(g, 0, 30_000, 33.3, 21).changes).toEqual([]);
  });

  it("a CPU-bound frame whose JS swings from frame to frame (25-70 ms) is still the CPU's", () => {
    const g = new FrameGovernor(4, 0, 0);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let t = 0;
    let prevJs = 40;
    const changes: number[] = [];
    for (let i = 0; i < 1500; i++) {
      // the interval is the previous frame's JS (+1 ms) rounded up to the next refresh
      const interval = Math.ceil((prevJs + 1) / 16.7) * 16.7;
      t += interval;
      const next = g.sample(t, interval, prevJs);
      if (next !== null) changes.push(next);
      prevJs = 25 + 45 * rand();
    }
    expect(changes).toEqual([]);
  });

  it("a browser holding rAF at 30 fps (energy saver) or a 30 Hz display: the descent does not pay, so it is taken back for good", () => {
    // 33.3 ms frames whatever the level, the main thread idle most of them: this reads as a wait on the GPU at first
    const g = new FrameGovernor(3, 0, 0);
    const r = run(g, 0, 120_000, 33.33, 9);
    // down twice (each step judged on its own window), nothing gained: the sharp picture back within ~10 s...
    expect(r.levels).toEqual([1, 2, 0]);
    expect(r.changes[2]!.at).toBeLessThan(12_000);
    // ...and nothing more in the two minutes after (the reviewer's simulation of the first version: dpr 1 for good)
    expect(g.level).toBe(0);
  });

  it("after a descent that did not pay, a real slowdown (15 % slower than that) is still answered", () => {
    const g = new FrameGovernor(3, 0, 0);
    let r = run(g, 0, 20_000, 33.33, 9);
    expect(r.levels).toEqual([1, 2, 0]);
    // the GPU gets busy: 50 ms at the top, 33 at 1.25, 25 at 1
    r = run(g, r.end, 20_000, (l) => [50, 33.3, 25][l]!, 9);
    expect(r.levels[0]).toBe(1);
    expect(g.level).toBeGreaterThan(0);
  });

  it("fast frames clear a descent that did not pay: the next slow spell is judged afresh", () => {
    const g = new FrameGovernor(3, 0, 0);
    let r = run(g, 0, 20_000, 33.33, 9);
    expect(g.level).toBe(0);
    r = run(g, r.end, 5000, 16.7, 5);
    expect(r.changes).toEqual([]);
    // the same 33 ms again, but this time the smaller picture does help (a GPU that is busy now)
    r = run(g, r.end, 10_000, (l) => (l === 0 ? 33.33 : 16.7), 9);
    expect(r.levels).toEqual([1]);
  });

  it("on a 120 Hz screen the refresh is learnt from its fastest frames", () => {
    const g = new FrameGovernor(4, 0, 0);
    run(g, 0, 6000, 8.3, 3);
    // 12 ms of JS is two 8.3 ms refreshes; 25 ms frames are then the GPU's
    expect(run(g, 6000, 9000, (l) => (l === 0 ? 25 : 8.3), 12).levels).toEqual([1]);
  });

  it("leaves a steady 60 fps alone, and a 40 fps that is only just slow", () => {
    expect(run(new FrameGovernor(4, 0, 0), 0, 30_000, 16.7, 8).changes).toEqual([]);
    expect(run(new FrameGovernor(4, 0, 0), 0, 30_000, 21, 5).changes).toEqual([]);
  });

  it("is not moved by spikes (a median) or by pauses (a hidden tab)", () => {
    const g = new FrameGovernor(4, 0, 0);
    let t = 0;
    const changes: number[] = [];
    for (let i = 0; i < 1500; i++) {
      // every fifth frame a 90 ms hitch: the median stays at 60 fps
      const interval = i % 5 === 4 ? 90 : 16.7;
      t += interval;
      const next = g.sample(t, interval, 4);
      if (next !== null) changes.push(next);
      if (i === 700) {
        t += 5000; // the tab was hidden
        const n = g.sample(t, 5000, 0);
        if (n !== null) changes.push(n);
      }
    }
    expect(changes).toEqual([]);
  });

  it("steps back up after 10 s of a steady 60 fps; each flip-flop triples the wait, and it still comes back", () => {
    const g = new FrameGovernor(4, 2, 0);
    let r = run(g, 0, GOVERNOR.warmupMs + GOVERNOR.upWindowMs + 500, 16.7, 6);
    expect(r.levels).toEqual([1]);
    // slow again soon after at the upper step (fast at the lower one): down, a flip-flop
    const slowAbove1 = (l: number) => (l <= 1 ? 33.3 : 16.7);
    r = run(g, r.end, 10_000, slowAbove1, 6, true);
    expect(g.level).toBe(2);
    // the next step up waits 30 s, not 10
    r = run(g, r.end, GOVERNOR.settleMs + 25_000, 16.7, 6);
    expect(g.level).toBe(2);
    r = run(g, r.end, 6_000, 16.7, 6);
    expect(g.level).toBe(1);
    // down again (flip-flop 2): now 90 s
    r = run(g, r.end, 10_000, slowAbove1, 6, true);
    expect(g.level).toBe(2);
    r = run(g, r.end, GOVERNOR.settleMs + 85_000, 16.7, 6);
    expect(g.level).toBe(2);
    r = run(g, r.end, 6_000, 16.7, 6);
    expect(g.level).toBe(1);
  });

  it("a GPU that stays shared: the sharpness is not moved every few seconds (measured: 5 steps in 64 s with an 8 s / x2 rule)", () => {
    // fast at the lower step, slow at the upper one (another window of the game drawing on the same GPU)
    const g = new FrameGovernor(3, 0, 0);
    const steps = run(g, 0, 180_000, (l) => (l === 0 ? 37 : 16.7), 6).changes.map((c) => c.at);
    // down at 6 s, a first try up at ~17 s, down again; the next try ~30 s later, down; the next one ~90 s after that
    expect(steps.length).toBeLessThanOrEqual(7);
    expect(steps.filter((s) => s > 60_000 && s <= 120_000)).toEqual([]);
    expect(steps.filter((s) => s > 60_000).length).toBeLessThanOrEqual(2);
  });

  it("a GPU shared on and off (~40 s cycles, the reviewer's run): each later try up waits longer", () => {
    // the other window draws for 25 s of every 40: the top step is slow then, the next one is fine
    const busyGpu = (t: number) => t % 40_000 < 25_000;
    const g = new FrameGovernor(3, 0, 0);
    const r = run(g, 0, 600_000, (l, t) => (l === 0 && busyGpu(t) ? 37 : 16.7), 6);
    const ups = r.changes.filter((c, i) => i > 0 && c.level < r.changes[i - 1]!.level).map((c) => c.at);
    // the first version (a 30 s flip-flop window) never saw these as flip-flops: a step every ~20 s for ever
    expect(r.changes.length).toBeLessThanOrEqual(10);
    for (let i = 2; i < ups.length; i++) expect(ups[i]! - ups[i - 1]!).toBeGreaterThan(ups[i - 1]! - ups[i - 2]!);
  });

  it("the wait never grows past 5 minutes: a GPU that is free again gets its sharp picture back", () => {
    const g = new FrameGovernor(3, 1, 0);
    let t = 0;
    // ten flip-flops in a row
    for (let i = 0; i < 10; i++) {
      let r = run(g, t, 400_000, 16.7, 6, true); // up
      expect(r.changes[0]!.level).toBe(0);
      expect(r.end - t).toBeLessThanOrEqual(GOVERNOR.maxUpWaitMs + GOVERNOR.settleMs + GOVERNOR.warmupMs + 1000);
      r = run(g, r.end, 10_000, (l) => (l === 0 ? 37 : 16.7), 6, true); // straight back down
      expect(r.changes[0]!.level).toBe(1);
      t = r.end;
    }
  });

  it("never steps past its last level or above the top", () => {
    const g = new FrameGovernor(2, 5, 0);
    expect(g.level).toBe(1);
    expect(run(g, 0, 20_000, 40, 4).changes).toEqual([]);
    const top = new FrameGovernor(3, -1, 0);
    expect(top.level).toBe(0);
    expect(run(top, 0, 20_000, 16.7, 4).changes).toEqual([]);
  });
});
