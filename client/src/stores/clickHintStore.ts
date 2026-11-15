import { create } from "zustand";

/**
 * A short line shown for a moment when a click or a tap on the floor cannot take the avatar there (round 9 review: up from
 * a letter chair, a click on the exit planned as "unreachable" and nothing happened — no walk, no word; a first-time visitor
 * felt trapped). The click planner (clickPlan.ts) answers every reachable floor point with a walk; this is for the rest — a
 * pocket no body gets to (behind the desk's counter) — so a click is never met with silence.
 */
export const CLICK_HINT_MS = 2200;

/** The words: plain and calm, with what to do instead. */
export const UNREACHABLE_HINT = "그곳으로는 갈 수 없어요. 가까운 바닥을 눌러 보세요.";

interface ClickHintStore {
  /** The line shown, or null. */
  text: string | null;
  /** Bumped by each show, so the same line shown twice restarts its fade (ClickHint's key). */
  serial: number;
  show: (text: string) => void;
  clear: () => void;
}

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export const useClickHint = create<ClickHintStore>((set) => ({
  text: null,
  serial: 0,
  show: (text) => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      set({ text: null });
    }, CLICK_HINT_MS);
    set((s) => ({ text, serial: s.serial + 1 }));
  },
  clear: () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    set({ text: null });
  },
}));
