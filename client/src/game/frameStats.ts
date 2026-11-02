/**
 * Frame-interval sampler for the performance E2E (`__cv.getFrameStats`, DEV only).
 *
 * One requestAnimationFrame callback writes its timestamp into a preallocated ring, so sampling
 * allocates nothing on the frame path. Only a read (`stats`, about once per run) copies and sorts the
 * intervals it needs. Headless frame times are a reference, never the 30 fps verdict (that is the
 * owner's real phone, Task 27).
 */

/** Interval statistics over a trailing window. */
export interface FrameStats {
  /** Intervals in the window. */
  frames: number;
  /** Mean rAF interval (ms); 0 with no frames. */
  meanMs: number;
  /** 95th percentile interval (ms); 0 with no frames. */
  p95Ms: number;
  /** Longest interval (ms); 0 with no frames. */
  maxMs: number;
  /** The window that was asked for (ms). */
  windowMs: number;
}

export interface FrameSampler {
  /** Record one rAF timestamp (`performance.now()` based). */
  sample: (now: number) => void;
  /** Interval statistics over the intervals that ended within `windowMs` before `now`. */
  stats: (windowMs: number, now: number) => FrameStats;
}

/** About 68 s of 60 fps. */
const DEFAULT_CAPACITY = 4096;

/** Mean / p95 / max of already-collected intervals (`s[floor(n * 0.95)]`, the same convention as the other perf scripts). */
export function summarizeIntervals(intervals: readonly number[], windowMs: number): FrameStats {
  if (intervals.length === 0) return { frames: 0, meanMs: 0, p95Ms: 0, maxMs: 0, windowMs };
  const sorted = [...intervals].sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) sum += v;
  return {
    frames: sorted.length,
    meanMs: sum / sorted.length,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    maxMs: sorted[sorted.length - 1],
    windowMs,
  };
}

export function createFrameSampler(capacity: number = DEFAULT_CAPACITY): FrameSampler {
  const stamps = new Float64Array(capacity);
  let total = 0;
  return {
    sample(now) {
      stamps[total % capacity] = now;
      total++;
    },
    stats(windowMs, now) {
      const have = Math.min(total, capacity);
      const stamp = (j: number) => stamps[(total - have + j) % capacity];
      const intervals: number[] = [];
      for (let j = have - 1; j >= 1; j--) {
        if (stamp(j) < now - windowMs) break;
        intervals.push(stamp(j) - stamp(j - 1));
      }
      return summarizeIntervals(intervals, windowMs);
    },
  };
}

let shared: FrameSampler | null = null;
let rafId = 0;

/**
 * The page-wide sampler, started on first use and kept for the whole session (so the window survives a
 * hall → classroom switch). DEV callers only: the debug hook is behind `import.meta.env.DEV`.
 */
export function ensureFrameSampler(): FrameSampler {
  if (shared === null) {
    const sampler = createFrameSampler();
    shared = sampler;
    const tick = (now: number) => {
      sampler.sample(now);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
  return shared;
}

/** Stop the shared sampler (tests). */
export function stopFrameSampler(): void {
  if (rafId !== 0) cancelAnimationFrame(rafId);
  rafId = 0;
  shared = null;
}
