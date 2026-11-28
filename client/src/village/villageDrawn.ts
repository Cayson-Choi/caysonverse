import { useSyncExternalStore } from "react";

/**
 * Whether the village model is on screen (perf/return, 2026-11-28): set once VillageModel has committed and two frames have been
 * drawn with it, cleared when it unmounts. The "마을로 나가는 중…" screen (areaLoading.ts) waits for it, so the way out of a
 * building never shows the empty ground the village stands on while its files load again (phone tier).
 */
let drawn = false;
const listeners = new Set<() => void>();

export function villageDrawn(): boolean {
  return drawn;
}

export function setVillageDrawn(on: boolean): void {
  if (drawn === on) return;
  drawn = on;
  for (const l of listeners) l();
}

export function subscribeVillageDrawn(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useVillageDrawn(): boolean {
  return useSyncExternalStore(subscribeVillageDrawn, villageDrawn, villageDrawn);
}
