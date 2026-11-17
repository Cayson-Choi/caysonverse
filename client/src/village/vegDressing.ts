/**
 * Whether the village is dressed (veg3d): its 3D trees, bushes, flowers and grass grown (villageVegetation.ts).
 *
 * The old flat foliage is hidden the moment the village is there (it must never show), and the new vegetation takes
 * a second or two to grow. Shown as it grows, every tree would first stand bare (trunk and limbs only) on each arrival:
 * so the village is covered (VegVeil) until it is dressed, and uncovered all at once with its crowns on.
 *
 * `begin()` when a build starts (VillageModel), `done(token)` when it ends built or failed (a cancelled build says
 * nothing: a newer one has begun, or the village is going away). A later `begin` supersedes an earlier one
 * (StrictMode's replay, a tier change): only the newest build's end uncovers. The cover starts closed: the village is
 * not dressed before its first build has even begun (the model still loading). Once dressed it stays so while the
 * player is indoors and back out (the vegetation is kept, vegPark.ts): only a new build covers again. `uncover()` when
 * the kept vegetation dresses the village at once, or when the model fails to load (its fallback and notice must show,
 * not the cover; `uncover` also makes a build still running end in nothing). `expect()` (the veil, while it covers)
 * and `begin()` arm a fail-safe: `FAIL_SAFE_MS` later it uncovers by itself, so a build that never ends (or never
 * starts: the model failed to load) cannot black out the village for good. `progress(token)` (the build grew another
 * part) pushes the fail-safe back, up to `HARD_CAP_MS` after `begin`: a slow device stays covered while its build is
 * really going on, and the trees never grow on screen. `reset()` when the scene goes away.
 */

export const FAIL_SAFE_MS = 12000;
/**
 * However the build progresses, the cover lifts this long (ms) after it began (perf/no-hitch 2026-11-17: a slow phone
 * grows the trees for 17-28 s; lifted by the 12 s fail-safe, the rest grew on screen in 300-700 ms steps).
 */
export const HARD_CAP_MS = 20000;

export interface VegDressing {
  dressed(): boolean;
  begin(): number;
  done(token: number): void;
  /** The build `token` made progress: the fail-safe waits again (never past HARD_CAP_MS after begin). */
  progress(token: number): void;
  /** Covered again (and the fail-safe off): the village went away before it was dressed. */
  cover(): void;
  /** Uncover now: the village is dressed without a build (its kept vegetation), or its model failed to load. */
  uncover(): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

export function createVegDressing(
  timers: {
    set(fn: () => void, ms: number): unknown;
    clear(h: unknown): void;
    now?: () => number;
  } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
  },
): VegDressing {
  let dressed = false;
  let token = 0;
  let safe: unknown = null;
  const listeners = new Set<() => void>();
  const set = (v: boolean) => {
    if (dressed === v) return;
    dressed = v;
    for (const l of [...listeners]) l();
  };
  const disarm = () => {
    if (safe !== null) timers.clear(safe);
    safe = null;
  };
  const now = timers.now ?? (() => Date.now());
  let begunAt = 0;
  const arm = (ms = FAIL_SAFE_MS) => {
    disarm();
    const mine = token;
    safe = timers.set(() => {
      safe = null;
      if (mine === token) set(true);
    }, ms);
  };
  return {
    dressed: () => dressed,
    begin() {
      token++;
      begunAt = now();
      arm();
      set(false);
      return token;
    },
    progress(t) {
      if (t !== token || safe === null || dressed) return;
      arm(Math.max(0, Math.min(FAIL_SAFE_MS, begunAt + HARD_CAP_MS - now())));
    },
    cover() {
      disarm();
      set(false);
    },
    done(t) {
      if (t !== token) return;
      disarm();
      set(true);
    },
    uncover() {
      token++;
      disarm();
      set(true);
    },
    reset() {
      disarm();
      set(false);
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/** The village's one (VillageModel writes it, VegVeil reads it). */
export const vegDressing = createVegDressing();
