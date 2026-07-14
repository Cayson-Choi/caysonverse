/**
 * Pure chat-text sanitizer. Clock-free and I/O-free so it is exhaustively
 * unit-testable; the room supplies the string and decides what to do with the
 * result (broadcast) or its absence (silent drop).
 *
 * Policy (binding): must be a string -> strip control characters (C0 incl.
 * tab/newline/CR, DEL + C1, and zero-width formatters) -> trim -> reject (return
 * null) if empty or longer than CHAT_MAX_LENGTH. Regular spaces are content and
 * are preserved; Korean text (outside every stripped range) is never touched.
 */

import { CHAT_MAX_LENGTH } from "@caysonverse/shared/constants";

/**
 * True for invisible/formatting code points removed before length-checking:
 *  - 0x00-0x1F  C0 controls (tab, newline, carriage return, bell, null, ...)
 *  - 0x7F-0x9F  DEL and the C1 control block
 *  - 0x200B-0x200D  zero-width space / non-joiner / joiner
 *  - 0x2060     word joiner
 *  - 0xFEFF     zero-width no-break space / BOM
 * Expressed as numeric ranges so no invisible characters live in the source.
 */
function isStripped(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200d) ||
    code === 0x2060 ||
    code === 0xfeff
  );
}

/**
 * Remove every invisible/formatting code point (see isStripped) but keep all
 * visible content and regular spaces. Does NOT trim — the caller decides whether
 * leading/trailing spaces matter. Shared by sanitizeChat and sanitizeAnnounce so
 * the strip policy lives in exactly one place.
 */
export function stripControl(text: string): string {
  let cleaned = "";
  for (const ch of text) {
    if (!isStripped(ch.codePointAt(0)!)) cleaned += ch;
  }
  return cleaned;
}

/**
 * Return the cleaned message, or null if it must be dropped.
 *
 * `maxLength` parameterizes the length cap (default CHAT_MAX_LENGTH) so the same
 * sanitizer backs both chat and the longer admin announcement — no duplicated
 * strip/trim logic. Empty (after strip+trim) is still a drop here; the announce
 * path handles "empty clears" separately (see announce.ts).
 */
export function sanitizeChat(text: unknown, maxLength: number = CHAT_MAX_LENGTH): string | null {
  if (typeof text !== "string") return null;

  const cleaned = stripControl(text).trim();

  if (cleaned.length === 0 || cleaned.length > maxLength) return null;
  return cleaned;
}
