/**
 * The seat the player last tapped (a chair or porch bench, seatTap.ts), so the walk that ends beside it offers THAT seat
 * though another chair 1 m off may be a hair nearer (the terrace's corner chairs): `interactInputAt` takes it while it is
 * free, in reach and approachable, for PREFERENCE_MS after the tap, and until the player sits, taps elsewhere or moves by
 * the keys or the stick (LocalPlayer.tsx clears it then; review 2026-11-15).
 */
export const PREFERENCE_MS = 30000;

let index = -1;
let until = 0;

/** Remember seat `i` as the tapped one (-1: none). */
export function setPreferredSeat(i: number, nowMs: number = Date.now()): void {
  index = i;
  until = i >= 0 ? nowMs + PREFERENCE_MS : 0;
}

/** The tapped seat while its time lasts, else -1. */
export function preferredSeat(nowMs: number = Date.now()): number {
  return index >= 0 && nowMs < until ? index : -1;
}
