/**
 * Keyboard shortcut table (controls overhaul, Task 4).
 *
 * Every non-movement key lives HERE, resolved by `KeyboardEvent.code` so the table
 * is layout-independent (Hangul IME, AZERTY, ...). `resolveHotkey` is pure: it maps
 * one key event to an action (or null) given whether a DOM field owns the keyboard.
 * `onHotkey` is the only place that touches `window`.
 *
 * Why ONE shared window listener instead of one per consumer: the table cancels the
 * browser default for some keys (Space, Enter, `/`, Tab). If every consumer owned its
 * own listener, the first to run would have already called `preventDefault()` and the
 * rest would see `defaultPrevented` and starve. So the listener resolves the hotkey
 * once, cancels the default once, and fans the resolved action out to every
 * subscriber — each of which sees exactly the same action for the same keystroke.
 *
 * Movement (WASD / arrows / Shift) is NOT here — drei's KeyboardControls (MOVE_KEYS
 * in constants.ts) still owns it, and orbit (Z/C, drag) lives in CameraRig.
 */

import { MOVE_KEYS } from "./constants";
import { isUiCaptured } from "./uiCapture";

export type HotkeyAction =
  | { type: "jump" }
  | { type: "interact" }
  /** E / F released — ends a held interaction (a lone member's 3 s coop switch). Passes while captured, like Tab's keyup. */
  | { type: "interactUp" }
  | { type: "recenter" }
  | { type: "toggleView" }
  | { type: "toggleMap" }
  /** B: open / close the classroom's team bag (a no-op where there is no bag — the legacy world). */
  | { type: "bag" }
  | { type: "menu" }
  | { type: "openChat" }
  | { type: "emoji"; index: number }
  | { type: "roster"; show: boolean }
  /**
   * A key that TYPES something and is no game key, pressed while nothing holds the keyboard: the chat bar takes the
   * caret DURING this keydown (no preventDefault), so the character — or the Hangul composition — lands in the field.
   */
  | { type: "typeToChat" };

/** The bits of a KeyboardEvent the table reads — lets tests pass plain objects. */
export interface KeyLike {
  type: "keydown" | "keyup";
  code: string;
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
  /**
   * What the key types (`KeyboardEvent.key`): "h", "ㅡ", "Process" (an IME such as the Korean one is handling it),
   * "ArrowUp", ... Optional so plain test objects stay valid; without it a key never counts as typing.
   */
  key?: string;
  /** 229 while an IME handles the key (Chrome on Windows in 한글 mode) — the legacy twin of key "Process". */
  keyCode?: number;
  /** Modifier state — optional so plain test objects stay valid; a real KeyboardEvent has all four. */
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** `Digit1`..`Digit6` (the six-emoji palette); capture group = the digit. */
const EMOJI_CODE = /^Digit([1-6])$/;

/** The held game keys drei's KeyboardControls owns (WASD, arrows, Shift, Z / C) — never typing, in any input mode. */
const MOVE_CODES: ReadonlySet<string> = new Set(MOVE_KEYS.flatMap((k) => k.keys));

/**
 * The letter hotkeys that are mnemonics of an English word (Recenter, View, Map, Bag). In 한글 mode the same keys
 * are ㄱ ㅍ ㅡ ㅠ — some of the commonest letters of a Korean sentence — so there they are typing (owner's report
 * 2026-11-10: talking without clicking the bar first opened the map). The positional keys keep their job in every mode:
 * WASD / arrows / Z / C (MOVE_CODES), E / F interact, Space, the digits, Tab, Enter, `/`, Esc. Where the key arrives as
 * a plain latin letter outside a field (Chrome on Windows), only the vowels ㅡ ㅠ can be told — by the consonant
 * before them (followsConsonant); a lone M / B / R / V there is the hotkey.
 */
const IME_TYPING_CODES: ReadonlySet<string> = new Set(["KeyR", "KeyV", "KeyM", "KeyB"]);

/** Hangul jamo / compatibility jamo / syllables — what `key` reads on macOS in 한글 mode (e.g. "ㅡ" for M). */
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7ff]/;

/**
 * Whether an IME is turning this key into text: key "Process" / keyCode 229 (the Korean IME in 한글 mode, wherever it
 * is on — always inside a text field) or a Hangul letter as the key itself (macOS, also outside a field).
 */
export function isImeKey(e: Pick<KeyLike, "key" | "keyCode">): boolean {
  return e.key === "Process" || e.keyCode === 229 || (e.key !== undefined && HANGUL.test(e.key));
}

/**
 * Whether the key types a character: one printable character as its `key` ("h", "7", ".", "ㅡ"), or an IME at work
 * ("Process"). Named keys ("Backspace", "F5", "Shift", "Dead", "Unidentified", "HangulMode", ...) type nothing.
 */
function typesText(e: Pick<KeyLike, "key" | "keyCode">): boolean {
  if (e.key === undefined) return false;
  return isImeKey(e) || [...e.key].length === 1;
}

/**
 * The consonant keys of the standard Korean layout (두벌식) that make the next M / B a vowel: ㅂ ㅈ ㄷ ㄱ ㅅ / ㅁ ㄴ ㅇ ㄹ ㅎ /
 * ㅋ ㅌ ㅊ. Every other letter key is a vowel (ㅛ ㅕ ㅑ ㅐ ㅔ / ㅗ ㅓ ㅏ ㅣ / ㅠ ㅜ ㅡ) — except V (ㅍ), left out on purpose:
 * V then M (switch to third person, then look at the map) is a real combo, while 프 / 퓨 rarely start a line.
 */
const CONSONANT_CODES: ReadonlySet<string> = new Set([
  "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT",
  "KeyA", "KeyS", "KeyD", "KeyF", "KeyG",
  "KeyZ", "KeyX", "KeyC",
]);

/** The letter hotkeys that are VOWELS in 한글 mode: M = ㅡ (the map), B = ㅠ (the bag). */
const VOWEL_HOTKEY_CODES: ReadonlySet<string> = new Set(["KeyM", "KeyB"]);

/**
 * How long (ms) after a consonant key a vowel key still reads as the same word being typed — slow typists included
 * (100 타/분 is 600 ms a key). A key pressed later than this is a key on its own.
 */
export const WORD_GAP_MS = 600;

/**
 * A consonant key still held when the next key goes down is a held game key (walking with W, turning with Z) — unless
 * the next key came within this many ms: a fast typist presses the next key a moment before letting go of the last.
 */
export const ROLLOVER_MS = 150;

/** What the shared listener remembers of the last key pressed out in the world (while nothing held the keyboard). */
export interface PrevKey {
  code: string;
  /** keydown time, ms (performance.now()). */
  at: number;
  /** Pressed by itself: not an auto-repeat (a held key) and no Ctrl / Alt / Meta. Shift is fine (ㄲ ㄸ ㅃ ㅆ ㅉ). */
  plain: boolean;
  /** Its keyup has been seen. */
  released: boolean;
}

/**
 * The remembered key after one more event (pure): a keydown out in the world replaces it; its own keyup marks it
 * released; a keydown while a field (or an overlay) holds the keyboard forgets it — a letter typed into the chat is no
 * word started out in the world, so the click that left the chat and the M after it open the map as usual.
 */
export function trackKey(prev: PrevKey | null, e: KeyLike, uiCaptured: boolean, now: number): PrevKey | null {
  if (e.type === "keyup") return prev !== null && prev.code === e.code ? { ...prev, released: true } : prev;
  if (uiCaptured) return null;
  return { code: e.code, at: now, plain: !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey, released: false };
}

/**
 * Whether a key pressed at `now` comes right after a consonant key, the way a vowel does in a word being typed:
 * the consonant was pressed by itself, at most WORD_GAP_MS before, and has been let go (or the two overlapped by no
 * more than ROLLOVER_MS — a fast typist's roll-over; longer, it is a game key being held).
 *
 * Why: Chrome on Windows (and Linux) switches the IME OFF while no text field has the caret (Chromium
 * ui/base/ime/win/tsf_bridge.cc gives the TEXT_INPUT_TYPE_NONE document GUID_COMPARTMENT_KEYBOARD_DISABLED), so out in
 * the world a key pressed in 한글 mode arrives as the plain latin letter — ㅡ is just "m", the map — and that one key
 * cannot be told from English mode. Its place in the sequence can: ㅡ and ㅠ are vowels, and a Korean syllable never
 * starts with a vowel key (그 = R M, 응 = D M D, 는 = S M S, 듀 = E B). Nothing is remembered beyond the last key, and
 * a reload changes nothing: it works on the first line typed on a fresh page.
 */
export function followsConsonant(prev: PrevKey | null, now: number): boolean {
  if (prev === null || !prev.plain || !CONSONANT_CODES.has(prev.code)) return false;
  const gap = now - prev.at;
  return gap >= 0 && gap <= WORD_GAP_MS && (prev.released || gap <= ROLLOVER_MS);
}

/**
 * Map one key event to a hotkey action, or null when it is not (or must not be
 * treated as) a hotkey.
 *
 * keydown is dropped when another handler already consumed it (`defaultPrevented`
 * — e.g. ChatInput's own Enter/Esc), during IME composition, on auto-repeat (one
 * action per physical press), and while a DOM field owns the keyboard. Escape alone
 * passes the capture rule so the 조교 대화창 can still be closed while typing in it and
 * the menu (which captures the keyboard while open) can be closed again.
 * Ctrl / Cmd / Alt chords are never ours (Ctrl+1..6 switches browser tabs, Ctrl+R
 * reloads, Alt+Tab switches windows, ...). Shift on its own is the run key and blocks
 * nothing — Shift+Tab shows the roster like Tab (a running player holds Shift).
 * Type to chat: a key that types a character and is no game key (H, Q, 7, ".", and in 한글 mode also ㄱ ㅍ ㅡ ㅠ —
 * R V M B, see IME_TYPING_CODES) resolves to `typeToChat`, so a player who just starts talking ends up in the chat
 * instead of opening the map. WASD / arrows / Shift / Z / C (movement and the camera turn, by `code`) and E / F stay
 * game keys in every input mode. 한글 mode is the key itself saying so (key "Process" / 229, or a jamo — macOS). Where
 * the browser hands a plain latin letter outside a field (Windows: the IME is off there), M / B are typing when
 * `afterConsonant` — the key right before was a consonant key, as in 그 (R M) or 응 (D M D); see followsConsonant.
 * On its own, M is the map and B the bag, in either mode (a Korean line never starts with ㅡ / ㅠ).
 * keyup only matters for Tab (roster hide) and E / F (interactUp: the end of a held interaction) and is
 * deliberately unconditional: the list must never stay stuck open because the chat grabbed focus
 * mid-hold, and a hold must be able to end after an overlay took the keyboard.
 */
export function resolveHotkey(e: KeyLike, uiCaptured: boolean, afterConsonant = false): HotkeyAction | null {
  if (e.type === "keyup") {
    if (e.code === "Tab") return { type: "roster", show: false };
    if (e.code === "KeyE" || e.code === "KeyF") return { type: "interactUp" };
    return null;
  }
  if (e.defaultPrevented || e.isComposing || e.repeat) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (uiCaptured && e.code !== "Escape") return null;
  // 한글 mode: ㄱ ㅍ ㅡ ㅠ are letters of the sentence being typed, not recenter / view / map / bag. On Windows only
  // the vowels can be told (by the consonant before them): ㅡ ㅠ after ㄱ ㅇ ㄴ ... are typing, never the map / bag.
  if (IME_TYPING_CODES.has(e.code) && (isImeKey(e) || (afterConsonant && VOWEL_HOTKEY_CODES.has(e.code) && typesText(e))))
    return { type: "typeToChat" };

  switch (e.code) {
    case "Space":
      return { type: "jump" };
    case "KeyE":
    case "KeyF":
      return { type: "interact" };
    case "KeyR":
      return { type: "recenter" };
    case "KeyV":
      return { type: "toggleView" };
    case "KeyM":
      return { type: "toggleMap" };
    case "KeyB":
      return { type: "bag" };
    case "Escape":
      return { type: "menu" };
    case "Enter":
    case "NumpadEnter":
    case "Slash":
      return { type: "openChat" };
    case "Tab":
      return { type: "roster", show: true };
    default: {
      const m = EMOJI_CODE.exec(e.code);
      if (m) return { type: "emoji", index: Number(m[1]) - 1 }; // 1 → EMOJIS[0]
      return !MOVE_CODES.has(e.code) && typesText(e) ? { type: "typeToChat" } : null;
    }
  }
}

/** What one Esc press does (controls-ux Task 15; overlays: AI 학교 탈출 Task 18). */
export type EscapeAction = "closeOverlay" | "closeNpc" | "closeRoster" | "closeMenu" | "openMenu";

/**
 * The ONE place that decides what Esc does: it closes the topmost thing that is open —
 * a classroom overlay first (the close-up, a lock plate, ... — the top one of ui/overlayStack.ts, one
 * per press), then the menu (it sits on top of everything and closes the others as it opens), then
 * the 조교 dialogue, then the player roster — and when nothing is open it opens the menu.
 * (A focused text field lets go of the keyboard before any of this: see escape.ts.)
 * Nothing else listens for Esc to close a panel.
 */
export function resolveEscape(s: {
  overlayOpen: boolean;
  npcOpen: boolean;
  rosterOpen: boolean;
  menuOpen: boolean;
}): EscapeAction {
  if (s.overlayOpen) return "closeOverlay";
  if (s.menuOpen) return "closeMenu";
  if (s.npcOpen) return "closeNpc";
  if (s.rosterOpen) return "closeRoster";
  return "openMenu";
}

/**
 * Whether the browser default for this action must be cancelled: Space / Enter
 * would re-activate a button that kept focus, `/` opens Firefox's quick find, and
 * Tab would move focus off the canvas. Roster HIDE (keyup) has no default to cancel.
 */
export function hotkeyPreventsDefault(a: HotkeyAction): boolean {
  return a.type === "jump" || a.type === "openChat" || (a.type === "roster" && a.show);
}

/**
 * Whether the browser default of this keydown must be cancelled even though it is not
 * (or no longer) an action: EVERY plain or Shift Tab press — key-repeats and Shift+Tab
 * included — while nobody holds the keyboard. resolveHotkey drops a repeat (one action
 * per press), so without this a held Tab (after ~0.5 s) or Shift+Tab fell through to the
 * browser, moved focus to the chat toggle / field, froze WASD under the "chat" capture
 * and typed the next W into the chat. Ctrl / Meta / Alt + Tab belong to the browser and
 * the OS; while a UI owner holds the keyboard the field's own focus walk is left alone.
 */
export function keydownCancelsDefault(e: KeyLike, uiCaptured: boolean): boolean {
  return (
    e.type === "keydown" &&
    e.code === "Tab" &&
    !uiCaptured &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey
  );
}

type HotkeyListener = (a: HotkeyAction, e: KeyboardEvent) => void;

/** Boxed so subscribing the same function twice yields two independent entries. */
const subscribers: { fn: HotkeyListener }[] = [];

/** The last key pressed out in the world (trackKey) — reset when the listener is installed. */
let prevKey: PrevKey | null = null;

/** The single shared window handler (keydown + keyup). */
function handleKey(e: KeyboardEvent): void {
  // Only keydown / keyup are ever registered here, so `type` is one of the two.
  const uiCaptured = isUiCaptured();
  const now = performance.now();
  // Resolve BEFORE cancelling: resolveHotkey drops an already-defaultPrevented keydown, and
  // our own preventDefault must not make the action vanish.
  const action = resolveHotkey(e as KeyLike, uiCaptured, followsConsonant(prevKey, now));
  prevKey = trackKey(prevKey, e as KeyLike, uiCaptured, now);
  if ((action && hotkeyPreventsDefault(action)) || keydownCancelsDefault(e as KeyLike, uiCaptured)) {
    e.preventDefault();
  }
  if (!action) return;
  // Snapshot: a subscriber may unsubscribe (or subscribe) while we fan out.
  for (const s of subscribers.slice()) s.fn(action, e);
}

/**
 * Subscribe to resolved hotkey actions; returns the disposer. The window listeners
 * are installed with the first subscriber and removed with the last, so an idle app
 * (entry screen, world torn down) holds no keyboard listener at all.
 */
export function onHotkey(fn: HotkeyListener): () => void {
  const entry = { fn };
  if (subscribers.length === 0) {
    prevKey = null;
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKey);
  }
  subscribers.push(entry);
  return () => {
    const i = subscribers.indexOf(entry);
    if (i === -1) return; // already disposed
    subscribers.splice(i, 1);
    if (subscribers.length === 0) {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKey);
    }
  };
}
