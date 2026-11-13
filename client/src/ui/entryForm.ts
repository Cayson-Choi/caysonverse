/**
 * The entry's village flow. Pure: no React, no DOM, no network. EntryScreen renders it and passes the real
 * connection functions into the flow (`VillageEntryDeps`), so the order of the calls and what is stored are
 * unit-tested here.
 *
 * The character builder (캐릭터 조립실) is Caysonverse's entrance: the look and the nickname are made there, and
 * 입장하기 checks them and joins 케이슨 마을 at once — no code, no destination step. Every address opens the
 * village (older `?experience=escape` / `?world=legacy` links included).
 */

import type { Appearance } from "@caysonverse/shared/appearance";
// Type-only: these modules open sockets / touch storage; the flow gets them injected.
import type { CachedIdentity } from "../net/identityCache";
import type { Identity } from "../stores/appStore";

/** The entry's fixed words (Korean-facing). */
export const ENTRY_COPY = {
  /** A join that failed without words of its own. */
  failed: "입장에 실패했습니다. 다시 시도해주세요.",
} as const;

/** A checked entry: the trimmed nickname and the validated look (validateEntry's value). */
interface Who {
  nickname: string;
  appearance: Appearance;
}

/** What entering 케이슨 마을 needs from the app (EntryScreen passes the real functions). */
export interface VillageEntryDeps {
  /** Joins (or creates) a village room; rejects with Korean words (connection.joinVillage maps them). */
  joinVillage(p: { nickname: string; appearance: Appearance }): Promise<{ sessionId: string }>;
  saveIdentity(identity: CachedIdentity): void;
  clearKicked(): void;
  enterVillage(identity: Identity): void;
}

/**
 * 입장하기: straight into 케이슨 마을. The look is remembered first (a later visit prefills it) and a
 * deliberate entry clears an earlier kick; then the village is joined and the screen moves. A rejected join
 * leaves the screen where it is (nothing is entered) and rejects with the join's Korean words.
 */
export async function enterVillageDirectly(deps: VillageEntryDeps, v: Who): Promise<void> {
  deps.saveIdentity({ nickname: v.nickname, appearance: v.appearance });
  deps.clearKicked();
  const room = await deps.joinVillage({ nickname: v.nickname, appearance: v.appearance });
  deps.enterVillage({ nickname: v.nickname, appearance: v.appearance, sessionId: room.sessionId });
}
