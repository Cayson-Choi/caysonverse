/**
 * Pure announcement sanitizer. Clock-free and I/O-free like sanitizeChat, but
 * with two deliberate differences from chat:
 *
 *  1. Length cap is ANNOUNCE_MAX_LENGTH (300), not CHAT_MAX_LENGTH — a notice
 *     can carry more than a single chat line.
 *  2. An EMPTY result is VALID: an admin sending "" (or whitespace-only) CLEARS
 *     the banner. So the tri-state return differs from sanitizeChat:
 *       - non-empty string → set the banner to this text
 *       - ""               → clear the banner (valid, intentional)
 *       - null             → drop the request (not a string, or over the cap)
 *
 *  3. NEWLINES ARE PRESERVED (final-review F6): the announce UI is deliberately
 *     multi-line (rows=3 textarea, pre-wrap banner), so we call `stripControl`
 *     with `keepNewlines` — `\r\n` is normalized to `\n` and interior line feeds
 *     survive, while all other control/zero-width characters are still stripped.
 *     Chat stays single-line (it strips newlines). `.trim()` only removes leading
 *     and trailing whitespace (including blank lines), never interior newlines.
 *
 * Reuses `stripControl` from chat.ts so the strip policy is defined once.
 */

import { ANNOUNCE_MAX_LENGTH } from "@caysonverse/shared/constants";
import { stripControl } from "./chat";

/** See module doc: string (set) | "" (clear) | null (drop). */
export function sanitizeAnnounce(text: unknown): string | null {
  if (typeof text !== "string") return null;

  const cleaned = stripControl(text, { keepNewlines: true }).trim();
  if (cleaned.length > ANNOUNCE_MAX_LENGTH) return null; // oversized → drop

  return cleaned; // "" is a legitimate clear
}
