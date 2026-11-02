/**
 * What an Esc press does in the world (controls-ux Task 15) — the glue between the
 * pure decision (`resolveEscape`, hotkeys.ts) and the stores / DOM it acts on.
 * MenuPanel subscribes to the shared hotkey table's `menu` action and calls
 * `handleEscape`; nothing else reacts to Esc, so the order cannot drift:
 *
 *   1. a text field outside the 조교 dialogue has the keyboard → it lets go (blur) and
 *      that is all. (The world chat input handles its own Esc, which the hotkey table
 *      already drops as consumed; this covers the admin announce field and the like.)
 *   2. otherwise the topmost open thing closes — a classroom overlay (the close-up, a lock plate, ...;
 *      the top one of ui/overlayStack.ts), then the menu (it is on top), then the 조교
 *      dialogue, then the roster — or, with nothing open, the menu opens.
 *
 * The 조교 dialogue and an overlay are the exception to rule 1: their own fields are part of them,
 * so one Esc closes the whole dialogue / overlay even while you are typing in it.
 */

import { useNpcStore } from "../stores/npcStore";
import { useUiStore } from "../stores/uiStore";
import { topOverlay } from "../ui/overlayStack";
import { resolveEscape } from "./hotkeys";

/** The bits of a DOM element `isTextEntry` reads — lets tests pass plain objects. */
export interface FocusLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  blur?: () => void;
}

/** `<input>` types that are buttons or pickers, not text — Esc is not "leave this field" for them. */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Whether `el` is something you type text into (input, textarea, contenteditable). */
export function isTextEntry(el: FocusLike | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((el.type ?? "text").toLowerCase());
  return false;
}

/** Let go of the focused text field, if any. Returns whether one was focused. */
export function blurTextEntry(el: FocusLike | null | undefined): boolean {
  if (!isTextEntry(el)) return false;
  el?.blur?.();
  return true;
}

/**
 * Open the menu. It sits on top of everything, so the roster and the 조교 dialogue are
 * closed as it opens (the ☰ button and Esc both come through here) — they would only
 * hide behind the dimmed backdrop and be waiting when the menu closes.
 */
export function openMenu(): void {
  if (useNpcStore.getState().activeNpc !== null) useNpcStore.getState().closePanel();
  const ui = useUiStore.getState();
  ui.setRosterOpen(false);
  ui.setMenuOpen(true);
}

/** Run one Esc press. */
export function handleEscape(): void {
  const overlay = topOverlay();
  const npcOpen = useNpcStore.getState().activeNpc !== null;
  if (!npcOpen && overlay === null && blurTextEntry(document.activeElement as FocusLike | null)) return;

  const ui = useUiStore.getState();
  switch (resolveEscape({ overlayOpen: overlay !== null, npcOpen, rosterOpen: ui.rosterOpen, menuOpen: ui.menuOpen })) {
    case "closeOverlay":
      overlay?.close();
      break;
    case "closeNpc":
      useNpcStore.getState().closePanel();
      break;
    case "closeRoster":
      ui.setRosterOpen(false);
      break;
    case "closeMenu":
      ui.setMenuOpen(false);
      break;
    case "openMenu":
      openMenu();
      break;
  }
}
