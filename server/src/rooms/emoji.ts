/**
 * Pure emoji-index validator. Clock-free and I/O-free so it is exhaustively
 * unit-testable; the room supplies the payload and decides what to do with the
 * result (broadcast) or its absence (silent drop — a reaction is a button
 * click, not typed effort, so there is no personal rejection notice for a bad
 * index, mirroring the rate-cap drop policy).
 *
 * Policy (binding): the payload's `index` must be an integer within
 * `0..EMOJIS.length-1`; anything else (wrong type, NaN/Infinity, a float, out
 * of range, or a malformed/missing payload) returns null.
 */

import { EMOJIS } from "@caysonverse/shared/constants";

/** Return the validated index, or null if the message must be dropped. */
export function validateEmojiIndex(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const index = (payload as { index?: unknown }).index;
  if (typeof index !== "number" || !Number.isInteger(index)) return null;
  if (index < 0 || index >= EMOJIS.length) return null;
  return index;
}
