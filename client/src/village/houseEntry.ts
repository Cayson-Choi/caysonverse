import { useSyncExternalStore } from "react";
import { HOUSE_BUDGET } from "@caysonverse/shared/village/houseAreas";

/**
 * Coming into a house (집 실내 G; design 5.2 step 4): the server moves the player at once when the code is right, but the house's
 * model may still be on its way (a slow phone, no prefetch). The dark cover with "집에 들어가는 중…" stands over the screen from the
 * keypad's "ok" (or from the house scene mounting, whichever is first) until the house's floor is drawn, and for at most
 * `HOUSE_BUDGET.loadTimeoutSeconds` (8 s): after that the entry is given up — the player is sent back to the porch with a short
 * "다시 시도해 주세요". Module state (like keypadStore.ts); `useHouseEntry` is the React window onto it, and `HouseEntryCover.tsx` draws it.
 *
 * Phases: `idle` (nothing), `loading` (cover shown, waiting for the model), `ready` (the floor is drawn: the cover opens), `failed`
 * (timed out or the model failed: the cover stays while the player is sent out).
 */

export type HouseEntryPhase = "idle" | "loading" | "ready" | "failed";

export interface HouseEntryState {
  phase: HouseEntryPhase;
  /** When the loading began (ms, performance.now()); 0 when idle. */
  since: number;
}

let state: HouseEntryState = { phase: "idle", since: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** How long the cover waits for the model before the entry is given up (ms). */
export const HOUSE_ENTRY_TIMEOUT_MS = HOUSE_BUDGET.loadTimeoutSeconds * 1000;

export function houseEntryState(): HouseEntryState {
  return state;
}

/** The cover goes up (the keypad said ok, or a house floor mounted without one). Already loading: unchanged. */
export function beginHouseEntry(): void {
  if (state.phase === "loading") return;
  state = { phase: "loading", since: now() };
  emit();
}

/** The house's floor is drawn: the cover may open. */
export function houseEntryReady(): void {
  if (state.phase === "idle" || state.phase === "ready") return;
  state = { phase: "ready", since: state.since };
  emit();
}

/** The model did not come in time (or failed): the player is sent back out. */
export function houseEntryFailed(): void {
  if (state.phase === "failed") return;
  state = { phase: "failed", since: state.since };
  emit();
}

export function resetHouseEntry(): void {
  if (state.phase === "idle") return;
  state = { phase: "idle", since: 0 };
  emit();
}

export function subscribeHouseEntry(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useHouseEntry(): HouseEntryState {
  return useSyncExternalStore(subscribeHouseEntry, houseEntryState, houseEntryState);
}
