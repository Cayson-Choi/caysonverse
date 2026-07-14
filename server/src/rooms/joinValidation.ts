import {
  NICKNAME_MIN,
  NICKNAME_MAX,
  CHARACTER_COUNT,
  TINT_COUNT,
} from "@caysonverse/shared/constants";

/** Sanitized, accepted join options. */
export interface JoinOptions {
  nickname: string;
  character: number;
  tint: number;
}

/** A rejected join, carrying a Korean, user-facing reason. */
export interface JoinError {
  error: string;
}

// User-facing messages are Korean; identifiers/comments stay English.
const NICKNAME_ERROR = "닉네임은 2~12자의 한글/영문/숫자만 가능합니다";
const CHARACTER_ERROR = "캐릭터 선택이 올바르지 않습니다";
const TINT_ERROR = "색상 선택이 올바르지 않습니다";

// Allowed nickname characters: Unicode letters (Korean included), Unicode
// digits, ASCII space, underscore, hyphen. Control characters, emoji and other
// symbols are excluded because they match none of these classes.
const NICKNAME_PATTERN = /^[\p{L}\p{N} _-]+$/u;

/**
 * Pure validation of the client-supplied join options.
 *
 * Returns the sanitized options (nickname trimmed) on success, or a
 * `{ error }` object with a Korean message on rejection. Contains no I/O and no
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

  // character
  if (!isIndexInRange(o.character, CHARACTER_COUNT)) {
    return { error: CHARACTER_ERROR };
  }

  // tint
  if (!isIndexInRange(o.tint, TINT_COUNT)) {
    return { error: TINT_ERROR };
  }

  return { nickname, character: o.character, tint: o.tint };
}

/** True when `value` is an integer in [0, count). Narrows to `number`. */
function isIndexInRange(value: unknown, count: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < count;
}
