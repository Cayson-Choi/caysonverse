/**
 * Identity cache (localStorage) — the last-used entry selection. Written by the
 * entry screen at join (Task 4) and read by the resilience driver for the silent
 * fresh re-join after a server restart (no DB, so a new avatar at spawn is
 * expected — but the SAME nickname/character/tint). All accesses are best-effort
 * (private mode / disabled storage never throws).
 */

import { CHARACTER_COUNT, TINT_COUNT } from "@caysonverse/shared/constants";

const STORAGE_KEY = "cv.entry";

export interface CachedIdentity {
  nickname: string;
  character: number;
  tint: number;
}

/**
 * Coerce a stored index to a valid preset index, else 0. Guards against a value
 * saved by an OLDER session (roster grew/shrank), a corrupted store, or a
 * non-integer — the entry screen renders CHARACTERS[character], so an
 * out-of-range index must never survive to a `CHARACTERS[99] is undefined` crash.
 */
function safeIndex(value: unknown, count: number): number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < count
    ? (value as number)
    : 0;
}

/** Load the last-used selection (prefill + reconnect re-join). Never throws. */
export function loadIdentity(): CachedIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CachedIdentity>;
      return {
        nickname: typeof parsed.nickname === "string" ? parsed.nickname : "",
        character: safeIndex(parsed.character, CHARACTER_COUNT),
        tint: safeIndex(parsed.tint, TINT_COUNT),
      };
    }
  } catch {
    // ignore malformed/absent storage
  }
  return { nickname: "", character: 0, tint: 0 };
}

/** Persist the selection so a later session/reconnect reuses it. Never throws. */
export function saveIdentity(identity: CachedIdentity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // storage may be unavailable (private mode); non-fatal
  }
}
