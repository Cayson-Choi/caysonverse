/**
 * The "상담실로 들어가는 중…" card between the hall and a classroom (AI 학교 탈출, Task 17).
 *
 * classSync raises it the moment the team's ticket arrives (`begin`), marks it `ready` once the
 * classroom connection is up and the classroom scene has been asked for (`enterEscape`), and
 * drops it (`end`) when the join fails. The LoadingTransition component (mounted once, in App)
 * keeps it on screen for at least ENTER_MIN_MS from `begin` — long enough to read — then fades it.
 *
 * Discrete UI state only (three writes per entry); it never carries per-frame data.
 */

import { create } from "zustand";

/** The card stays up at least this long (ms) from the ticket, so it never flashes. */
export const ENTER_MIN_MS = 600;
/** A join that has not finished after this long drops the card by itself (the join has its own timeouts). */
export const ENTER_GIVE_UP_MS = 20_000;

/** ms the card still has to stay up, `nowMs` after it began at `startedAt`. */
export function holdRemainingMs(startedAt: number, nowMs: number): number {
  return Math.min(ENTER_MIN_MS, Math.max(0, ENTER_MIN_MS - (nowMs - startedAt)));
}

export type EnterPhase = "idle" | "joining" | "ready";

interface EnterTransitionState {
  phase: EnterPhase;
  label: string;
  /** performance.now() when the card began. */
  startedAt: number;
  /** A ticket arrived: raise the card. A card already joining keeps its start time. */
  begin: (label: string, nowMs: number) => void;
  /** The classroom is up and its scene was asked for: the card may fade once its minimum time is over. */
  ready: () => void;
  /** The card is gone (faded, or the join failed). */
  end: () => void;
}

export const useEnterTransition = create<EnterTransitionState>((set) => ({
  phase: "idle",
  label: "",
  startedAt: 0,

  begin: (label, nowMs) =>
    set((s) => (s.phase === "joining" ? s : { phase: "joining", label, startedAt: nowMs })),
  ready: () => set((s) => (s.phase === "joining" ? { phase: "ready" } : s)),
  end: () => set((s) => (s.phase === "idle" ? s : { phase: "idle", label: "", startedAt: 0 })),
}));
