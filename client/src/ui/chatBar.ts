/**
 * The chat bar's decisions, pure (ChatInput.tsx wires them to the DOM).
 *
 * Owner's ask (2026-11-10): once you are chatting you STAY chatting — Enter sends the line and the
 * caret stays in the field for the next one; a send button at the end of the bar does the same; a
 * press anywhere outside the bar takes the caret out, so WASD / the arrows walk again at once.
 * Enter on an empty field is the keyboard's way back out (like Escape), so a keyboard player never
 * needs the mouse to stop chatting.
 */

import { CHAT_RATE } from "@caysonverse/shared/constants";

/** What a keydown inside the focused chat field does. */
export type ChatKeyAction = "send" | "leave" | null;

/** The bits of a keydown this reads — lets tests pass plain objects. */
export interface ChatKeyLike {
  key: string;
  /** True while an IME (Hangul) composition is in progress: the IME owns the key. */
  isComposing: boolean;
  /**
   * 229 while an IME handles the key. Safari reports the Enter that COMMITS a Hangul syllable with keyCode 229 but
   * isComposing false, so this is the second half of "the IME owns the key". Optional so tests can leave it out.
   */
  keyCode?: number;
  /** An auto-repeat of a held key. Optional so tests can leave it out. */
  repeat?: boolean;
}

/** Whether `line` has anything besides whitespace — exactly what sendChat (and the server) would accept. */
export function hasChatText(line: string): boolean {
  return line.trim().length > 0;
}

/**
 * Enter with text → "send" (the caller keeps the focus); Enter on an empty or blank field and
 * Escape → "leave" (the caller blurs); anything else → null (the field's own key). Nothing at all
 * during an IME composition (isComposing, or keyCode 229 — Safari's committing Enter): the Enter that
 * finishes a Hangul syllable belongs to the IME — acting on it would send the line and then let the IME
 * commit its last syllable into the emptied field (sent again with the next line), or drop it.
 * Nothing on an auto-repeat either — one action per physical press: an Enter held a little too long after
 * sending would otherwise repeat onto the field the send just emptied and read as "empty Enter = leave".
 */
export function chatKeyAction(e: ChatKeyLike, line: string): ChatKeyAction {
  if (e.isComposing || e.keyCode === 229 || e.repeat) return null;
  if (e.key === "Escape") return "leave";
  if (e.key === "Enter") return hasChatText(line) ? "send" : "leave";
  return null;
}

/** Anything that can say whether it holds a node — the chat bar's element (tests pass a stand-in). */
export interface Container {
  contains(node: never): boolean;
}

/**
 * Whether a press (pointerdown) on `target` takes the caret out of the chat: everything outside the
 * bar does — the 3D view, a HUD button, a menu. A press on the field, the send button or the bar
 * itself keeps it. No bar (unmounted) or no target also leaves: the keyboard must never stay in a
 * field nobody can see.
 */
export function pressLeavesChat(target: unknown, bar: Container | null): boolean {
  if (!bar || target === null || target === undefined) return true;
  return !bar.contains(target as never);
}

/**
 * Whether a typed key (the hotkey table's `typeToChat`: a key that types a character and is no game key, pressed while
 * nothing holds the keyboard) may open the world chat with it. Not while the 조교 dialogue is open — a question meant for
 * the assistant must never go out to everyone by accident — and not while another text field has the caret.
 */
export function typeToChatAllowed(s: { npcOpen: boolean; otherFieldFocused: boolean }): boolean {
  return !s.npcOpen && !s.otherFieldFocused;
}

/**
 * Extra wait (ms) on top of the server's chat window before the client lets one more line go: the server times a line
 * when it ARRIVES, and the network can bring two lines closer together than they were sent.
 */
export const CHAT_PACE_SLACK_MS = 500;

/**
 * Whether one more line may go out at `now` (ms), given when this client's recent lines went (`sentAt`, any order).
 * The server keeps at most CHAT_RATE.count lines per CHAT_RATE.windowMs (a line exactly windowMs old still counts)
 * and DROPS the next one with a notice — after the field was cleared, so that line was lost. Now that the chat stays
 * open, quick back-and-forth reaches the cap easily; the client holds such a line back instead (it stays in the field).
 */
export function chatPaceAllows(sentAt: readonly number[], now: number, slackMs: number = CHAT_PACE_SLACK_MS): boolean {
  let recent = 0;
  for (const t of sentAt) if (now - t <= CHAT_RATE.windowMs + slackMs) recent++;
  return recent < CHAT_RATE.count;
}
