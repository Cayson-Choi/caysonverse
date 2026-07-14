import { describe, it, expect, beforeEach } from "vitest";
import { guardMoveKeys, setUiCaptured, isUiCaptured } from "./uiCapture";
import type { MoveKeys } from "./input";

const held: MoveKeys = { forward: true, backward: false, left: true, right: false };
const none: MoveKeys = { forward: false, backward: false, left: false, right: false };

describe("uiCaptured flag", () => {
  beforeEach(() => setUiCaptured(false));

  it("defaults to not captured", () => {
    expect(isUiCaptured()).toBe(false);
  });

  it("round-trips set/get", () => {
    setUiCaptured(true);
    expect(isUiCaptured()).toBe(true);
    setUiCaptured(false);
    expect(isUiCaptured()).toBe(false);
  });
});

describe("guardMoveKeys", () => {
  it("suppresses every movement key while the UI is captured", () => {
    expect(guardMoveKeys(held, true)).toEqual(none);
  });

  it("passes keys through untouched when the UI is not captured", () => {
    expect(guardMoveKeys(held, false)).toEqual(held);
  });

  it("holds no latched state — flipping capture off restores the exact raw keys", () => {
    // Model the blur edge: the same physical keys are held before and after.
    // Captured → suppressed; released capture → identical raw state (never stuck,
    // never a phantom press), because the guard is a pure function of its inputs.
    expect(guardMoveKeys(held, true)).toEqual(none);
    expect(guardMoveKeys(held, false)).toEqual(held);
  });
});
