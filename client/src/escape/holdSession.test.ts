import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHoldRing,
  holdConfirmed,
  holdPress,
  holdRelease,
  holdStopped,
  resetHold,
  subscribeHold,
} from "./holdSession";

beforeEach(() => resetHold());

describe("a lone member's hold: press → the server confirms → the ring", () => {
  it("shows no ring until the server says the hold began", () => {
    holdPress("safe_key_left");
    expect(getHoldRing()).toBeNull();
    holdConfirmed("safe_key_left", 1000);
    expect(getHoldRing()).toEqual({ objectId: "safe_key_left", since: 1000 });
  });

  it("a confirmation for a switch nobody is pressing (a late echo after the release) shows nothing", () => {
    holdConfirmed("safe_key_left", 1000);
    expect(getHoldRing()).toBeNull();
    holdPress("safe_key_left");
    holdRelease();
    holdConfirmed("safe_key_left", 1100);
    expect(getHoldRing()).toBeNull();
  });

  it("a confirmation for the other switch is not mine", () => {
    holdPress("safe_key_left");
    holdConfirmed("safe_key_right", 1000);
    expect(getHoldRing()).toBeNull();
  });

  it("the first confirmation sets the start; a repeat does not restart the ring", () => {
    holdPress("safe_key_left");
    holdConfirmed("safe_key_left", 1000);
    holdConfirmed("safe_key_left", 1500);
    expect(getHoldRing()?.since).toBe(1000);
  });

  it("the ring keeps one identity while it is unchanged (useSyncExternalStore must not loop)", () => {
    holdPress("safe_key_left");
    holdConfirmed("safe_key_left", 1000);
    expect(getHoldRing()).toBe(getHoldRing());
  });
});

describe("releasing", () => {
  it("hands back the switch to send HoldEnd for, once, and clears the ring", () => {
    holdPress("safe_key_left");
    holdConfirmed("safe_key_left", 1000);
    expect(holdRelease()).toBe("safe_key_left");
    expect(getHoldRing()).toBeNull();
    expect(holdRelease()).toBeNull();
  });

  it("a press that never got a confirmation is still released (the server may have the hold already)", () => {
    holdPress("safe_key_left");
    expect(holdRelease()).toBe("safe_key_left");
  });

  it("releasing with nothing pressed sends nothing", () => {
    expect(holdRelease()).toBeNull();
  });

  it("a second press while one is held does not replace it", () => {
    holdPress("safe_key_left");
    holdPress("safe_key_right");
    expect(holdRelease()).toBe("safe_key_left");
  });
});

describe("the server ended the hold (cancelled, or done)", () => {
  it("takes the ring away but keeps the press, so the eventual release still reaches the server", () => {
    holdPress("safe_key_left");
    holdConfirmed("safe_key_left", 1000);
    holdStopped();
    expect(getHoldRing()).toBeNull();
    expect(holdRelease()).toBe("safe_key_left");
  });

  it("a stop with nothing going on is harmless", () => {
    expect(() => holdStopped()).not.toThrow();
    expect(getHoldRing()).toBeNull();
  });

  it("after a stop the same press does not bring the ring back by itself", () => {
    holdPress("safe_key_left");
    holdConfirmed("safe_key_left", 1000);
    holdStopped();
    holdConfirmed("safe_key_left", 2000); // a stray echo of the old hold
    expect(getHoldRing()).toBeNull();
  });
});

describe("subscribe", () => {
  it("tells listeners when the ring appears and when it goes, and only then", () => {
    const fn = vi.fn();
    const off = subscribeHold(fn);
    holdPress("safe_key_left");
    expect(fn).not.toHaveBeenCalled(); // a press alone changes nothing on screen
    holdConfirmed("safe_key_left", 1000);
    expect(fn).toHaveBeenCalledTimes(1);
    holdRelease();
    expect(fn).toHaveBeenCalledTimes(2);
    holdRelease(); // nothing to clear
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    holdPress("safe_key_left");
    holdConfirmed("safe_key_left", 3000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("a listener that unsubscribes while being called does not break the others", () => {
    const calls: string[] = [];
    const offA = subscribeHold(() => {
      calls.push("a");
      offA();
    });
    subscribeHold(() => calls.push("b"));
    holdPress("k");
    holdConfirmed("k", 1);
    expect(calls).toEqual(["a", "b"]);
  });
});

describe("resetHold", () => {
  it("forgets everything (the scene ended)", () => {
    holdPress("k");
    holdConfirmed("k", 1);
    resetHold();
    expect(getHoldRing()).toBeNull();
    expect(holdRelease()).toBeNull();
  });
});
