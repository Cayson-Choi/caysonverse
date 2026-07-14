/**
 * Identity cache (localStorage) — the last-used entry selection. Written by the
 * entry screen at join (Task 4) and read by the resilience driver for the silent
 * fresh re-join after a server restart (no DB, so a new avatar at spawn is
 * expected — but the SAME nickname/character/tint). All accesses are best-effort
 * (private mode / disabled storage never throws).
 */

const STORAGE_KEY = "cv.entry";

export interface CachedIdentity {
  nickname: string;
  character: number;
  tint: number;
}

/** Load the last-used selection (prefill + reconnect re-join). Never throws. */
export function loadIdentity(): CachedIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CachedIdentity>;
      return {
        nickname: typeof parsed.nickname === "string" ? parsed.nickname : "",
        character: Number.isInteger(parsed.character) ? (parsed.character as number) : 0,
        tint: Number.isInteger(parsed.tint) ? (parsed.tint as number) : 0,
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
