/**
 * Pure typing-indicator payload validator. Clock-free and I/O-free so it is
 * exhaustively unit-testable; the room supplies the payload and decides what to
 * do with the result (rate-cap + broadcast) or its absence (silent drop — the
 * indicator is a cosmetic hint, so there is no personal rejection notice).
 *
 * Policy (binding): the payload must be an object whose `on` is a real boolean;
 * anything else (wrong type, truthy non-boolean, missing field, or a malformed
 * payload) returns null. The boolean is returned as-is so `false` (typing OFF)
 * stays distinguishable from `null` (invalid).
 */

/** Return the validated `on` flag, or null if the message must be dropped. */
export function validateTypingPayload(payload: unknown): boolean | null {
  if (typeof payload !== "object" || payload === null) return null;
  const on = (payload as { on?: unknown }).on;
  return typeof on === "boolean" ? on : null;
}
