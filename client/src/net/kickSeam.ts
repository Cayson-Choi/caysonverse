/**
 * Kick reconnection SEAM for Task 11.
 *
 * When this client is kicked (room leave code 4001), we persist a
 * session-scoped flag. Task 11 will add auto-reconnection; its logic MUST check
 * `wasKicked()` and REFUSE to auto-reconnect a kicked session (a kick is not a
 * transient network drop). The flag is cleared when the user deliberately
 * re-enters from the entry screen (`clearKicked()`), which is a fresh, intended
 * join — not an automatic reconnect.
 *
 * sessionStorage (not localStorage) is deliberate: the block is scoped to this
 * browser session/tab, so a brand-new tab or a later session starts clean. All
 * accesses are best-effort (private mode / disabled storage never throws).
 */

const KICK_FLAG = "cv.kicked";

/** Mark this session as kicked (called from the leave handler on code 4001). */
export function markKicked(): void {
  try {
    sessionStorage.setItem(KICK_FLAG, "1");
  } catch {
    // storage unavailable (private mode) — non-fatal
  }
}

/** True if this session was kicked and must not auto-reconnect (Task 11 reads this). */
export function wasKicked(): boolean {
  try {
    return sessionStorage.getItem(KICK_FLAG) === "1";
  } catch {
    return false;
  }
}

/** Clear the kick block — called when the user manually re-enters the world. */
export function clearKicked(): void {
  try {
    sessionStorage.removeItem(KICK_FLAG);
  } catch {
    // non-fatal
  }
}
