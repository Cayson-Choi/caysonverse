import type { VillageTier } from "../villageModelPrep";
import type { VegMode } from "./vegMode";

/**
 * The village's built vegetation, kept while the player is indoors (the owner, 2026-11-13: coming out of the memorial
 * hall or a house covered the screen for 2-3 s while every tree was grown again). Indoors the village model goes away
 * (VillageModel unmounts, its clone is freed); the vegetation does not: VillageModel parks it here, given back to the
 * clone it dressed (`detach`), and the next VillageModel takes it and dresses its new clone with it at once (`attach`).
 * Only the very first arrival grows it (under the cover, VegVeil).
 *
 * The phone tier frees the parked vegetation's GPU buffers (its data stays, uploaded again on the way out), as it frees
 * the village's own files indoors (villageRelease.ts). A different tier or mode builds anew. The village scene holds
 * the park while it is up (`holdVegetationPark`); one tick after it goes, the parked vegetation is freed.
 */
export interface Parkable {
  detach(): void;
  releaseGpu(): void;
  dispose(): void;
}

interface Parked<T extends Parkable> {
  veg: T;
  tier: VillageTier;
  mode: VegMode;
}

export interface VegPark<T extends Parkable> {
  /** Keep `veg` (detached from its clone) for the next visit outside. Replaces (and frees) anything parked before. */
  park(veg: T, tier: VillageTier, mode: VegMode): void;
  /** The parked vegetation for this tier and mode (taken out of the park), or null; a mismatch is freed. */
  take(tier: VillageTier, mode: VegMode): T | null;
  /** Free what is parked. */
  clear(): void;
  /** While the village scene is up: returns the release (the park is cleared one tick later, unless held again). */
  hold(): () => void;
  /** What is parked (tests and the dev hook). */
  peek(): T | null;
}

export function createVegPark<T extends Parkable>(
  timers: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): VegPark<T> {
  let parked: Parked<T> | null = null;
  let holds = 0;
  let pending: unknown = null;
  const clear = () => {
    const p = parked;
    parked = null;
    p?.veg.dispose();
  };
  return {
    park(veg, tier, mode) {
      if (parked && parked.veg !== veg) clear();
      veg.detach();
      if (tier === "low") veg.releaseGpu();
      parked = { veg, tier, mode };
      // parked after the scene let go (its children's cleanups run after its own): free it with the scene
      if (holds === 0 && pending === null) {
        pending = timers.set(() => {
          pending = null;
          if (holds === 0) clear();
        }, 0);
      }
    },
    take(tier, mode) {
      const p = parked;
      if (!p) return null;
      parked = null;
      if (p.tier !== tier || p.mode !== mode) {
        p.veg.dispose();
        return null;
      }
      return p.veg;
    },
    clear,
    hold() {
      holds++;
      if (pending !== null) {
        timers.clear(pending);
        pending = null;
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
        if (holds > 0) return;
        if (pending !== null) timers.clear(pending);
        pending = timers.set(() => {
          pending = null;
          if (holds === 0) clear();
        }, 0);
      };
    },
    peek: () => parked?.veg ?? null,
  };
}
