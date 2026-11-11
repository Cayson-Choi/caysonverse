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
import { BUBBLE_GAP_M, EMOJI_SPRITE_HEIGHT } from "./constants";

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

/** Clear space (m) between the top of the avatar's head (or hat) and the glyph's bottom edge at the start. */
export const EMOJI_HEAD_GAP_M = 0.05;

/**
 * Height (m above the avatar's group) of the emoji sprite's CENTRE before the rise is added.
 * `headTopY` is the top of the avatar's head or hat (the look's `topY`); `bubbleTopY` is the top
 * edge of the speech bubble when one is up, else null.
 *  - no bubble: right above the head (owner, 2026-11-10: "머리 좀 가까이에서 출발해서 위로 올라가게 해줘. 그래야
 *    조금 더 오래 보이지"), so the reaction starts by the face and floats up in view; it may pass over the
 *    avatar's name tag on its way, which is short-lived and drawn on top;
 *  - bubble up: just above the bubble's top edge, so a reaction never covers the words of a chat line.
 */
export function emojiBaseHeight(headTopY: number, bubbleTopY: number | null): number {
  const half = EMOJI_SPRITE_HEIGHT / 2;
  if (bubbleTopY !== null) return bubbleTopY + BUBBLE_GAP_M + half;
  return headTopY + EMOJI_HEAD_GAP_M + half;
}

/** Animation state at `elapsedMs` since the emoji started showing. */
export function emojiFloatProgress(elapsedMs: number): EmojiProgress {
  const t = clamp01(elapsedMs / EMOJI_DISPLAY_MS);
  const offsetY = EMOJI_RISE_M * t;
  const fadeT = clamp01((t - FADE_START_FRACTION) / (1 - FADE_START_FRACTION));
  const opacity = 1 - fadeT;
  return { offsetY, opacity };
}
