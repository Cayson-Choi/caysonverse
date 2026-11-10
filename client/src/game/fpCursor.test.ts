import { describe, it, expect } from "vitest";
import {
  FP_CURSOR_IDLE_MS,
  createFpCursorTracker,
  fpCursorHidden,
  heldKeyMask,
  noteHeldKeys,
  noteMouseMove,
  noteMousePress,
  type FpCursorContext,
} from "./fpCursor";

/** First person on a desktop with nothing holding the keyboard — the one case the cursor may hide in. */
const FP: FpCursorContext = { mode: "fp", touch: false, captured: false };

const NO_KEYS = { forward: false, backward: false, left: false, right: false, run: false, camLeft: false, camRight: false };
const C_HELD = heldKeyMask({ ...NO_KEYS, camRight: true });
const W_HELD = heldKeyMask({ ...NO_KEYS, forward: true });

describe("fpCursor — idle timeout", () => {
  it("hides the cursor after the mouse has rested FP_CURSOR_IDLE_MS (1.2 s) in first person", () => {
    expect(FP_CURSOR_IDLE_MS).toBe(1200);
    const t = createFpCursorTracker();
    noteMouseMove(t, 100, 100, 1000);
    expect(fpCursorHidden(t, FP, 1000)).toBe(false);
    expect(fpCursorHidden(t, FP, 1000 + FP_CURSOR_IDLE_MS - 1)).toBe(false);
    expect(fpCursorHidden(t, FP, 1000 + FP_CURSOR_IDLE_MS)).toBe(true);
  });

  it("counts a mouse that never moved as idle (entering first person with a resting mouse hides it)", () => {
    const t = createFpCursorTracker();
    expect(fpCursorHidden(t, FP, 0)).toBe(true);
  });

  it("shows it again the moment the mouse moves, and the idle clock restarts from that move", () => {
    const t = createFpCursorTracker();
    noteMouseMove(t, 100, 100, 0);
    expect(fpCursorHidden(t, FP, 5000)).toBe(true);
    noteMouseMove(t, 101, 100, 5000);
    expect(fpCursorHidden(t, FP, 5000)).toBe(false);
    expect(fpCursorHidden(t, FP, 5000 + FP_CURSOR_IDLE_MS - 1)).toBe(false);
    expect(fpCursorHidden(t, FP, 5000 + FP_CURSOR_IDLE_MS)).toBe(true);
  });

  it("a mouse button press is mouse activity too", () => {
    const t = createFpCursorTracker();
    noteMouseMove(t, 100, 100, 0);
    noteMousePress(t, 4000);
    expect(fpCursorHidden(t, FP, 4000)).toBe(false);
  });

  it("ignores a pointermove that did not move (Chrome's fake moves after a layout change)", () => {
    const t = createFpCursorTracker();
    expect(noteMouseMove(t, 100, 100, 0)).toBe(true);
    expect(noteMouseMove(t, 100, 100, 5000)).toBe(false);
    expect(fpCursorHidden(t, FP, 5000)).toBe(true);
  });
});

describe("fpCursor — movement / turn keys", () => {
  it("hides at once when C is pressed with the mouse resting (no 1.2 s wait)", () => {
    const t = createFpCursorTracker();
    noteMouseMove(t, 100, 100, 1000);
    noteHeldKeys(t, C_HELD, 1100);
    expect(fpCursorHidden(t, FP, 1100)).toBe(true);
  });

  it("Z, C and every walk key count; Shift alone does not", () => {
    for (const control of ["forward", "backward", "left", "right", "camLeft", "camRight"] as const) {
      expect(heldKeyMask({ ...NO_KEYS, [control]: true })).not.toBe(0);
    }
    expect(heldKeyMask({ ...NO_KEYS, run: true })).toBe(0);
    expect(heldKeyMask(NO_KEYS)).toBe(0);
  });

  it("a mouse move while C is still held shows the cursor and it STAYS shown while the key stays held", () => {
    const t = createFpCursorTracker();
    noteMouseMove(t, 100, 100, 0);
    noteHeldKeys(t, C_HELD, 1000);
    expect(fpCursorHidden(t, FP, 1000)).toBe(true);
    noteMouseMove(t, 140, 100, 1200);
    // The held key keeps being reported every frame — that is no new press, so it must not re-hide.
    for (let now = 1200; now < 1200 + FP_CURSOR_IDLE_MS; now += 16) {
      noteHeldKeys(t, C_HELD, now);
      expect(fpCursorHidden(t, FP, now)).toBe(false);
    }
    // ...until the mouse has rested again.
    noteHeldKeys(t, C_HELD, 1200 + FP_CURSOR_IDLE_MS);
    expect(fpCursorHidden(t, FP, 1200 + FP_CURSOR_IDLE_MS)).toBe(true);
  });

  it("a NEW key pressed after the mouse moved hides it again at once", () => {
    const t = createFpCursorTracker();
    noteHeldKeys(t, C_HELD, 1000);
    noteMouseMove(t, 140, 100, 1200);
    expect(fpCursorHidden(t, FP, 1300)).toBe(false);
    noteHeldKeys(t, C_HELD | W_HELD, 1300);
    expect(fpCursorHidden(t, FP, 1300)).toBe(true);
  });

  it("releasing the key and pressing it again is a new press", () => {
    const t = createFpCursorTracker();
    noteHeldKeys(t, C_HELD, 1000);
    noteMouseMove(t, 140, 100, 1200);
    noteHeldKeys(t, 0, 1250);
    expect(fpCursorHidden(t, FP, 1250)).toBe(false);
    noteHeldKeys(t, C_HELD, 1300);
    expect(fpCursorHidden(t, FP, 1300)).toBe(true);
  });

  it("after the keys are let go, the cursor stays as the mouse decides (shown until it rests 1.2 s)", () => {
    const t = createFpCursorTracker();
    noteHeldKeys(t, C_HELD, 1000);
    noteMouseMove(t, 140, 100, 1200);
    noteHeldKeys(t, 0, 1300);
    expect(fpCursorHidden(t, FP, 1300)).toBe(false);
    expect(fpCursorHidden(t, FP, 1200 + FP_CURSOR_IDLE_MS)).toBe(true);
  });
});

describe("fpCursor — where it never hides", () => {
  function idleWithKey() {
    const t = createFpCursorTracker();
    noteMouseMove(t, 100, 100, 0);
    noteHeldKeys(t, C_HELD, 9000);
    return t;
  }

  it("third person: unchanged (cursor always shown)", () => {
    expect(fpCursorHidden(idleWithKey(), { ...FP, mode: "tp" }, 9000)).toBe(false);
  });

  it("the overview map: unchanged (it is panned with the mouse)", () => {
    expect(fpCursorHidden(idleWithKey(), { ...FP, mode: "ov" }, 9000)).toBe(false);
  });

  it("a touch device: unchanged", () => {
    expect(fpCursorHidden(idleWithKey(), { ...FP, touch: true }, 9000)).toBe(false);
  });

  it("while a chat field, the menu or a panel holds the keyboard", () => {
    expect(fpCursorHidden(idleWithKey(), { ...FP, captured: true }, 9000)).toBe(false);
  });
});
