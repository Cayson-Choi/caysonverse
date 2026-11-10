import { create } from "zustand";

/**
 * The rich tier's GPU budget at run time (perf/interaction-latency): a frame governor that steps the scene's drawing
 * resolution down while the GPU cannot keep up — and back up when it can. Nothing else about the frame changes (the bloom,
 * the shadows and every material stay as they are: no shader is recompiled, which would itself be a long frame).
 *
 * Why: the rich tier's frame is GPU-bound on a laptop's integrated GPU, and much more so when that GPU is shared (a second
 * tab or window of the game, another 3D app). Chrome then shows each input about four frame intervals later, so a 12 fps
 * frame rate is a 300-700 ms wait after every click or key press (the owner's Vercel toolbar numbers). Drawing fewer pixels
 * is the one change that scales the GPU work down without changing what is drawn: the steps are the dprs 1.5 -> 1.25 -> 1
 * (2 -> 1.5 -> 1.25 -> 1 on a dpr-2 screen), applied as the post chain's render scale (postChain.ts `setScale`: the scene is
 * drawn into a part of the same target and stretched over the screen). A step re-makes nothing — the canvas keeps its
 * size — so it costs nothing on its frame. (Resizing the canvas for a step, the first version, made that frame 100-317 ms
 * and flashed the cleared canvas over the game.)
 *
 * The rule (`FrameGovernor`), judged every 250 ms over the last 2 s of frames: a frame's wait is its interval minus the
 * main thread's busy time in it — the previous frame's callbacks and render calls, the browser's own work for that frame
 * (style, layout, paint, the commit) and any task that ran before the main thread was free (QualityEffects measures it
 * with a message posted at the end of each frame). What is left is the time the main thread sat idle until the next
 * frame was let in. When the median interval is longer than 22 ms (under ~45 fps) AND the median wait is longer than a
 * whole display refresh, the frames are waiting on the GPU or the compositor and a smaller picture may help: one step down.
 * Measured (headless Chrome, Radeon 680M): GPU-bound frames wait 28 ms (the old chain) and 35 ms (the GPU shared with two
 * other windows of the game) of 37-43 ms intervals; CPU-bound ones (4x CPU throttling, 27 ms of JS in 34 ms intervals)
 * wait 5 ms. A CPU-bound frame is left alone: fewer pixels would not make it faster, only blurrier. The refresh is the
 * shortest interval seen (16.7 ms until a shorter one shows up: 120 Hz).
 *
 * A descent must pay: the steps down from one level are one descent, and when the last step it could take has not made
 * the median interval at least 15 % shorter than when it began, the sharp picture comes back and no new descent starts
 * until the interval gets 15 % longer than that (or the frames are fast again). An idle main thread at 33 ms frames is
 * not always a busy GPU: a browser holding rAF at 30 fps (Chrome's energy saver), a 30 Hz display. Smaller pictures do
 * not help there, so they must not stay. (Each step of a descent is judged on the vsync's ladder: 33 -> 33 -> 17 ms
 * is a descent that paid at its second step.)
 *
 * After 10 s of a steady 60 fps take one step back up; a descent that starts within 2 minutes of a step up is a flip-flop,
 * and each one triples the wait before the next step up (30 s, 90 s, 270 s, then 5 min at most), so a GPU that stays
 * shared does not see the sharpness go up and down every half minute, while one that is free again still gets its sharp
 * picture back. The first 4 s after the scene starts and 0.5 s after every step are not judged (loading, the step itself),
 * nor are pauses (an interval over 400 ms: a hidden tab, a load).
 *
 * Pure (no three, no DOM): unit-tested in renderBudget.test.ts. The level lives in `useRenderBudget` (the next scene under
 * the same setting starts where this one ended up); QualityEffects runs the governor and gives its scale to the post chain.
 */

export interface BudgetStep {
  /** The dpr the scene is drawn at on this step. */
  dpr: number;
}

/** The rich tier's dpr caps under the top, best first. */
export const DPR_STEPS: readonly number[] = [1.5, 1.25, 1];

/** The dpr react-three-fiber draws at for a `[min, max]` range on a screen of `deviceDpr` (its calculateDpr). */
export function rangeDpr(range: readonly [number, number], deviceDpr: number): number {
  return Math.min(Math.max(range[0], deviceDpr), range[1]);
}

/**
 * The distinct steps for this screen: the canvas's own dpr first, then each cap that lowers it (a 1080p screen at 100 % is
 * at dpr 1 already: it has one step, and the governor has nothing to do there).
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

/** The post chain's render scale on `level`: the step's dpr over the canvas's (the top step's). */
export function stepScale(steps: readonly BudgetStep[], level: number): number {
  if (steps.length === 0) return 1;
  const top = steps[0]!.dpr;
  const at = steps[Math.min(Math.max(0, level), steps.length - 1)]!.dpr;
  return top > 0 ? at / top : 1;
}

export const GOVERNOR = {
  /** Not judged for this long after the governor starts (the scene's first seconds: loading, shader compiles). */
  warmupMs: 4000,
  /** ...and for this long after each step (a step re-makes nothing; the frames in flight were drawn at the old scale). */
  settleMs: 500,
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
  /** A descent that starts within this long after a step up is a flip-flop (a GPU shared on and off: ~40 s cycles seen). */
  flipFlopMs: 120_000,
  /** A descent has paid when it has made the median interval at least this much shorter (x 0.85)... */
  gain: 0.85,
  /** ...and after one that did not, a new one starts only once the interval is this much longer than its start (x 1.15). */
  worse: 1.15,
  /** An interval this long is a pause (a hidden tab, a load), not a frame. */
  pauseMs: 400,
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
  /** The descent in progress: the level it started from and the median interval there. */
  private descent: { from: number; interval: number } | null = null;
  /** The interval at which a whole descent did not pay (null: none, or the frames have been fast since). */
  private noGainAt: number | null = null;

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
   * the interval had to fit). Returns the new level when it changes, else null.
   */
  sample(now: number, intervalMs: number, busyMs: number): number | null {
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
    else this.noGainAt = null; // fast again: what did not pay before is judged afresh
    const waiting = interval > GOVERNOR.slowMs && median(this.waits) > GOVERNOR.waitRefreshes * this.refresh;

    const d = this.descent;
    if (d && interval <= d.interval * GOVERNOR.gain) {
      this.descent = null; // the smaller picture paid: it stays (and the next step down, if any, starts a new descent)
    } else if (d && (this.level >= this.maxLevel || !waiting)) {
      // Every step down so far left the frames as slow as before: the sharp picture back, and no new descent at this rate.
      this.descent = null;
      this.noGainAt = d.interval;
      return this.step(d.from, now);
    }

    const blocked = this.noGainAt !== null && interval <= this.noGainAt * GOVERNOR.worse;
    if (this.level < this.maxLevel && waiting && !blocked) {
      if (!this.descent) {
        this.descent = { from: this.level, interval };
        if (now - this.lastUpAt < GOVERNOR.flipFlopMs) this.flipFlops++;
      }
      return this.step(this.level + 1, now);
    }
    const upWait = Math.min(GOVERNOR.maxUpWaitMs, GOVERNOR.upWindowMs * GOVERNOR.upBackoff ** this.flipFlops);
    if (!this.descent && this.level > 0 && now - this.fastSince >= upWait) {
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

/** The level a scene under `setting` starts on. */
export function startLevel(setting: string): number {
  const s = useRenderBudget.getState();
  return s.setting === setting ? s.level : 0;
}
