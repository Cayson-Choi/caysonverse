import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isUiCaptured, acquireUiCapture, releaseAllUiCapture, releaseUiCapture } from "../game/uiCapture";
import { popOverlay, pushOverlay, resetOverlays, topOverlay } from "./overlayStack";

beforeEach(() => {
  releaseAllUiCapture();
  resetOverlays();
});
afterEach(() => {
  resetOverlays();
  releaseAllUiCapture();
});

describe("overlayStack", () => {
  it("overlayStack captures input while any overlay is open and releases when the last closes", () => {
    expect(isUiCaptured()).toBe(false);
    pushOverlay("inspect", () => {});
    expect(isUiCaptured()).toBe(true); // WASD, E and 1~6 stop reaching the world
    pushOverlay("lock", () => {});
    expect(isUiCaptured()).toBe(true);

    popOverlay("lock");
    expect(isUiCaptured()).toBe(true); // the inspect overlay is still open
    popOverlay("inspect");
    expect(isUiCaptured()).toBe(false);
  });

  it("topOverlay is the one opened last, and null when none is open", () => {
    expect(topOverlay()).toBeNull();
    const closeA = vi.fn();
    const closeB = vi.fn();
    pushOverlay("a", closeA);
    pushOverlay("b", closeB);
    const top = topOverlay();
    expect(top?.id).toBe("b");
    top?.close();
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();
    popOverlay("b");
    expect(topOverlay()?.id).toBe("a");
  });

  it("popping an overlay that is not on top removes only that one", () => {
    pushOverlay("a", () => {});
    pushOverlay("b", () => {});
    popOverlay("a");
    expect(topOverlay()?.id).toBe("b");
    expect(isUiCaptured()).toBe(true);
    popOverlay("b");
    expect(topOverlay()).toBeNull();
    expect(isUiCaptured()).toBe(false);
  });

  it("pushing an id that is already open replaces it and brings it to the top (one entry per id)", () => {
    const first = vi.fn();
    const second = vi.fn();
    pushOverlay("a", first);
    pushOverlay("b", () => {});
    pushOverlay("a", second);
    expect(topOverlay()?.id).toBe("a");
    topOverlay()?.close();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    popOverlay("a");
    expect(topOverlay()?.id).toBe("b"); // not "a" again: it was one entry
  });

  it("popping an overlay that is not open changes nothing (a double close, a late cleanup)", () => {
    popOverlay("ghost");
    expect(isUiCaptured()).toBe(false);
    pushOverlay("a", () => {});
    popOverlay("ghost");
    expect(topOverlay()?.id).toBe("a");
    expect(isUiCaptured()).toBe(true);
    popOverlay("a");
    popOverlay("a");
    expect(isUiCaptured()).toBe(false);
  });

  it("the overlays' hold is its own: the chat letting go does not free it, and closing them does not free the chat", () => {
    acquireUiCapture("chat");
    pushOverlay("a", () => {});
    releaseUiCapture("chat");
    expect(isUiCaptured()).toBe(true);
    acquireUiCapture("chat");
    popOverlay("a");
    expect(isUiCaptured()).toBe(true); // the chat still holds
    releaseUiCapture("chat");
    expect(isUiCaptured()).toBe(false);
  });

  it("a scene that wipes every hold (PlayShell mounting) is healed by the next push", () => {
    pushOverlay("a", () => {});
    releaseAllUiCapture();
    expect(isUiCaptured()).toBe(false);
    pushOverlay("b", () => {});
    expect(isUiCaptured()).toBe(true);
  });

  it("resetOverlays empties the stack and lets go of the keyboard", () => {
    pushOverlay("a", () => {});
    pushOverlay("b", () => {});
    resetOverlays();
    expect(topOverlay()).toBeNull();
    expect(isUiCaptured()).toBe(false);
  });
});
