/**
 * What an Esc press does in the world (controls-ux Task 15) — the glue between the
 * pure decision (`resolveEscape`, hotkeys.ts) and the stores / DOM it acts on.
 * MenuPanel subscribes to the shared hotkey table's `menu` action and calls
 * `handleEscape`; nothing else reacts to Esc, so the order cannot drift:
 *
 *   1. a text field outside the 조교 dialogue has the keyboard → it lets go (blur) and
 *      that is all. (The world chat input handles its own Esc, which the hotkey table
 *      already drops as consumed; this covers the admin announce field and the like.)
 *   2. otherwise the topmost open thing closes — 조교 dialogue, roster, menu — or, with
 *      nothing open, the menu opens.
 *
 * The 조교 dialogue is the exception to rule 1: its own input is part of the dialogue,
 * so one Esc closes the whole dialogue even while you are typing in it (as it always did).
 */

import { useNpcStore } from "../stores/npcStore";
import { useUiStore } from "../stores/uiStore";
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

/** Run one Esc press. */
export function handleEscape(): void {
  const npcOpen = useNpcStore.getState().activeNpc !== null;
  if (!npcOpen && blurTextEntry(document.activeElement as FocusLike | null)) return;

  const ui = useUiStore.getState();
  switch (resolveEscape({ npcOpen, rosterOpen: ui.rosterOpen, menuOpen: ui.menuOpen })) {
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
      ui.setMenuOpen(true);
      break;
  }
}
