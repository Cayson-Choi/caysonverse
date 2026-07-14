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
