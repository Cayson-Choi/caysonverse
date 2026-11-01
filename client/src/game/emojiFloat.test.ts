import { describe, it, expect } from "vitest";
import { EMOJI_DISPLAY_MS } from "@caysonverse/shared/constants";
import { BUBBLE_BASE_HEIGHT, BUBBLE_GAP_M, EMOJI_BASE_HEIGHT, EMOJI_SPRITE_HEIGHT } from "./constants";
import { emojiBaseHeight, emojiFloatProgress, EMOJI_RISE_M } from "./emojiFloat";

describe("emojiFloatProgress", () => {
  it("starts at zero offset and full opacity", () => {
    expect(emojiFloatProgress(0)).toEqual({ offsetY: 0, opacity: 1 });
  });

  it("stays fully opaque before the fade-out begins", () => {
    const { offsetY, opacity } = emojiFloatProgress(EMOJI_DISPLAY_MS / 2);
    expect(opacity).toBe(1);
    expect(offsetY).toBeCloseTo(EMOJI_RISE_M / 2, 5);
  });

  it("reaches the full rise and zero opacity exactly at EMOJI_DISPLAY_MS", () => {
    const { offsetY, opacity } = emojiFloatProgress(EMOJI_DISPLAY_MS);
    expect(offsetY).toBeCloseTo(EMOJI_RISE_M, 5);
    expect(opacity).toBe(0);
  });

  it("is partially faded midway through the fade window", () => {
    // Fade begins at 60% of the duration; the midpoint of the fade window
    // (80%) should be half-opaque.
    const t = EMOJI_DISPLAY_MS * 0.8;
    const { opacity } = emojiFloatProgress(t);
    expect(opacity).toBeCloseTo(0.5, 5);
  });

  it("clamps past EMOJI_DISPLAY_MS instead of overshooting", () => {
    const { offsetY, opacity } = emojiFloatProgress(EMOJI_DISPLAY_MS + 5000);
    expect(offsetY).toBeCloseTo(EMOJI_RISE_M, 5);
    expect(opacity).toBe(0);
  });

  it("clamps negative elapsed time to the start state", () => {
    expect(emojiFloatProgress(-100)).toEqual({ offsetY: 0, opacity: 1 });
  });

  it("rises monotonically with elapsed time", () => {
    const a = emojiFloatProgress(500);
    const b = emojiFloatProgress(1500);
    expect(b.offsetY).toBeGreaterThan(a.offsetY);
  });
});

describe("emojiBaseHeight — where the glyph starts, clear of the tag and any speech bubble", () => {
  const half = EMOJI_SPRITE_HEIGHT / 2;

  it("with a bubble up it starts just above the bubble's top edge (the sprite is centre-origin)", () => {
    // A tall two-line bubble resting on a lifted tag: bottom 2.9 m, top 3.7 m.
    expect(emojiBaseHeight(2.9, 3.7)).toBeCloseTo(3.7 + BUBBLE_GAP_M + half, 9);
    // ...and follows the bubble wherever it is, even under the default.
    expect(emojiBaseHeight(2.3, 2.6)).toBeCloseTo(2.6 + BUBBLE_GAP_M + half, 9);
  });

  it("never draws over a bubble: its lowest point is above the bubble's top edge", () => {
    for (const top of [2.4, 2.9, 3.4, 4.2]) {
      const base = emojiBaseHeight(top - 0.5, top);
      expect(base - half).toBeGreaterThanOrEqual(top);
    }
  });

  it("without a bubble it keeps the default height while the tag sits below it", () => {
    expect(emojiBaseHeight(BUBBLE_BASE_HEIGHT, null)).toBeCloseTo(EMOJI_BASE_HEIGHT, 9);
    // Up close the tag top is ~2.3 m: the default 2.9 m already clears it.
    expect(emojiBaseHeight(2.36, null)).toBeCloseTo(EMOJI_BASE_HEIGHT, 9);
  });

  it("without a bubble it still climbs over a tall or lifted tag (anchor above the default)", () => {
    expect(emojiBaseHeight(3.4, null)).toBeCloseTo(3.4 + BUBBLE_GAP_M + half, 9);
    expect(emojiBaseHeight(3.4, null)).toBeGreaterThan(EMOJI_BASE_HEIGHT);
  });
});
