import { NICKNAME_MIN, NICKNAME_MAX } from "@caysonverse/shared/constants";
import { APPEARANCE_ERROR, validateAppearance, type Appearance } from "@caysonverse/shared/appearance";

/**
 * Client-side entry pre-validation. Deliberately mirrors the SERVER's
 * `validateJoinOptions` rules (same length bounds, same charset regex, and the
 * same shared `validateAppearance` for the 15 appearance fields) so the user
 * gets instant Korean feedback and a well-formed request — the server remains
 * the sole authority and re-checks everything.
 */

// User-facing strings are Korean (identifiers/comments stay English).
export const NICKNAME_ERROR = "닉네임은 2~12자의 한글/영문/숫자만 가능합니다";

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
  appearance: Appearance;
}

export type EntryResult =
  | { ok: true; value: EntryInput }
  | { ok: false; error: string };

/** Validate a full entry selection, returning the sanitized value or an error. */
export function validateEntry(input: EntryInput): EntryResult {
  const nicknameError = validateNickname(input.nickname);
  if (nicknameError) return { ok: false, error: nicknameError };

  // Nickname first, then the appearance (the server's order and message).
  const appearance = validateAppearance(input.appearance);
  if (appearance === null) return { ok: false, error: APPEARANCE_ERROR };

  return { ok: true, value: { nickname: input.nickname.trim(), appearance } };
}
