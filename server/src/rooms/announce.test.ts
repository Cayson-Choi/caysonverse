import { describe, it, expect } from "vitest";
import { ANNOUNCE_MAX_LENGTH } from "@caysonverse/shared/constants";
import { sanitizeAnnounce } from "./announce";

describe("sanitizeAnnounce", () => {
  it("returns the trimmed text for a normal announcement", () => {
    expect(sanitizeAnnounce("  오늘 수업은 8시 시작!  ")).toBe("오늘 수업은 8시 시작!");
  });

  it("returns an empty string (CLEAR) for empty or whitespace-only input", () => {
    // Empty is VALID for announce (it clears the banner) — unlike sanitizeChat.
    expect(sanitizeAnnounce("")).toBe("");
    expect(sanitizeAnnounce("   ")).toBe("");
    expect(sanitizeAnnounce("\t\n ")).toBe("");
  });

  it("returns an empty string when the text is only strippable characters", () => {
    // ZWSP + ZWNJ + BOM, written as escapes so no invisible bytes live in source.
    expect(sanitizeAnnounce("\u200B\u200C\uFEFF")).toBe("");
  });

  it("returns null for non-string input (dropped)", () => {
    expect(sanitizeAnnounce(null)).toBeNull();
    expect(sanitizeAnnounce(undefined)).toBeNull();
    expect(sanitizeAnnounce(42)).toBeNull();
    expect(sanitizeAnnounce({ text: "hi" })).toBeNull();
  });

  it("strips control and zero-width characters like the chat sanitizer", () => {
    // "공지" ZWSP "사" TAB "항" — invisibles stripped, no interior space to keep.
    expect(sanitizeAnnounce("공지\u200B사\t항")).toBe("공지사항");
  });

  it("preserves regular interior spaces (they are content, not stripped)", () => {
    expect(sanitizeAnnounce("오늘 수업 시작")).toBe("오늘 수업 시작");
  });

  it("preserves an embedded newline between lines (announce is multi-line, F6)", () => {
    // The concrete finding case: two schedule lines must NOT be concatenated.
    expect(sanitizeAnnounce("1교시: 09:00 시작\n2교시: 11:00 시작")).toBe(
      "1교시: 09:00 시작\n2교시: 11:00 시작",
    );
    // Contrast: sanitizeChat strips the same newline (chat is single-line).
  });

  it("normalizes CRLF and bare CR line breaks to LF", () => {
    expect(sanitizeAnnounce("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("keeps interior newlines but still strips other control/zero-width chars", () => {
    // \n survives; \t and ZWSP are still removed.
    expect(sanitizeAnnounce("공지\n둘째\t줄" + String.fromCharCode(0x200B) + "끝")).toBe("공지\n둘째줄끝");
  });

  it("trims leading/trailing blank lines but keeps interior ones", () => {
    expect(sanitizeAnnounce("\n\n가운데\n\n")).toBe("가운데");
  });

  it("accepts text exactly at the 300-char limit", () => {
    const atLimit = "가".repeat(ANNOUNCE_MAX_LENGTH);
    expect(sanitizeAnnounce(atLimit)).toBe(atLimit);
  });

  it("returns null for text longer than the 300-char limit (dropped)", () => {
    const overLimit = "가".repeat(ANNOUNCE_MAX_LENGTH + 1);
    expect(sanitizeAnnounce(overLimit)).toBeNull();
  });

  it("allows longer text than chat would (announce cap is higher)", () => {
    const s = "안".repeat(250); // > CHAT_MAX_LENGTH (200) but <= 300
    expect(sanitizeAnnounce(s)).toBe(s);
  });
});
