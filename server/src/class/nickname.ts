/**
 * Nickname identity inside a class. Pure.
 *
 * `nicknameKey` is THE server's one nickname normaliser (ruling E14): the class uses it to tell
 * "the same student again" (a refresh → take over their ghost) from "someone else with that name",
 * the escape rooms use it as the member key (Task 11), and the kick deny list (rooms/denySet.ts)
 * matches with it too.
 */

/** NFC, trimmed, every run of white space collapsed to one space, lower case. */
export function nicknameKey(n: string): string {
  return n.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * What a join under nickname key `key` means for this class:
 *  - `taken`: someone CONNECTED already uses it → refuse the join;
 *  - `takeover`: only a disconnected player (a ghost in its reconnection window) has it → the new
 *    session replaces that ghost (a refreshed tab / a second device of the same student);
 *  - `new`: nobody has it.
 */
export type NickDecision = { kind: "new" } | { kind: "takeover"; sid: string } | { kind: "taken" };

export function decideNickname(
  existing: readonly { sid: string; key: string; connected: boolean }[],
  key: string,
): NickDecision {
  let ghost: string | null = null;
  for (const e of existing) {
    if (e.key !== key) continue;
    if (e.connected) return { kind: "taken" };
    if (ghost === null) ghost = e.sid;
  }
  return ghost === null ? { kind: "new" } : { kind: "takeover", sid: ghost };
}
