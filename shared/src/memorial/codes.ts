import { CROCKFORD_ALPHABET } from "./constants";

/**
 * Crockford base32 codes (share 8, invite 12, recovery 12): encode random bytes, normalise what a person types back in.
 * Pure; the caller supplies the random bytes (crypto on the server, never Math.random).
 */

/** The first `length` base32 chars of `bytes` (5 bits each; `bytes` must carry at least `length * 5` bits). */
export function crockfordFromBytes(bytes: Uint8Array, length: number): string {
  if (bytes.length * 8 < length * 5) throw new Error("not enough random bytes");
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      bits -= 5;
      out += CROCKFORD_ALPHABET[(acc >>> bits) & 31];
    }
    acc &= (1 << bits) - 1;
    if (out.length >= length) break;
  }
  return out;
}

/** Uppercase, drop spaces and hyphens, read O as 0 and I / L as 1. Returns null when anything else is left over. */
export function normalizeCode(input: unknown, length: number): string | null {
  if (typeof input !== "string") return null;
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (s.length !== length) return null;
  for (const ch of s) if (!CROCKFORD_ALPHABET.includes(ch)) return null;
  return s;
}

/** `7KQ2M9XD` → `7KQ2-M9XD` (groups of 4, for reading aloud / writing down). */
export function groupCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}
