import { describe, expect, it } from "vitest";
import { LABEL_PX_PER_M, fitFontPx, labelCanvasSize } from "./hubSignSpecs";

describe("labelCanvasSize", () => {
  it("is about 300 px per metre", () => {
    expect(LABEL_PX_PER_M).toBe(300);
    expect(labelCanvasSize({ w: 3.6, h: 0.44 })).toEqual({ width: 1080, height: 132 });
    expect(labelCanvasSize({ w: 0.8, h: 0.8 })).toEqual({ width: 240, height: 240 });
  });

  it("never goes below 32 px or above 2048 px a side", () => {
    expect(labelCanvasSize({ w: 0.01, h: 100 })).toEqual({ width: 32, height: 2048 });
  });
});

describe("fitFontPx", () => {
  /** A stub font: every character is `em` of the font size wide. */
  const stub = (em: number) => (text: string, px: number) => text.length * em * px;

  it("is limited by the height for a short word", () => {
    // 1 line, height 100 -> 78 px; "상담실" is 3 em wide = 234 at that size, far inside 88% of 1000.
    expect(fitFontPx(["상담실"], 1000, 100, stub(1))).toBeCloseTo(78, 9);
  });

  it("shrinks a long line until it fits 88% of the width", () => {
    const px = fitFontPx(["다음 업데이트"], 600, 200, stub(1)); // 7 chars: 7 em
    expect(px).toBeCloseTo((600 * 0.88) / 7, 9);
    expect(7 * px).toBeLessThanOrEqual(600 * 0.88 + 1e-9);
  });

  it("splits the height between lines (with a 12% gap) and fits the widest one", () => {
    const px = fitFontPx(["팀", "만들기"], 2000, 800, stub(1)); // wide canvas: the height decides
    expect(px).toBeCloseTo((800 * 0.78) / (2 + 0.12), 9);
    // A very narrow canvas makes the widest line (3 em) decide.
    expect(fitFontPx(["팀", "만들기"], 90, 800, stub(1))).toBeCloseTo((90 * 0.88) / 3, 9);
  });

  it("never returns less than 8 px, and ignores a line the canvas cannot measure", () => {
    expect(fitFontPx(["x"], 1, 1, stub(1))).toBe(8);
    expect(fitFontPx(["ab"], 500, 100, () => 0)).toBeCloseTo(78, 9);
  });
});
