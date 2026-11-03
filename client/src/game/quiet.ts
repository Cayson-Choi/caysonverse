/**
 * The quiet place (케이슨 마을, Task 4): the memorial hall's interior. The server drops Emoji and Jump there
 * without a word (VillageRoom `isQuiet`), so the local player must not play them either — an avatar that hops
 * or floats a heart on this screen while nobody else sees it would be a lie. Module state, like activeMap.ts:
 * the village scene's area store sets it when the local player's area changes (and clears it on unmount);
 * `pressJump` and the emoji controls read it, and the emoji bar and the touch jump button hide while it is on.
 * Everywhere else it stays off.
 */

import { useSyncExternalStore } from "react";

let quiet = false;
const listeners = new Set<() => void>();

/** True while jumping and emoji reactions are off. */
export function isQuiet(): boolean {
  return quiet;
}

export function setQuiet(on: boolean): void {
  if (quiet === on) return;
  quiet = on;
  for (const l of [...listeners]) l();
}

export function subscribeQuiet(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React: re-render when the quiet flag flips (the emoji bar and the jump button hide on it). */
export function useQuiet(): boolean {
  return useSyncExternalStore(subscribeQuiet, isQuiet, isQuiet);
}
