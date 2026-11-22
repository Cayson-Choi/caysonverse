/**
 * Whether the park's world is on screen yet (first-time-player review: after the door the park showed a plain void for the seconds its textures, models and
 * rides were still loading, and it looked broken). ParkWorld suspends until everything it needs has loaded; its first effect marks it ready, and the
 * "불러오는 중" veil (CoasterHud.tsx ParkLoadingVeil) is up until then.
 */
import { useSyncExternalStore } from "react";

let ready = false;
const listeners = new Set<() => void>();

export function setParkReady(v: boolean): void {
  if (ready === v) return;
  ready = v;
  if (!v) stage = 0;
  for (const l of listeners) l();
}
export function parkReady(): boolean {
  return ready;
}
export function useParkReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    parkReady,
    parkReady,
  );
}

/** How far the park has come once its files are in: 0 nothing, 1 mounted, 2 its first frames drawn (the loading screen's stage line, areaLoading.ts). */
let stage: 0 | 1 | 2 = 0;
export function setParkStage(v: 0 | 1 | 2): void {
  if (stage === v) return;
  stage = v;
  for (const l of listeners) l();
}
export function parkStage(): 0 | 1 | 2 {
  return stage;
}
export function useParkStage(): 0 | 1 | 2 {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    parkStage,
    parkStage,
  );
}
