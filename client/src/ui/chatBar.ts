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
import type { Rect } from "../game/hud";

/**
 * What a keydown inside the focused chat field does. "sendAfterIme": an Enter the IME handled after it had already
 * committed the syllable (Safari) — send the line once the IME has settled, i.e. right after this event. "consume": the
 * IME's own key (Safari's 229 Escape, which only drops the syllable) — keep it from the window's hotkeys, do nothing else.
 */
export type ChatKeyAction = "send" | "sendAfterIme" | "leave" | "consume" | null;

/** The bits of a keydown this reads — lets tests pass plain objects. */
export interface ChatKeyLike {
  key: string;
  /** True while an IME (Hangul) composition is in progress: the IME owns the key. */
  isComposing: boolean;
  /**
   * 229 while an IME handles the key. Safari reports the Enter that COMMITS a Hangul syllable with keyCode 229 but
   * isComposing false (it ends the composition BEFORE the keydown). Optional so tests can leave it out.
   */
  keyCode?: number;
  /** An auto-repeat of a held key. Optional so tests can leave it out. */
  repeat?: boolean;
}

/** What the bar remembers about an IME Enter's send (ChatInput.tsx) — so one press never acts twice. */
export interface ChatKeyContext {
  /** A sendAfterIme is queued and has not run yet. */
  imeSendQueued?: boolean;
  /** ms since an IME Enter's send went out (absent: none lately). */
  sinceImeSend?: number;
  /**
   * What the composition that ended right before this key committed (compositionend's data; absent: none since the last
   * key). Safari's 229 Enter after a commit with no Hangul in it only confirmed a conversion (Japanese / Chinese).
   */
  lastCommit?: string;
}

/** Hangul jamo / compatibility jamo / syllables. */
const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-퟿]/;

/**
 * How long (ms) after an IME Enter's send another Enter keydown still belongs to that same press: a browser that also
 * sends the plain Enter (keyCode 13) after its 229 one would otherwise land on the field the send just emptied and read
 * as "empty Enter = leave". A person cannot press Enter twice this fast.
 */
export const IME_ENTER_TAIL_MS = 150;

/** Whether `line` has anything besides whitespace — exactly what sendChat (and the server) would accept. */
export function hasChatText(line: string): boolean {
  return line.trim().length > 0;
}

/**
 * Enter with text → "send" (the caller keeps the focus); Enter on an empty or blank field and Escape → "leave" (the
 * caller blurs); anything else → null (the field's own key).
 *  - Nothing during an IME composition (isComposing): the Enter that finishes a Hangul syllable in Chrome / Firefox
 *    belongs to the IME, and the plain Enter right after it sends — acting on the first would send the line and then let
 *    the IME commit its last syllable into the emptied field.
 *  - Safari ends the composition BEFORE the keydown and reports that Enter as keyCode 229 with isComposing false
 *    (WebKit bug 165004). A Korean Enter commits AND sends, so it is not ignored (that made a Korean player press Enter
 *    twice there): "sendAfterIme" — the caller sends after this event, once the committed syllable is in the field.
 *    Unless what was just committed has no Hangul in it (`lastCommit`): a Japanese / Chinese Enter only confirms the
 *    conversion — nothing, as before. An Escape the IME handled (229) only drops the syllable: "consume" — review
 *    round 3: left alone it bubbled up to the window's hotkey table, which took it for the menu key, and the menu's
 *    Escape blurred the chat (escape.ts) and could open the menu. A second, plain Escape leaves as always.
 *  - One press never acts twice: no Enter while an IME send is queued, and an empty-field Enter within
 *    IME_ENTER_TAIL_MS of one is its tail, not a "leave". Nothing on an auto-repeat either: an Enter held a little too
 *    long after sending would otherwise repeat onto the field the send just emptied and read as "empty Enter = leave".
 */
export function chatKeyAction(e: ChatKeyLike, line: string, ctx: ChatKeyContext = {}): ChatKeyAction {
  if (e.isComposing || e.repeat) return null;
  if (e.key === "Escape") return e.keyCode === 229 ? "consume" : "leave";
  if (e.key !== "Enter" || ctx.imeSendQueued) return null;
  if (e.keyCode === 229) return ctx.lastCommit && !HANGUL.test(ctx.lastCommit) ? null : "sendAfterIme";
  if (hasChatText(line)) return "send";
  return ctx.sinceImeSend !== undefined && ctx.sinceImeSend < IME_ENTER_TAIL_MS ? null : "leave";
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
 * nothing holds the keyboard) may open the chat with it. Not while another text field has the caret.
 */
export function typeToChatAllowed(s: { otherFieldFocused: boolean }): boolean {
  return !s.otherFieldFocused;
}

/**
 * The letter a held key typed (hotkeys.ts stepHeld: the first m of "ㅡㅡ") goes into the field at the caret, replacing a
 * selection, ahead of the key that opened the chat. Returns the new value and caret, or null when it would not fit.
 */
export function insertPrefix(
  value: string,
  selStart: number,
  selEnd: number,
  prefix: string,
  maxLength: number,
): { value: string; caret: number } | null {
  const a = Math.max(0, Math.min(selStart, selEnd, value.length));
  const b = Math.max(a, Math.min(Math.max(selStart, selEnd), value.length));
  const next = value.slice(0, a) + prefix + value.slice(b);
  if (next.length > maxLength) return null;
  return { value: next, caret: a + prefix.length };
}

/**
 * Extra wait (ms) on top of the server's chat window before the client lets one more line go: the server times a line
 * when it ARRIVES, and the network can bring two lines closer together than they were sent.
 */
export const CHAT_PACE_SLACK_MS = 500;

/**
 * How long (ms) from `now` until one more line may go, given when this client's recent lines went (`sentAt`, any
 * order); 0 when it may go now. The server keeps at most CHAT_RATE.count lines per CHAT_RATE.windowMs (a line exactly
 * windowMs old still counts) and DROPS the next one with a notice — after the field was cleared, so that line was lost.
 * Now that the chat stays open, quick back-and-forth reaches the cap easily; the client holds such a line back instead.
 */
export function chatPaceWaitMs(sentAt: readonly number[], now: number, slackMs: number = CHAT_PACE_SLACK_MS): number {
  const span = CHAT_RATE.windowMs + slackMs;
  const recent = sentAt.filter((t) => now - t <= span).sort((x, y) => x - y);
  if (recent.length < CHAT_RATE.count) return 0;
  // The line that has to leave the window: once it is out, only count - 1 recent lines remain.
  const blocker = recent[recent.length - CHAT_RATE.count];
  return Math.floor(blocker + span - now) + 1;
}

/** Whether one more line may go out at `now` (ms) — see chatPaceWaitMs. */
export function chatPaceAllows(sentAt: readonly number[], now: number, slackMs: number = CHAT_PACE_SLACK_MS): boolean {
  return chatPaceWaitMs(sentAt, now, slackMs) === 0;
}

/** One press of Enter / the send button against the pace: go, or stay held (until when), and whether to say so. */
export interface PaceDecision {
  send: boolean;
  /** Put the "too fast" notice in the log — only the first refused press of a hold (review: it piled up once per press). */
  notice: boolean;
  /** Held until this time (ms), when the line may go; null when it goes now. */
  until: number | null;
}

/** Decide one press: `heldUntil` is the running hold (null: none) — a press during it adds no second notice. */
export function paceSend(sentAt: readonly number[], now: number, heldUntil: number | null): PaceDecision {
  const wait = chatPaceWaitMs(sentAt, now);
  if (wait === 0) return { send: true, notice: false, until: null };
  const running = heldUntil !== null && now < heldUntil;
  return { send: false, notice: !running, until: now + wait };
}

/**
 * How long (ms) after the finger of a press that left the chat lifted, its click may still come. A phone fires a tap's
 * click right after the finger lifts (no double-tap delay with width=device-width); 400 ms also covers the old
 * ~300–350 ms delay, and the HUD is still back at once.
 */
export const LEAVE_TAP_CLICK_MS = 400;

/** The longest (ms) a press that left the chat keeps the HUD in its chat layout while its finger is still down — a
 *  pointerup that never came (the window lost focus mid-press), a finger that stays put. */
export const LEAVE_TAP_HOLD_MAX_MS = 5000;

/**
 * How far (px) the finger of a press that left the chat may travel and still be a tap that produces a click. Further, it
 * is a drag (the joystick walking, the camera turning) — no browser fires a click for it: Chrome drops a tap past its
 * touch slop (8 dp on Android, 15 px elsewhere), and UIKit's tap, the most lenient, allows about 45 pt. 48 px (the HUD's
 * own touch minimum) is past them all, so once a press has gone this far nothing can land on a button that comes back.
 */
export const LEAVE_TAP_DRAG_PX = 48;

/** The press (pointerdown outside the bar) that took the caret out of the chat, until it is over. */
export interface LeaveTap {
  pointerId: number;
  /** Where it went down (client px). */
  x: number;
  y: number;
  /** Its finger (button) has lifted: what remains is the click it may still produce. */
  up: boolean;
}

/** What happens around a leave tap (ChatInput listens on the window, capture phase). */
export type LeaveTapEvent =
  /** `near`: it went down within LEAVE_TAP_DRAG_PX of a control that comes back with the HUD (pressNearAny). */
  | { type: "press"; pointerId: number; x: number; y: number; near: boolean }
  | { type: "pointermove"; pointerId: number; x: number; y: number }
  | { type: "pointerup"; pointerId: number }
  | { type: "pointercancel"; pointerId: number }
  | { type: "click" }
  | { type: "timeout" }
  | { type: "focus" };

/** A leave tap after one event, and its fallback timer: (re)start it with `timerMs`, stop it (null), or leave it (absent). */
export interface LeaveTapStep {
  tap: LeaveTap | null;
  timerMs?: number | null;
}

/**
 * The HUD keeps its chat layout (the 💬 button away, the emoji fan / action / jump buttons hidden: cv-chat-focus) until
 * the tap that left the chat is over (pure; ChatInput keeps the state and the timer).
 *
 * Only a press that went down NEAR such a control (`near`: within LEAVE_TAP_DRAG_PX of the 💬 / jump / action / emoji
 * buttons, an open emoji fan's buttons or the guide card — pressNearAny) can have its click land on one: a tap's click is aimed within a tap's slop
 * of where it went down. Any other press (the joystick on the other half, the view away from the cluster) ends the chat
 * layout at once — review round 5: a joystick walk at a normal pace (the thumb 8–50 px out) that left the chat kept the
 * jump / action buttons hidden until the thumb lifted, up to LEAVE_TAP_HOLD_MAX_MS.
 *
 * Why (review round 3, phones): the tap that leaves blurs the field at its pointerdown — the keyboard must go, and the
 * tap still does what it does on the 3D view (click-to-move, the camera) — and the HUD used to come back right then,
 * before the finger lifted. The browser aims a tap's click when the finger LIFTS, so that same tap's click landed on a
 * button that had just come back: where 💬 sits, the chat was left and entered again (the keyboard popped up again);
 * where the emoji fan / the action button sit, they fired. Holding the layout until the click has gone to what was
 * under the finger (or a moment after the lift when no click comes, or a cancel) means nothing appears under a finger.
 *  - press: the tap starts; the field blurs right after (ChatInput), and the bar folds away at once (it cannot be hit).
 *  - pointermove of that finger, further than LEAVE_TAP_DRAG_PX from where it went down: a drag, which produces no
 *    click — over at once, while the finger is still down (review round 4: a joystick walk that left the chat kept the
 *    jump / action buttons hidden until the thumb lifted, up to LEAVE_TAP_HOLD_MAX_MS).
 *  - pointerup of that finger: wait LEAVE_TAP_CLICK_MS for its click.
 *  - click: over right AFTER it (a 0 ms timer) — the click has gone to what was there in the chat layout.
 *  - pointercancel of that finger (a scroll, a system gesture: no click will come), the timer, the chat taking the caret
 *    again: over.
 * Other fingers, and a click before the finger lifted, change nothing.
 */
export function leaveTapStep(tap: LeaveTap | null, ev: LeaveTapEvent): LeaveTapStep {
  if (ev.type === "press") {
    if (ev.near) return { tap: { pointerId: ev.pointerId, x: ev.x, y: ev.y, up: false }, timerMs: LEAVE_TAP_HOLD_MAX_MS };
    return tap === null ? { tap: null, timerMs: null } : { tap }; // nothing it could land on: no layout to hold
  }
  if (ev.type === "timeout" || ev.type === "focus") return { tap: null, timerMs: null };
  if (tap === null) return { tap: null };
  switch (ev.type) {
    case "pointermove":
      return ev.pointerId === tap.pointerId && !tap.up && Math.hypot(ev.x - tap.x, ev.y - tap.y) > LEAVE_TAP_DRAG_PX
        ? { tap: null, timerMs: null }
        : { tap };
    case "pointerup":
      return ev.pointerId === tap.pointerId && !tap.up ? { tap: { ...tap, up: true }, timerMs: LEAVE_TAP_CLICK_MS } : { tap };
    case "pointercancel":
      return ev.pointerId === tap.pointerId ? { tap: null, timerMs: null } : { tap };
    case "click":
      return tap.up ? { tap, timerMs: 0 } : { tap };
  }
}

/**
 * Whether a press at (x, y) went down within `margin` px of any of `rects` (their boxes; a round button's box holds its
 * circle, so this errs on the side of holding the layout). The controls that come back with the HUD (ChatInput): only a
 * press near one of them can produce a click on one — a tap's click is aimed within its slop of where it went down, and
 * LEAVE_TAP_DRAG_PX is past every browser's.
 */
export function pressNearAny(x: number, y: number, rects: readonly Rect[], margin: number = LEAVE_TAP_DRAG_PX): boolean {
  for (const r of rects) {
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
    const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
    if (Math.hypot(dx, dy) <= margin) return true;
  }
  return false;
}

// ──────────────────────────── a chat a take-back opened: only a guess until the player types on ────────────────────────────

/**
 * The chat a take-back opened (hotkeys.ts typeToChat `tentative`: an M had already opened the map when the next key took
 * it back). Review round 5: a quick look at the map — M, a look, M — reads exactly like a slow ㅡㅡ; the map closed, the
 * chat opened with "mm" and the W that followed typed "mmw" while the avatar stood still. So the chat opens (the slow
 * typist's line is in it at once, and Enter sends it), but while the field holds exactly what the take-back typed, a walk
 * key, Escape or a press elsewhere puts the field back as it was and leaves.
 */
export interface TakeBackDraft {
  /** The field's text before the take-back put its letter(s) in. */
  before: string;
  /** The field's text once the key that opened it has typed its own letter too: while it holds exactly this, nothing more was typed. */
  typed: string;
}

/**
 * The draft for a take-back: `inserted` is what insertPrefix made of the field (the held letter at the caret); `key` is
 * what the opening key types (KeyboardEvent.key) — it lands at the caret after the keydown, unless the field is full.
 */
export function takeBackDraft(before: string, inserted: { value: string; caret: number }, key: string | undefined, maxLength: number): TakeBackDraft {
  const ch = key !== undefined && [...key].length === 1 ? key : "";
  const fits = ch !== "" && inserted.value.length + ch.length <= maxLength;
  return { before, typed: fits ? inserted.value.slice(0, inserted.caret) + ch + inserted.value.slice(inserted.caret) : inserted.value };
}

/** The keys that walk (MOVE_KEYS without Shift and the Z / C camera turn: ㅋ ㅊ go on a line — ㅡㅡㅋ). */
const DRAFT_WALK_CODES: ReadonlySet<string> = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);

/**
 * What a keydown in the field does to a take-back draft: "undo" (a walk key — by `code`, so in 한글 mode too, where W
 * reaches the field as Process / 229 — or a plain Escape), "keep" (a bare modifier, Caps Lock, the 한/영 / 한자 keys) or
 * "typing" (anything else: the guess was right, the draft is over — Space, Enter, Backspace, ㅋ, a chord, the IME's own
 * Escape, a key during a composition).
 */
export function draftKey(e: {
  code: string;
  key: string;
  keyCode?: number;
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): "undo" | "keep" | "typing" {
  if (
    /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(e.code) ||
    e.code === "CapsLock" ||
    e.code === "Lang1" ||
    e.code === "Lang2" ||
    e.key === "HangulMode" ||
    e.key === "HanjaMode"
  )
    return "keep";
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return "typing";
  if (e.key === "Escape") return e.keyCode === 229 ? "typing" : "undo";
  return DRAFT_WALK_CODES.has(e.code) ? "undo" : "typing";
}

/** The text to put back when a draft is undone — null when there is none, or something more was typed (or pasted) since. */
export function undoDraft(value: string, d: TakeBackDraft | null): string | null {
  return d !== null && value === d.typed ? d.before : null;
}

// ────────────────────────────── the soft keyboard folded away, the caret still in the field ──────────────────────────────

/** A keyboard at least this tall (px) was up (soft keyboards are 180–350 px; a hardware keyboard's strip ~40–55 px). */
export const KBD_UP_MIN_PX = 120;
/** At most this (px) left of it: folded (a hardware keyboard's suggestion strip, a rounding of the viewport). */
export const KBD_DOWN_MAX_PX = 60;
/** How long (ms) a fold must last before the field lets go — a turn of the phone or a keyboard switch passes through. */
export const KBD_FOLD_SETTLE_MS = 200;
/** A visual viewport zoomed further than this off 1 (pinch): its numbers are the zoom's, not a keyboard's. */
const KBD_ZOOM_EPS = 0.02;

/** One look at the viewport: innerWidth / innerHeight, the keyboard inset of the visual viewport (kbdInset.ts), its scale. */
export interface KbdSample {
  w: number;
  h: number;
  inset: number;
  scale: number;
}

/** What the watch remembers since the field took the caret: the screen's width, its tallest layout height, the tallest keyboard. */
export interface KbdWatch {
  w: number;
  base: number;
  peak: number;
}

/** The watch as the field takes the caret. */
export function kbdWatchStart(s: KbdSample): KbdWatch {
  return { w: s.w, base: s.h, peak: Math.abs(s.scale - 1) > KBD_ZOOM_EPS ? 0 : s.inset };
}

/**
 * One more look (pure; ChatInput samples on every viewport resize while a touch field has the caret). Review round 5
 * (Android): the back key — or the keyboard's own fold key — hides the soft keyboard WITHOUT a blur: the field kept the
 * caret and the HUD stayed in its chat layout (jump / action / emoji hidden, no 💬) until a tap; with Enter keeping the
 * caret, that came after every line. The keyboard's height is the visual viewport's inset (iOS, Android resizes-visual)
 * or how far the layout viewport shrank (resizes-content: many in-app browsers); `folded` once it had been up
 * (KBD_UP_MIN_PX) and is back to ~0 (KBD_DOWN_MAX_PX) — told once, until it is up again. A new width (the phone turned)
 * starts afresh; a zoomed viewport says nothing (`kbd` null).
 */
export function kbdWatchStep(w: KbdWatch, s: KbdSample): { watch: KbdWatch; kbd: number | null; folded: boolean } {
  if (Math.abs(s.scale - 1) > KBD_ZOOM_EPS) return { watch: w, kbd: null, folded: false };
  if (s.w !== w.w) return { watch: { w: s.w, base: s.h, peak: s.inset }, kbd: s.inset, folded: false };
  const base = Math.max(w.base, s.h);
  const kbd = Math.max(s.inset, base - s.h);
  const folded = w.peak >= KBD_UP_MIN_PX && kbd <= KBD_DOWN_MAX_PX;
  return { watch: { w: w.w, base, peak: folded ? 0 : Math.max(w.peak, kbd) }, kbd, folded };
}
