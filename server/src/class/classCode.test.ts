import { describe, it, expect } from "vitest";
import { CLASS_CODE_ALPHABET, CLASS_CODE_LENGTH } from "@caysonverse/shared/escape/constants";
import { normalizeClassCode } from "@caysonverse/shared/escape/classCode";
import { generateClassCode } from "./classCode";

/** A fake `rand` that replays `values` (each must be < n) and records every `n` it was asked for. */
function scripted(values: number[]) {
  const asked: number[] = [];
  let i = 0;
  const rand = (n: number) => {
    asked.push(n);
    if (i >= values.length) throw new Error("scripted rand exhausted");
    return values[i++];
  };
  return { rand, asked };
}

describe("generateClassCode (server)", () => {
  it("generateClassCode uses only the alphabet and skips taken codes", () => {
    // Real crypto randomness: always a canonical 6-symbol code.
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = generateClassCode(() => false);
      expect(code).toHaveLength(CLASS_CODE_LENGTH);
      expect([...code].every((ch) => CLASS_CODE_ALPHABET.includes(ch))).toBe(true);
      expect(normalizeClassCode(code)).toBe(code);
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(490); // 32^6 space: collisions in 500 draws are near impossible

    // Scripted: the first candidate "222222" is taken, so the second "333333" is returned.
    const { rand, asked } = scripted([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
    const tried: string[] = [];
    const code = generateClassCode((c) => {
      tried.push(c);
      return c === "222222";
    }, rand);
    expect(code).toBe("333333");
    expect(tried).toEqual(["222222", "333333"]);
    expect(asked.every((n) => n === CLASS_CODE_ALPHABET.length)).toBe(true);
    expect(asked).toHaveLength(12);
  });

  it("maps every rand index onto the alphabet in order", () => {
    const { rand } = scripted([0, 31, 8, 9, 10, 23]);
    expect(generateClassCode(() => false, rand)).toBe(
      [0, 31, 8, 9, 10, 23].map((i) => CLASS_CODE_ALPHABET[i]).join(""),
    );
  });

  it("gives up with a fixed error instead of looping forever when every code is taken", () => {
    expect(() => generateClassCode(() => true, () => 0)).toThrow("no free class code");
  });
});
