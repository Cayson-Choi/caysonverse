/**
 * Typing indicator ("…" over a chat typist), controls-ux Task 12 — the SEND and
 * RECEIVE halves plus the registry. Drawing the "…" is the name tag's job (Task 14).
 *
 * Like a jump, "typing" is a broadcast EVENT, never synced state: the typist's
 * ChatInput turns it ON while the field is non-empty and OFF when it clears / is
 * sent / loses focus; every other screen keeps a TypingRegistry that the name tags
 * read each frame (net/typingSync.ts feeds it).
 *
 * Clock-free like jump.ts / bubbleRegistry: every method takes `now` (ms), so it is
 * testable with injected timestamps. The per-frame path (`isTyping`) allocates
 * nothing; `snapshot` is for the dev/E2E hook only.
 */

import { TYPING_RATE, TYPING_TTL_MS } from "@caysonverse/shared/constants";

/**
 * Minimum gap (ms) between two ONs THIS client sends: the server cap plus 50 ms of
 * network slack. The server keeps a hit that is exactly `windowMs` old, so an ON at
 * exactly +windowMs would be rejected — the heartbeat waits strictly longer. It also
 * stays well inside TYPING_TTL_MS, so a continuous typist's indicator never lapses.
 */
export const TYPING_SEND_INTERVAL_MS = TYPING_RATE.windowMs + 50;

export interface TypingSender {
  /** Call on every input change: `nonEmpty` = the trimmed field has text. */
  onInput(nowMs: number, nonEmpty: boolean): void;
  /** The line was sent, the field blurred or unmounted: OFF, only if currently ON. */
  stop(): void;
}

/**
 * Turns the input's change events into the server's typing messages.
 *  - A non-empty change sends `send(true)` when at least `intervalMs` have passed
 *    since the last ON actually sent (the first one always goes): the first
 *    keystroke, then a heartbeat that keeps the receivers' TTL alive.
 *  - Emptying the field sends `send(false)`, but only while ON.
 *  - `stop()` sends `send(false)`, but only while ON.
 * `lastOnAt` is deliberately NOT reset by an OFF or `stop()`: the server's rate
 * window survives an OFF and a sent chat, so the next ON is always scheduled from
 * the last ON that went out — never sooner, or the server would drop it silently
 * and the receivers would never show it.
 */
export function createTypingSender(
  send: (on: boolean) => void,
  intervalMs: number = TYPING_SEND_INTERVAL_MS,
): TypingSender {
  let on = false;
  let lastOnAt = Number.NEGATIVE_INFINITY;

  return {
    onInput(nowMs, nonEmpty) {
      if (!nonEmpty) {
        if (on) {
          on = false;
          send(false);
        }
        return;
      }
      if (nowMs - lastOnAt >= intervalMs) {
        lastOnAt = nowMs;
        on = true;
        send(true);
      }
    },
    stop() {
      if (!on) return;
      on = false;
      send(false);
    },
  };
}

export class TypingRegistry {
  /** sid -> wall-clock ms of its last ON. */
  private readonly lastOnAt = new Map<string, number>();

  /** `sid` sent an ON at `now` (restarts its TTL). */
  set(sid: string, now: number): void {
    this.lastOnAt.set(sid, now);
  }

  /** Drop `sid` at once (its OFF or chat arrived, or the avatar left). */
  remove(sid: string): void {
    this.lastOnAt.delete(sid);
  }

  /** Drop everyone (room teardown). */
  clear(): void {
    this.lastOnAt.clear();
  }

  /**
   * Whether `sid` is typing at `now`: false once TYPING_TTL_MS have passed since its
   * last ON (the OFF may have been lost). Allocation-free — safe per avatar per frame.
   */
  isTyping(sid: string, now: number): boolean {
    const at = this.lastOnAt.get(sid);
    if (at === undefined) return false;
    if (now - at >= TYPING_TTL_MS) {
      this.lastOnAt.delete(sid);
      return false;
    }
    return true;
  }

  /** Dev/E2E view: every sid still typing at `now`. Allocates — never per frame. */
  snapshot(now: number): string[] {
    const out: string[] = [];
    for (const sid of [...this.lastOnAt.keys()]) {
      if (this.isTyping(sid, now)) out.push(sid);
    }
    return out;
  }
}

/** Process-wide singleton: written by typingSync, read by the name tags. */
export const typingRegistry = new TypingRegistry();
