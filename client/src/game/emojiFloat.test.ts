import { describe, it, expect } from "vitest";
import { EMOJI_DISPLAY_MS } from "@caysonverse/shared/constants";
import { emojiFloatProgress, EMOJI_RISE_M } from "./emojiFloat";

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
