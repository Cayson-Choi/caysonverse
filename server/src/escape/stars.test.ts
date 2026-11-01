import { describe, expect, it } from "vitest";
import { computeStars } from "./stars";

describe("computeStars", () => {
  it("computeStars", () => {
    const r = { escaped: true, overtime: false, remainingS: 300, hintsUsed: 1, wrongAttempts: 3 };
    expect(computeStars(r)).toBe(3);
    expect(computeStars({ ...r, remainingS: 299 })).toBe(2);
    expect(computeStars({ ...r, hintsUsed: 4 })).toBe(1);
    expect(computeStars({ ...r, overtime: true })).toBe(1);
    expect(computeStars({ ...r, escaped: false })).toBe(0);
  });

  it("3 needs every condition; 2 only needs ≤ 3 hints; 다시 도전 and no escape win over everything", () => {
    const best = { escaped: true, overtime: false, remainingS: 900, hintsUsed: 0, wrongAttempts: 0 };
    expect(computeStars(best)).toBe(3);
    expect(computeStars({ ...best, hintsUsed: 2 })).toBe(2);
    expect(computeStars({ ...best, wrongAttempts: 4 })).toBe(2);
    expect(computeStars({ ...best, hintsUsed: 3, wrongAttempts: 50, remainingS: 0 })).toBe(2);
    expect(computeStars({ ...best, hintsUsed: 4, remainingS: 0 })).toBe(1);
    expect(computeStars({ ...best, overtime: true, remainingS: 0 })).toBe(1);
    expect(computeStars({ ...best, escaped: false, overtime: true })).toBe(0);
  });
});
