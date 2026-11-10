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
import { viewState } from "./viewState";

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
   * `prefix`: what a held key before it typed (a lone M / B that turned out to start a word, see stepHeld) — the chat
   * puts it in first, so "ㅡㅡ" / "my" lose nothing to the hold.
   */
  | { type: "typeToChat"; prefix?: string };

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
 * before them (followsConsonant), or by the key after them (stepHeld: ㅡㅡ, ㅠㅠ); a lone R / V there is the hotkey.
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
 * How long (ms) after a consonant key a vowel key still reads as the same word being typed — slow typists included. A
 * key pressed later than this is a key on its own. Review round 3 (2026-11-10): at 600 ms (100 타/분) a slower typist
 * still got the map — "그래" (r m f o), "음" (d m a), "즈" (w m) at 0.6 s a key or slower. A child hunting for each key
 * types ~50 타/분, 1.2 s a key (the slowest pace the e2e plays); 1.5 s leaves 0.3 s for a hesitation on top. Longer
 * would only widen the cost below for little gain: a consonant game key TAPPED (R recenter, E / F interact, a short
 * WASD step) and then M within this gap opens the chat with "m", not the map — the map key is a key on its own after a
 * longer pause, after a held key (walking), or while the map is open (then M always closes it, see handleKey).
 */
export const WORD_GAP_MS = 1500;

/**
 * A consonant key still held when the next key goes down is a held game key (walking with W, turning with Z) — unless
 * the next key came within this many ms: a typist presses the next key a moment before letting go of the last. Review
 * round 3: "그" typed with ㄱ still down 200 ms opened the map at 150 ms; slow typists overlap 200–250 ms. Walking with
 * W held and pressing M a moment later is still the map (the e2e presses it 350 ms into the walk).
 */
export const ROLLOVER_MS = 250;

/**
 * A consonant held longer than this (ms) before it was let go was a game key being held — a step, a turn of the camera
 * — not a letter: a typed press lasts about 0.1 s (slow typists ~0.25 s). Real Chrome marks a longer hold by its
 * auto-repeat too (`plain` false), but only after the repeat delay (0.25–1 s; Windows 0.5 s), and a synthetic key never
 * repeats — without this, walking 0.9 s with W and pressing M 0.3 s after letting go read as "즈".
 */
export const TYPED_PRESS_MAX_MS = 400;

/** What the shared listener remembers of the last key pressed out in the world (while nothing held the keyboard). */
export interface PrevKey {
  code: string;
  /** keydown time, ms (performance.now()). */
  at: number;
  /** Pressed by itself: not an auto-repeat (a held key) and no Ctrl / Alt / Meta. Shift is fine (ㄲ ㄸ ㅃ ㅆ ㅉ). */
  plain: boolean;
  /** Its keyup has been seen. */
  released: boolean;
  /** When that keyup came (ms) — how long the key was held. Absent: not let go yet (or not recorded). */
  upAt?: number;
}

/**
 * The remembered key after one more event (pure): a keydown out in the world replaces it; its own keyup marks it
 * released; a keydown while a field (or an overlay) holds the keyboard forgets it — a letter typed into the chat is no
 * word started out in the world, so the click that left the chat and the M after it open the map as usual.
 */
export function trackKey(prev: PrevKey | null, e: KeyLike, uiCaptured: boolean, now: number): PrevKey | null {
  if (e.type === "keyup") return prev !== null && prev.code === e.code && !prev.released ? { ...prev, released: true, upAt: now } : prev;
  if (uiCaptured) return null;
  return { code: e.code, at: now, plain: !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey, released: false };
}

/**
 * Whether a key pressed at `now` comes right after a consonant key, the way a vowel does in a word being typed:
 * the consonant was pressed by itself, at most WORD_GAP_MS before, and has been let go after a typed press (no longer
 * than TYPED_PRESS_MAX_MS) — or the two overlapped by no more than ROLLOVER_MS (a typist's roll-over; longer, it is a
 * game key being held).
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
  if (gap < 0 || gap > WORD_GAP_MS) return false;
  if (!prev.released) return gap <= ROLLOVER_MS;
  return prev.upAt === undefined || prev.upAt - prev.at <= TYPED_PRESS_MAX_MS;
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
 * Otherwise this says toggleMap / bag — and the shared listener holds that a moment (stepHeld): a line CAN start with
 * ㅡ / ㅠ (ㅡㅡ, ㅠㅠ), and the key after it tells.
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

/**
 * How long (ms) a lone M out in the world waits for the next key before it opens the map. A Korean line CAN start with
 * the vowels ㅡ ㅠ — ㅡㅡ, ㅠㅠ, ㅡㅅㅡ are among the commonest chat lines (review 2026-11-10) — and on Windows they arrive
 * as a plain "m" / "b" with no consonant before them, so that one key cannot tell; the next one can. A double tap is
 * 100–250 ms apart; the map's own fly-up takes 300 ms (OV_BLEND_SEC), so the wait barely shows. A slower second key
 * (up to TAKE_BACK_MS after the first) still makes it a word: the map that opened meanwhile is taken back (stepHeld).
 */
export const VOWEL_HOLD_MS = 300;

/**
 * How long (ms) after a lone M that already opened the map a key that goes on typing still takes the map back (stepHeld:
 * a slow ㅡㅡ, "me too", ㅡㅅㅡ). Review round 3: at 500 ms a slow typist's second key came too late and the map stayed
 * open. The same span as WORD_GAP_MS — the slowest typist's next key (1.2 s) plus a hesitation — so the map never
 * stands open longer than this because of typing. The price: an M that closes the map sooner than this after it opened
 * reads as ㅡㅡ — the map closes all the same, and the chat opens with "mm". Later, M just closes it.
 */
export const TAKE_BACK_MS = WORD_GAP_MS;

/**
 * How long (ms) a lone B waits: longer than the map's wait, because in a classroom the bag takes the keyboard as it opens
 * (an overlay, the first chip focused), so a second ㅠ could never reach the table to close it again; elsewhere B does
 * nothing anyway. 0.6 s (100 타/분) — the bag still answers B in well under a second.
 */
export const BAG_HOLD_MS = 600;

/** How long a held key waits before it acts: the map VOWEL_HOLD_MS (a toggle: TAKE_BACK_MS can still take it back), the bag BAG_HOLD_MS. */
export function heldKeyWaitMs(action: HotkeyAction): number {
  return action.type === "bag" ? BAG_HOLD_MS : VOWEL_HOLD_MS;
}

/** A lone M / B held back (stepHeld): the action it will take, the letter it typed, when (ms). */
export interface HeldKey {
  action: HotkeyAction;
  char: string;
  at: number;
  /**
   * The wait ran out and the action was taken (the map is opening). Until TAKE_BACK_MS after `at`, a key that goes on
   * typing (goesOnTyping) still makes the M the start of a word: the action is taken again (a toggle: the map closes)
   * and the chat opens with the letter.
   */
  acted?: boolean;
}

/** One key through the hold: what to remember, and the actions to hand the subscribers now, in order. */
export interface HeldStep {
  held: HeldKey | null;
  out: HotkeyAction[];
}

/**
 * Keys that leave a held M / B as it is: a bare Shift (ㅡ_ㅡ, a capital next), Ctrl / Alt / Meta on their way to a chord,
 * Caps Lock and the 한/영 / 한자 keys (a player switching modes before typing on).
 */
function isNeutralKey(e: KeyLike): boolean {
  return (
    /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(e.code) ||
    e.code === "CapsLock" ||
    e.code === "Lang1" ||
    e.code === "Lang2" ||
    e.key === "HangulMode" ||
    e.key === "HanjaMode"
  );
}

/**
 * The keys that keep their own job right after a lone M / B: walking (WASD, the arrows, Shift), jumping (Space), the chat
 * (Enter, /), the menu (Esc) and the roster (Tab) — M then one of these is the map, and that key.
 */
const KEEP_JOB_CODES: ReadonlySet<string> = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "ShiftLeft", "ShiftRight",
  "Space", "Enter", "NumpadEnter", "Slash", "Escape", "Tab",
]);

/**
 * Whether a key after a lone M / B goes on typing the line that M / B started (ㅡㅡ, ㅡㅅㅡ, "my", "me too"): a press
 * of its own (no repeat, no chord, not consumed elsewhere) that types something and keeps no job of its own
 * (KEEP_JOB_CODES). The letter hotkeys E F (interact), R (recenter), V (view), Z C (the camera turn), the digits (emoji)
 * included — review round 3: inside such a line they are its letters ("me too" opened the map, then E interacted).
 */
function goesOnTyping(e: KeyLike): boolean {
  return (
    !e.repeat &&
    !e.isComposing &&
    !e.defaultPrevented &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    typesText(e) &&
    !KEEP_JOB_CODES.has(e.code)
  );
}

/**
 * Whether this keydown's action is held back instead of taken: a plain latin M / B (the map / the bag) out in the world —
 * typed by itself (no IME at work: that is typing already, see resolveHotkey), so it may be ㅡ / ㅠ starting a line.
 */
function isHeldVowel(e: KeyLike, action: HotkeyAction | null): boolean {
  return (
    action !== null &&
    (action.type === "toggleMap" || action.type === "bag") &&
    VOWEL_HOTKEY_CODES.has(e.code) &&
    typesText(e) &&
    !isImeKey(e)
  );
}

/**
 * The shared listener's hold on a lone M / B (pure; the timer lives in handleKey): given what is held, one key event and
 * the action resolveHotkey found for it, what to hold now and which actions to hand out at once.
 *  - A lone plain M / B is held — nothing happens yet; it acts when its wait runs out (heldKeyWaitMs, handleKey). Not an
 *    M while the map is OPEN (`mapOpen`): there M is the map's own close key and acts at once — nobody types ㅡ while
 *    looking at the map, and walking on the map with a short step and then M must close it (not read as "즈").
 *  - The next key goes on TYPING (goesOnTyping) — another M / B (ㅡㅡ, ㅠㅠ), any typed key that is no game key
 *    (ㅡㅅㅡ, ㅡ.ㅡ, "my"), and the letter hotkeys E F R V Z C and the digits too ("me too") — so the M / B started a
 *    word: one typeToChat carrying the held letter (`prefix`); the map / bag never open, the key's own job is not done.
 *  - Any other key (WASD, the arrows, Space, Enter, /, Esc, Tab, an auto-repeat, a chord): M was the map after all — it
 *    acts AT ONCE, then that key does its own job. So M-then-walk never waits.
 *  - After the wait ran out (`acted`: the map is opening), up to TAKE_BACK_MS after the press: a key that goes on typing
 *    (a slow ㅡㅡ, "me too", ㅡㄹ) takes the map back — the toggle once more — and opens the chat with the letter; any
 *    other key just does its own job (the map stays: walking on it, Enter to chat on it). Later than that, the M is long
 *    done and the key is a key on its own. So the map never stands open longer than TAKE_BACK_MS because of typing.
 *  - A bare modifier / 한영 key changes nothing; a key while something took the keyboard meanwhile (a click into a
 *    field) drops the held action — no map opening under the chat, nothing taken back.
 * Keyups pass straight through.
 */
export function stepHeld(
  held: HeldKey | null,
  e: KeyLike,
  action: HotkeyAction | null,
  uiCaptured: boolean,
  now: number,
  mapOpen = false,
): HeldStep {
  const own = action ? [action] : [];
  if (e.type === "keyup") return { held, out: own };
  if (held?.acted && now - held.at > TAKE_BACK_MS) held = null; // long done: this key is a key on its own
  const out: HotkeyAction[] = [];
  if (held !== null) {
    if (isNeutralKey(e)) return { held, out: own };
    if (uiCaptured) return { held: null, out: own };
    if (goesOnTyping(e)) {
      const chat: HotkeyAction = { type: "typeToChat", prefix: held.char };
      return { held: null, out: held.acted ? [held.action, chat] : [chat] };
    }
    if (!held.acted) out.push(held.action);
  }
  if (action !== null && !uiCaptured && isHeldVowel(e, action) && !(mapOpen && action.type === "toggleMap"))
    return { held: { action, char: e.key as string, at: now }, out };
  return { held: null, out: [...out, ...own] };
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

/** The lone M / B being held (stepHeld), the keydown that started it, and the timer that lets it act. */
let held: HeldKey | null = null;
let heldEvent: KeyboardEvent | null = null;
let heldTimer: ReturnType<typeof setTimeout> | null = null;

/** Hand one action to every subscriber. Snapshot: a subscriber may unsubscribe (or subscribe) while we fan out. */
function fanOut(action: HotkeyAction, e: KeyboardEvent): void {
  for (const s of subscribers.slice()) s.fn(action, e);
}

/** Forget the held key (and its timer) without acting on it. */
function dropHeld(): void {
  if (heldTimer !== null) clearTimeout(heldTimer);
  held = null;
  heldEvent = null;
  heldTimer = null;
}

/**
 * Hold `next` (from this keydown `e`) until its wait runs out (heldKeyWaitMs) — then it acts, unless something took the
 * keyboard meanwhile (a click into the chat: no map under it), and stays remembered as `acted` until TAKE_BACK_MS (a
 * slow second key can still take it back, stepHeld).
 */
function holdKey(next: HeldKey, e: KeyboardEvent): void {
  dropHeld();
  held = next;
  heldEvent = e;
  heldTimer = setTimeout(() => {
    const h = held;
    const ev = heldEvent;
    dropHeld();
    if (!h || !ev || isUiCaptured()) return;
    fanOut(h.action, ev);
    if (subscribers.length > 0) held = { ...h, acted: true };
  }, heldKeyWaitMs(next.action));
}

/** The single shared window handler (keydown + keyup). */
function handleKey(e: KeyboardEvent): void {
  // Only keydown / keyup are ever registered here, so `type` is one of the two.
  const uiCaptured = isUiCaptured();
  const now = performance.now();
  // The map is open (the overview): M is its close key — never the ㅡ of a word, and never held (stepHeld).
  const mapOpen = viewState.mode === "ov";
  // Resolve BEFORE cancelling: resolveHotkey drops an already-defaultPrevented keydown, and
  // our own preventDefault must not make the action vanish.
  const action = resolveHotkey(e as KeyLike, uiCaptured, !mapOpen && followsConsonant(prevKey, now));
  prevKey = trackKey(prevKey, e as KeyLike, uiCaptured, now);
  const step = stepHeld(held, e as KeyLike, action, uiCaptured, now, mapOpen);
  if (step.held !== held) {
    if (step.held === null) dropHeld();
    else holdKey(step.held, e);
  }
  // The key's OWN action decides the default: a held M cancels nothing, and neither does the typeToChat it may turn into
  // (the letter must land in the field), while the Enter that follows a held M still does.
  if ((action && hotkeyPreventsDefault(action)) || keydownCancelsDefault(e as KeyLike, uiCaptured)) {
    e.preventDefault();
  }
  for (const a of step.out) fanOut(a, e);
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
    dropHeld();
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKey);
  }
  subscribers.push(entry);
  return () => {
    const i = subscribers.indexOf(entry);
    if (i === -1) return; // already disposed
    subscribers.splice(i, 1);
    if (subscribers.length === 0) {
      dropHeld(); // a world torn down never opens a map afterwards
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKey);
    }
  };
}
