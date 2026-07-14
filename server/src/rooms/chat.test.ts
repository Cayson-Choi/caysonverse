import { describe, it, expect } from "vitest";
import { CHAT_MAX_LENGTH } from "@caysonverse/shared/constants";
import { sanitizeChat, stripControl } from "./chat";

describe("sanitizeChat", () => {
  it("returns null for non-string input", () => {
    expect(sanitizeChat(null)).toBeNull();
    expect(sanitizeChat(undefined)).toBeNull();
    expect(sanitizeChat(42)).toBeNull();
    expect(sanitizeChat({ text: "안녕" })).toBeNull();
    expect(sanitizeChat(["안녕"])).toBeNull();
    expect(sanitizeChat(true)).toBeNull();
  });

  it("returns null for empty or whitespace-only text", () => {
    expect(sanitizeChat("")).toBeNull();
    expect(sanitizeChat("   ")).toBeNull();
    expect(sanitizeChat("\t\t")).toBeNull();
    expect(sanitizeChat("\n \n")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeChat("  안녕하세요  ")).toBe("안녕하세요");
  });

  it("preserves interior spaces between words", () => {
    expect(sanitizeChat("안녕 하세요 반갑습니다")).toBe("안녕 하세요 반갑습니다");
  });

  it("strips C0 control characters (tab, newline, CR, bell, null, backspace, DEL)", () => {
    expect(sanitizeChat("line1\tline2\nline3\rend")).toBe("line1line2line3end");
    expect(sanitizeChat("a\u0007b\u0000c\u0008d\u007fe")).toBe("abcde");
  });

  it("strips C1 control characters", () => {
    expect(sanitizeChat("a\u0080b\u0085c\u009bd")).toBe("abcd");
  });

  it("strips zero-width characters (ZWSP, ZWNJ, ZWJ, word joiner, BOM)", () => {
    expect(sanitizeChat("a\u200Bb\u200Cc\u200Dd\u2060e\uFEFFf")).toBe("abcdef");
  });

  it("strips an embedded newline between words (chat is single-line)", () => {
    // Contrast with sanitizeAnnounce, which PRESERVES this newline (F6).
    expect(sanitizeChat("1교시\n2교시")).toBe("1교시2교시");
  });

  it("preserves a Korean sentence that contains no control chars", () => {
    const s = "가나다라마바사아자차카타파하 밥이랑 놀자!";
    expect(sanitizeChat(s)).toBe(s);
  });

  it("accepts text exactly at the length limit", () => {
    const atLimit = "가".repeat(CHAT_MAX_LENGTH);
    expect(sanitizeChat(atLimit)).toBe(atLimit);
  });

  it("returns null for text longer than the limit", () => {
    const overLimit = "가".repeat(CHAT_MAX_LENGTH + 1);
    expect(sanitizeChat(overLimit)).toBeNull();
  });

  it("measures the limit after trimming and stripping, not before", () => {
    const padded = "   " + "나".repeat(CHAT_MAX_LENGTH) + "\t\t";
    expect(sanitizeChat(padded)).toBe("나".repeat(CHAT_MAX_LENGTH));
  });

  it("accepts an override maxLength argument (parameterized limit)", () => {
    // Default cap rejects; a larger explicit cap accepts the same text.
    const long = "다".repeat(CHAT_MAX_LENGTH + 50);
    expect(sanitizeChat(long)).toBeNull();
    expect(sanitizeChat(long, CHAT_MAX_LENGTH + 50)).toBe(long);
    // A smaller explicit cap rejects text the default would accept.
    expect(sanitizeChat("다".repeat(10), 5)).toBeNull();
    expect(sanitizeChat("다".repeat(5), 5)).toBe("다".repeat(5));
  });
});

describe("stripControl", () => {
  it("removes control and zero-width characters but keeps visible content + spaces", () => {
    expect(stripControl("a\tb\nc")).toBe("abc");
    expect(stripControl("공지\u200B사항")).toBe("공지사항");
    expect(stripControl("오늘 수업")).toBe("오늘 수업"); // regular spaces preserved
  });

  it("does not trim (trimming is the caller's responsibility)", () => {
    expect(stripControl("  hi  ")).toBe("  hi  ");
  });

  it("strips newlines by default (single-line policy for chat)", () => {
    expect(stripControl("a\nb\r\nc")).toBe("abc");
  });

  it("preserves newlines with keepNewlines, still stripping other controls", () => {
    // \n kept; \t and a zero-width joiner (U+200D) still stripped.
    expect(stripControl("a\nb\tc" + String.fromCharCode(0x200D) + "d", { keepNewlines: true })).toBe("a\nbcd");
  });

  it("normalizes CRLF and bare CR to LF when keeping newlines", () => {
    expect(stripControl("a\r\nb\rc", { keepNewlines: true })).toBe("a\nb\nc");
  });
});
