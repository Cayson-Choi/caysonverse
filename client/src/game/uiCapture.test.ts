import { describe, it, expect, beforeEach } from "vitest";
import {
  guardMoveKeys,
  setUiCaptured,
  isUiCaptured,
  captureReleaseEffect,
} from "./uiCapture";
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

describe("captureReleaseEffect (unmount cleanup)", () => {
  beforeEach(() => setUiCaptured(false));

  it("releases a capture stranded true when a focused input unmounts without a blur", () => {
    // A focused chat input set the flag, then the element was removed from the
    // DOM (reconnect remount / kick) — no blur/focusout fires, so onBlur never
    // runs. The unmount disposer is the ONLY thing that clears it.
    setUiCaptured(true);
    expect(isUiCaptured()).toBe(true);
    const dispose = captureReleaseEffect();
    dispose();
    expect(isUiCaptured()).toBe(false); // WASD / Enter / emoji shortcuts live again
  });

  it("is idempotent and safe when capture was already released", () => {
    const dispose = captureReleaseEffect();
    dispose();
    expect(isUiCaptured()).toBe(false);
  });
});
