import { describe, it, expect } from "vitest";
import { validateNickname, validateEntry } from "./validation";

describe("validateNickname", () => {
  it("accepts Korean, English, digits, and the allowed separators", () => {
    expect(validateNickname("테스터")).toBeNull();
    expect(validateNickname("ab")).toBeNull(); // exactly the minimum
    expect(validateNickname("Player_1")).toBeNull();
    expect(validateNickname("a b-c_d")).toBeNull();
    expect(validateNickname("열두글자로만든이름끝")).toBeNull(); // within 12
  });

  it("trims before measuring length", () => {
    expect(validateNickname("  ab  ")).toBeNull();
    expect(validateNickname("   a   ")).not.toBeNull(); // one visible char -> too short
  });

  it("rejects out-of-range lengths", () => {
    expect(validateNickname("a")).not.toBeNull();
    expect(validateNickname("")).not.toBeNull();
    expect(validateNickname("a".repeat(13))).not.toBeNull();
  });

  it("rejects disallowed characters (emoji, punctuation, symbols)", () => {
    expect(validateNickname("hi!")).not.toBeNull();
    expect(validateNickname("a@b")).not.toBeNull();
    expect(validateNickname("웃음😀")).not.toBeNull();
  });

  it("returns a Korean error message", () => {
    const msg = validateNickname("a");
    expect(msg).toMatch(/[가-힣]/); // contains Hangul
  });
});

describe("validateEntry", () => {
  it("accepts valid selections and returns the trimmed nickname", () => {
    const r = validateEntry({ nickname: "  테스터 ", character: 2, tint: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ nickname: "테스터", character: 2, tint: 5 });
  });

  it("rejects a bad nickname", () => {
    const r = validateEntry({ nickname: "a", character: 0, tint: 0 });
    expect(r.ok).toBe(false);
  });

  it("rejects an out-of-range character index", () => {
    expect(validateEntry({ nickname: "테스터", character: -1, tint: 0 }).ok).toBe(false);
    expect(validateEntry({ nickname: "테스터", character: 4, tint: 0 }).ok).toBe(false);
    expect(validateEntry({ nickname: "테스터", character: 1.5, tint: 0 }).ok).toBe(false);
  });

  it("rejects an out-of-range tint index", () => {
    expect(validateEntry({ nickname: "테스터", character: 0, tint: 8 }).ok).toBe(false);
    expect(validateEntry({ nickname: "테스터", character: 0, tint: -1 }).ok).toBe(false);
  });

  it("accepts every in-range character and tint index", () => {
    for (let c = 0; c < 4; c++) {
      expect(validateEntry({ nickname: "테스터", character: c, tint: 0 }).ok).toBe(true);
    }
    for (let t = 0; t < 8; t++) {
      expect(validateEntry({ nickname: "테스터", character: 0, tint: t }).ok).toBe(true);
    }
  });
});
