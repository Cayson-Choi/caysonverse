/**
 * Releasing one entry of the loaders' cache (drei/r3f `useLoader`, suspend-react underneath), including an entry that
 * is still loading (final fix, the parked "release mid-load" item of the Task 9 review).
 *
 * The cache's read (`useLoader(...)`, `useGLTF(...)`: plain functions, no React hooks inside) returns the value once it
 * has loaded and throws the in-flight promise while it loads. Clearing an entry while it loads would orphan the
 * result: the textures and geometry that arrive afterwards would never be freed. So a release that finds the entry
 * still loading waits for it, then frees and clears it, unless someone holds the files again by then (they will use
 * it). A failed load is just cleared.
 *
 * Only call this for an entry that was requested: reading an entry that does not exist would start a new download.
 */

/** One cache entry: read it (throws its promise while loading), clear it, free its value (GPU side). */
export interface CachedFile<T = unknown> {
  /** Unique per entry: a release already waiting for it is not doubled. */
  id: string;
  read(): T;
  clear(): void;
  free(value: T): void;
}

const waiting = new Set<string>();

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  typeof v === "object" && v !== null && typeof (v as { then?: unknown }).then === "function";

/** True while a release waits for `id` to finish loading (tests, dev probes). */
export function isWaitingForLoad(id: string): boolean {
  return waiting.has(id);
}

/**
 * Free and clear `file` now, or once it has finished loading. `stillHeld`: checked when a load finishes; true leaves
 * the entry to whoever holds it now.
 */
export function releaseCachedFile<T>(file: CachedFile<T>, stillHeld: () => boolean): void {
  if (waiting.has(file.id)) return;
  let value: T;
  try {
    value = file.read();
  } catch (thrown) {
    if (isThenable(thrown)) {
      waiting.add(file.id);
      const settle = () => {
        waiting.delete(file.id);
        if (!stillHeld()) releaseCachedFile(file, stillHeld);
      };
      thrown.then(settle, settle);
      return;
    }
    try {
      file.clear(); // a failed load: drop the error so the next visit tries again
    } catch {
      // ignore
    }
    return;
  }
  try {
    file.clear();
  } catch {
    // ignore
  }
  try {
    file.free(value);
  } catch {
    // freeing is best effort
  }
}
