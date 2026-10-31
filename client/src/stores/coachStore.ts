import { create } from "zustand";
import { nextCoachStep, type CoachEvent, type CoachStep } from "../game/coach";
import { useSettingsStore } from "./settingsStore";

/**
 * Where the first-visit guide stands (controls-ux Task 17). Discrete UI state — a step
 * changes a few times per visit, never per frame. The move / look measuring runs in
 * CoachMarks (5 Hz, off the frame path) and reports into `report`; the chat input reports
 * a sent line; the card's "건너뛰기" and the menu's "조작 안내 다시 보기" report skip and
 * restart. Every transition is `nextCoachStep`, so an action out of turn changes nothing.
 *
 * The guide starts at ① unless the player has already seen it (`coachDone`, saved with the
 * other settings). Reaching "done" — by finishing or skipping — saves `coachDone: true`, so
 * a reload does not show it again; a restart replays it without clearing that flag (a page
 * reload mid-replay does not bring it back).
 */
interface CoachStore {
  step: CoachStep;
  /**
   * Counts restarts. A restart while ① is already up leaves `step` unchanged, but the
   * distance walked so far must not count towards the replay — CoachMarks begins its
   * measuring afresh whenever `step` or `round` changes.
   */
  round: number;
  report: (ev: CoachEvent) => void;
}

export const useCoachStore = create<CoachStore>((set, get) => ({
  step: useSettingsStore.getState().settings.coachDone ? "done" : "move",
  round: 0,
  report: (ev) => {
    const prev = get().step;
    const next = nextCoachStep(prev, ev);
    if (ev === "restart") {
      set((s) => ({ step: next, round: s.round + 1 }));
      return;
    }
    if (next === prev) return; // an action out of turn, or nothing left to do
    set({ step: next });
    if (next === "done" && !useSettingsStore.getState().settings.coachDone) {
      useSettingsStore.getState().update({ coachDone: true });
    }
  },
}));
