import { describe, it, expect } from "vitest";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, isDoubleTap, isLookHalf } from "./tapGesture";

describe("tapGesture — constants", () => {
  it("keeps the agreed window (300 ms) and slop (30 px)", () => {
    expect(DOUBLE_TAP_MS).toBe(300);
    expect(DOUBLE_TAP_PX).toBe(30);
  });
});

describe("isDoubleTap", () => {
  it("isDoubleTap: within 300 ms and 30 px only; a null prev is never a double", () => {
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 300, x: 30, y: 0 })).toBe(true);
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 301, x: 0, y: 0 })).toBe(false);
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 100, x: 31, y: 0 })).toBe(false);
    expect(isDoubleTap(null, { t: 0, x: 0, y: 0 })).toBe(false);
  });

  it("measures distance in both axes (diagonal), sign-independent", () => {
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 50, x: 118, y: 124 })).toBe(true); // hypot 30
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 50, x: 82, y: 76 })).toBe(true); // same, other direction
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 50, x: 120, y: 123 })).toBe(false); // hypot ~30.5
  });

  it("a tap that is not later than the previous one is never a double", () => {
    expect(isDoubleTap({ t: 500, x: 0, y: 0 }, { t: 400, x: 0, y: 0 })).toBe(false);
  });

  it("two instant taps (same timestamp, same spot) count as a double", () => {
    expect(isDoubleTap({ t: 1000, x: 5, y: 5 }, { t: 1000, x: 5, y: 5 })).toBe(true);
  });
});

describe("isLookHalf", () => {
  it("right-handed: the look half is the right half, x >= vw/2", () => {
    expect(isLookHalf(187.4, 375)).toBe(false);
    expect(isLookHalf(187.4, 375, false)).toBe(false);
    expect(isLookHalf(188, 375)).toBe(true);
    expect(isLookHalf(375, 375)).toBe(true);
    expect(isLookHalf(0, 375)).toBe(false);
  });

  it("the exact midline belongs to the look half (x >= vw/2)", () => {
    expect(isLookHalf(200, 400)).toBe(true);
    expect(isLookHalf(199.9, 400)).toBe(false);
  });

  it("left-handed mirrors it: the look half is the left half", () => {
    expect(isLookHalf(10, 375, true)).toBe(true);
    expect(isLookHalf(187, 375, true)).toBe(true);
    expect(isLookHalf(200, 375, true)).toBe(false);
  });

  it("the two hands are exact complements (every x is in exactly one look half)", () => {
    for (const x of [0, 24, 100, 187, 187.5, 188, 300, 374, 375]) {
      expect(isLookHalf(x, 375, false)).toBe(!isLookHalf(x, 375, true));
    }
  });
});
