/**
 * The lock plates' pure parts (AI 학교 탈출, Task 19): turning a wheel, typing a digit, cycling a card
 * through the bins, the hold ring's progress, and the words for what a wrong try or a key press says.
 *
 * Everything here is UX only. The server owns the lock's input and the verdict; nothing here knows or
 * works out whether an input is right. A value is the server's shared input: digits lock = the digits,
 * letters lock = one wheel-index digit per wheel (so a wheel holds at most ten positions).
 */

import { COOP_WINDOW_MS, SOLO_HOLD_MS } from "@caysonverse/shared/escape/constants";
import type { EngineEvent, EscapeEventPayload } from "@caysonverse/shared/escape/messages";
import { eulReul } from "./bag";

/** One digit per wheel, so a wheel never has more than this many positions. */
const MAX_WHEEL = 10;

function isAsciiDigit(c: string): boolean {
  return c.length === 1 && c >= "0" && c <= "9";
}

/** The wheel's position at `i` (0 when the character is not a digit). */
function positionAt(value: string, i: number): number {
  const c = value.charAt(i);
  return isAsciiDigit(c) ? c.charCodeAt(0) - 48 : 0;
}

/** Turn wheel `i` of `value` one step (`dir` +1 = next position, -1 = previous), wrapping at `wheelLen`. */
export function spinWheel(value: string, i: number, dir: 1 | -1, wheelLen: number): string {
  const len = Math.min(Math.trunc(wheelLen), MAX_WHEEL);
  if (!Number.isInteger(i) || i < 0 || i >= value.length || !(len >= 1)) return value;
  const next = (((positionAt(value, i) % len) + dir) % len + len) % len;
  return value.slice(0, i) + String(next) + value.slice(i + 1);
}

/** A digits lock's wheel: 0..9, 9 → 0 and 0 → 9. */
export function spinDigit(value: string, i: number, dir: 1 | -1): string {
  return spinWheel(value, i, dir, MAX_WHEEL);
}

/** Move a cursor over `len` wheels one step left (-1) or right (+1); it stops at the ends. */
export function cursorMove(cursor: number, dir: 1 | -1, len: number): number {
  if (len <= 0) return 0;
  return Math.min(len - 1, Math.max(0, cursor + dir));
}

/**
 * A digit typed on the keyboard: it is written at the cursor wheel and the cursor moves on (and stays on the last
 * wheel at the end). Anything that is not a single ASCII digit changes nothing.
 */
export function typeDigit(value: string, cursor: number, d: string): { value: string; cursor: number } {
  const len = value.length;
  const at = len === 0 ? 0 : Math.min(len - 1, Math.max(0, Math.trunc(cursor) || 0));
  if (len === 0 || !isAsciiDigit(d)) return { value, cursor: at };
  return { value: value.slice(0, at) + d + value.slice(at + 1), cursor: Math.min(len - 1, at + 1) };
}

/** Where a tap sends a card next: "" (the tray) → the first bin → the second → back to the tray. */
export function cycleBin(current: string, bins: readonly string[]): string {
  if (bins.length === 0) return "";
  const next = bins.indexOf(current) + 1; // "" or an unknown bin starts at the first one
  return next >= bins.length ? "" : bins[next];
}

/** How much of the hold is done, 0..1. A zero length counts as done, a broken clock as not started. */
export function holdProgress(sinceMs: number, nowMs: number, holdMs: number = SOLO_HOLD_MS): number {
  const p = (nowMs - sinceMs) / holdMs;
  if (Number.isNaN(p) || p <= 0) return 0;
  return p >= 1 ? 1 : p;
}

/** Whole steps a vertical drag of `dy` px has turned a wheel (dragging up = +, towards the next position). */
export function dragSteps(dy: number, stepPx: number): number {
  if (!(stepPx > 0)) return 0;
  const n = Math.trunc(-dy / stepPx);
  return n === 0 ? 0 : n; // never -0
}

/**
 * Locally-made changes that wait for the server to echo them back (a quick second tap must build on the first,
 * not on the old value on screen). An override is settled once the server holds the same value; the same
 * object comes back when nothing settled, so the caller does not render again. A missing server entry reads as "".
 */
export function settleOverrides(
  over: Readonly<Record<string, string>>,
  server: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  let out: Record<string, string> | null = null;
  for (const key of Object.keys(over)) {
    if ((server[key] ?? "") !== over[key]) continue;
    if (out === null) out = { ...over };
    delete out[key];
  }
  return out ?? over;
}

/** What a `wrong` event says. A sort board counts; a card still in the tray is not a wrong try. */
export function wrongText(ev: Extract<EngineEvent, { e: "wrong" }>): string {
  if (ev.unplaced !== undefined && ev.unplaced > 0) return "아직 놓지 않은 카드가 있어요";
  if (ev.wrongCount !== undefined) return `${ev.wrongCount}장이 제자리가 아니에요`;
  return "맞지 않아요. 다시 맞춰 봐요";
}

/** The toast for a coop press — "가람님이 서쪽 열쇠를 잡았어요! 2초 안에 함께 돌려요" — or null for any other event. */
export function coopEventText(
  ev: EscapeEventPayload,
  objects: readonly { id: string; label: string }[],
  members: readonly { sid: string; nickname: string }[],
): string | null {
  if (ev.e !== "coop") return null;
  const who = members.find((m) => m.sid === ev.by)?.nickname ?? "팀원";
  const label = objects.find((o) => o.id === ev.objectId)?.label ?? "열쇠";
  return `${who}님이 ${label}${eulReul(label)} 잡았어요! ${COOP_WINDOW_MS / 1000}초 안에 함께 돌려요`;
}

/** The server's input as exactly `len` wheel positions: padded with 0, cut short, a stray character read as 0. */
export function fitValue(value: string | undefined, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += String(positionAt(value ?? "", i));
  return out;
}
