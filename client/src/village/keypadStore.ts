import { useSyncExternalStore } from "react";
import type { KeypadResultPayload } from "@caysonverse/shared/village/messages";

export interface KeypadUiState {
  buildingId: string | null;
  pending: boolean;
  result: KeypadResultPayload | null;
}

let state: KeypadUiState = { buildingId: null, pending: false, result: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function openKeypad(buildingId: string): void {
  state = { buildingId, pending: false, result: null };
  emit();
}

export function closeKeypad(): void {
  if (state.buildingId === null && state.result === null) return;
  state = { buildingId: null, pending: false, result: null };
  emit();
}

export function keypadPending(): void {
  state = { ...state, pending: true, result: null };
  emit();
}

export function noteKeypadResult(result: KeypadResultPayload): void {
  state = { ...state, pending: false, result };
  emit();
}

export function useKeypad(): KeypadUiState {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, () => state, () => state);
}

