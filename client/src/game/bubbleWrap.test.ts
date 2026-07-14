import { describe, it, expect } from "vitest";
import { wrapText } from "./bubbleWrap";

// Deterministic measure: one "unit" per code point. maxWidth is then a char count.
const measure = (s: string) => [...s].length;

describe("wrapText", () => {
  it("keeps short text on a single line", () => {
    expect(wrapText("안녕", 20, 3, measure)).toEqual(["안녕"]);
  });

  it("greedily wraps space-separated words at the width", () => {
    expect(wrapText("aaa bbb ccc", 7, 3, measure)).toEqual(["aaa bbb", "ccc"]);
  });

  it("collapses runs of interior whitespace when wrapping", () => {
    expect(wrapText("  aaa   bbb  ", 20, 3, measure)).toEqual(["aaa bbb"]);
  });

  it("breaks no-space text (Korean) at the character boundary that fits", () => {
    expect(wrapText("가나다라마바사", 3, 5, measure)).toEqual(["가나다", "라마바", "사"]);
  });

  it("char-breaks a single word longer than the width", () => {
    expect(wrapText("aaaaaaa", 3, 5, measure)).toEqual(["aaa", "aaa", "a"]);
  });

  it("caps at maxLines and ellipsizes the last line when content overflows", () => {
    const lines = wrapText("가나다라마바사아자차", 3, 3, measure);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("가나다");
    expect(lines[1]).toBe("라마바");
    expect(lines[2].endsWith("…")).toBe(true);
    // The ellipsized last line still fits the width.
    expect(measure(lines[2])).toBeLessThanOrEqual(3);
  });

  it("does not ellipsize when the content fits exactly in maxLines", () => {
    const lines = wrapText("가나다라마바", 3, 2, measure);
    expect(lines).toEqual(["가나다", "라마바"]);
    expect(lines.some((l) => l.includes("…"))).toBe(false);
  });

  it("returns an empty array for empty text", () => {
    expect(wrapText("", 10, 3, measure)).toEqual([]);
    expect(wrapText("   ", 10, 3, measure)).toEqual([]);
  });
});
