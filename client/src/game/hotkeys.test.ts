import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveHotkey,
  hotkeyPreventsDefault,
  onHotkey,
  type HotkeyAction,
  type KeyLike,
} from "./hotkeys";
import { setUiCaptured } from "./uiCapture";

const kd = (code: string, o: Partial<KeyLike> = {}): KeyLike => ({
  type: "keydown",
  code,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
  ...o,
});
const ku = (code: string, o: Partial<KeyLike> = {}): KeyLike => kd(code, { type: "keyup", ...o });

describe("resolveHotkey — key table", () => {
  it("maps the spec key table", () => {
    expect(resolveHotkey(kd("Space"), false)).toEqual({ type: "jump" });
    expect(resolveHotkey(kd("KeyE"), false)).toEqual({ type: "interact" });
    expect(resolveHotkey(kd("KeyF"), false)).toEqual({ type: "interact" });
    expect(resolveHotkey(kd("KeyR"), false)).toEqual({ type: "recenter" });
    expect(resolveHotkey(kd("KeyV"), false)).toEqual({ type: "toggleView" });
    expect(resolveHotkey(kd("KeyM"), false)).toEqual({ type: "toggleMap" });
    expect(resolveHotkey(kd("Escape"), false)).toEqual({ type: "menu" });
    expect(resolveHotkey(kd("Enter"), false)).toEqual({ type: "openChat" });
    expect(resolveHotkey(kd("NumpadEnter"), false)).toEqual({ type: "openChat" });
    expect(resolveHotkey(kd("Slash"), false)).toEqual({ type: "openChat" });
    expect(resolveHotkey(kd("Digit1"), false)).toEqual({ type: "emoji", index: 0 });
    expect(resolveHotkey(kd("Digit2"), false)).toEqual({ type: "emoji", index: 1 });
    expect(resolveHotkey(kd("Digit3"), false)).toEqual({ type: "emoji", index: 2 });
    expect(resolveHotkey(kd("Digit4"), false)).toEqual({ type: "emoji", index: 3 });
    expect(resolveHotkey(kd("Digit5"), false)).toEqual({ type: "emoji", index: 4 });
    expect(resolveHotkey(kd("Digit6"), false)).toEqual({ type: "emoji", index: 5 });
    expect(resolveHotkey(kd("Tab"), false)).toEqual({ type: "roster", show: true });
  });

  it("returns null for keys that are not hotkeys", () => {
    // WASD / arrows / Shift / Z / C belong to other systems (drei movement, orbit);
    // Digit0 / Digit7 are outside the six-emoji palette; T is untouched until Task 10.
    for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ShiftLeft", "KeyZ", "KeyC", "KeyT", "Digit0", "Digit7"])
      expect(resolveHotkey(kd(code), false)).toBeNull();
  });

  it("returns null for every key except Escape while the UI owns the keyboard (Review Focus 1)", () => {
    for (const code of ["Space", "KeyE", "KeyF", "KeyR", "KeyV", "KeyM", "Enter", "NumpadEnter", "Slash", "Digit1", "Digit6", "Tab"])
      expect(resolveHotkey(kd(code), true)).toBeNull();
    // Esc still reaches the menu action so it can close the 조교 대화창 while typing.
    expect(resolveHotkey(kd("Escape"), true)).toEqual({ type: "menu" });
    // ...but the chat input's own Esc (preventDefault + blur) must not also hit the menu.
    expect(resolveHotkey(kd("Escape", { defaultPrevented: true }), true)).toBeNull();
  });

  it("ignores events another handler already consumed", () => {
    // ChatInput's Enter (send) is preventDefault'ed in its React handler before it
    // bubbles to window — without this the same Enter would re-open the chat.
    expect(resolveHotkey(kd("Enter", { defaultPrevented: true }), false)).toBeNull();
    expect(resolveHotkey(kd("Space", { defaultPrevented: true }), false)).toBeNull();
    expect(resolveHotkey(kd("Escape", { defaultPrevented: true }), false)).toBeNull();
  });

  it("ignores auto-repeat and IME composition", () => {
    for (const code of ["Space", "KeyV", "KeyM", "Enter", "Digit3", "Tab", "Escape"]) {
      expect(resolveHotkey(kd(code, { repeat: true }), false)).toBeNull();
      expect(resolveHotkey(kd(code, { isComposing: true }), false)).toBeNull();
    }
    // Escape is exempt from the UI-capture rule only — repeat is still ignored while captured.
    expect(resolveHotkey(kd("Escape", { repeat: true }), true)).toBeNull();
    expect(resolveHotkey(kd("Escape", { isComposing: true }), true)).toBeNull();
  });

  it("Tab keyup hides the roster even while captured", () => {
    expect(resolveHotkey(ku("Tab"), false)).toEqual({ type: "roster", show: false });
    expect(resolveHotkey(ku("Tab"), true)).toEqual({ type: "roster", show: false });
    // The release must not be lost to a stale flag that another handler left behind.
    expect(resolveHotkey(ku("Tab", { defaultPrevented: true }), true)).toEqual({
      type: "roster",
      show: false,
    });
  });

  it("keyup of every other key is null", () => {
    for (const code of ["Space", "KeyE", "KeyF", "KeyR", "KeyV", "KeyM", "Escape", "Enter", "Slash", "Digit1"]) {
      expect(resolveHotkey(ku(code), false)).toBeNull();
      expect(resolveHotkey(ku(code), true)).toBeNull();
    }
  });
});

describe("hotkeyPreventsDefault", () => {
  it("cancels the browser default for jump, openChat and roster show (Review Focus 2)", () => {
    // Space would re-activate a focused button, Enter too, `/` opens Firefox quick
    // find, Tab would move focus away from the canvas.
    expect(hotkeyPreventsDefault({ type: "jump" })).toBe(true);
    expect(hotkeyPreventsDefault({ type: "openChat" })).toBe(true);
    expect(hotkeyPreventsDefault({ type: "roster", show: true })).toBe(true);
  });

  it("leaves every other action alone", () => {
    const rest: HotkeyAction[] = [
      { type: "roster", show: false },
      { type: "emoji", index: 0 },
      { type: "interact" },
      { type: "recenter" },
      { type: "toggleView" },
      { type: "toggleMap" },
      { type: "menu" },
    ];
    for (const a of rest) expect(hotkeyPreventsDefault(a)).toBe(false);
  });
});

/**
 * Minimal window stand-in: the client test environment is plain node (no jsdom),
 * so `onHotkey` is exercised against an EventTarget that records which listeners
 * are currently attached.
 */
class FakeWindow extends EventTarget {
  private live: { type: string; listener: EventListenerOrEventListenerObject }[] = [];

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (!listener) return;
    if (!this.live.some((l) => l.type === type && l.listener === listener))
      this.live.push({ type, listener });
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    this.live = this.live.filter((l) => !(l.type === type && l.listener === listener));
    if (listener) super.removeEventListener(type, listener, options);
  }

  count(type: string): number {
    return this.live.filter((l) => l.type === type).length;
  }
}

describe("onHotkey — one shared window listener", () => {
  let win: FakeWindow;
  let disposers: (() => void)[] = [];

  /** Subscribe and remember the disposer, so a failing assertion cannot leak into the next test. */
  function sub(fn: Parameters<typeof onHotkey>[0]): () => void {
    const off = onHotkey(fn);
    disposers.push(off);
    return off;
  }

  /** Dispatch a cancelable key event shaped like the bits of KeyboardEvent we read. */
  function press(
    type: "keydown" | "keyup",
    code: string,
    o: { repeat?: boolean; isComposing?: boolean } = {},
  ): Event {
    const ev = Object.assign(new Event(type, { cancelable: true }), {
      code,
      repeat: false,
      isComposing: false,
      ...o,
    });
    win.dispatchEvent(ev);
    return ev;
  }

  beforeEach(() => {
    win = new FakeWindow();
    vi.stubGlobal("window", win);
    setUiCaptured(false);
  });
  afterEach(() => {
    for (const off of disposers) off(); // idempotent — tests that already disposed are fine
    disposers = [];
    vi.unstubAllGlobals();
    setUiCaptured(false);
  });

  it("two subscribers both receive the same action (no starvation by preventDefault)", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = sub(a);
    const offB = sub(b);

    const ev = press("keydown", "Enter");

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0]).toEqual({ type: "openChat" });
    expect(b.mock.calls[0][0]).toEqual({ type: "openChat" });
    // Both get the original event too, and it was cancelled exactly by the shared listener.
    expect(a.mock.calls[0][1]).toBe(ev);
    expect(b.mock.calls[0][1]).toBe(ev);
    expect(ev.defaultPrevented).toBe(true);
    offA();
    offB();
  });

  it("installs the window listeners with the first subscriber and removes them with the last", () => {
    expect(win.count("keydown")).toBe(0);
    expect(win.count("keyup")).toBe(0);

    const offA = sub(vi.fn());
    expect(win.count("keydown")).toBe(1);
    expect(win.count("keyup")).toBe(1);

    const offB = sub(vi.fn());
    const offC = sub(vi.fn());
    // Still ONE listener per event type no matter how many subscribers.
    expect(win.count("keydown")).toBe(1);
    expect(win.count("keyup")).toBe(1);

    offA();
    offB();
    expect(win.count("keydown")).toBe(1);
    expect(win.count("keyup")).toBe(1);

    offC();
    expect(win.count("keydown")).toBe(0);
    expect(win.count("keyup")).toBe(0);

    // A later subscriber re-installs them.
    const offD = sub(vi.fn());
    expect(win.count("keydown")).toBe(1);
    offD();
    expect(win.count("keydown")).toBe(0);
  });

  it("an unsubscribed handler stops receiving and the others keep working", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = sub(a);
    const offB = sub(b);

    offA();
    offA(); // double dispose is harmless
    press("keydown", "KeyM");

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(b.mock.calls[0][0]).toEqual({ type: "toggleMap" });
    offB();
  });

  it("subscribing the same function twice yields two independent subscriptions", () => {
    const fn = vi.fn();
    const off1 = sub(fn);
    const off2 = sub(fn);

    press("keydown", "KeyV");
    expect(fn).toHaveBeenCalledTimes(2);

    off1();
    press("keydown", "KeyV");
    expect(fn).toHaveBeenCalledTimes(3);
    off2();
  });

  it("a subscriber that unsubscribes during dispatch does not skip the next one", () => {
    const calls: string[] = [];
    let offFirst = (): void => {};
    offFirst = sub(() => {
      calls.push("first");
      offFirst();
    });
    const offSecond = sub(() => calls.push("second"));

    press("keydown", "KeyR");

    expect(calls).toEqual(["first", "second"]);
    offSecond();
    expect(win.count("keydown")).toBe(0);
  });

  it("respects the UI capture flag but still delivers Esc and the Tab release", () => {
    const fn = vi.fn();
    const off = sub(fn);

    setUiCaptured(true);
    const enter = press("keydown", "Enter");
    const slash = press("keydown", "Slash");
    const digit = press("keydown", "Digit2");
    expect(fn).not.toHaveBeenCalled();
    // A captured keystroke is the UI's — never cancelled by us.
    expect(enter.defaultPrevented).toBe(false);
    expect(slash.defaultPrevented).toBe(false);
    expect(digit.defaultPrevented).toBe(false);

    press("keydown", "Escape");
    press("keyup", "Tab");
    expect(fn.mock.calls.map((c) => c[0])).toEqual([
      { type: "menu" },
      { type: "roster", show: false },
    ]);
    off();
  });

  it("ignores auto-repeat for subscribers", () => {
    const fn = vi.fn();
    const off = sub(fn);

    press("keydown", "Space");
    press("keydown", "Space", { repeat: true });
    press("keydown", "Space", { repeat: true });

    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });

  it("cancels the browser default once, only for the actions that ask for it", () => {
    const off = sub(vi.fn());
    const spy = vi.fn();

    // Spy on preventDefault of a real event so we count calls rather than infer them.
    const send = (type: "keydown" | "keyup", code: string): number => {
      const ev = Object.assign(new Event(type, { cancelable: true }), {
        code,
        repeat: false,
        isComposing: false,
      });
      const real = ev.preventDefault.bind(ev);
      spy.mockClear();
      ev.preventDefault = () => {
        spy();
        real();
      };
      win.dispatchEvent(ev);
      return spy.mock.calls.length;
    };

    // Two extra subscribers must not multiply the cancel call.
    const offB = sub(vi.fn());
    const offC = sub(vi.fn());
    expect(send("keydown", "Space")).toBe(1);
    expect(send("keydown", "Enter")).toBe(1);
    expect(send("keydown", "Slash")).toBe(1);
    expect(send("keydown", "Tab")).toBe(1);
    // No default to cancel for these.
    expect(send("keyup", "Tab")).toBe(0);
    expect(send("keydown", "Digit4")).toBe(0);
    expect(send("keydown", "KeyV")).toBe(0);
    expect(send("keydown", "Escape")).toBe(0);
    expect(send("keydown", "KeyA")).toBe(0);
    off();
    offB();
    offC();
  });
});
