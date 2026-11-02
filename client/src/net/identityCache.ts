/**
 * Identity cache (localStorage) — the last-used entry selection ("마지막 외형 기억").
 * Written by the entry screen on 입장 only (never on every builder edit) and read
 * when the entry screen opens, to prefill the nickname and the builder's look.
 * The resilience driver's silent fresh re-join after a server restart uses this
 * tab's in-memory identity (appStore) and falls back to this cache only when
 * there is none — another tab may have saved a different look meanwhile. All
 * accesses are best-effort (private mode / disabled storage never throws).
 *
 * Character stage 3: the value is `{ nickname, appearance }` under the same key.
 * A value saved by the pre-builder build (`{ nickname, character, tint }`), or one
 * whose appearance is corrupt or out of range (an older/newer manifest, a
 * hand-edited store), keeps its nickname and gets DEFAULT_APPEARANCE as a whole
 * (spec §5.2) — never a half-valid mix, never a crash on the entry screen.
 *
 * AI 학교 탈출 (Task 13): a class entry also remembers its class code (반 코드), so the entry
 * screen can prefill it and a class connection's Phase-2 rejoin finds the class again. The
 * field is OPTIONAL (ruling E14): a world identity has none. Only the canonical form
 * (`normalizeClassCode`) is ever written; a stored value that is not one loads as "" (no code).
 */

import { DEFAULT_APPEARANCE, validateAppearance, type Appearance } from "@caysonverse/shared/appearance";
import { normalizeClassCode } from "@caysonverse/shared/escape/classCode";

const STORAGE_KEY = "cv.entry";

export interface CachedIdentity {
  nickname: string;
  appearance: Appearance;
  /** The last class code entered (canonical), "" when the stored one was not valid; absent for the world. */
  classCode?: string;
}

/** A fresh, mutable copy of the default look (DEFAULT_APPEARANCE itself is frozen). */
function defaultAppearance(): Appearance {
  return { ...DEFAULT_APPEARANCE };
}

/** Load the last-used selection (prefill + reconnect re-join). Never throws. */
export function loadIdentity(): CachedIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        const stored = parsed as { nickname?: unknown; appearance?: unknown; classCode?: unknown };
        const identity: CachedIdentity = {
          nickname: typeof stored.nickname === "string" ? stored.nickname : "",
          appearance: validateAppearance(stored.appearance) ?? defaultAppearance(),
        };
        if ("classCode" in stored) identity.classCode = normalizeClassCode(stored.classCode) ?? "";
        return identity;
      }
    }
  } catch {
    // ignore malformed/absent storage
  }
  return { nickname: "", appearance: defaultAppearance() };
}

/** Persist the selection so a later session/reconnect reuses it. Never throws. */
export function saveIdentity(identity: CachedIdentity): void {
  try {
    const classCode = normalizeClassCode(identity.classCode);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        nickname: identity.nickname,
        appearance: identity.appearance,
        ...(classCode !== null ? { classCode } : {}),
      }),
    );
  } catch {
    // storage may be unavailable (private mode); non-fatal
  }
}
