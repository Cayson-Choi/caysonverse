/**
 * The 달배's seat choice on the boarding panel (owner 2026-11-20: "맨 끝에가 제일 무섭게 보인단 말이야"): "end" (맨 끝 자리, the default: the bow and
 * stern rows swing highest) or "middle" (가운데 자리, the gentlest seats). Sent with the board (net/connection.ts sendRideBoard); the server hands out
 * the seats in that order (shared/land/moonBoat.ts moonBoardingSeats). Kept in the browser between visits.
 */
import type { MoonSeatPref } from "@caysonverse/shared/land/moonBoat";

const KEY = "cv.moonSeatPref";
let pref: MoonSeatPref = "end";
try {
  if (typeof window !== "undefined" && window.localStorage.getItem(KEY) === "middle") pref = "middle";
} catch {
  /* private window: the default */
}
const listeners = new Set<() => void>();

export function moonSeatPref(): MoonSeatPref {
  return pref;
}
export function setMoonSeatPref(next: MoonSeatPref): void {
  if (next === pref) return;
  pref = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  for (const l of [...listeners]) l();
}
export function subscribeMoonSeatPref(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
