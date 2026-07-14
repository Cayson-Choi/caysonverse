/**
 * Emoji-reaction registry — the source of truth for which reaction (if any) is
 * currently floating above each player, living OUTSIDE React (like
 * bubbleRegistry). The broadcast handler writes here; each avatar's render
 * loop reads its own entry every frame and drives the float animation from
 * `startedAt`. Clock-free: every method takes `now` (ms) so it is fully
 * testable with injected timestamps (no fake timers).
 *
 * Rules (binding): a newer reaction from the same player REPLACES the active
 * one (new seq, restarted animation clock) — replace-on-new, no queueing. An
 * entry is active for EMOJI_DISPLAY_MS then removed. No visibility cap (unlike
 * speech bubbles): a reaction is a 3s-and-gone effect, not a queue to prune.
 */

import { EMOJI_DISPLAY_MS } from "@caysonverse/shared/constants";

export interface EmojiEntry {
  sid: string;
  /** Index into EMOJIS. */
  index: number;
  /** Wall-clock ms at which this entry started (t=0 for the float animation). */
  startedAt: number;
  /** Monotonic id, bumped on every set — lets the avatar hook detect replacement. */
  seq: number;
}

export class EmojiRegistry {
  private readonly entries = new Map<string, EmojiEntry>();
  private counter = 0;

  /** Show (or replace) `sid`'s reaction with `index`, animation starting at `now`. */
  set(sid: string, index: number, now: number): void {
    this.entries.set(sid, { sid, index, startedAt: now, seq: ++this.counter });
  }

  /** Drop `sid`'s reaction immediately (e.g. the player left). */
  remove(sid: string): void {
    this.entries.delete(sid);
  }

  /** Drop every reaction (room teardown). */
  clear(): void {
    this.entries.clear();
  }

  /** The active reaction for `sid` at `now`, or null (expired / none). */
  get(sid: string, now: number): EmojiEntry | null {
    const entry = this.entries.get(sid);
    if (!entry) return null;
    if (now - entry.startedAt >= EMOJI_DISPLAY_MS) {
      this.entries.delete(sid);
      return null;
    }
    return entry;
  }

  /** Dev/E2E view: every currently-active reaction at `now`. */
  snapshot(now: number): EmojiEntry[] {
    const out: EmojiEntry[] = [];
    for (const sid of [...this.entries.keys()]) {
      const entry = this.get(sid, now);
      if (entry) out.push(entry);
    }
    return out;
  }
}

/** Process-wide singleton driven by the emoji broadcast; read by the avatars. */
export const emojiRegistry = new EmojiRegistry();
