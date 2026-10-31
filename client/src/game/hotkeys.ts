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

import { isUiCaptured } from "./uiCapture";

export type HotkeyAction =
  | { type: "jump" }
  | { type: "interact" }
  | { type: "recenter" }
  | { type: "toggleView" }
  | { type: "toggleMap" }
  | { type: "menu" }
  | { type: "openChat" }
  | { type: "emoji"; index: number }
  | { type: "roster"; show: boolean };

/** The bits of a KeyboardEvent the table reads — lets tests pass plain objects. */
export interface KeyLike {
  type: "keydown" | "keyup";
  code: string;
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
  /** Modifier state — optional so plain test objects stay valid; a real KeyboardEvent has all four. */
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** `Digit1`..`Digit6` (the six-emoji palette); capture group = the digit. */
const EMOJI_CODE = /^Digit([1-6])$/;

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
 * reloads, Alt+Tab switches windows, ...), and neither is Shift+Tab (focus walks
 * backwards); Shift on its own is the run key and blocks nothing else.
 * keyup only matters for Tab (roster hide) and is deliberately unconditional: the
 * list must never stay stuck open because the chat grabbed focus mid-hold.
 */
export function resolveHotkey(e: KeyLike, uiCaptured: boolean): HotkeyAction | null {
  if (e.type === "keyup") {
    return e.code === "Tab" ? { type: "roster", show: false } : null;
  }
  if (e.defaultPrevented || e.isComposing || e.repeat) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.shiftKey && e.code === "Tab") return null;
  if (uiCaptured && e.code !== "Escape") return null;

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
      return m ? { type: "emoji", index: Number(m[1]) - 1 } : null; // 1 → EMOJIS[0]
    }
  }
}

/** What one Esc press does (controls-ux Task 15). */
export type EscapeAction = "closeNpc" | "closeRoster" | "closeMenu" | "openMenu";

/**
 * The ONE place that decides what Esc does: it closes the topmost thing that is open —
 * the 조교 dialogue first, then the player roster, then the menu — and when nothing is
 * open it opens the menu. (A focused text field lets go of the keyboard before any of
 * this: see escape.ts.) Nothing else listens for Esc to close a panel.
 */
export function resolveEscape(s: {
  npcOpen: boolean;
  rosterOpen: boolean;
  menuOpen: boolean;
}): EscapeAction {
  if (s.npcOpen) return "closeNpc";
  if (s.rosterOpen) return "closeRoster";
  if (s.menuOpen) return "closeMenu";
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

type HotkeyListener = (a: HotkeyAction, e: KeyboardEvent) => void;

/** Boxed so subscribing the same function twice yields two independent entries. */
const subscribers: { fn: HotkeyListener }[] = [];

/** The single shared window handler (keydown + keyup). */
function handleKey(e: KeyboardEvent): void {
  // Only keydown / keyup are ever registered here, so `type` is one of the two.
  const action = resolveHotkey(e as KeyLike, isUiCaptured());
  if (!action) return;
  if (hotkeyPreventsDefault(action)) e.preventDefault();
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
