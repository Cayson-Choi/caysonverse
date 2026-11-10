import { describe, expect, it } from "vitest";
import { DPR_STEPS, FrameGovernor, GOVERNOR, budgetDpr, budgetSteps, rangeDpr, stepDprRange, startLevel, useRenderBudget } from "./renderBudget";

/** Feed `ms` of frames at a fixed interval and JS time; returns the levels it changed to, with their times. */
function run(g: FrameGovernor, from: number, ms: number, interval: number, js: number) {
  const changes: { at: number; level: number }[] = [];
  let t = from;
  while (t < from + ms) {
    t += interval;
    const next = g.sample(t, interval, js);
    if (next !== null) changes.push({ at: t, level: next });
  }
  return { changes, end: t };
}

/** Like `run`, but stops at the first change (the frame rate then is whatever the next phase says). */
function runUntilChange(g: FrameGovernor, from: number, ms: number, interval: number, js: number) {
  let t = from;
  while (t < from + ms) {
    t += interval;
    const next = g.sample(t, interval, js);
    if (next !== null) return { changes: [{ at: t, level: next }], end: t };
  }
  return { changes: [], end: t };
}

describe("budgetSteps: the rich tier's steps for a screen", () => {
  it("a 150 % laptop panel (dpr 1.5): 1.5 -> 1.25 -> 1", () => {
    expect(budgetSteps([1, 1.5], 1.5)).toEqual([{ dpr: 1.5 }, { dpr: 1.25 }, { dpr: 1 }]);
  });

  it("skips a cap that would not lower the dpr: a 100 % screen has nothing to give, a 125 % one has one step", () => {
    expect(budgetSteps([1, 1.5], 1)).toEqual([{ dpr: 1 }]);
    expect(budgetSteps([1, 1.5], 1.25)).toEqual([{ dpr: 1.25 }, { dpr: 1 }]);
  });

  it("a retina screen is held to the tier's 1.5 first", () => {
    expect(rangeDpr([1, 1.5], 2)).toBe(1.5);
    expect(budgetSteps([1, 1.5], 2)[0]).toEqual({ dpr: 1.5 });
    expect(DPR_STEPS[0]).toBe(1.5);
  });

  it("budgetDpr: the Canvas's range on a level, held to the steps there are", () => {
    expect(budgetDpr([1, 1.5], 1.5, 0)).toEqual([1, 1.5]);
    expect(budgetDpr([1, 1.5], 1.5, 1)).toEqual([1, 1.25]);
    expect(budgetDpr([1, 1.5], 1.5, 2)).toEqual([1, 1]);
    expect(budgetDpr([1, 1.5], 1.5, 9)).toEqual([1, 1]);
    // a 100 % screen has nothing to step: any level is its one range
    expect(budgetDpr([1, 1.5], 1, 2)).toEqual([1, 1]);
  });

  it("the level is kept per setting: the next scene starts where this one ended up, a new choice from the top", () => {
    useRenderBudget.getState().setLevel("auto", 1);
    expect(startLevel("auto")).toBe(1);
    expect(startLevel("high")).toBe(0);
    useRenderBudget.getState().setLevel("high", 0);
    expect(startLevel("auto")).toBe(0);
  });

  it("the Canvas's range on a step has its top at the step's dpr", () => {
    expect(stepDprRange([1, 1.5], { dpr: 1.25 })).toEqual([1, 1.25]);
    expect(stepDprRange([1, 1.5], { dpr: 1.5 })).toEqual([1, 1.5]);
  });
});

describe("FrameGovernor", () => {
  it("steps down while the GPU cannot keep up (30 fps, the frame's own JS only 6 ms)", () => {
    const g = new FrameGovernor(4, 0, 0);
    const { changes } = run(g, 0, 20_000, 33.3, 6);
    expect(changes.map((c) => c.level)).toEqual([1, 2, 3]);
    // (four levels here only to see it walk all the way; the rich tier has three: 1.5, 1.25, 1)
    // Not before the warm-up and a full window, then one step per settle + window.
    expect(changes[0]!.at).toBeGreaterThanOrEqual(GOVERNOR.warmupMs + GOVERNOR.windowMs * 0.9);
    expect(changes[1]!.at - changes[0]!.at).toBeGreaterThanOrEqual(GOVERNOR.settleMs + GOVERNOR.windowMs * 0.9);
    expect(g.level).toBe(3);
  });

  it("the measured cases: the old chain and a shared GPU wait on the GPU, a 4x-throttled CPU does not", () => {
    // medians from headless Chrome on the Radeon 680M (interval, the previous frame's JS)
    expect(run(new FrameGovernor(3, 0, 0), 0, 8000, 37.5, 9).changes.length).toBeGreaterThan(0); // old chain, 2560x1290
    expect(run(new FrameGovernor(3, 0, 0), 0, 8000, 43.4, 6.9).changes.length).toBeGreaterThan(0); // + 2 other windows
    expect(run(new FrameGovernor(3, 0, 0), 0, 30_000, 34.1, 27.3).changes).toEqual([]); // 4x CPU throttling
  });

  it("a shared GPU (12 fps, 9 ms of JS: the owner's case) steps down too", () => {
    expect(run(new FrameGovernor(4, 0, 0), 0, 8000, 84, 9).changes.length).toBeGreaterThan(0);
  });

  it("leaves a CPU-bound frame alone: fewer pixels would only blur it (4x throttled: 50 ms frames, 42 ms of JS)", () => {
    const g = new FrameGovernor(4, 0, 0);
    expect(run(g, 0, 30_000, 50, 42).changes).toEqual([]);
  });

  it("the browser's own work after the callbacks is CPU time too (4x throttled: 25 ms of callbacks + 12 ms of paint and commit)", () => {
    // busy = everything before the main thread was free again: the governor leaves these 50 ms frames alone...
    expect(run(new FrameGovernor(3, 0, 0), 0, 30_000, 50, 37).changes).toEqual([]);
    // ...where counting the callbacks alone read the 12 ms as a wait on the GPU and stepped down for nothing.
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

  it("on a 120 Hz screen the refresh is learnt from its fastest frames", () => {
    const g = new FrameGovernor(4, 0, 0);
    run(g, 0, 6000, 8.3, 3);
    // 12 ms of JS is two 8.3 ms refreshes; 25 ms frames are then the GPU's
    expect(run(g, 6000, 9000, 25, 12).changes.length).toBeGreaterThan(0);
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
    expect(r.changes.map((c) => c.level)).toEqual([1]);
    // slow again soon after: down (flip-flop 1)
    r = runUntilChange(g, r.end, 10_000, 33.3, 6);
    expect(r.end - (GOVERNOR.warmupMs + GOVERNOR.upWindowMs)).toBeLessThan(GOVERNOR.flipFlopMs);
    expect(g.level).toBe(2);
    // the next step up waits 30 s, not 10
    r = run(g, r.end, GOVERNOR.settleMs + 25_000, 16.7, 6);
    expect(g.level).toBe(2);
    r = run(g, r.end, 6_000, 16.7, 6);
    expect(g.level).toBe(1);
    // down again (flip-flop 2): now 90 s
    r = runUntilChange(g, r.end, 10_000, 33.3, 6);
    expect(g.level).toBe(2);
    r = run(g, r.end, GOVERNOR.settleMs + 85_000, 16.7, 6);
    expect(g.level).toBe(2);
    r = run(g, r.end, 6_000, 16.7, 6);
    expect(g.level).toBe(1);
  });

  it("a GPU that stays shared: the dpr is not moved every few seconds (measured: 5 steps in 64 s with an 8 s / x2 rule)", () => {
    // fast at the lower step, slow at the upper one (another window of the game drawing on the same GPU)
    const g = new FrameGovernor(3, 0, 0);
    let t = 0;
    const steps: number[] = [];
    while (t < 180_000) {
      const interval = g.level === 0 ? 37 : 16.7;
      t += interval;
      const next = g.sample(t, interval, 6);
      if (next !== null) steps.push(t);
    }
    // down at 6 s, a first try up at ~18 s, down again; the next try ~30 s later, down; the next one ~90 s after that
    expect(steps.length).toBeLessThanOrEqual(7);
    expect(steps.filter((s) => s > 60_000 && s <= 120_000)).toEqual([]);
    expect(steps.filter((s) => s > 60_000).length).toBeLessThanOrEqual(2);
  });

  it("the wait never grows past 5 minutes: a GPU that is free again gets its sharp picture back", () => {
    const g = new FrameGovernor(3, 1, 0);
    let t = 0;
    // ten flip-flops in a row
    for (let i = 0; i < 10; i++) {
      let r = runUntilChange(g, t, 400_000, 16.7, 6); // up
      expect(r.changes[0]!.level).toBe(0);
      expect(r.end - t).toBeLessThanOrEqual(GOVERNOR.maxUpWaitMs + GOVERNOR.settleMs + GOVERNOR.warmupMs + 1000);
      r = runUntilChange(g, r.end, 10_000, 37, 6); // straight back down
      expect(r.changes[0]!.level).toBe(1);
      t = r.end;
    }
  });

  it("never steps right after a press or a release (the step's long frame would land in its paint): it waits for a quiet moment", () => {
    const g = new FrameGovernor(3, 0, 0);
    let t = 0;
    let lastInput = -Infinity;
    const changes: { at: number; level: number }[] = [];
    while (t < 30_000) {
      t += 37; // GPU-bound: it would step at ~6 s
      if (t < 20_000 && Math.floor(t / 400) !== Math.floor((t - 37) / 400)) lastInput = t; // a click every 400 ms
      const next = g.sample(t, 37, 6, lastInput);
      if (next !== null) changes.push({ at: t, level: next });
    }
    // the clicks stopped just before 20 s: the first step comes on the first judgement once they have been quiet
    expect(lastInput).toBeGreaterThan(19_000);
    expect(changes[0]!.at).toBeGreaterThanOrEqual(lastInput + GOVERNOR.inputQuietMs);
    expect(changes[0]!.at).toBeLessThan(lastInput + GOVERNOR.inputQuietMs + GOVERNOR.evalEveryMs + 100);
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
