import { useSyncExternalStore } from "react";

/**
 * Whether the cubby close-up's card is folded (owner 2026-11-20: "호두에 대한 정보를 접어 놓을 수도 있고 펼쳐볼 수도 있게"). Folded, the
 * card is a slim bar with the name, so the cubby and its photo show behind it. The choice holds for the browser tab's session
 * (sessionStorage, guarded: a private window or blocked storage just starts unfolded) and for every cubby opened meanwhile.
 */

const KEY = "cv-cubby-folded";

function read(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let folded = read();
const listeners = new Set<() => void>();

export function isCubbyCardFolded(): boolean {
  return folded;
}

export function setCubbyCardFolded(on: boolean): void {
  if (folded === on) return;
  folded = on;
  try {
    if (on) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the choice lasts until the page closes */
  }
  for (const l of [...listeners]) l();
}

export function subscribeCubbyFold(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React: the folded flag (re-renders on a toggle). */
export function useCubbyCardFolded(): boolean {
  return useSyncExternalStore(subscribeCubbyFold, isCubbyCardFolded, isCubbyCardFolded);
}
