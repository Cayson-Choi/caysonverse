/**
 * A heavy useMemo that survives React throwing a render away (perf/100, 2026-11-28).
 *
 * React keeps a memo only for a component that COMMITTED. A render React discards — a Suspense retry interrupted by a more
 * urgent update (R3F renders concurrently: any HUD or store update cuts in), or a sibling suspending on the first mount —
 * computes every useMemo again on the next try. The village's dressing (prepareVillage: a clone of the whole village and
 * hundreds of materials) took ~160 ms a try on a 4x-throttled phone, longer than the gap between two such updates, so on the
 * way back out of the hall, a house or the park the village was dressed ~6 times a second and never shown (measured: 110
 * dressings in 15 s, 0 commits; the player stood in an empty grey world with 250-1300 ms frames).
 *
 * A `KeptSlot` holds the last value made for a set of inputs (compared by identity) across those retries. The component
 * marks the value it drew (`commit`, in an effect) and gives it back when it unmounts (`release`, before freeing it). A
 * value made for older inputs that was never drawn is handed to `drop` (freed) when new inputs replace it; a drawn one is
 * left to its component's own cleanup.
 */
export class KeptSlot<T> {
  private deps: readonly unknown[] | null = null;
  private value: T | null = null;
  private committed = false;

  constructor(private readonly drop: (value: T) => void) {}

  /** The value for `deps`: the kept one when the inputs are the same objects, else a new one from `make`. */
  get(deps: readonly unknown[], make: () => T): T {
    if (this.value !== null && this.deps && this.deps.length === deps.length && this.deps.every((d, i) => d === deps[i])) return this.value;
    if (this.value !== null && !this.committed) {
      try {
        this.drop(this.value);
      } catch {
        // a failed free never blocks the new value
      }
    }
    this.value = make();
    this.deps = deps;
    this.committed = false;
    return this.value;
  }

  /** The component drew `value` (call from an effect). */
  commit(value: T): void {
    if (value === this.value) this.committed = true;
  }

  /** The component is done with `value` (call in its cleanup, before freeing it): it is no longer handed out. */
  release(value: T): void {
    if (value !== this.value) return;
    this.value = null;
    this.deps = null;
    this.committed = false;
  }
}
