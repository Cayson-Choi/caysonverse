/**
 * What the classroom's story box is fed, as a pure decision (AI 학교 탈출, Task 17 review fix): the
 * scene's effect calls `feedDialogue` on every store change and pushes whatever it returns.
 *
 *  - The intro lines play once, and only for a team that is really in its intro phase: a refresh or a
 *    reconnect in the middle of the game must not replay the opening story. (The state decides once
 *    both the room's content and the team's view are here — that moment spends the intro either way.)
 *  - Each `say` event queues the line it names, once. A `hint` event queues Bandit saying it (Task 20) — unless
 *    the team has escaped or the class has ended: a hint that was still on its way (the AI polish step) comes too
 *    late to be told. Every other event is ignored (and consumed).
 */

import type { EscapePhase } from "@caysonverse/shared/escape/constants";
import type { EscapeEventPayload, RoomContent } from "@caysonverse/shared/escape/messages";
import { introLines, sayLine, type DialogueLine } from "./dialogue";

/** What the feed remembers between two calls. */
export interface FeedState {
  /** The intro was decided (played, or skipped because the game was already on). */
  introPushed: boolean;
  /** The last `eventSeq` already looked at. */
  seenEvent: number;
}

/** A scene that mounts with an empty feed. (A scene that mounts later starts `seenEvent` at the store's own counter.) */
export const FEED_START: FeedState = Object.freeze({ introPushed: false, seenEvent: 0 });

/** The slice of the escape store the feed reads: `phase` is null until the team's view has arrived. */
export interface FeedInput {
  content: RoomContent | null;
  phase: EscapePhase | null;
  eventSeq: number;
  lastEvent: EscapeEventPayload | null;
}

export interface FeedResult {
  next: FeedState;
  lines: DialogueLine[];
}

export function feedDialogue(prev: FeedState, i: FeedInput): FeedResult {
  let introPushed = prev.introPushed;
  let seenEvent = prev.seenEvent;
  const lines: DialogueLine[] = [];

  if (!introPushed && i.content !== null && i.phase !== null) {
    introPushed = true;
    if (i.phase === "intro") for (const l of introLines(i.content)) lines.push(l);
  }

  if (i.eventSeq !== seenEvent) {
    seenEvent = i.eventSeq;
    const ev = i.lastEvent;
    if (ev !== null && ev.e === "say" && i.content !== null) {
      const line = sayLine(i.content, ev.lineId);
      if (line) lines.push(line);
    } else if (ev !== null && ev.e === "hint" && i.phase !== "escaped" && i.phase !== "ended") {
      if (typeof ev.text === "string" && ev.text !== "") lines.push({ speaker: "bandit", text: ev.text });
    }
  }

  return { next: { introPushed, seenEvent }, lines };
}
