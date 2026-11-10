import { create } from "zustand";

/**
 * The rich tier's GPU budget at run time (perf/interaction-latency): a frame governor that steps the drawing resolution
 * down while the GPU cannot keep up — and back up when it can. Nothing else about the frame changes (the bloom, the
 * shadows and every material stay as they are: no shader is recompiled, which would itself be a long frame).
 *
 * Why: the rich tier's frame is GPU-bound on a laptop's integrated GPU, and much more so when that GPU is shared (a second
 * tab or window of the game, another 3D app). Chrome then shows each input about four frame intervals later, so a 12 fps
 * frame rate is a 300-700 ms wait after every click or key press (the owner's Vercel toolbar numbers). Lowering the dpr
 * is the one change that scales the GPU work down without changing what is drawn (1.5 -> 1.25 -> 1).
 *
 * The rule (`FrameGovernor`), judged every 250 ms over the last 2 s of frames: a frame's wait is its interval minus the
 * main thread's busy time in it — the previous frame's callbacks and render calls, the browser's own work for that frame
 * (style, layout, paint, the commit) and any task that ran before the main thread was free (QualityEffects measures it
 * with a message posted at the end of each frame). What is left is the time the main thread sat idle until the next
 * frame was let in. When the median interval is longer than 22 ms (under ~45 fps) AND the median wait is longer than a
 * whole display refresh, the frames are waiting on the GPU or the compositor and a smaller canvas helps: one step down.
 * Measured (headless Chrome, Radeon 680M): GPU-bound frames wait 28 ms (the old chain) and 35 ms (the GPU shared with two
 * other windows of the game) of 37-43 ms intervals; CPU-bound ones (4x CPU throttling, 27 ms of JS in 34 ms intervals)
 * wait 5 ms. A CPU-bound frame is left alone: fewer pixels would not make it faster, only blurrier. (Counting only the
 * frame callbacks as busy was not enough: at 4x the browser's own per-frame work was read as a wait and the dpr was
 * stepped down for nothing.) The refresh is the shortest interval seen (16.7 ms until a shorter one shows up: 120 Hz).
 * After 10 s of a steady 60 fps take one step back up; a step up that has to be taken back within 30 s is a flip-flop, and
 * each one triples the wait before the next step up (30 s, 90 s, 270 s, then 5 min at most). Every step is one long
 * frame (the canvas and its targets are re-made: 100-230 ms measured on the Radeon 680M), so a GPU that stays shared
 * must not see the dpr go up and down every few seconds (measured with the old 8 s / 10 s / x2 rule: five steps in a
 * minute, one of them inside a click), while one that is free again still gets its sharp picture back.
 * The first 4 s after the scene starts and 1.5 s after every step are not judged (loading, the resize itself), nor are
 * pauses (an interval over 400 ms: a hidden tab, a load).
 *
 * Pure (no three, no DOM): unit-tested in renderBudget.test.ts. The level lives in `useRenderBudget`: the post chain's
 * governor (QualityEffects) writes it and sets the Canvas's dpr; PlayShell reads it whenever it renders (`budgetDpr`).
 */

export interface BudgetStep {
  /** The dpr cap of this step (the Canvas's dpr range is clamped under it). */
  dpr: number;
}

/** The rich tier's dpr caps, best first. */
export const DPR_STEPS: readonly number[] = [1.5, 1.25, 1];

/** The dpr react-three-fiber draws at for a `[min, max]` range on a screen of `deviceDpr` (its calculateDpr). */
export function rangeDpr(range: readonly [number, number], deviceDpr: number): number {
  return Math.min(Math.max(range[0], deviceDpr), range[1]);
}

/**
 * The distinct steps for this screen: a cap that would not lower the dpr the range already gives is skipped (a 1080p
 * screen at 100 % is at dpr 1 already: it has one step, and the governor has nothing to do there).
 */
export function budgetSteps(range: readonly [number, number], deviceDpr: number): BudgetStep[] {
  const base = rangeDpr(range, deviceDpr);
  const steps: BudgetStep[] = [{ dpr: base }];
  for (const cap of DPR_STEPS) {
    const dpr = Math.min(base, cap);
    if (dpr < steps[steps.length - 1]!.dpr) steps.push({ dpr });
  }
  return steps;
}

/** The Canvas's dpr range on a step: the tier's range with its top clamped to the step's dpr. */
export function stepDprRange(range: readonly [number, number], step: BudgetStep): [number, number] {
  return [Math.min(range[0], step.dpr), Math.min(range[1], step.dpr)];
}

export const GOVERNOR = {
  /** Not judged for this long after the governor starts (the scene's first seconds: loading, shader compiles). */
  warmupMs: 4000,
  /** ...and for this long after each step (the canvas and its targets are re-made at the new size). */
  settleMs: 1500,
  /** The window a judgement is made over. */
  windowMs: 2000,
  /** The windows are judged this often, not on every frame (each judgement sorts them). */
  evalEveryMs: 250,
  /** A median frame interval longer than this is too slow (under ~45 fps). */
  slowMs: 22,
  /** ...when the median wait (interval minus the main thread's busy time) is longer than this many refreshes. */
  waitRefreshes: 1,
  /** The display's refresh until a shorter interval is seen (the intervals are the frames' rAF timestamps)... */
  refreshMs: 16.7,
  /** ...but never under a 165 Hz screen's. */
  minRefreshMs: 6,
  /** A median interval at or under this (a steady 60 fps)... */
  fastMs: 18,
  /** ...for this long tries the step above (tripled for every flip-flop, up to `maxUpWaitMs`). */
  upWindowMs: 10_000,
  upBackoff: 3,
  maxUpWaitMs: 300_000,
  /** A step down within this long after a step up is a flip-flop. */
  flipFlopMs: 30_000,
  /** An interval this long is a pause (a hidden tab, a load), not a frame. */
  pauseMs: 400,
  /** No step this soon after a press or a release (a click's or a key's next paint comes within ~100-300 ms). */
  inputQuietMs: 600,
} as const;

function median(xs: number[]): number {
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 0;
}

export class FrameGovernor {
  level: number;
  private readonly maxLevel: number;
  private holdUntil: number;
  private times: number[] = [];
  private intervals: number[] = [];
  private waits: number[] = [];
  private refresh: number = GOVERNOR.refreshMs;
  private lastEval = -Infinity;
  private fastSince: number;
  private lastUpAt = -Infinity;
  private flipFlops = 0;

  /** `levels`: how many steps there are (budgetSteps(...).length); `start`: the level to begin on; `now`: the clock (ms). */
  constructor(levels: number, start: number, now: number) {
    this.maxLevel = Math.max(0, levels - 1);
    this.level = Math.min(Math.max(0, start), this.maxLevel);
    this.holdUntil = now + GOVERNOR.warmupMs;
    this.fastSince = this.holdUntil;
  }

  /**
   * One frame: `now` (ms), the interval from the previous frame to this one (their rAF timestamps), and how much of that
   * interval the main thread was busy (the previous frame's callbacks and the browser's work for it, other tasks: what
   * the interval had to fit), and when the player last pressed or let go of something. Returns the new level when it
   * changes, else null. No step is taken within `inputQuietMs` of an input: a step is one long frame (the canvas and its
   * targets are re-made), and it would land in that input's next paint; the step waits for a quiet moment instead.
   */
  sample(now: number, intervalMs: number, busyMs: number, lastInputAt = -Infinity): number | null {
    if (now < this.holdUntil) return null;
    if (!(intervalMs > 0) || intervalMs > GOVERNOR.pauseMs) return null;
    if (intervalMs >= GOVERNOR.minRefreshMs && intervalMs < this.refresh) this.refresh = intervalMs;
    this.times.push(now);
    this.intervals.push(intervalMs);
    this.waits.push(intervalMs - Math.max(0, busyMs));
    while (this.times.length && this.times[0]! < now - GOVERNOR.windowMs) {
      this.times.shift();
      this.intervals.shift();
      this.waits.shift();
    }
    if (now - this.lastEval < GOVERNOR.evalEveryMs) return null;
    this.lastEval = now;
    if (this.times.length < 2 || this.times[0]! > now - GOVERNOR.windowMs * 0.9) return null;

    const interval = median(this.intervals);
    if (interval > GOVERNOR.fastMs) this.fastSince = now;
    if (now - lastInputAt < GOVERNOR.inputQuietMs) return null;
    if (this.level < this.maxLevel && interval > GOVERNOR.slowMs && median(this.waits) > GOVERNOR.waitRefreshes * this.refresh) {
      if (now - this.lastUpAt < GOVERNOR.flipFlopMs) this.flipFlops++;
      return this.step(this.level + 1, now);
    }
    const upWait = Math.min(GOVERNOR.maxUpWaitMs, GOVERNOR.upWindowMs * GOVERNOR.upBackoff ** this.flipFlops);
    if (this.level > 0 && now - this.fastSince >= upWait) {
      this.lastUpAt = now;
      return this.step(this.level - 1, now);
    }
    return null;
  }

  private step(level: number, now: number): number {
    this.level = level;
    this.holdUntil = now + GOVERNOR.settleMs;
    this.fastSince = this.holdUntil;
    this.times = [];
    this.intervals = [];
    this.waits = [];
    return level;
  }
}

/**
 * The governor's level for the session, with the setting it was found under: a different graphics setting starts again
 * from the top (a fresh choice is judged afresh), the same one keeps it (the next scene starts where this one ended up).
 */
interface RenderBudgetStore {
  level: number;
  setting: string | null;
  setLevel: (setting: string, level: number) => void;
}

export const useRenderBudget = create<RenderBudgetStore>((set) => ({
  level: 0,
  setting: null,
  setLevel: (setting, level) => set({ setting, level }),
}));

/** The level a scene under `setting` starts on (and the level in force: read, not subscribed to — see `budgetDpr`). */
export function startLevel(setting: string): number {
  const s = useRenderBudget.getState();
  return s.setting === setting ? s.level : 0;
}

/**
 * The Canvas's dpr range on `level` of the tier's `range` on a screen of `deviceDpr`. The governor applies a step itself
 * (react-three-fiber's setDpr from inside the Canvas) and the scene's shell reads the level when it renders for another
 * reason, so the two always agree and a step does not re-render the whole scene (a 50-100 ms main-thread block, measured
 * as the input delay of a click that met a step).
 */
export function budgetDpr(range: readonly [number, number], deviceDpr: number, level: number): [number, number] {
  const steps = budgetSteps(range, deviceDpr);
  return stepDprRange(range, steps[Math.min(Math.max(0, level), steps.length - 1)]!);
}
