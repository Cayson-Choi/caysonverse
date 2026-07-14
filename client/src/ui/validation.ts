import {
  NICKNAME_MIN,
  NICKNAME_MAX,
  CHARACTER_COUNT,
  TINT_COUNT,
} from "@caysonverse/shared/constants";

/**
 * Client-side entry pre-validation. Deliberately mirrors the SERVER's
 * `validateJoinOptions` rules (same length bounds, same charset regex, same
 * index ranges) so the user gets instant Korean feedback and a well-formed
 * request — the server remains the sole authority and re-checks everything.
 */

// User-facing strings are Korean (identifiers/comments stay English).
export const NICKNAME_ERROR = "닉네임은 2~12자의 한글/영문/숫자만 가능합니다";
const CHARACTER_ERROR = "캐릭터 선택이 올바르지 않습니다";
const TINT_ERROR = "색상 선택이 올바르지 않습니다";

// Same class set as the server: Unicode letters/digits, ASCII space, `_`, `-`.
const NICKNAME_PATTERN = /^[\p{L}\p{N} _-]+$/u;

/** Returns a Korean error message, or `null` when the nickname is valid. */
export function validateNickname(raw: string): string | null {
  const nickname = raw.trim();
  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
    return NICKNAME_ERROR;
  }
  if (!NICKNAME_PATTERN.test(nickname)) return NICKNAME_ERROR;
  return null;
}

export interface EntryInput {
  nickname: string;
  character: number;
  tint: number;
}

export type EntryResult =
  | { ok: true; value: EntryInput }
  | { ok: false; error: string };

/** Validate a full entry selection, returning the sanitized value or an error. */
export function validateEntry(input: EntryInput): EntryResult {
  const nicknameError = validateNickname(input.nickname);
  if (nicknameError) return { ok: false, error: nicknameError };

  if (!isIndexInRange(input.character, CHARACTER_COUNT)) {
    return { ok: false, error: CHARACTER_ERROR };
  }
  if (!isIndexInRange(input.tint, TINT_COUNT)) {
    return { ok: false, error: TINT_ERROR };
  }

  return {
    ok: true,
    value: { nickname: input.nickname.trim(), character: input.character, tint: input.tint },
  };
}

/** True when `value` is an integer in [0, count). */
function isIndexInRange(value: number, count: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < count;
}
