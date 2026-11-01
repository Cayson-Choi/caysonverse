import { describe, it, expect } from "vitest";
import { CLASS_CODE_ALPHABET, CLASS_CODE_LENGTH } from "./constants";
import { normalizeClassCode, sanitizeCodeInput } from "./classCode";

describe("class code alphabet", () => {
  it("alphabet has 32 symbols and no 0/O/1/I", () => {
    expect(CLASS_CODE_ALPHABET).toHaveLength(32);
    for (const c of "0O1I") expect(CLASS_CODE_ALPHABET).not.toContain(c);
  });

  it("alphabet symbols are unique, upper-case alphanumerics", () => {
    expect(new Set(CLASS_CODE_ALPHABET).size).toBe(CLASS_CODE_ALPHABET.length);
    expect(CLASS_CODE_ALPHABET).toMatch(/^[0-9A-Z]+$/);
    expect(CLASS_CODE_LENGTH).toBe(6);
  });
});

describe("normalizeClassCode", () => {
  it("normalizeClassCode", () => {
    expect(normalizeClassCode(" k7q2xm ")).toBe("K7Q2XM");
    for (const bad of ["K7Q2X", "K7Q2XMM", "K7Q0XM", "K7QIXM", 42, null]) {
      expect(normalizeClassCode(bad)).toBeNull();
    }
  });

  it("accepts an already-normal code unchanged and trims any whitespace", () => {
    expect(normalizeClassCode("K7Q2XM")).toBe("K7Q2XM");
    expect(normalizeClassCode("\tk7q2xm\n")).toBe("K7Q2XM");
  });

  it("rejects every non-string and every string with an inner space or foreign character", () => {
    for (const bad of [undefined, {}, [], ["K7Q2XM"], true, "", "      ", "K7 Q2XM", "K7Q-2XM", "K7Q2Xß"]) {
      expect(normalizeClassCode(bad)).toBeNull();
    }
  });

  it("does not let a length-changing upper-casing (ß -> SS) sneak a 5-char input through", () => {
    expect(normalizeClassCode("ßABCD")).toBeNull();
  });

  it("rejects each of the four excluded look-alike symbols in any position", () => {
    for (let pos = 0; pos < CLASS_CODE_LENGTH; pos++) {
      for (const bad of "0O1I") {
        const code = "ABCDEF".slice(0, pos) + bad + "ABCDEF".slice(pos + 1);
        expect(normalizeClassCode(code), code).toBeNull();
      }
    }
  });
});

describe("sanitizeCodeInput", () => {
  it("sanitizeCodeInput strips disallowed characters while typing", () =>
    expect(sanitizeCodeInput("k7q-2xm0ab")).toBe("K7Q2XM"));

  it("keeps a partial code as typed (upper-cased) and never exceeds 6 characters", () => {
    expect(sanitizeCodeInput("k7q")).toBe("K7Q");
    expect(sanitizeCodeInput("")).toBe("");
    expect(sanitizeCodeInput("ABCDEFGHJK")).toHaveLength(CLASS_CODE_LENGTH);
  });

  it("drops spaces, punctuation, Hangul and the excluded symbols", () => {
    expect(sanitizeCodeInput(" k 7 q ")).toBe("K7Q");
    expect(sanitizeCodeInput("한글ab1")).toBe("AB");
    expect(sanitizeCodeInput("0O1I")).toBe("");
  });

  it("its result is accepted by normalizeClassCode once it is 6 symbols long", () => {
    const typed = sanitizeCodeInput("  k7q-2xm ");
    expect(typed).toBe("K7Q2XM");
    expect(normalizeClassCode(typed)).toBe(typed);
  });
});
