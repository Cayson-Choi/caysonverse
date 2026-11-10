import { describe, it, expect } from "vitest";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, canTapWalk, isDoubleTap, isLookHalf } from "./tapGesture";
import { isStickZone } from "./joystick";

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

describe("stick zone and look half share one handedness (Task 15 — one setting feeds both)", () => {
  it("below the middle, outside the 24 px edge strip, every x is the stick's OR the look half's, never both or neither", () => {
    const vw = 375;
    const vh = 812;
    for (const leftHanded of [false, true]) {
      for (let x = 24; x < vw - 24; x += 7) {
        const stick = isStickZone(x, 700, vw, vh, leftHanded);
        const look = isLookHalf(x, vw, leftHanded);
        expect(stick, `x=${x} leftHanded=${leftHanded}`).toBe(!look);
      }
    }
  });

  it("a stick-zone tap is therefore never a look-half tap (no double-tap recenter from the stick half)", () => {
    expect(isStickZone(280, 700, 375, 812, true)).toBe(true);
    expect(isLookHalf(280, 375, true)).toBe(false);
    expect(isStickZone(100, 700, 375, 812, false)).toBe(true);
    expect(isLookHalf(100, 375, false)).toBe(false);
  });
});

describe("canTapWalk — re-checked when the held-back single-tap walk fires", () => {
  it("walks when nothing changed while the tap waited for a possible second tap", () => {
    expect(canTapWalk("tp", false, false, false)).toBe(true);
    expect(canTapWalk("fp", false, false, false)).toBe(true);
  });

  it("does not walk once the overview map is open", () => {
    expect(canTapWalk("ov", false, false, false)).toBe(false);
  });

  it("does not walk while chat / a panel owns the keyboard", () => {
    expect(canTapWalk("tp", true, false, false)).toBe(false);
    expect(canTapWalk("fp", true, false, false)).toBe(false);
  });

  it("does not walk when the player sat down inside the window (it would stand them straight up)", () => {
    expect(canTapWalk("tp", false, false, true)).toBe(false);
    expect(canTapWalk("fp", false, false, true)).toBe(false);
  });

  it("a tap made while already seated still means 'stand up and walk there' (design 29)", () => {
    expect(canTapWalk("tp", false, true, true)).toBe(true);
    expect(canTapWalk("tp", true, true, true)).toBe(false); // ...unless the UI took the keyboard
    expect(canTapWalk("ov", false, true, true)).toBe(false);
  });

  it("walking after standing up inside the window is fine", () => {
    expect(canTapWalk("tp", false, true, false)).toBe(true);
  });
});

describe("canTapWalk — a tap dropped while it waited (round 3 review)", () => {
  it("does not walk once its ring was dropped meanwhile (a key, the stick, Esc, a sit): no ring that comes back later", () => {
    expect(canTapWalk("tp", false, false, false, true)).toBe(false);
    expect(canTapWalk("tp", false, true, false, true)).toBe(false);
    expect(canTapWalk("tp", false, false, false, false)).toBe(true);
  });
});
