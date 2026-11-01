/**
 * Class code (반 코드) normalisation. Browser-safe: the entry form cleans what the student
 * types with `sanitizeCodeInput`, and the server validates the final value with
 * `normalizeClassCode` — both read the same alphabet.
 */

import { CLASS_CODE_ALPHABET, CLASS_CODE_LENGTH } from "./constants";

function allInAlphabet(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (!CLASS_CODE_ALPHABET.includes(s[i])) return false;
  }
  return true;
}

/**
 * The canonical form of a typed class code — trimmed, upper-case, exactly
 * `CLASS_CODE_LENGTH` symbols from `CLASS_CODE_ALPHABET` — or null when `raw` is not one
 * (wrong type, wrong length, or a character outside the alphabet such as 0/O/1/I).
 */
export function normalizeClassCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // Length is checked BEFORE upper-casing: "ß" upper-cases to "SS", which would otherwise
  // turn a 5-character input into a "valid" 6-character code.
  if (trimmed.length !== CLASS_CODE_LENGTH) return null;
  const code = trimmed.toUpperCase();
  if (code.length !== CLASS_CODE_LENGTH || !allInAlphabet(code)) return null;
  return code;
}

/**
 * Tidy a class-code input box while the student is typing: upper-case, delete every
 * character outside the alphabet (spaces, dashes, 0/O/1/I, Hangul), cut at
 * `CLASS_CODE_LENGTH`. Never throws and never returns more than 6 symbols.
 */
export function sanitizeCodeInput(raw: string): string {
  let out = "";
  for (const ch of raw.toUpperCase()) {
    if (CLASS_CODE_ALPHABET.includes(ch)) {
      out += ch;
      if (out.length === CLASS_CODE_LENGTH) break;
    }
  }
  return out;
}
