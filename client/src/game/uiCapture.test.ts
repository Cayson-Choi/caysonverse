import { describe, it, expect, beforeEach } from "vitest";
import {
  acquireUiCapture,
  captureReleaseEffect,
  guardMoveInput,
  guardMoveKeys,
  isUiCaptured,
  releaseAllUiCapture,
  releaseUiCapture,
} from "./uiCapture";
import type { MoveKeys } from "./input";

const held: MoveKeys = { forward: true, backward: false, left: true, right: false, run: false };
const none: MoveKeys = { forward: false, backward: false, left: false, right: false, run: false };

describe("uiCaptured — owner-based hold", () => {
  beforeEach(() => releaseAllUiCapture());

  it("defaults to not captured", () => {
    expect(isUiCaptured()).toBe(false);
  });

  it("is captured while an owner holds it and free again once it lets go", () => {
    acquireUiCapture("chat");
    expect(isUiCaptured()).toBe(true);
    releaseUiCapture("chat");
    expect(isUiCaptured()).toBe(false);
  });

  it("the menu's hold survives the 조교 dialogue releasing (it closed behind the open menu)", () => {
    acquireUiCapture("npc");
    acquireUiCapture("menu");
    releaseUiCapture("npc");
    expect(isUiCaptured()).toBe(true);
    releaseUiCapture("menu");
    expect(isUiCaptured()).toBe(false);
  });

  it("the menu's hold survives the chat input blurring (Tab walked focus behind the menu)", () => {
    acquireUiCapture("menu");
    acquireUiCapture("chat");
    releaseUiCapture("chat");
    expect(isUiCaptured()).toBe(true);
    releaseUiCapture("menu");
    expect(isUiCaptured()).toBe(false);
  });

  it("works in either release order and with every owner at once", () => {
    for (const owner of ["chat", "npc", "admin", "menu"]) acquireUiCapture(owner);
    for (const owner of ["menu", "chat", "admin"]) {
      releaseUiCapture(owner);
      expect(isUiCaptured()).toBe(true); // npc still holds
    }
    releaseUiCapture("npc");
    expect(isUiCaptured()).toBe(false);
  });

  it("a double release is harmless: it neither throws nor frees someone else's hold", () => {
    acquireUiCapture("menu");
    releaseUiCapture("npc"); // never held
    releaseUiCapture("npc");
    expect(isUiCaptured()).toBe(true);
    releaseUiCapture("menu");
    releaseUiCapture("menu");
    expect(isUiCaptured()).toBe(false);
    releaseUiCapture("menu"); // and again on an already-free keyboard
    expect(isUiCaptured()).toBe(false);
  });

  it("isUiCaptured is chat OR overlay; blurring chat keeps an open overlay captured", () => {
    expect(isUiCaptured()).toBe(false);
    acquireUiCapture("overlay");
    expect(isUiCaptured()).toBe(true); // an overlay alone captures
    acquireUiCapture("chat");
    releaseUiCapture("chat"); // the chat input blurs behind the open overlay
    expect(isUiCaptured()).toBe(true);
    releaseUiCapture("overlay");
    expect(isUiCaptured()).toBe(false);

    // And the other way round: the overlay closing leaves a focused chat captured.
    acquireUiCapture("chat");
    acquireUiCapture("overlay");
    releaseUiCapture("overlay");
    expect(isUiCaptured()).toBe(true);
    releaseUiCapture("chat");
    expect(isUiCaptured()).toBe(false);
  });

  it("acquiring twice is still one hold (one release frees it)", () => {
    acquireUiCapture("chat");
    acquireUiCapture("chat");
    releaseUiCapture("chat");
    expect(isUiCaptured()).toBe(false);
  });

  it("releaseAllUiCapture clears every owner (a fresh world)", () => {
    acquireUiCapture("chat");
    acquireUiCapture("menu");
    releaseAllUiCapture();
    expect(isUiCaptured()).toBe(false);
  });
});

describe("guardMoveKeys", () => {
  it("suppresses every movement key while the UI is captured", () => {
    expect(guardMoveKeys(held, true)).toEqual(none);
  });

  it("zeroes run too while captured — Shift held while typing never runs", () => {
    expect(guardMoveKeys({ ...held, run: true }, true)).toEqual({ ...none, run: false });
  });

  it("passes keys through untouched when the UI is not captured", () => {
    expect(guardMoveKeys(held, false)).toEqual(held);
  });

  it("passes run through when the UI is not captured", () => {
    expect(guardMoveKeys({ ...held, run: true }, false)).toEqual({ ...held, run: true });
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
  beforeEach(() => releaseAllUiCapture());

  it("releases a hold stranded when a focused input unmounts without a blur", () => {
    // A focused chat input took the keyboard, then the element was removed from the
    // DOM (reconnect remount / kick) — no blur/focusout fires, so onBlur never
    // runs. The unmount disposer is the ONLY thing that releases it.
    acquireUiCapture("chat");
    expect(isUiCaptured()).toBe(true);
    const dispose = captureReleaseEffect("chat");
    dispose();
    expect(isUiCaptured()).toBe(false); // WASD / Enter / emoji shortcuts live again
  });

  it("releases only its own owner: a 조교 dialogue unmounting leaves the open menu's hold", () => {
    acquireUiCapture("menu");
    acquireUiCapture("npc");
    captureReleaseEffect("npc")();
    expect(isUiCaptured()).toBe(true);
  });

  it("is idempotent and safe when nothing was held", () => {
    const dispose = captureReleaseEffect("chat");
    dispose();
    dispose();
    expect(isUiCaptured()).toBe(false);
  });
});

describe("guardMoveInput — the phone joystick obeys the same freeze as the keys", () => {
  it("drops a held joystick (and its run flag) while the UI is captured — a close-up must not let the avatar walk away", () => {
    expect(guardMoveInput({ forward: 1, right: -0.5, run: true }, true)).toEqual({ forward: 0, right: 0, run: false });
  });

  it("passes the joystick through untouched when the UI is not captured (the very same object: no allocation)", () => {
    const stick = { forward: 1, right: -0.5, run: true };
    expect(guardMoveInput(stick, false)).toBe(stick);
  });

  it("holds no latched state — the stick that is still down moves the avatar again the moment the UI lets go", () => {
    const stick = { forward: 0.7, right: 0, run: false };
    expect(guardMoveInput(stick, true).forward).toBe(0);
    expect(guardMoveInput(stick, false).forward).toBe(0.7);
  });
});
