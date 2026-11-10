import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveHotkey,
  resolveEscape,
  hotkeyPreventsDefault,
  keydownCancelsDefault,
  onHotkey,
  followsConsonant,
  trackKey,
  stepHeld,
  WORD_GAP_MS,
  ROLLOVER_MS,
  TYPED_PRESS_MAX_MS,
  VOWEL_HOLD_MS,
  TAKE_BACK_MS,
  BAG_HOLD_MS,
  heldKeyWaitMs,
  type HeldKey,
  type PrevKey,
  type HotkeyAction,
  type KeyLike,
} from "./hotkeys";
import { acquireUiCapture, releaseAllUiCapture } from "./uiCapture";
import { viewState } from "./viewState";

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
// TEXT_INPUT_TYPE_NONE document gets GUID_COMPARTMENT_KEYBOARD_DISABLED). So outside the chat a key pressed in 한글 mode
// arrives as the plain latin letter — ㅡ is just "m" — and that ONE key cannot be told from English mode. Its place in
// the sequence can: ㅡ (M) and ㅠ (B) are VOWELS, and a Korean syllable never starts with a vowel key — it follows a
// consonant (그 = R M, 응 = D M D, 는 = S M S, 듀 = E B). An M / B right after a consonant key is a word being typed;
// an M / B on its own is the map / the bag, in either mode.
describe("followsConsonant — is this key the vowel of a word being typed?", () => {
  const prev = (code: string, at: number, o: Partial<PrevKey> = {}): PrevKey => ({ code, at, plain: true, released: true, ...o });

  it("right after a consonant key (ㄱ ㅇ ㄴ ㅈ ㅁ ㄷ ㄹ ㅋ ㅊ ㅂ ㅅ ㅎ ㅌ — Q W E R T A S D F G Z X C)", () => {
    for (const code of ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyZ", "KeyX", "KeyC"])
      expect(followsConsonant(prev(code, 1000), 1120), code).toBe(true);
  });

  it("but not after V (ㅍ): V then M — switch the view, then open the map — is a real combo, and 프 / 퓨 rarely start a line", () => {
    expect(followsConsonant(prev("KeyV", 1000), 1120)).toBe(false);
    expect(followsConsonant(prev("KeyV", 1000), 1300)).toBe(false);
  });

  it("a slow typist too, up to WORD_GAP_MS — not after that (a key pressed later is a key on its own)", () => {
    // Review round 3: a slow typist (0.6 – 1.2 s a key: a child hunting for each key, ~50 타/분) still got the map with
    // 그래 / 음 / 즈. The gap covers 1.2 s a key with room for a hesitation, and no more than that.
    expect(WORD_GAP_MS).toBeGreaterThanOrEqual(1200 + 200);
    expect(WORD_GAP_MS).toBeLessThanOrEqual(1600);
    for (const gap of [300, 600, 900, 1200]) expect(followsConsonant(prev("KeyR", 1000), 1000 + gap), `${gap}`).toBe(true);
    expect(followsConsonant(prev("KeyR", 1000), 1000 + WORD_GAP_MS)).toBe(true);
    expect(followsConsonant(prev("KeyR", 1000), 1000 + WORD_GAP_MS + 1)).toBe(false);
  });

  it("a consonant that was HELD before it was let go (a step, a turn of the camera) is a game key, not a letter", () => {
    // a typed press lasts about 0.1 s (slow typists ~0.25 s); real Chrome marks a longer hold by its auto-repeat too,
    // but a hold shorter than the repeat delay (or a synthetic key) never repeats
    expect(TYPED_PRESS_MAX_MS).toBeGreaterThanOrEqual(300);
    expect(TYPED_PRESS_MAX_MS).toBeLessThanOrEqual(500);
    expect(followsConsonant(prev("KeyD", 1000, { upAt: 1000 + TYPED_PRESS_MAX_MS }), 1000 + TYPED_PRESS_MAX_MS + 300)).toBe(true);
    // walking with W for 0.9 s, letting go, and pressing M for the map 0.3 s later
    expect(followsConsonant(prev("KeyW", 1000, { upAt: 1900 }), 2200)).toBe(false);
    expect(followsConsonant(prev("KeyW", 1000, { upAt: 1000 + TYPED_PRESS_MAX_MS + 1 }), 1000 + TYPED_PRESS_MAX_MS + 100)).toBe(false);
  });

  it("not after a vowel key, a digit, Space, an arrow, Enter, Escape, Shift — or nothing at all", () => {
    for (const code of ["KeyM", "KeyB", "KeyH", "KeyK", "KeyO", "Digit1", "Space", "ArrowUp", "Enter", "Escape", "ShiftLeft", "Tab"])
      expect(followsConsonant(prev(code, 1000), 1100), code).toBe(false);
    expect(followsConsonant(null, 1100)).toBe(false);
  });

  it("a consonant key still HELD is walking / turning, not a word — unless the vowel came within a typist's roll-over", () => {
    // fast typists press the next key a moment before letting go of the last one — up to a quarter second
    // (review round 3: "그" with ㄱ still held 200 ms opened the map)
    expect(ROLLOVER_MS).toBeGreaterThanOrEqual(250);
    expect(ROLLOVER_MS).toBeLessThan(300); // walking with W held, then M, stays the map (e2e: M 350 ms into the walk)
    for (const gap of [150, 200, 240]) expect(followsConsonant(prev("KeyR", 1000, { released: false }), 1000 + gap), `${gap}`).toBe(true);
    expect(followsConsonant(prev("KeyD", 1000, { released: false }), 1000 + ROLLOVER_MS)).toBe(true);
    // holding W to walk and pressing M for the map
    expect(followsConsonant(prev("KeyW", 1000, { released: false }), 1000 + ROLLOVER_MS + 1)).toBe(false);
    expect(followsConsonant(prev("KeyW", 1000, { released: false }), 1400)).toBe(false);
  });

  it("not after an auto-repeat (a held key) or a Ctrl / Alt / Meta chord", () => {
    expect(followsConsonant(prev("KeyW", 1000, { plain: false }), 1050)).toBe(false);
  });
});

describe("trackKey — what the shared listener remembers of the last key pressed out in the world", () => {
  it("a keydown out in the world: its code and time, not yet released, plain unless a repeat or a chord", () => {
    expect(trackKey(null, kd("KeyR", { key: "r" }), false, 500)).toEqual({ code: "KeyR", at: 500, plain: true, released: false });
    expect(trackKey(null, kd("KeyR", { key: "R", shiftKey: true }), false, 500)?.plain).toBe(true); // ㄲ is Shift + R
    expect(trackKey(null, kd("KeyW", { key: "w", repeat: true }), false, 500)?.plain).toBe(false);
    for (const o of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }])
      expect(trackKey(null, kd("KeyR", { key: "r", ...o }), false, 500)?.plain, JSON.stringify(o)).toBe(false);
  });

  it("its keyup marks it released (another key's keyup changes nothing)", () => {
    const r = trackKey(null, kd("KeyR", { key: "r" }), false, 500);
    expect(trackKey(r, ku("KeyR"), false, 560)).toEqual({ code: "KeyR", at: 500, plain: true, released: true, upAt: 560 });
    expect(trackKey(r, ku("KeyW"), false, 560)).toEqual(r);
    expect(trackKey(null, ku("KeyR"), false, 560)).toBeNull();
  });

  it("a key typed while a field holds the keyboard forgets it: that is no word started out in the world", () => {
    const r = trackKey(null, kd("KeyR", { key: "r" }), false, 500);
    expect(trackKey(r, kd("KeyR", { key: "Process", keyCode: 229 }), true, 560)).toBeNull();
  });
});

describe("resolveHotkey — M / B right after a consonant (Windows 한글 mode: ㅡ ㅠ arrive as plain m / b)", () => {
  const typed = (code: string, key: string, o: Partial<KeyLike> = {}) => kd(code, { key, ...o });

  it("after a consonant: plain m / b are ㅡ / ㅠ — typing, not the MAP / the bag", () => {
    expect(resolveHotkey(typed("KeyM", "m"), false, true)).toEqual({ type: "typeToChat" });
    expect(resolveHotkey(typed("KeyB", "b"), false, true)).toEqual({ type: "typeToChat" });
    expect(resolveHotkey(typed("KeyM", "M", { shiftKey: true }), false, true)).toEqual({ type: "typeToChat" });
  });

  it("on their own, m / b stay the map / the bag (a Korean line never starts with ㅡ / ㅠ)", () => {
    expect(resolveHotkey(typed("KeyM", "m"), false, false)).toEqual({ type: "toggleMap" });
    expect(resolveHotkey(typed("KeyB", "b"), false, false)).toEqual({ type: "bag" });
    expect(resolveHotkey(typed("KeyM", "m"), false)).toEqual({ type: "toggleMap" });
  });

  it("R / V are consonants (ㄱ ㅍ): a plain r / v stays recenter / view even after another key", () => {
    expect(resolveHotkey(typed("KeyR", "r"), false, true)).toEqual({ type: "recenter" });
    expect(resolveHotkey(typed("KeyV", "v"), false, true)).toEqual({ type: "toggleView" });
  });

  it("the positional game keys keep their job after a consonant too: WASD / Z / C, E / F, Space, digits, Enter, /, Esc, Tab", () => {
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

// Review (2026-11-10): "ㅡㅡ" / "ㅠㅠ" typed without clicking the bar still opened the map / the bag on Windows Chrome —
// out there the IME is off, ㅡ arrives as a plain "m", and the FIRST m follows no consonant. ㅡㅡ ㅠㅠ are some of the
// commonest chat lines there are. So a lone plain M / B waits a moment before it acts: when the next key goes on typing
// (another M / B, or any typed key that is no game key) it was a word, and the chat opens with both letters; otherwise
// (the hold runs out, or a game key comes) it is the map / the bag as always.
describe("stepHeld — a lone M / B waits a moment for the next key (Windows: ㅡㅡ ㅠㅠ arrive as m m / b b)", () => {
  const typed = (code: string, key: string, o: Partial<KeyLike> = {}) => kd(code, { key, ...o });
  /** One keydown through the table and the hold, the way the shared listener runs them. */
  const step = (held: HeldKey | null, e: KeyLike, now: number, uiCaptured = false, afterConsonant = false) =>
    stepHeld(held, e, resolveHotkey(e, uiCaptured, afterConsonant), uiCaptured, now);
  const heldM: HeldKey = { action: { type: "toggleMap" }, char: "m", at: 1000 };
  const heldB: HeldKey = { action: { type: "bag" }, char: "b", at: 1000 };

  it("the hold is short — long enough for a double tap (ㅡㅡ), short enough that M still feels like the map key", () => {
    expect(VOWEL_HOLD_MS).toBeGreaterThanOrEqual(250);
    expect(VOWEL_HOLD_MS).toBeLessThanOrEqual(400);
  });

  it("a plain m / b on its own does nothing yet: it is held (with the letter it typed)", () => {
    expect(step(null, typed("KeyM", "m"), 1000)).toEqual({ held: heldM, out: [] });
    expect(step(null, typed("KeyB", "b"), 1000)).toEqual({ held: heldB, out: [] });
    expect(step(null, typed("KeyM", "M", { shiftKey: true }), 1000)).toEqual({
      held: { action: { type: "toggleMap" }, char: "M", at: 1000 },
      out: [],
    });
  });

  it('ㅡㅡ / ㅠㅠ (m m, b b): the second press makes it a word — the chat opens with the first letter, never the map / bag', () => {
    expect(step(heldM, typed("KeyM", "m"), 1150)).toEqual({ held: null, out: [{ type: "typeToChat", prefix: "m" }] });
    expect(step(heldB, typed("KeyB", "b"), 1150)).toEqual({ held: null, out: [{ type: "typeToChat", prefix: "b" }] });
    // ㅠㅡ, ㅡㅠ: mixed too
    expect(step(heldB, typed("KeyM", "m"), 1150)).toEqual({ held: null, out: [{ type: "typeToChat", prefix: "b" }] });
  });

  it("a typed key that is no game key after it is a word too (ㅡㅅㅡ, ㅡ.ㅡ, ㅠㅜ, English \"my\")", () => {
    for (const [code, key] of [
      ["KeyT", "t"],
      ["Period", "."],
      ["KeyN", "n"],
      ["KeyY", "y"],
      ["KeyO", "o"],
    ])
      expect(step(heldM, typed(code, key), 1200), code).toEqual({ held: null, out: [{ type: "typeToChat", prefix: "m" }] });
  });

  it("a game key after it: the M WAS the map — it acts at once, then that key does its own job", () => {
    expect(step(heldM, typed("KeyW", "w"), 1100)).toEqual({ held: null, out: [{ type: "toggleMap" }] });
    expect(step(heldM, typed("KeyD", "d"), 1100)).toEqual({ held: null, out: [{ type: "toggleMap" }] });
    expect(step(heldM, typed("ArrowUp", "ArrowUp"), 1100)).toEqual({ held: null, out: [{ type: "toggleMap" }] });
    expect(step(heldM, typed("Space", " "), 1100)).toEqual({ held: null, out: [{ type: "toggleMap" }, { type: "jump" }] });
    expect(step(heldM, typed("Enter", "Enter"), 1100)).toEqual({ held: null, out: [{ type: "toggleMap" }, { type: "openChat" }] });
    expect(step(heldM, typed("Slash", "/"), 1100)).toEqual({ held: null, out: [{ type: "toggleMap" }, { type: "openChat" }] });
    expect(step(heldM, typed("Tab", "Tab"), 1100)).toEqual({ held: null, out: [{ type: "toggleMap" }, { type: "roster", show: true }] });
    expect(step(heldB, typed("Escape", "Escape"), 1100)).toEqual({ held: null, out: [{ type: "bag" }, { type: "menu" }] });
    // a held key's auto-repeat (walking with W) — the player is playing
    expect(step(heldM, typed("KeyW", "w", { repeat: true }), 1100)).toEqual({ held: null, out: [{ type: "toggleMap" }] });
    // a chord (Ctrl+R reload, ...)
    expect(step(heldM, typed("KeyR", "r", { ctrlKey: true }), 1100)).toEqual({ held: null, out: [{ type: "toggleMap" }] });
  });

  // Review round 3: the interact / camera letters inside such a line kept the map open ("me too": the map, then E
  // interacted). After a lone m every key that TYPES something and is no walking / jumping / Enter / / / Esc / Tab key is a
  // letter of the line: E F (interact), R (recenter), V (view), Z C (the camera turn), the digits (emoji) too.
  it("the letter hotkeys and the digits after it are letters of the line too (me, ㅡㄹ, ㅡㄱ, ㅡㅍ, ㅡㅋ, ㅡㅊ, ㅡ1): the chat, never their own job", () => {
    for (const [code, key] of [
      ["KeyE", "e"],
      ["KeyF", "f"],
      ["KeyR", "r"],
      ["KeyV", "v"],
      ["KeyZ", "z"],
      ["KeyC", "c"],
      ["Digit2", "2"],
      ["KeyQ", "q"],
      ["KeyX", "x"],
    ]) {
      expect(step(heldM, typed(code, key), 1100), code).toEqual({ held: null, out: [{ type: "typeToChat", prefix: "m" }] });
      expect(step(heldB, typed(code, key), 1100), code).toEqual({ held: null, out: [{ type: "typeToChat", prefix: "b" }] });
    }
    // but not a repeat, a chord, a key another handler consumed, or a named key that types nothing
    expect(step(heldM, typed("KeyE", "e", { repeat: true }), 1100)).toEqual({ held: null, out: [{ type: "toggleMap" }] });
    expect(step(heldM, typed("KeyE", "e", { altKey: true }), 1100)).toEqual({ held: null, out: [{ type: "toggleMap" }] });
    expect(step(heldM, typed("KeyE", "e", { defaultPrevented: true }), 1100)).toEqual({ held: null, out: [{ type: "toggleMap" }] });
    expect(step(heldM, typed("F5", "F5"), 1100)).toEqual({ held: null, out: [{ type: "toggleMap" }] });
  });

  it("a bare Shift / Ctrl / Alt / 한영 key leaves the hold as it is (ㅡ_ㅡ, a capital next)", () => {
    for (const [code, key] of [
      ["ShiftLeft", "Shift"],
      ["ShiftRight", "Shift"],
      ["ControlLeft", "Control"],
      ["AltRight", "Alt"],
      ["MetaLeft", "Meta"],
      ["CapsLock", "CapsLock"],
      ["Lang1", "HangulMode"],
    ])
      expect(step(heldM, typed(code, key), 1100), code).toEqual({ held: heldM, out: [] });
    // and the letter after the Shift still makes the word
    expect(step(heldM, typed("Minus", "_", { shiftKey: true }), 1180)).toEqual({ held: null, out: [{ type: "typeToChat", prefix: "m" }] });
  });

  it("a key while something took the keyboard meanwhile (a click into a field) drops the held map — no map under the chat", () => {
    expect(step(heldM, typed("KeyH", "h"), 1100, true)).toEqual({ held: null, out: [] });
    expect(step(heldM, typed("KeyM", "Process", { keyCode: 229 }), 1100, true)).toEqual({ held: null, out: [] });
    expect(step(heldM, typed("Escape", "Escape"), 1100, true)).toEqual({ held: null, out: [{ type: "menu" }] });
  });

  it("only a plain latin M / B out in the world is held: an IME key, a jamo, a vowel after a consonant, a synthetic key act at once", () => {
    expect(step(null, typed("KeyM", "Process", { keyCode: 229 }), 1000)).toEqual({ held: null, out: [{ type: "typeToChat" }] });
    expect(step(null, typed("KeyM", "ㅡ"), 1000)).toEqual({ held: null, out: [{ type: "typeToChat" }] });
    expect(step(null, typed("KeyM", "m"), 1000, false, true)).toEqual({ held: null, out: [{ type: "typeToChat" }] });
    expect(step(null, kd("KeyM"), 1000)).toEqual({ held: null, out: [{ type: "toggleMap" }] });
    expect(step(null, kd("KeyB"), 1000)).toEqual({ held: null, out: [{ type: "bag" }] });
    expect(step(null, typed("KeyM", "m"), 1000, true)).toEqual({ held: null, out: [] });
    expect(step(null, typed("KeyM", "m", { ctrlKey: true }), 1000)).toEqual({ held: null, out: [] });
    // R / V (consonants) are not held: recenter / view act at once, as before
    expect(step(null, typed("KeyR", "r"), 1000)).toEqual({ held: null, out: [{ type: "recenter" }] });
    expect(step(null, typed("KeyV", "v"), 1000)).toEqual({ held: null, out: [{ type: "toggleView" }] });
  });

  it("keyups pass straight through and leave the hold alone", () => {
    expect(stepHeld(heldM, ku("KeyE"), { type: "interactUp" }, false, 1100)).toEqual({ held: heldM, out: [{ type: "interactUp" }] });
    expect(stepHeld(heldM, ku("KeyM", { key: "m" }), null, false, 1100)).toEqual({ held: heldM, out: [] });
  });

  // Review (2026-11-10, round 2): "ㅡㅡ" typed slowly (350 ms apart) still opened the map, then closed it again with the
  // second m, and nothing reached the chat. A slow typist's second key comes after the short hold ran out — so for a
  // moment more (TAKE_BACK_MS from the press: sooner than anyone reacts to the map starting to move) the map it opened
  // can still be taken back (the map is a toggle).
  describe("after the hold ran out and the map opened (acted), a moment more can still take it back", () => {
    const actedM: HeldKey = { ...heldM, acted: true };

    it("a slow ㅡㅡ (the second m 0.35 – 1.2 s after the first): the map is toggled back, the chat opens with the first m", () => {
      const back = { held: null, out: [{ type: "toggleMap" }, { type: "typeToChat", prefix: "m" }] };
      for (const gap of [350, 600, 900, 1200]) expect(step(actedM, typed("KeyM", "m"), 1000 + gap), `${gap}`).toEqual(back);
      // English "my", slowly: the same
      expect(step(actedM, typed("KeyY", "y"), 1450)).toEqual(back);
      // up to TAKE_BACK_MS after the first press, inclusive
      expect(step(actedM, typed("KeyM", "m"), 1000 + TAKE_BACK_MS)).toEqual(back);
    });

    it("the letter hotkeys and the digits take it back too — the map never stays open under a line being typed (me, ㅡㄹ, ㅡㅋ)", () => {
      const back = { held: null, out: [{ type: "toggleMap" }, { type: "typeToChat", prefix: "m" }] };
      for (const [code, key] of [
        ["KeyE", "e"],
        ["KeyF", "f"],
        ["KeyR", "r"],
        ["KeyV", "v"],
        ["KeyZ", "z"],
        ["KeyC", "c"],
        ["Digit1", "1"],
        ["Period", "."],
      ])
        for (const gap of [600, 900, 1200]) expect(step(actedM, typed(code, key), 1000 + gap), `${code} ${gap}`).toEqual(back);
    });

    it("a game key then does only its own job — the map stays open (M, then walk / jump / chat on the map)", () => {
      for (const at of [1400, 1900, 2200]) {
        expect(step(actedM, typed("KeyW", "w"), at)).toEqual({ held: null, out: [] });
        expect(step(actedM, typed("KeyA", "a"), at)).toEqual({ held: null, out: [] });
        expect(step(actedM, typed("ArrowLeft", "ArrowLeft"), at)).toEqual({ held: null, out: [] });
        expect(step(actedM, typed("Space", " "), at)).toEqual({ held: null, out: [{ type: "jump" }] });
        expect(step(actedM, typed("Enter", "Enter"), at)).toEqual({ held: null, out: [{ type: "openChat" }] });
        expect(step(actedM, typed("Slash", "/"), at)).toEqual({ held: null, out: [{ type: "openChat" }] });
        expect(step(actedM, typed("Escape", "Escape"), at)).toEqual({ held: null, out: [{ type: "menu" }] });
        // a held key's repeat is the player playing, too
        expect(step(actedM, typed("KeyE", "e", { repeat: true }), at)).toEqual({ held: null, out: [] });
      }
    });

    it("later than TAKE_BACK_MS after the first m, an m is a key on its own: held afresh (M, see the map, M closes it)", () => {
      const at = 1000 + TAKE_BACK_MS + 1;
      expect(step(actedM, typed("KeyM", "m"), at)).toEqual({ held: { action: { type: "toggleMap" }, char: "m", at }, out: [] });
      expect(step(actedM, typed("KeyH", "h"), at)).toEqual({ held: null, out: [{ type: "typeToChat" }] });
    });

    it("a bare modifier keeps it; a key while something took the keyboard drops it (nothing toggled back)", () => {
      expect(step(actedM, typed("ShiftLeft", "Shift"), 1300)).toEqual({ held: actedM, out: [] });
      expect(step(actedM, typed("KeyM", "m"), 1300, true)).toEqual({ held: null, out: [] });
    });
  });

  it("how long each key waits: M (the map) VOWEL_HOLD_MS — a slow typist's next key can still take it back; B a little longer, because the bag takes the keyboard where there is one (a classroom), so a second ㅠ could not close it again", () => {
    expect(heldKeyWaitMs({ type: "toggleMap" })).toBe(VOWEL_HOLD_MS);
    expect(heldKeyWaitMs({ type: "bag" })).toBe(BAG_HOLD_MS);
    expect(VOWEL_HOLD_MS).toBeLessThan(BAG_HOLD_MS);
    expect(BAG_HOLD_MS).toBeLessThanOrEqual(700); // the bag still answers B in well under a second
    // Review round 3: the take-back reaches the slowest typist's next key (1.2 s a key) with room for a hesitation —
    // the same span as the word gap — and no further: a second M later than that is a player closing the map
    expect(TAKE_BACK_MS).toBe(WORD_GAP_MS);
    expect(TAKE_BACK_MS).toBeGreaterThanOrEqual(1200 + 200);
    expect(TAKE_BACK_MS).toBeLessThanOrEqual(1600);
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
    // The held M / B (stepHeld) acts when its hold runs out — a setTimeout. performance.now is mocked per test.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    releaseAllUiCapture();
    viewState.mode = "tp";
  });
  afterEach(() => {
    for (const off of disposers) off(); // idempotent — tests that already disposed are fine
    disposers = [];
    vi.useRealTimers();
    vi.unstubAllGlobals();
    releaseAllUiCapture();
    viewState.mode = "tp";
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

  /** A plain latin key as Windows Chrome hands it outside a field (IME off): key "m", keyCode 77. */
  function latin(type: "keydown" | "keyup", code: string, key: string, o: Partial<KeyLike> = {}): Event {
    const ev = Object.assign(new Event(type, { cancelable: true }), {
      code,
      key,
      keyCode: key.toUpperCase().charCodeAt(0),
      repeat: false,
      isComposing: false,
      ...o,
    });
    win.dispatchEvent(ev);
    return ev;
  }

  it('Windows 한글 "그래" typed without clicking (r m f o): R recenters, but M is typing — the map never opens', () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn();
    sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyR", "r");
      now.mockReturnValue(1080);
      latin("keyup", "KeyR", "r");
      now.mockReturnValue(1190);
      const m = latin("keydown", "KeyM", "m");
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "recenter" }, { type: "typeToChat" }]);
      expect(m.defaultPrevented).toBe(false); // the "m" lands in the field the chat opened
    } finally {
      now.mockRestore();
    }
  });

  it("M on its own is the map — once its short hold has run out; after a pause longer than WORD_GAP_MS, too; and right after V", () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn();
    sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyM", "m");
      latin("keyup", "KeyM", "m");
      expect(fn).not.toHaveBeenCalled(); // held: the next key might make it a word (ㅡㅡ)
      vi.advanceTimersByTime(VOWEL_HOLD_MS - 1);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "toggleMap" }]);
      now.mockReturnValue(5000);
      latin("keydown", "KeyR", "r");
      latin("keyup", "KeyR", "r");
      now.mockReturnValue(5000 + WORD_GAP_MS + 50);
      latin("keydown", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      expect(fn.mock.calls.at(-1)?.[0]).toEqual({ type: "toggleMap" });
      latin("keyup", "KeyM", "m");
      // V (third person), the view settles (~0.3 s), then M: the map, from that view
      now.mockReturnValue(9000);
      latin("keydown", "KeyV", "v");
      latin("keyup", "KeyV", "v");
      now.mockReturnValue(9300);
      latin("keydown", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      expect(fn.mock.calls.slice(-2).map((c) => c[0])).toEqual([{ type: "toggleView" }, { type: "toggleMap" }]);
      // the held map is handed out with the keydown that started it
      expect(fn.mock.calls.at(-1)?.[1]).toMatchObject({ type: "keydown", code: "KeyM" });
    } finally {
      now.mockRestore();
    }
  });

  it("walking (W held — its auto-repeats, or just held down) and then M opens the map, not the chat", () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn();
    sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyW", "w");
      now.mockReturnValue(1300); // still held, no repeat yet
      latin("keydown", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "toggleMap" }]);
      latin("keyup", "KeyM", "m");
      now.mockReturnValue(2000);
      latin("keydown", "KeyW", "w", { repeat: true }); // the held W's auto-repeat
      now.mockReturnValue(2030);
      latin("keyup", "KeyW", "w");
      now.mockReturnValue(2100);
      latin("keydown", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "toggleMap" }, { type: "toggleMap" }]);
    } finally {
      now.mockRestore();
    }
  });

  it("M, then a game key before the hold runs out: the map opens AT ONCE with that key (no wait), and only once", () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn();
    sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyM", "m");
      latin("keyup", "KeyM", "m");
      now.mockReturnValue(1120);
      latin("keydown", "KeyW", "w"); // open the map and start walking
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "toggleMap" }]);
      vi.advanceTimersByTime(VOWEL_HOLD_MS * 3);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it('Windows 한글 "ㅡㅡ" typed without clicking (m m): the chat opens with "m" first, the map never opens', () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn((a: HotkeyAction) => {
      if (a.type === "typeToChat") acquireUiCapture("chat"); // what ChatInput's focus() does
    });
    sub(fn);
    try {
      now.mockReturnValue(1000);
      const m1 = latin("keydown", "KeyM", "m");
      now.mockReturnValue(1070);
      latin("keyup", "KeyM", "m");
      now.mockReturnValue(1150);
      const m2 = latin("keydown", "KeyM", "m");
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "typeToChat", prefix: "m" }]);
      expect(m1.defaultPrevented).toBe(false);
      expect(m2.defaultPrevented).toBe(false); // the second "m" lands in the field after the first
      // "ㅡㅡㅡ": the third goes into the focused field — no hotkey, and the hold never acts later
      now.mockReturnValue(1300);
      latin("keydown", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS * 4);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "typeToChat", prefix: "m" }]);
    } finally {
      now.mockRestore();
    }
  });

  it('"ㅠㅠ" (b b) never opens the bag, and English "my" starts the chat with its m', () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn();
    sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyB", "b");
      now.mockReturnValue(1180);
      latin("keydown", "KeyB", "b");
      vi.advanceTimersByTime(VOWEL_HOLD_MS * 2);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "typeToChat", prefix: "b" }]);
      now.mockReturnValue(5000);
      latin("keydown", "KeyM", "m");
      now.mockReturnValue(5110);
      latin("keydown", "KeyY", "y");
      vi.advanceTimersByTime(VOWEL_HOLD_MS * 2);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([
        { type: "typeToChat", prefix: "b" },
        { type: "typeToChat", prefix: "m" },
      ]);
    } finally {
      now.mockRestore();
    }
  });

  it("a held map is dropped when the keyboard was taken before the hold ran out (a click into the chat)", () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn();
    sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyM", "m");
      acquireUiCapture("chat");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      expect(fn).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('a slow "ㅡㅡ" (m, 350 ms, m): the map that opened when the hold ran out is taken back, and the chat opens with "m"', () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn((a: HotkeyAction) => {
      if (a.type === "typeToChat") acquireUiCapture("chat"); // what ChatInput's focus() does
    });
    sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyM", "m");
      latin("keyup", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "toggleMap" }]); // the map, on its own
      now.mockReturnValue(1350);
      const m2 = latin("keydown", "KeyM", "m");
      expect(fn.mock.calls.map((c) => c[0])).toEqual([
        { type: "toggleMap" },
        { type: "toggleMap" }, // taken back
        { type: "typeToChat", prefix: "m" },
      ]);
      expect(m2.defaultPrevented).toBe(false); // the second m lands in the field
      vi.advanceTimersByTime(WORD_GAP_MS * 2);
      expect(fn).toHaveBeenCalledTimes(3);
    } finally {
      now.mockRestore();
    }
  });

  it("M, the map starts to open, M again once the player could see it (past TAKE_BACK_MS): it just closes — no chat", () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn();
    sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      now.mockReturnValue(1000 + TAKE_BACK_MS + 50);
      latin("keydown", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "toggleMap" }, { type: "toggleMap" }]);
    } finally {
      now.mockRestore();
    }
  });

  it("M, a look at the map, M again two seconds later: it just closes the map (no chat)", () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn();
    sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      now.mockReturnValue(3000);
      latin("keydown", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "toggleMap" }, { type: "toggleMap" }]);
    } finally {
      now.mockRestore();
    }
  });

  it("B on its own opens the bag once its wait has passed; a slow ㅠㅠ (450 ms apart) never opens it", () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn();
    sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyB", "b");
      vi.advanceTimersByTime(BAG_HOLD_MS - 1);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "bag" }]);
      now.mockReturnValue(5000);
      latin("keydown", "KeyB", "b");
      vi.advanceTimersByTime(450);
      now.mockReturnValue(5450);
      latin("keydown", "KeyB", "b");
      vi.advanceTimersByTime(BAG_HOLD_MS * 2);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "bag" }, { type: "typeToChat", prefix: "b" }]);
    } finally {
      now.mockRestore();
    }
  });

  it("the last subscriber leaving cancels a held key — nothing acts after the world is gone", () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn();
    const off = sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyM", "m");
      off();
      vi.advanceTimersByTime(VOWEL_HOLD_MS * 2);
      expect(fn).not.toHaveBeenCalled();
      // a new world starts with no hold left over: its first m is held afresh, and acts on its own
      const fn2 = vi.fn();
      sub(fn2);
      now.mockReturnValue(1100);
      latin("keydown", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      expect(fn2.mock.calls.map((c) => c[0])).toEqual([{ type: "toggleMap" }]);
    } finally {
      now.mockRestore();
    }
  });

  it("a consonant typed INTO a field does not make the next key out in the world a word (the click that left the chat)", () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn();
    sub(fn);
    try {
      acquireUiCapture("chat");
      now.mockReturnValue(1000);
      latin("keydown", "KeyR", "Process", { keyCode: 229 });
      latin("keyup", "KeyR", "ㄱ");
      releaseAllUiCapture(); // the press outside took the caret out
      now.mockReturnValue(1200);
      latin("keydown", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      expect(fn.mock.calls.at(-1)?.[0]).toEqual({ type: "toggleMap" });
    } finally {
      now.mockRestore();
    }
  });

  // Review round 3 (2026-11-10): a slower typist (about 0.6 s a key or slower) still got the map — "그래" (r m f o) left it
  // open with only "o" in the chat on top, "음" (d m a) and "즈" (w m) opened it. Each line below is played through the
  // shared listener as Windows Chrome hands it outside a field (plain latin keys, each held 50 ms) at 0.09 – 1.2 s a key,
  // with a stand-in for the map (the overview, a toggle) and for the chat field: the keys from the one that opened the
  // chat on land in it, after a held letter (`prefix`) put in first.
  describe("slow typing never leaves the map open (round 3 matrix: 그래 · 음 · 즈 · ㅡㅡ · 안녕하세요 · 그래 알겠어 · me too)", () => {
    const LINES: [label: string, keys: string, field: string][] = [
      ["그래", "rmfo", "mfo"],
      ["음", "dma", "ma"],
      ["즈", "wm", "m"],
      ["ㅡㅡ", "mm", "mm"],
      ["안녕하세요", "dkssudgktpdy", "kssudgktpdy"],
      ["그래 알겠어", "rmfo dkfrpTdj", "mfo dkfrpTdj"], // ㅆ = Shift + T
      ["me too", "me too", "me too"],
    ];
    const codeOf = (k: string) => (k === " " ? "Space" : `Key${k.toUpperCase()}`);

    /** Type `keys` one every `gapMs` (each held `holdMs`), then wait until every hold and take-back is long over. */
    function play(keys: string, gapMs: number, holdMs = 50) {
      const now = vi.spyOn(performance, "now");
      const st = { clock: 10_000, map: false, openedAt: 0, longestOpen: 0, field: null as string | null };
      const to = (t: number) => {
        now.mockReturnValue(t);
        vi.advanceTimersByTime(t - st.clock);
        st.clock = t;
      };
      now.mockReturnValue(st.clock);
      const fn = vi.fn((a: HotkeyAction) => {
        if (a.type === "toggleMap") {
          st.map = !st.map;
          viewState.mode = st.map ? "ov" : "tp"; // what CameraRig's toggleOverview does
          if (st.map) st.openedAt = st.clock;
          else st.longestOpen = Math.max(st.longestOpen, st.clock - st.openedAt);
        }
        if (a.type === "typeToChat" && st.field === null) {
          st.field = a.prefix ?? ""; // ChatInput: focus(), then the held letter at the caret
          acquireUiCapture("chat");
        }
      });
      const off = sub(fn);
      try {
        let t = st.clock;
        for (const k of keys) {
          to(t);
          const shiftKey = k !== k.toLowerCase();
          const ev = latin("keydown", codeOf(k), k, { shiftKey });
          if (st.field !== null && !ev.defaultPrevented) st.field += k; // the character lands where the caret is
          to(t + holdMs);
          latin("keyup", codeOf(k), k, { shiftKey });
          t += gapMs;
        }
        to(t + TAKE_BACK_MS + 1000);
      } finally {
        now.mockRestore();
        off();
        releaseAllUiCapture();
      }
      if (st.map) st.longestOpen = Math.max(st.longestOpen, st.clock - st.openedAt);
      return { mapEndsOpen: st.map, longestOpen: st.longestOpen, field: st.field, actions: fn.mock.calls.map((c) => c[0]) };
    }

    for (const gap of [90, 300, 600, 900, 1200])
      for (const [label, keys, field] of LINES)
        it(`"${label}" (${keys}) at ${gap} ms a key: the whole line from its first letter on is in the chat, the map never stays open`, () => {
          const r = play(keys, gap);
          expect(r.mapEndsOpen, "the map ends open").toBe(false);
          expect(r.longestOpen, "the map stood open longer than the take-back").toBeLessThanOrEqual(TAKE_BACK_MS);
          expect(r.field).toBe(field);
          // none of its letters did a game key's job once the line was under way (ㄹ = F interact, 1–6 emoji, ...)
          expect(r.actions.filter((a) => a.type === "interact" || a.type === "emoji" || a.type === "toggleView")).toEqual([]);
          viewState.mode = "tp";
        });

    it("a consonant (or a vowel after it) typed slower than WORD_GAP_MS is a key on its own again: R, 1.6 s, M is the map", () => {
      const r = play("rm", WORD_GAP_MS + 100);
      expect(r.mapEndsOpen).toBe(true);
      expect(r.field).toBeNull();
    });
  });

  it('"그" typed with ㄱ still held (R down, M 200 ms later, R up after): the chat, never the map', () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn();
    sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyR", "r");
      now.mockReturnValue(1200);
      latin("keydown", "KeyM", "m");
      now.mockReturnValue(1260);
      latin("keyup", "KeyR", "r");
      vi.advanceTimersByTime(TAKE_BACK_MS);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "recenter" }, { type: "typeToChat" }]);
    } finally {
      now.mockRestore();
    }
  });

  it("walking (W held 0.9 s, let go) and M 0.3 s later is the map — a held W is no letter, even with no auto-repeat", () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn();
    sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyW", "w");
      now.mockReturnValue(1900);
      latin("keyup", "KeyW", "w");
      now.mockReturnValue(2200);
      latin("keydown", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "toggleMap" }]);
    } finally {
      now.mockRestore();
    }
  });

  it("the map open: walking on it with WASD keeps it open (no chat), and M then closes it AT ONCE — after a short step too", () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn((a: HotkeyAction) => {
      if (a.type === "toggleMap") viewState.mode = viewState.mode === "ov" ? "tp" : "ov";
    });
    sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyM", "m");
      latin("keyup", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      expect(viewState.mode).toBe("ov");
      // a short step on the map, inside the take-back: W walks (drei's job), the map stays, no chat
      now.mockReturnValue(1600);
      latin("keydown", "KeyW", "w");
      now.mockReturnValue(1680);
      latin("keyup", "KeyW", "w");
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "toggleMap" }]);
      // and M right after that step (a consonant tap!) closes the map at once — the open map's own key, no wait, no chat
      now.mockReturnValue(2000);
      latin("keydown", "KeyM", "m");
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "toggleMap" }, { type: "toggleMap" }]);
      expect(viewState.mode).toBe("tp");
      vi.advanceTimersByTime(TAKE_BACK_MS * 2);
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it("the map opened by the 🗺 button: M closes it at once; a line typed right after is not taken for ㅡ (no map flicker)", () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn((a: HotkeyAction) => {
      if (a.type === "toggleMap") viewState.mode = viewState.mode === "ov" ? "tp" : "ov";
      if (a.type === "typeToChat") acquireUiCapture("chat");
    });
    sub(fn);
    try {
      viewState.mode = "ov"; // the button
      now.mockReturnValue(1000);
      latin("keydown", "KeyM", "m");
      latin("keyup", "KeyM", "m");
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "toggleMap" }]);
      now.mockReturnValue(1300);
      latin("keydown", "KeyH", "h");
      vi.advanceTimersByTime(TAKE_BACK_MS * 2);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "toggleMap" }, { type: "typeToChat" }]);
      expect(viewState.mode).toBe("tp");
    } finally {
      now.mockRestore();
    }
  });

  it("M, the map, M again later than the take-back: it just closes (no chat); sooner, it reads as ㅡㅡ — the map closes too", () => {
    const now = vi.spyOn(performance, "now");
    const fn = vi.fn((a: HotkeyAction) => {
      if (a.type === "toggleMap") viewState.mode = viewState.mode === "ov" ? "tp" : "ov";
      if (a.type === "typeToChat") acquireUiCapture("chat");
    });
    sub(fn);
    try {
      now.mockReturnValue(1000);
      latin("keydown", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      now.mockReturnValue(1000 + TAKE_BACK_MS + 1);
      latin("keydown", "KeyM", "m");
      expect(fn.mock.calls.map((c) => c[0])).toEqual([{ type: "toggleMap" }, { type: "toggleMap" }]);
      expect(viewState.mode).toBe("tp");
      // sooner: the map closes all the same, and the chat opens with "m" (the second m lands after it)
      now.mockReturnValue(5000);
      latin("keydown", "KeyM", "m");
      vi.advanceTimersByTime(VOWEL_HOLD_MS);
      now.mockReturnValue(6000);
      latin("keydown", "KeyM", "m");
      expect(fn.mock.calls.slice(2).map((c) => c[0])).toEqual([{ type: "toggleMap" }, { type: "toggleMap" }, { type: "typeToChat", prefix: "m" }]);
      expect(viewState.mode).toBe("tp");
    } finally {
      now.mockRestore();
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
