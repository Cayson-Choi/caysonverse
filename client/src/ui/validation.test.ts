import { describe, it, expect } from "vitest";
import {
  APPEARANCE_FIELDS,
  APPEARANCE_RANGES,
  DEFAULT_APPEARANCE,
  type Appearance,
} from "@caysonverse/shared/appearance";
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
  it("accepts a valid nickname + appearance and trims the nickname", () => {
    const look = { ...DEFAULT_APPEARANCE, hat: 1, top: 2, voice: 1 };
    const r = validateEntry({ nickname: "  테스터 ", appearance: look });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ nickname: "테스터", appearance: look });

    // Every field at its top value is still valid.
    const max = {} as Appearance;
    for (const field of APPEARANCE_FIELDS) max[field] = APPEARANCE_RANGES[field] - 1;
    expect(validateEntry({ nickname: "테스터", appearance: max }).ok).toBe(true);
  });

  it("rejects a bad nickname", () => {
    const r = validateEntry({ nickname: "a", appearance: DEFAULT_APPEARANCE });
    expect(r.ok).toBe(false);
  });

  it("rejects an invalid appearance with \"외형 선택이 올바르지 않습니다\"", () => {
    const bad: Appearance[] = [
      { ...DEFAULT_APPEARANCE, hat: APPEARANCE_RANGES.hat },
      { ...DEFAULT_APPEARANCE, skin: -1 },
      { ...DEFAULT_APPEARANCE, voice: 1.5 },
      { ...DEFAULT_APPEARANCE, topColor: NaN },
    ];
    for (const appearance of bad) {
      const r = validateEntry({ nickname: "테스터", appearance });
      expect(r).toEqual({ ok: false, error: "외형 선택이 올바르지 않습니다" });
    }
    // A missing field too (a stale or hand-edited cache).
    const missing: Partial<Appearance> = { ...DEFAULT_APPEARANCE };
    delete missing.shoes;
    expect(validateEntry({ nickname: "테스터", appearance: missing as Appearance })).toEqual({
      ok: false,
      error: "외형 선택이 올바르지 않습니다",
    });
  });

  it("sends only the 15 appearance fields (extra keys dropped)", () => {
    const withExtra = { ...DEFAULT_APPEARANCE, character: 3, tint: 2 } as Appearance;
    const r = validateEntry({ nickname: "테스터", appearance: withExtra });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value.appearance).sort()).toEqual([...APPEARANCE_FIELDS].sort());
  });
});
