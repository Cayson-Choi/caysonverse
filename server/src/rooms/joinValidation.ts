import { NICKNAME_MIN, NICKNAME_MAX } from "@caysonverse/shared/constants";
import { APPEARANCE_ERROR, validateAppearance, type Appearance } from "@caysonverse/shared/appearance";

/** Sanitized, accepted join options. */
export interface JoinOptions {
  nickname: string;
  /** Exactly the 15 appearance fields, each an integer in its range (extra keys dropped). */
  appearance: Appearance;
}

/** A rejected join, carrying a Korean, user-facing reason. */
export interface JoinError {
  error: string;
}

// User-facing messages are Korean; identifiers/comments stay English.
// The appearance message is APPEARANCE_ERROR, shared with the entry screen.
const NICKNAME_ERROR = "닉네임은 2~12자의 한글/영문/숫자만 가능합니다";

/**
 * Sent to a stale pre-builder bundle: a tab left open across a deploy rejoins with
 * `{ character, tint }` and no `appearance`. APPEARANCE_ERROR would never clear for it
 * (the old page keeps sending the same options), so it is told to reload instead.
 * The old client shows any Korean server message verbatim (reconnectPolicy.joinErrorNotice).
 */
export const STALE_CLIENT_ERROR = "새 버전이 나왔어요. 페이지를 새로고침(F5)해 주세요";

// Allowed nickname characters: Unicode letters (Korean included), Unicode
// digits, ASCII space, underscore, hyphen. Control characters, emoji and other
// symbols are excluded because they match none of these classes.
const NICKNAME_PATTERN = /^[\p{L}\p{N} _-]+$/u;

/**
 * Pure validation of the client-supplied join options.
 *
 * Returns the sanitized options (nickname trimmed, appearance reduced to its 15
 * fields) on success, or a `{ error }` object with a Korean message on rejection.
 * The nickname is checked first, then the appearance. A stale pre-builder bundle
 * that still sends `{ character, tint }` without `appearance` gets STALE_CLIENT_ERROR
 * (refresh the page); any other missing or invalid appearance gets APPEARANCE_ERROR
 * (Review Focus 3). Contains no I/O and no
 * clock access, so the room can throw the error to reject the join while this
 * logic stays exhaustively unit-testable.
 */
export function validateJoinOptions(options: unknown): JoinOptions | JoinError {
  if (typeof options !== "object" || options === null) {
    return { error: NICKNAME_ERROR };
  }
  const o = options as Record<string, unknown>;

  // nickname
  if (typeof o.nickname !== "string") return { error: NICKNAME_ERROR };
  const nickname = o.nickname.trim();
  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
    return { error: NICKNAME_ERROR };
  }
  if (!NICKNAME_PATTERN.test(nickname)) return { error: NICKNAME_ERROR };

  // A pre-builder bundle (character stage 2 and earlier) sends { character, tint } instead of appearance.
  if (o.appearance === undefined && (o.character !== undefined || o.tint !== undefined)) {
    return { error: STALE_CLIENT_ERROR };
  }

  // appearance: all 15 fields in range (shared/appearance.ts is the one rule set)
  const appearance = validateAppearance(o.appearance);
  if (appearance === null) return { error: APPEARANCE_ERROR };

  return { nickname, appearance };
}
