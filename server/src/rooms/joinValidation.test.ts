import { describe, it, expect } from "vitest";
import {
  APPEARANCE_ERROR,
  APPEARANCE_FIELDS,
  APPEARANCE_RANGES,
  DEFAULT_APPEARANCE,
  type Appearance,
} from "@caysonverse/shared/appearance";
import { validateJoinOptions, type JoinOptions } from "./joinValidation";

// Narrow the union: assert a success result and return it typed.
function accepted(options: unknown) {
  const result = validateJoinOptions(options);
  expect(result).not.toHaveProperty("error");
  return result as JoinOptions;
}

function rejected(options: unknown) {
  const result = validateJoinOptions(options);
  expect(result).toHaveProperty("error");
  return result as { error: string };
}

const base = { appearance: DEFAULT_APPEARANCE };

/** The largest legal value in every appearance field. */
function maxLook(): Appearance {
  const look = {} as Appearance;
  for (const field of APPEARANCE_FIELDS) look[field] = APPEARANCE_RANGES[field] - 1;
  return look;
}

describe("validateJoinOptions — nickname", () => {
  it("accepts Korean, English, digits, space, underscore, hyphen", () => {
    expect(accepted({ ...base, nickname: "케이슨" }).nickname).toBe("케이슨");
    expect(accepted({ ...base, nickname: "Cayson" }).nickname).toBe("Cayson");
    expect(accepted({ ...base, nickname: "AI 강사_01-x" }).nickname).toBe("AI 강사_01-x");
    expect(accepted({ ...base, nickname: "12" }).nickname).toBe("12");
  });

  it("trims surrounding whitespace before storing and measuring", () => {
    expect(accepted({ ...base, nickname: "  케이슨  " }).nickname).toBe("케이슨");
  });

  it("counts length after trimming", () => {
    // " a " trims to "a" (length 1) -> too short.
    rejected({ ...base, nickname: " a " });
    // A 12-char name padded with spaces still trims to 12 -> accepted.
    expect(accepted({ ...base, nickname: "  abcdefghijkl  " }).nickname).toBe("abcdefghijkl");
  });

  it("rejects shorter than 2 characters (after trim)", () => {
    rejected({ ...base, nickname: "a" });
    rejected({ ...base, nickname: "" });
    rejected({ ...base, nickname: "   " });
  });

  it("rejects longer than 12 characters (after trim)", () => {
    rejected({ ...base, nickname: "abcdefghijklm" }); // 13
  });

  it("rejects control characters", () => {
    rejected({ ...base, nickname: "ab\ncd" });
    rejected({ ...base, nickname: "ab\tcd" });
    rejected({ ...base, nickname: "ab\u0000cd" });
  });

  it("rejects emoji and symbols", () => {
    rejected({ ...base, nickname: "hi😀" });
    rejected({ ...base, nickname: "a@b" });
    rejected({ ...base, nickname: "a!b" });
    rejected({ ...base, nickname: "a.b" });
  });

  it("rejects a non-string nickname", () => {
    rejected({ ...base, nickname: 123 });
    rejected({ ...base, nickname: null });
    rejected({ ...base, nickname: undefined });
  });

  it("uses the specified Korean error message for bad nicknames", () => {
    expect(rejected({ ...base, nickname: "a" }).error).toBe(
      "닉네임은 2~12자의 한글/영문/숫자만 가능합니다",
    );
  });
});

describe("validateJoinOptions — appearance", () => {
  it("accepts DEFAULT_APPEARANCE and every field at range − 1", () => {
    expect(accepted({ nickname: "test", appearance: DEFAULT_APPEARANCE }).appearance).toEqual(DEFAULT_APPEARANCE);
    const max = maxLook();
    expect(accepted({ nickname: "test", appearance: max }).appearance).toEqual(max);
    // One field at a time at its top value (the rest default), so no field's range is off by one.
    for (const field of APPEARANCE_FIELDS) {
      const look = { ...DEFAULT_APPEARANCE, [field]: APPEARANCE_RANGES[field] - 1 };
      expect(accepted({ nickname: "test", appearance: look }).appearance[field], field).toBe(
        APPEARANCE_RANGES[field] - 1,
      );
    }
  });

  it("rejects each field at −1, at its range, as 1.5, as \"0\" and as NaN with APPEARANCE_ERROR", () => {
    for (const field of APPEARANCE_FIELDS) {
      for (const bad of [-1, APPEARANCE_RANGES[field], 1.5, "0", NaN]) {
        const appearance = { ...DEFAULT_APPEARANCE, [field]: bad };
        expect(rejected({ nickname: "test", appearance }).error, `${field}=${String(bad)}`).toBe(APPEARANCE_ERROR);
      }
    }
  });

  it("rejects a missing field, and a missing, null or array appearance", () => {
    for (const field of APPEARANCE_FIELDS) {
      const appearance: Record<string, number> = { ...DEFAULT_APPEARANCE };
      delete appearance[field];
      expect(rejected({ nickname: "test", appearance }).error, field).toBe(APPEARANCE_ERROR);
    }
    expect(rejected({ nickname: "test" }).error).toBe(APPEARANCE_ERROR);
    expect(rejected({ nickname: "test", appearance: null }).error).toBe(APPEARANCE_ERROR);
    expect(rejected({ nickname: "test", appearance: Object.values(DEFAULT_APPEARANCE) }).error).toBe(
      APPEARANCE_ERROR,
    );
  });

  it("rejects the pre-builder { character, tint } options (stale client bundle, Review Focus 3)", () =>
    expect(rejected({ nickname: "test", character: 0, tint: 0 }).error).toBe("외형 선택이 올바르지 않습니다"));

  it("keeps only the 15 appearance fields (extra keys dropped)", () => {
    const r = accepted({
      nickname: "test",
      appearance: { ...DEFAULT_APPEARANCE, character: 3, tint: 2, __proto_x: 1, role: 1 },
    });
    expect(Object.keys(r.appearance).sort()).toEqual([...APPEARANCE_FIELDS].sort());
    expect(r.appearance).toEqual(DEFAULT_APPEARANCE);
    // Only nickname + appearance come back: no stray top-level option survives either.
    expect(Object.keys(accepted({ nickname: "test", appearance: DEFAULT_APPEARANCE, role: 1, x: 5 })).sort()).toEqual([
      "appearance",
      "nickname",
    ]);
  });

  it("checks the nickname before the appearance", () => {
    expect(rejected({ nickname: "a", appearance: null }).error).toBe("닉네임은 2~12자의 한글/영문/숫자만 가능합니다");
  });
});

describe("validateJoinOptions — options object", () => {
  it("rejects a non-object options value", () => {
    rejected(null);
    rejected(undefined);
    rejected("nickname");
    rejected(42);
  });
});
