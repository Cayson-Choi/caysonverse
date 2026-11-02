import { useEffect, useState } from "react";
import type { EscapedEvent } from "@caysonverse/shared/escape/messages";
import { useEscapeStore } from "../stores/escapeStore";
import type { DialogueQueue } from "./dialogue";
import {
  ESCAPE_DONE_MS,
  ESCAPE_LINES_AT_MS,
  FINISH_START,
  escapeClock,
  escapeDialogue,
  escapeTimeline,
  stepFinish,
  type EscapeStart,
} from "./escapeTimeline";
import { prefersReducedMotion } from "./reducedMotion";
import type { VeilMode } from "./ui/EscapeVeil";

/** The escape event is normally a moment behind the state; past this long without it the card opens without it (the way out must exist). */
const SUMMARY_WAIT_MS = 8000;
/** How often the show looks at its clock for the story and the card (the 3D parts read the clock per frame themselves). */
const TICK_MS = 100;

export interface EscapeFinish {
  /** The faded room (`idle`), the escape playing (`live`), or a player who came in after it (`replay`). */
  mode: VeilMode;
  /** The summary card is up. */
  card: boolean;
  /** What the card shows; null = the escape event never came (only the way out is offered). */
  summary: EscapedEvent | null;
}

const IDLE: EscapeFinish = Object.freeze({ mode: "idle", card: false, summary: null });

/**
 * The end of the game as a sequence (AI 학교 탈출, Task 20), for the classroom scene's lifetime:
 *   the team escapes → the show's clock starts (the door glows and opens, the light pours in, the room
 *   gets its colours back — escapeTimeline.ts, read by the door, EscapeFx and the veil) → at 4200 ms
 *   Ari wakes and tells the escape lines in the story box → when the box is empty, the summary card.
 *
 * A player who was watching the game gets all of it ("live"); one who comes in after the escape (a refresh,
 * the server re-sends the event) gets the open door and the card at once ("replay"). With "reduce motion"
 * the show is skipped to its end, and Ari still speaks. The clock is stopped when the scene goes.
 */
export function useEscapeFinish(queue: DialogueQueue): EscapeFinish {
  const [state, setState] = useState<EscapeFinish>(IDLE);

  useEffect(() => {
    let mem = FINISH_START;
    let pushed = false;
    let shownCard = false;
    let tickId = 0;
    let waitId = 0;

    const stopTick = (): void => {
      if (tickId !== 0) window.clearInterval(tickId);
      tickId = 0;
    };

    const openCard = (summary: EscapedEvent | null, mode: VeilMode): void => {
      shownCard = true;
      setState({ mode, card: true, summary });
    };

    const tick = (summary: EscapedEvent): void => {
      const t = escapeClock.elapsed(performance.now());
      if (!pushed && escapeTimeline(t).showLines) {
        pushed = true;
        queue.push(escapeDialogue(summary.lines));
      }
      if (escapeTimeline(t, pushed && queue.size() === 0).showSummary) {
        stopTick();
        setState((s) => ({ ...s, card: true }));
        shownCard = true;
      }
    };

    const begin = (start: EscapeStart, summary: EscapedEvent): void => {
      window.clearTimeout(waitId);
      waitId = 0;
      if (shownCard) {
        // The way out was already offered without the event; now the card gets its words.
        setState((s) => ({ ...s, summary }));
        return;
      }
      if (start === "replay") {
        escapeClock.start(performance.now(), ESCAPE_DONE_MS);
        openCard(summary, "replay");
        return;
      }
      // The close-up (if one is open) would hide the show.
      useEscapeStore.getState().setInspect(null);
      escapeClock.start(performance.now(), prefersReducedMotion() ? ESCAPE_LINES_AT_MS : 0);
      setState({ mode: "live", card: false, summary });
      tickId = window.setInterval(() => tick(summary), TICK_MS);
      tick(summary);
    };

    const sync = (s: ReturnType<typeof useEscapeStore.getState>): void => {
      const phase = s.view ? s.view.phase : null;
      const r = stepFinish(mem, { phase, hasSummary: s.summary !== null });
      mem = r.next;
      if (r.start !== null && s.summary !== null) {
        begin(r.start, s.summary);
        return;
      }
      // Escaped, and the event is late: do not leave the player without a way out.
      if (phase === "escaped" && s.summary === null && waitId === 0 && !shownCard) {
        waitId = window.setTimeout(() => {
          if (useEscapeStore.getState().summary === null) {
            escapeClock.start(performance.now(), ESCAPE_DONE_MS);
            openCard(null, "replay");
          }
        }, SUMMARY_WAIT_MS);
      }
    };

    sync(useEscapeStore.getState());
    const off = useEscapeStore.subscribe(sync);
    return () => {
      off();
      stopTick();
      window.clearTimeout(waitId);
      escapeClock.stop();
    };
  }, [queue]);

  return state;
}
