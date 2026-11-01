/**
 * Server-side class-code generation. The alphabet and length come from the shared
 * constants, so every generated code passes `normalizeClassCode` unchanged.
 */

import { randomInt } from "node:crypto";
import { CLASS_CODE_ALPHABET, CLASS_CODE_LENGTH } from "@caysonverse/shared/escape/constants";

/**
 * Attempts before giving up. With 32^6 ≈ 1.07e9 codes and at most a handful of classes,
 * even one collision is a one-in-ten-million event; the bound only stops an endless loop
 * when `taken` is broken.
 */
const MAX_ATTEMPTS = 1000;

/**
 * A fresh class code for which `taken(code)` is false. `rand(n)` returns an integer in
 * [0, n) — crypto.randomInt by default (class codes are guessable entry tickets, so they
 * must not come from Math.random).
 */
export function generateClassCode(
  taken: (code: string) => boolean,
  rand: (n: number) => number = (n) => randomInt(n),
): string {
  const n = CLASS_CODE_ALPHABET.length;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let code = "";
    for (let i = 0; i < CLASS_CODE_LENGTH; i++) code += CLASS_CODE_ALPHABET[rand(n)];
    if (!taken(code)) return code;
  }
  throw new Error("no free class code");
}
