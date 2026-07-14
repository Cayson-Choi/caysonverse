/**
 * Speech-bubble registry — the source of truth for which chat bubble (if any) is
 * currently shown above each player, living OUTSIDE React (like remoteStore).
 * The broadcast handler writes here; each avatar's render loop reads its own
 * entry every frame. Clock-free: every method takes `now` (ms) so it is fully
 * testable with injected timestamps (no fake timers).
 *
 * Rules (binding):
 *  - a newer message from the same player REPLACES the current bubble (new seq,
 *    refreshed TTL),
 *  - a bubble is visible for SPEECH_BUBBLE_MS then removed,
 *  - at most MAX_VISIBLE_BUBBLES are visible at once; the oldest beyond that are
 *    hidden (not deleted — they simply return null until they expire or the
 *    active set shrinks).
 */

import { SPEECH_BUBBLE_MS, MAX_VISIBLE_BUBBLES } from "@caysonverse/shared/constants";

export interface BubbleEntry {
  sid: string;
  text: string;
  /** Wall-clock ms at which this bubble stops being visible. */
  expiresAt: number;
  /** Monotonic id, bumped on every set — lets followers re-rasterize only on change. */
  seq: number;
}

export class BubbleRegistry {
  private readonly entries = new Map<string, BubbleEntry>();
  private counter = 0;

  /** Show (or replace) `sid`'s bubble with `text`, visible from `now`. */
  set(sid: string, text: string, now: number): void {
    this.entries.set(sid, {
      sid,
      text,
      expiresAt: now + SPEECH_BUBBLE_MS,
      seq: ++this.counter,
    });
  }

  /** Drop `sid`'s bubble immediately (e.g. the player left). */
  remove(sid: string): void {
    this.entries.delete(sid);
  }

  /** Drop every bubble (room teardown). */
  clear(): void {
    this.entries.clear();
  }

  /** The visible bubble for `sid` at `now`, or null (expired / evicted / none). */
  get(sid: string, now: number): BubbleEntry | null {
    this.prune(now);
    const entry = this.entries.get(sid);
    if (!entry) return null;
    if (this.entries.size > MAX_VISIBLE_BUBBLES && !this.isVisible(entry)) return null;
    return entry;
  }

  /** Dev/E2E view: every currently-visible bubble at `now`. */
  snapshot(now: number): BubbleEntry[] {
    this.prune(now);
    const all = [...this.entries.values()];
    if (all.length <= MAX_VISIBLE_BUBBLES) return all;
    return all.sort((a, b) => a.seq - b.seq).slice(all.length - MAX_VISIBLE_BUBBLES);
  }

  /** Delete expired entries (visible while now < expiresAt). */
  private prune(now: number): void {
    for (const [sid, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(sid);
    }
  }

  /** True when `entry` is among the newest MAX_VISIBLE_BUBBLES by seq. */
  private isVisible(entry: BubbleEntry): boolean {
    let newer = 0;
    for (const other of this.entries.values()) {
      if (other.seq > entry.seq && ++newer >= MAX_VISIBLE_BUBBLES) return false;
    }
    return true;
  }
}

/** Process-wide singleton driven by the chat broadcast; read by the avatars. */
export const bubbleRegistry = new BubbleRegistry();
