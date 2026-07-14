/**
 * Pure float-up animation progress for emoji reactions. Given the elapsed time
 * since an emoji started showing, returns how far it has risen and how opaque
 * it is. Clock-free (elapsedMs is injected) so it is exhaustively testable;
 * useEmoji.ts calls it every frame with `performance.now() - entry.startedAt`
 * — no React state, no per-frame allocation beyond the returned literal.
 *
 * Rises EMOJI_RISE_M linearly over EMOJI_DISPLAY_MS; opacity stays at 1 until
 * FADE_START_FRACTION of the duration, then fades linearly to 0 by the end.
 * Both values clamp outside [0, EMOJI_DISPLAY_MS] so a late or negative frame
 * never overshoots the rise or opacity range.
 */

import { EMOJI_DISPLAY_MS } from "@caysonverse/shared/constants";

/** Total upward travel (m) over the animation's lifetime. */
export const EMOJI_RISE_M = 0.8;

/** Fraction of EMOJI_DISPLAY_MS at which the fade-out begins (opaque before). */
const FADE_START_FRACTION = 0.6;

export interface EmojiProgress {
  /** Metres to add to the sprite's base height, 0 (start) .. EMOJI_RISE_M (end). */
  offsetY: number;
  /** Sprite material opacity, 1 (start) .. 0 (end). */
  opacity: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Animation state at `elapsedMs` since the emoji started showing. */
export function emojiFloatProgress(elapsedMs: number): EmojiProgress {
  const t = clamp01(elapsedMs / EMOJI_DISPLAY_MS);
  const offsetY = EMOJI_RISE_M * t;
  const fadeT = clamp01((t - FADE_START_FRACTION) / (1 - FADE_START_FRACTION));
  const opacity = 1 - fadeT;
  return { offsetY, opacity };
}
