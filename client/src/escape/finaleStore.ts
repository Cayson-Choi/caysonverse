import { create } from "zustand";
import type { EscapeEventPayload } from "@caysonverse/shared/escape/messages";
import { FIRST_TRY_START, firstTryReduce, type FirstTry } from "./ui/finale";

/**
 * What the last-door panel (AI 학교 탈출, Task 20) remembers between two events — DISCRETE state only:
 * whether it is open, the card the team just got wrong (and why), how many steps were got right, and what
 * this player watched of the first try. Written by the panel's event feed (`FinalePanel`), read by the panel,
 * the summary card and the door's context button (`useEscapeInteractions` opens it).
 */

export interface FinaleWrong {
  stepId: string;
  optionId: string;
  explain: string;
}

interface FinaleUiState {
  open: boolean;
  /** The card the whole team just chose wrongly, until the next step or the next vote. */
  wrong: FinaleWrong | null;
  /** Grows by one when a step was got right (the "맞았어요!" note replays). */
  rightSeq: number;
  firstTry: FirstTry;

  setOpen: (open: boolean) => void;
  /** Take one room event into account. `firstStepId` is the id of the last door's first step. */
  onEvent: (ev: EscapeEventPayload, firstStepId: string) => void;
  /** A new classroom starts quiet. */
  reset: () => void;
}

export const useFinaleStore = create<FinaleUiState>((set) => ({
  open: false,
  wrong: null,
  rightSeq: 0,
  firstTry: FIRST_TRY_START,

  setOpen: (open) => set((s) => (s.open === open ? s : { open })),
  onEvent: (ev, firstStepId) => {
    switch (ev.e) {
      case "finale":
        // Step 0 is the door opening for the vote (the panel opens after the story box has finished);
        // a later step means the step before it was right.
        set((s) => ({
          firstTry: firstTryReduce(s.firstTry, ev, firstStepId),
          ...(ev.step >= 1 ? { open: true, wrong: null, rightSeq: s.rightSeq + 1 } : {}),
        }));
        return;
      case "finaleWrong":
        set((s) => ({
          open: true,
          wrong: { stepId: ev.stepId, optionId: ev.optionId, explain: ev.explain },
          firstTry: firstTryReduce(s.firstTry, ev, firstStepId),
        }));
        return;
      case "escaped":
        set({ open: false, wrong: null });
        return;
      default:
    }
  },
  reset: () => set({ open: false, wrong: null, rightSeq: 0, firstTry: FIRST_TRY_START }),
}));

/** Open the last-door panel (the door's context button). */
export function openFinale(): void {
  useFinaleStore.getState().setOpen(true);
}
