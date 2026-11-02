/**
 * The story lines of a classroom (AI 학교 탈출, Task 17): who says what, and the queue that plays them
 * one after another — the intro lines when the team comes in, then every `say` event of the room.
 * Task 20 pushes the escape lines into the same queue.
 *
 * Plain data and a small class, no React: the DialogueBox ticks it a few times a second and reads
 * `current()`; nothing here runs per frame.
 */

import type { RoomContent } from "@caysonverse/shared/escape/messages";

/** Ari's face: the glitch she starts with, her smile, her thinking, the moment she wakes up. */
export type AriMood = "glitch" | "smile" | "think" | "wake";

export interface DialogueLine {
  speaker: "ari" | "bandit" | "narrator";
  text: string;
  /** Ari's face for this line (only an Ari line uses it). */
  mood?: AriMood;
}

/** A line stays up at least this long, and 90 ms per character beyond that. */
export const MIN_LINE_MS = 2500;
export const MS_PER_CHAR = 90;
/** Lines waiting at most (the showing one included); a flood drops the oldest waiting ones. */
export const MAX_QUEUED = 24;

/** How long a line is shown before the queue moves on by itself: max(2500, characters × 90) ms. */
export function lineDurationMs(text: string): number {
  return Math.max(MIN_LINE_MS, text.length * MS_PER_CHAR);
}

/**
 * First in, first out. The line at the front is the one showing; it leaves on a tap (`advance`) or
 * when `tick` sees it has been up long enough. A line's clock starts at the first `tick` that finds
 * it showing, so the queue never needs a clock of its own.
 */
export class DialogueQueue {
  private lines: DialogueLine[] = [];
  /** When the showing line came up, or null until the next tick sees it. */
  private shownAt: number | null = null;
  private ver = 0;

  /** Add lines at the back. A fresh queue shows the first one at once. */
  push(lines: readonly DialogueLine[]): void {
    if (lines.length === 0) return;
    for (const l of lines) this.lines.push(l);
    // Over the cap: the oldest WAITING lines go, the showing one (index 0) stays.
    if (this.lines.length > MAX_QUEUED) this.lines.splice(1, this.lines.length - MAX_QUEUED);
    this.ver++;
  }

  /** The line showing now, or null. */
  current(): DialogueLine | null {
    return this.lines[0] ?? null;
  }

  /** How many lines are queued, the showing one included. */
  size(): number {
    return this.lines.length;
  }

  /** Changes on every push, advance and clear — a view compares it instead of the lines. */
  version(): number {
    return this.ver;
  }

  /** The showing line is done (a tap): the next one comes up. */
  advance(): void {
    if (this.lines.length === 0) return;
    this.lines.shift();
    this.shownAt = null;
    this.ver++;
  }

  /** Auto-advance: the showing line leaves max(2500, length × 90) ms after the first tick that saw it. */
  tick(nowMs: number): void {
    const line = this.lines[0];
    if (!line) return;
    if (this.shownAt === null) {
      this.shownAt = nowMs;
      return;
    }
    if (nowMs - this.shownAt < lineDurationMs(line.text)) return;
    this.lines.shift();
    this.shownAt = this.lines.length > 0 ? nowMs : null;
    this.ver++;
  }

  /**
   * The showing line gets its full time again, counted from the next tick. For a view that stopped
   * ticking (a cover held the room still): without it the first tick afterwards would find the line
   * "up for a minute" and drop it unseen. Changes nothing a view renders, so no version bump.
   */
  restartClock(): void {
    this.shownAt = null;
  }

  /** Drop everything (a new scene starts quiet). */
  clear(): void {
    if (this.lines.length === 0) return;
    this.lines = [];
    this.shownAt = null;
    this.ver++;
  }
}

/** The room's line with this id, shown with `mood` when Ari says it; null for an unknown or empty one. */
function resolve(content: RoomContent, lineId: string, ariMood: "glitch" | "smile"): DialogueLine | null {
  if (!Object.prototype.hasOwnProperty.call(content.lines, lineId)) return null;
  const line = content.lines[lineId];
  if (!line || typeof line.text !== "string" || line.text === "") return null;
  return line.speaker === "ari"
    ? { speaker: "ari", text: line.text, mood: ariMood }
    : { speaker: line.speaker, text: line.text };
}

/** The intro lines of a room, in order — Ari still glitching. Unknown ids are skipped. */
export function introLines(content: RoomContent): DialogueLine[] {
  const out: DialogueLine[] = [];
  for (const id of content.introLines) {
    const line = resolve(content, id, "glitch");
    if (line) out.push(line);
  }
  return out;
}

/** The line a `say` event names — Ari smiling — or null when the room has no such line. */
export function sayLine(content: RoomContent, lineId: string): DialogueLine | null {
  return resolve(content, lineId, "smile");
}
