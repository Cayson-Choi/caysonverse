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
 */

import { DEFAULT_APPEARANCE, validateAppearance, type Appearance } from "@caysonverse/shared/appearance";
import { NICKNAME_MAX } from "@caysonverse/shared/constants";

const STORAGE_KEY = "cv.entry";

export interface CachedIdentity {
  nickname: string;
  appearance: Appearance;
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
        const stored = parsed as { nickname?: unknown; appearance?: unknown };
        const identity: CachedIdentity = {
          // A name saved under the old 12-character rule is cut to today's limit, so the entry form and a reconnect
          // send a name the server accepts (발주자 2026-11-10: 이름은 5글자까지만).
          nickname: typeof stored.nickname === "string" ? stored.nickname.trim().slice(0, NICKNAME_MAX) : "",
          appearance: validateAppearance(stored.appearance) ?? defaultAppearance(),
        };
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
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ nickname: identity.nickname, appearance: identity.appearance }),
    );
  } catch {
    // storage may be unavailable (private mode); non-fatal
  }
}
