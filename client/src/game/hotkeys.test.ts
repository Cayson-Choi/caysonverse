import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveHotkey,
  resolveEscape,
  hotkeyPreventsDefault,
  keydownCancelsDefault,
  onHotkey,
  inputModeOf,
  noteTypedKey,
  forgetTypedMode,
  type HotkeyAction,
  type KeyLike,
} from "./hotkeys";
import { acquireUiCapture, releaseAllUiCapture } from "./uiCapture";

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
    expect(resolveHotkey(kd("KeyB"), false)).toEqual({ type: "bag" }); // the classroom team bag (Task 18 review)
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
    for (const code of ["Space", "KeyE", "KeyF", "KeyR", "KeyV", "KeyM", "KeyB", "Enter", "NumpadEnter", "Slash", "Digit1", "Digit6", "Tab"])
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

  it("ignores browser/OS chords: Ctrl, Meta or Alt held", () => {
    // Ctrl/Cmd+1..6 switch browser tabs, Ctrl+R reloads, Ctrl+F finds, Ctrl/Cmd+V pastes,
    // Alt+Tab switches windows — none may fire an action. (Shift+Tab is NOT a chord: Shift is
    // the run key in-world, so Shift+Tab shows the roster like Tab — see the next test.)
    const chords: [string, Partial<KeyLike>][] = [
      ["KeyR", { ctrlKey: true }],
      ["KeyF", { ctrlKey: true }],
      ["Digit1", { metaKey: true }],
      ["Digit3", { ctrlKey: true }],
      ["Tab", { altKey: true }],
      ["Tab", { ctrlKey: true }],
      ["Tab", { metaKey: true }],
      ["Space", { ctrlKey: true }],
      ["Slash", { ctrlKey: true }],
      ["Enter", { altKey: true }],
      ["KeyV", { metaKey: true }],
      ["KeyM", { metaKey: true }],
      ["Enter", { ctrlKey: true }],
      ["Space", { altKey: true }],
      ["Escape", { ctrlKey: true }],
    ];
    for (const [code, mods] of chords) {
      expect(resolveHotkey(kd(code, mods), false), `${code} ${JSON.stringify(mods)}`).toBeNull();
      expect(resolveHotkey(kd(code, mods), true), `${code} ${JSON.stringify(mods)} captured`).toBeNull();
    }
  });

  it("Shift alone does not block a hotkey — Shift+Tab shows the roster too", () => {
    // Shift is the run key; Shift+/ is `?` on a US layout but still the Slash key. A runner
    // who taps Tab with Shift held (or Shift+Tab) must get the roster, not a focus walk.
    expect(resolveHotkey(kd("Space", { shiftKey: true }), false)).toEqual({ type: "jump" });
    expect(resolveHotkey(kd("Slash", { shiftKey: true }), false)).toEqual({ type: "openChat" });
    expect(resolveHotkey(kd("KeyE", { shiftKey: true }), false)).toEqual({ type: "interact" });
    expect(resolveHotkey(kd("Tab", { shiftKey: false }), false)).toEqual({ type: "roster", show: true });
    expect(resolveHotkey(kd("Tab", { shiftKey: true }), false)).toEqual({ type: "roster", show: true });
    // ...but while the UI owns the keyboard Shift+Tab is the field's own focus walk.
    expect(resolveHotkey(kd("Tab", { shiftKey: true }), true)).toBeNull();
  });

  it("a repeated Shift+Tab or Shift+Ctrl/Alt+Tab is not an action", () => {
    expect(resolveHotkey(kd("Tab", { shiftKey: true, repeat: true }), false)).toBeNull();
    expect(resolveHotkey(kd("Tab", { shiftKey: true, ctrlKey: true }), false)).toBeNull();
    expect(resolveHotkey(kd("Tab", { shiftKey: true, altKey: true }), false)).toBeNull();
  });

  it("an explicit false for every modifier is the same as leaving them out", () => {
    const none = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    expect(resolveHotkey(kd("Space", none), false)).toEqual({ type: "jump" });
    expect(resolveHotkey(kd("Tab", none), false)).toEqual({ type: "roster", show: true });
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

  it("Tab keyup hides the roster whatever modifiers are held at release", () => {
    // Alt+Tab / Shift released before Tab, Ctrl held, etc. — a stuck roster is worse
    // than an extra hide, so the release path ignores modifiers entirely.
    for (const mods of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(resolveHotkey(ku("Tab", mods), false), JSON.stringify(mods)).toEqual({ type: "roster", show: false });
      expect(resolveHotkey(ku("Tab", mods), true), JSON.stringify(mods)).toEqual({ type: "roster", show: false });
    }
  });

  it("keyup of every other key is null", () => {
    for (const code of ["Space", "KeyR", "KeyV", "KeyM", "Escape", "Enter", "Slash", "Digit1"]) {
      expect(resolveHotkey(ku(code), false)).toBeNull();
      expect(resolveHotkey(ku(code), true)).toBeNull();
    }
  });

  it("KeyE keyup resolves to interactUp even while captured (a hold must be able to end)", () => {
    for (const code of ["KeyE", "KeyF"]) {
      expect(resolveHotkey(ku(code), false), code).toEqual({ type: "interactUp" });
      // The UI grabbing the keyboard mid-hold (an overlay opening) must not strand the release.
      expect(resolveHotkey(ku(code), true), code).toEqual({ type: "interactUp" });
      // ...nor a stale defaultPrevented flag, nor modifiers released in another order.
      expect(resolveHotkey(ku(code, { defaultPrevented: true }), true), code).toEqual({ type: "interactUp" });
      for (const mods of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }])
        expect(resolveHotkey(ku(code, mods), true), `${code} ${JSON.stringify(mods)}`).toEqual({ type: "interactUp" });
    }
    // The press itself is still just "interact", and still dropped while captured.
    expect(resolveHotkey(kd("KeyE"), false)).toEqual({ type: "interact" });
    expect(resolveHotkey(kd("KeyE"), true)).toBeNull();
  });

  it("interactUp has no browser default to cancel", () => {
    expect(hotkeyPreventsDefault({ type: "interactUp" })).toBe(false);
  });
});

// Owner's report (2026-11-10): "채팅창에 클릭 하지 말을 하는 경우에 지도를 누른 걸로 넘어가버리던데" — talking without
// clicking the chat bar first opened the map (Hangul ㅡ is the M key). A key a player TYPES must end up in the chat.
describe("resolveHotkey — type to chat (a typed key that is not a game key opens the chat with it)", () => {
  /** A keydown as a real KeyboardEvent carries it: `code` (the physical key) AND `key` (what it types). */
  const typed = (code: string, key: string, o: Partial<KeyLike> = {}) => kd(code, { key, ...o });
  /** The Korean IME in 한글 mode: Chrome on Windows reports key "Process" (keyCode 229), macOS the jamo itself. */
  const hangul = (code: string, jamo: string) => [
    typed(code, "Process", { keyCode: 229 }),
    typed(code, jamo),
  ];

  it("a letter, digit or sign that is no game key opens the chat (and is typed into it)", () => {
    for (const [code, key] of [
      ["KeyH", "h"],
      ["KeyQ", "q"],
      ["KeyT", "T"],
      ["KeyL", "l"],
      ["KeyO", "o"],
      ["KeyN", "n"],
      ["Digit7", "7"],
      ["Digit0", "0"],
      ["Numpad1", "1"],
      ["Period", "."],
      ["Comma", ","],
      ["Minus", "-"],
      ["Quote", "'"],
    ])
      expect(resolveHotkey(typed(code, key), false), code).toEqual({ type: "typeToChat" });
  });

  it("Shift + a letter (a capital) types too — Shift is no chord", () => {
    expect(resolveHotkey(typed("KeyH", "H", { shiftKey: true }), false)).toEqual({ type: "typeToChat" });
  });

  it("한글 mode: ㄱ ㅍ ㅡ ㅠ (R V M B) are typing, not recenter / view / MAP / bag", () => {
    for (const [code, jamo] of [
      ["KeyR", "ㄱ"],
      ["KeyV", "ㅍ"],
      ["KeyM", "ㅡ"],
      ["KeyB", "ㅠ"],
    ])
      for (const e of hangul(code, jamo)) expect(resolveHotkey(e, false), `${code} ${e.key}`).toEqual({ type: "typeToChat" });
  });

  it("한글 mode: every other letter that is no game key types too (ㅎ ㅗ ㅓ ㅏ ㅣ ㅅ ㅂ ...)", () => {
    for (const [code, jamo] of [
      ["KeyG", "ㅎ"],
      ["KeyH", "ㅗ"],
      ["KeyJ", "ㅓ"],
      ["KeyK", "ㅏ"],
      ["KeyL", "ㅣ"],
      ["KeyT", "ㅅ"],
      ["KeyQ", "ㅂ"],
      ["KeyX", "ㅌ"],
    ])
      for (const e of hangul(code, jamo)) expect(resolveHotkey(e, false), `${code} ${e.key}`).toEqual({ type: "typeToChat" });
  });

  it("English mode: R V M B stay the recenter / view / map / bag hotkeys (the 🗺 button opens the map in either mode)", () => {
    expect(resolveHotkey(typed("KeyR", "r"), false)).toEqual({ type: "recenter" });
    expect(resolveHotkey(typed("KeyV", "v"), false)).toEqual({ type: "toggleView" });
    expect(resolveHotkey(typed("KeyM", "m"), false)).toEqual({ type: "toggleMap" });
    expect(resolveHotkey(typed("KeyM", "M", { shiftKey: true }), false)).toEqual({ type: "toggleMap" });
    expect(resolveHotkey(typed("KeyB", "b"), false)).toEqual({ type: "bag" });
  });

  it("movement and the camera turn (WASD, arrows, Shift, Z / C) are never typing — in English or 한글 mode", () => {
    for (const [code, key, jamo] of [
      ["KeyW", "w", "ㅈ"],
      ["KeyA", "a", "ㅁ"],
      ["KeyS", "s", "ㄴ"],
      ["KeyD", "d", "ㅇ"],
      ["KeyZ", "z", "ㅋ"],
      ["KeyC", "c", "ㅊ"],
    ]) {
      expect(resolveHotkey(typed(code, key), false), code).toBeNull();
      for (const e of hangul(code, jamo)) expect(resolveHotkey(e, false), `${code} ${e.key}`).toBeNull();
    }
    for (const [code, key] of [
      ["ArrowUp", "ArrowUp"],
      ["ArrowLeft", "ArrowLeft"],
      ["ShiftLeft", "Shift"],
      ["ShiftRight", "Shift"],
    ])
      expect(resolveHotkey(typed(code, key), false), code).toBeNull();
  });

  it("E / F interact, Space jumps, 1–6 send emoji, Tab / Enter / / / Esc keep their jobs — in 한글 mode too", () => {
    for (const e of hangul("KeyE", "ㄷ")) expect(resolveHotkey(e, false)).toEqual({ type: "interact" });
    for (const e of hangul("KeyF", "ㄹ")) expect(resolveHotkey(e, false)).toEqual({ type: "interact" });
    expect(resolveHotkey(typed("Space", " "), false)).toEqual({ type: "jump" });
    expect(resolveHotkey(typed("Digit1", "1"), false)).toEqual({ type: "emoji", index: 0 });
    expect(resolveHotkey(typed("Digit6", "6"), false)).toEqual({ type: "emoji", index: 5 });
    expect(resolveHotkey(typed("Tab", "Tab"), false)).toEqual({ type: "roster", show: true });
    expect(resolveHotkey(typed("Enter", "Enter"), false)).toEqual({ type: "openChat" });
    expect(resolveHotkey(typed("Slash", "/"), false)).toEqual({ type: "openChat" });
    expect(resolveHotkey(typed("Slash", "?", { shiftKey: true }), false)).toEqual({ type: "openChat" });
    expect(resolveHotkey(typed("Escape", "Escape"), false)).toEqual({ type: "menu" });
  });

  it("keys that type nothing never open the chat (F-keys, Backspace, Dead, Unidentified, a bare modifier)", () => {
    for (const [code, key] of [
      ["F5", "F5"],
      ["Backspace", "Backspace"],
      ["Delete", "Delete"],
      ["Home", "Home"],
      ["Quote", "Dead"],
      ["", "Unidentified"],
      ["ControlLeft", "Control"],
      ["AltLeft", "Alt"],
      ["MetaLeft", "Meta"],
      ["CapsLock", "CapsLock"],
      ["HangulMode", "HangulMode"],
    ])
      expect(resolveHotkey(typed(code, key), false), `${code} ${key}`).toBeNull();
  });

  it("a key with no `key` at all (a synthetic event) is not typing", () => {
    expect(resolveHotkey(kd("KeyH"), false)).toBeNull();
    expect(resolveHotkey(kd("KeyM"), false)).toEqual({ type: "toggleMap" });
  });

  it("never while a field / overlay / the menu holds the keyboard — the field gets the key itself", () => {
    expect(resolveHotkey(typed("KeyH", "h"), true)).toBeNull();
    for (const e of hangul("KeyM", "ㅡ")) expect(resolveHotkey(e, true)).toBeNull();
    // the first keystroke of a Hangul composition inside the focused chat field: no hotkey at all
    expect(resolveHotkey(typed("KeyM", "Process", { keyCode: 229, isComposing: true }), true)).toBeNull();
    expect(resolveHotkey(typed("KeyM", "Process", { keyCode: 229 }), true)).toBeNull();
  });

  it("never on a chord, an auto-repeat, a composing key or a key another handler consumed", () => {
    for (const o of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }, { isComposing: true }, { defaultPrevented: true }])
      expect(resolveHotkey(typed("KeyH", "h", o), false), JSON.stringify(o)).toBeNull();
  });

  it("has no browser default to cancel: the typed character must land in the field it opened", () => {
    expect(hotkeyPreventsDefault({ type: "typeToChat" })).toBe(false);
  });
});

// Chrome on Windows (and Linux) switches the IME OFF while no text field has the caret (Chromium tsf_bridge.cc: the
// TEXT_INPUT_TYPE_NONE document gets GUID_COMPARTMENT_KEYBOARD_DISABLED). So outside the chat, a key pressed in 한글
// mode arrives as the plain latin letter — ㅡ is just "m" — and cannot be told from English mode. What CAN be seen is
// the mode the player was in the last time they typed into a field (there the IME is on): remembered here.
describe("inputModeOf — what a key typed into a field says about the input mode", () => {
  const typed = (code: string, key: string, o: Partial<KeyLike> = {}) => kd(code, { key, ...o });

  it("a letter the IME handles (key Process / keyCode 229, or a Hangul jamo) → hangul", () => {
    expect(inputModeOf(typed("KeyM", "Process", { keyCode: 229 }))).toBe("hangul");
    expect(inputModeOf(typed("KeyR", "Unidentified", { keyCode: 229 }))).toBe("hangul");
    expect(inputModeOf(typed("KeyM", "ㅡ"))).toBe("hangul");
  });

  it("a plain latin letter → latin (upper or lower case)", () => {
    expect(inputModeOf(typed("KeyM", "m"))).toBe("latin");
    expect(inputModeOf(typed("KeyH", "H", { shiftKey: true }))).toBe("latin");
  });

  it("anything that is not a letter key says nothing (digits, Space, Enter, Backspace, arrows, chords)", () => {
    for (const [code, key] of [
      ["Digit7", "7"],
      ["Space", " "],
      ["Enter", "Enter"],
      ["Backspace", "Backspace"],
      ["ArrowLeft", "ArrowLeft"],
      ["Enter", "Process"],
      ["", "Unidentified"],
    ])
      expect(inputModeOf(typed(code, key)), `${code} ${key}`).toBeNull();
    expect(inputModeOf(typed("KeyC", "c", { ctrlKey: true }))).toBeNull();
    expect(inputModeOf(typed("KeyV", "v", { metaKey: true }))).toBeNull();
    expect(inputModeOf(kd("KeyM"))).toBeNull(); // no key at all
  });
});

describe("resolveHotkey — the remembered 한글 mode (Windows: no IME outside a field)", () => {
  const typed = (code: string, key: string, o: Partial<KeyLike> = {}) => kd(code, { key, ...o });

  it("last typed in 한글: plain r v m b are ㄱ ㅍ ㅡ ㅠ — typing, not recenter / view / MAP / bag", () => {
    for (const [code, key] of [
      ["KeyR", "r"],
      ["KeyV", "v"],
      ["KeyM", "m"],
      ["KeyB", "b"],
      ["KeyM", "M"],
    ])
      expect(resolveHotkey(typed(code, key, { shiftKey: key === "M" }), false, true), `${code} ${key}`).toEqual({ type: "typeToChat" });
  });

  it("last typed in English (or never typed): r v m b stay the hotkeys", () => {
    expect(resolveHotkey(typed("KeyM", "m"), false, false)).toEqual({ type: "toggleMap" });
    expect(resolveHotkey(typed("KeyR", "r"), false, false)).toEqual({ type: "recenter" });
    expect(resolveHotkey(typed("KeyV", "v"), false)).toEqual({ type: "toggleView" });
    expect(resolveHotkey(typed("KeyB", "b"), false)).toEqual({ type: "bag" });
  });

  it("the positional game keys keep their job in 한글 mode too: WASD / Z / C, E / F, Space, digits, Enter, /, Esc, Tab", () => {
    for (const [code, key] of [
      ["KeyW", "w"],
      ["KeyA", "a"],
      ["KeyS", "s"],
      ["KeyD", "d"],
      ["KeyZ", "z"],
      ["KeyC", "c"],
    ])
      expect(resolveHotkey(typed(code, key), false, true), code).toBeNull();
    expect(resolveHotkey(typed("KeyE", "e"), false, true)).toEqual({ type: "interact" });
    expect(resolveHotkey(typed("KeyF", "f"), false, true)).toEqual({ type: "interact" });
    expect(resolveHotkey(typed("Space", " "), false, true)).toEqual({ type: "jump" });
    expect(resolveHotkey(typed("Digit1", "1"), false, true)).toEqual({ type: "emoji", index: 0 });
    expect(resolveHotkey(typed("Enter", "Enter"), false, true)).toEqual({ type: "openChat" });
    expect(resolveHotkey(typed("Slash", "/"), false, true)).toEqual({ type: "openChat" });
    expect(resolveHotkey(typed("Escape", "Escape"), false, true)).toEqual({ type: "menu" });
    expect(resolveHotkey(typed("Tab", "Tab"), false, true)).toEqual({ type: "roster", show: true });
  });

  it("never while something holds the keyboard, never on a chord, never a synthetic key with no `key`", () => {
    expect(resolveHotkey(typed("KeyM", "m"), true, true)).toBeNull();
    expect(resolveHotkey(typed("KeyM", "m", { ctrlKey: true }), false, true)).toBeNull();
    expect(resolveHotkey(kd("KeyM"), false, true)).toEqual({ type: "toggleMap" });
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

describe("keydownCancelsDefault — Tab never walks browser focus in-world", () => {
  it("cancels EVERY plain or Shift Tab keydown while nobody holds the keyboard (repeats and Shift+Tab too)", () => {
    // A held Tab (key-repeat after ~0.5 s) or Shift+Tab used to slip through resolveHotkey
    // (null), so the browser moved focus to the chat toggle / field and froze WASD.
    for (const o of [{}, { repeat: true }, { shiftKey: true }, { shiftKey: true, repeat: true }])
      expect(keydownCancelsDefault(kd("Tab", o), false), JSON.stringify(o)).toBe(true);
  });

  it("leaves Tab alone while a UI owner holds the keyboard (the field's own focus walk)", () => {
    for (const o of [{}, { repeat: true }, { shiftKey: true }])
      expect(keydownCancelsDefault(kd("Tab", o), true), JSON.stringify(o)).toBe(false);
  });

  it("leaves Ctrl / Alt / Meta + Tab to the browser and OS, and never cancels a keyup", () => {
    for (const o of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }])
      expect(keydownCancelsDefault(kd("Tab", o), false), JSON.stringify(o)).toBe(false);
    expect(keydownCancelsDefault(ku("Tab"), false)).toBe(false);
  });

  it("is only about Tab — other keys are decided by their action", () => {
    expect(keydownCancelsDefault(kd("KeyW"), false)).toBe(false);
    expect(keydownCancelsDefault(kd("KeyV"), false)).toBe(false);
    expect(keydownCancelsDefault(kd("Space"), false)).toBe(false);
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
    o: Partial<Pick<KeyLike, "repeat" | "isComposing" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">> = {},
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
    releaseAllUiCapture();
  });
  afterEach(() => {
    for (const off of disposers) off(); // idempotent — tests that already disposed are fine
    disposers = [];
    vi.unstubAllGlobals();
    releaseAllUiCapture();
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

    acquireUiCapture("chat");
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

  it("browser/OS chords produce zero deliveries and zero preventDefault calls", () => {
    const fn = vi.fn();
    sub(fn);
    // Each of these would be cancelled (Space, Enter, Slash, Tab) or delivered (the rest)
    // if the modifier were ignored: tab switching, reload, find, window switching.
    const chords: [string, Parameters<typeof press>[2]][] = [
      ["KeyR", { ctrlKey: true }],
      ["KeyF", { ctrlKey: true }],
      ["Digit1", { metaKey: true }],
      ["Digit3", { ctrlKey: true }],
      ["Tab", { altKey: true }],
      ["Tab", { ctrlKey: true }],
      ["Space", { ctrlKey: true }],
      ["Slash", { ctrlKey: true }],
      ["Enter", { altKey: true }],
      ["Enter", { ctrlKey: true }],
      ["Space", { altKey: true }],
    ];
    for (const [code, mods] of chords) {
      const ev = press("keydown", code, mods);
      expect(ev.defaultPrevented, `${code} ${JSON.stringify(mods)}`).toBe(false);
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("a held Tab and Shift+Tab are cancelled (focus never leaves the canvas) and keep the roster shown", () => {
    // Mirrors the roster subscriber: show on the first press, hide only on keyup.
    let shown = false;
    sub((a) => {
      if (a.type === "roster") shown = a.show;
    });

    const first = press("keydown", "Tab");
    expect(first.defaultPrevented).toBe(true);
    expect(shown).toBe(true);

    // Key-repeat (~0.5 s into the hold): still cancelled, still shown, no hide.
    for (let i = 0; i < 3; i++) {
      const rep = press("keydown", "Tab", { repeat: true });
      expect(rep.defaultPrevented, `repeat ${i}`).toBe(true);
      expect(shown, `repeat ${i}`).toBe(true);
    }

    // Shift+Tab (a runner's Tab): cancelled, shows the roster.
    press("keyup", "Tab");
    expect(shown).toBe(false);
    const sh = press("keydown", "Tab", { shiftKey: true });
    expect(sh.defaultPrevented).toBe(true);
    expect(shown).toBe(true);
    const shRep = press("keydown", "Tab", { shiftKey: true, repeat: true });
    expect(shRep.defaultPrevented).toBe(true);
    expect(shown).toBe(true);
    press("keyup", "Tab", { shiftKey: true });
    expect(shown).toBe(false);
  });

  it("Tab is left alone while a UI owner holds the keyboard", () => {
    const fn = vi.fn();
    sub(fn);
    acquireUiCapture("chat");
    for (const o of [{}, { repeat: true }, { shiftKey: true }]) {
      const ev = press("keydown", "Tab", o);
      expect(ev.defaultPrevented, JSON.stringify(o)).toBe(false);
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("Ctrl/Alt/Meta+Tab, repeated or not, is never cancelled", () => {
    const fn = vi.fn();
    sub(fn);
    for (const o of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true, repeat: true }]) {
      expect(press("keydown", "Tab", o).defaultPrevented, JSON.stringify(o)).toBe(false);
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("Tab keyup with Alt held still reaches subscribers as a roster hide", () => {
    const fn = vi.fn();
    sub(fn);

    press("keyup", "Tab", { altKey: true });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toEqual({ type: "roster", show: false });
  });

  it("KeyE keyup reaches subscribers as interactUp even while a UI owner holds the keyboard", () => {
    const fn = vi.fn();
    sub(fn);
    acquireUiCapture("overlay");

    const down = press("keydown", "KeyE");
    expect(fn).not.toHaveBeenCalled(); // the press is dropped while captured
    expect(down.defaultPrevented).toBe(false);
    press("keyup", "KeyE");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toEqual({ type: "interactUp" });
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

  it("a typed key reaches subscribers as typeToChat WITHOUT preventDefault (so the character lands in the chat)", () => {
    const fn = vi.fn();
    sub(fn);
    const ev = Object.assign(new Event("keydown", { cancelable: true }), {
      code: "KeyM",
      key: "Process",
      keyCode: 229,
      repeat: false,
      isComposing: false,
    });
    win.dispatchEvent(ev);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toEqual({ type: "typeToChat" });
    expect(ev.defaultPrevented).toBe(false);
  });

  it("remembers the mode of the last letter typed into a field: 한글 → a plain m opens the chat, English → the map again", () => {
    const fn = vi.fn();
    sub(fn);
    const m = () => {
      const ev = Object.assign(new Event("keydown", { cancelable: true }), { code: "KeyM", key: "m", keyCode: 77, repeat: false, isComposing: false });
      win.dispatchEvent(ev);
      return ev;
    };
    try {
      forgetTypedMode();
      m();
      expect(fn.mock.calls.at(-1)?.[0]).toEqual({ type: "toggleMap" }); // nothing typed yet: M is the map
      noteTypedKey(kd("KeyH", { key: "Process", keyCode: 229 })); // typed 한글 into the chat
      noteTypedKey(kd("Enter", { key: "Enter", keyCode: 13 })); // (Enter says nothing about the mode)
      const ev = m();
      expect(fn.mock.calls.at(-1)?.[0]).toEqual({ type: "typeToChat" });
      expect(ev.defaultPrevented).toBe(false);
      noteTypedKey(kd("KeyO", { key: "o", keyCode: 79 })); // then typed English
      m();
      expect(fn.mock.calls.at(-1)?.[0]).toEqual({ type: "toggleMap" });
    } finally {
      forgetTypedMode();
    }
  });
});

describe("resolveEscape — what one Esc press does", () => {
  const state = (npcOpen: boolean, rosterOpen: boolean, menuOpen: boolean, overlayOpen = false) => ({
    overlayOpen,
    npcOpen,
    rosterOpen,
    menuOpen,
  });

  it("the menu (on top) first, then the NPC panel, then the roster, then the menu opens", () => {
    expect(resolveEscape(state(true, true, true))).toBe("closeMenu");
    expect(resolveEscape(state(false, true, true))).toBe("closeMenu");
    expect(resolveEscape(state(true, false, true))).toBe("closeMenu");
    expect(resolveEscape(state(false, false, true))).toBe("closeMenu");
    expect(resolveEscape(state(true, true, false))).toBe("closeNpc");
    expect(resolveEscape(state(false, true, false))).toBe("closeRoster");
    expect(resolveEscape(state(false, false, false))).toBe("openMenu");
  });

  it("resolveEscape closes an overlay first — before the menu, the 조교 dialogue and the roster", () => {
    expect(resolveEscape(state(false, false, false, true))).toBe("closeOverlay");
    expect(resolveEscape(state(true, true, true, true))).toBe("closeOverlay");
    expect(resolveEscape(state(false, true, false, true))).toBe("closeOverlay");
    expect(resolveEscape(state(true, false, false, true))).toBe("closeOverlay");
    expect(resolveEscape(state(false, false, true, true))).toBe("closeOverlay");
  });

  it("covers every combination: overlay → menu → npc → roster order, else the menu opens", () => {
    for (const overlay of [false, true])
      for (const npc of [false, true])
        for (const roster of [false, true])
          for (const menu of [false, true]) {
            const want = overlay ? "closeOverlay" : menu ? "closeMenu" : npc ? "closeNpc" : roster ? "closeRoster" : "openMenu";
            expect(resolveEscape(state(npc, roster, menu, overlay)), `${overlay}/${npc}/${roster}/${menu}`).toBe(want);
          }
  });

  it("Esc reaches the menu action while the keyboard is captured, so an open menu can be closed", () => {
    // MenuPanel sets the capture flag while open — Escape must still resolve.
    expect(resolveHotkey(kd("Escape"), true)).toEqual({ type: "menu" });
    expect(resolveHotkey(kd("Escape"), false)).toEqual({ type: "menu" });
  });
});
