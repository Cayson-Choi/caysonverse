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
 * starts: the model failed to load) cannot black out the village for good. `reset()` when the scene goes away.
 */

export const FAIL_SAFE_MS = 12000;

export interface VegDressing {
  dressed(): boolean;
  begin(): number;
  done(token: number): void;
  expect(): void;
  /** Uncover now: the village is dressed without a build (its kept vegetation), or its model failed to load. */
  uncover(): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

export function createVegDressing(
  timers: {
    set(fn: () => void, ms: number): unknown;
    clear(h: unknown): void;
  } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
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
  const arm = () => {
    disarm();
    const mine = token;
    safe = timers.set(() => {
      safe = null;
      if (mine === token) set(true);
    }, FAIL_SAFE_MS);
  };
  return {
    dressed: () => dressed,
    begin() {
      token++;
      arm();
      set(false);
      return token;
    },
    expect() {
      if (!dressed && safe === null) arm();
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
