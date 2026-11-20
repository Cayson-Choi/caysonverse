/**
 * The "가는 중" screen of the park's door (owner 2026-11-20: "케이슨랜드 들어가기 눌렀을때 ... 멈춘줄 알거 같아"): from the press of 케이슨랜드 들어가기
 * (or 나가기) until the place on the other side is really on screen, a full-screen loading screen with a spinning ring, a stage line and a bar.
 * This file is the store and the pure stage model; AreaLoadingOverlay.tsx draws it. Module state, like houseEntry.ts.
 *
 * Ends: park — the park has been DRAWN (parkReady.ts); village — the village's area is back, its vegetation dressed and a few frames drawn.
 * A press the server never answers (nothing moved) is dropped after `NO_MOVE_MS`.
 */
import { useSyncExternalStore } from "react";
import type { AreaId } from "@caysonverse/shared/village/villageLayout";

export type LoadTarget = "park" | "village";

export interface AreaLoadingState {
  target: LoadTarget | null;
  /** performance.now() of the press; 0 when none. */
  since: number;
}

/** The door was pressed and the server did not move us within this long (ms): nothing is coming, the screen goes. */
export const NO_MOVE_MS = 3500;
/** Frames drawn in the village after the way back before it counts as ready. */
export const VILLAGE_READY_FRAMES = 6;
/** The screen stays at least this long (ms), so a fast arrival is a short fade, not a flash. */
export const MIN_SHOWN_MS = 700;

let state: AreaLoadingState = { target: null, since: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function areaLoadingState(): AreaLoadingState {
  return state;
}
export function beginAreaLoading(target: LoadTarget): void {
  if (state.target === target) return;
  state = { target, since: now() };
  emit();
}
export function endAreaLoading(): void {
  if (state.target === null) return;
  state = { target: null, since: 0 };
  emit();
}
export function useAreaLoading(): AreaLoadingState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    areaLoadingState,
    areaLoadingState,
  );
}

/** What the model reads. */
export interface LoadInputs {
  target: LoadTarget;
  area: AreaId;
  /** park: the park has been drawn */
  parkReady: boolean;
  /** park: 0 nothing mounted, 1 mounted (files in), 2 first frames drawn */
  parkStage: 0 | 1 | 2;
  /** park: downloaded share 0..1 of the loaders' queue */
  downloaded: number;
  /** village: frames drawn since the way back */
  villageFrames: number;
  /** village: its vegetation is dressed */
  vegDressed: boolean;
}

export type LoadStageId = "door" | "files" | "build" | "almost";

export interface LoadView {
  done: boolean;
  stage: LoadStageId;
  /** 0..1, never going backwards for the same inputs' stage ladder */
  progress: number;
  title: string;
  subtitle: string;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function loadView(i: LoadInputs): LoadView {
  if (i.target === "park") {
    const title = "케이슨랜드로 가는 중…";
    if (i.area === "park" && i.parkReady) return { done: true, stage: "almost", progress: 1, title, subtitle: "거의 다 됐어요" };
    if (i.area !== "park") return { done: false, stage: "door", progress: 0.06, title, subtitle: "문을 열고 있어요" };
    if (i.parkStage >= 2) return { done: false, stage: "almost", progress: 0.92, title, subtitle: "거의 다 됐어요" };
    if (i.parkStage === 1) return { done: false, stage: "build", progress: 0.75, title, subtitle: "꽃밭과 불빛을 꾸미고 있어요" };
    return { done: false, stage: "files", progress: 0.1 + 0.55 * clamp01(i.downloaded), title, subtitle: "놀이기구를 준비하고 있어요" };
  }
  const title = "마을로 돌아가는 중…";
  if (i.area !== "village") return { done: false, stage: "door", progress: 0.06, title, subtitle: "문을 열고 있어요" };
  const ready = i.vegDressed && i.villageFrames >= VILLAGE_READY_FRAMES;
  if (ready) return { done: true, stage: "almost", progress: 1, title, subtitle: "거의 다 됐어요" };
  if (!i.vegDressed) return { done: false, stage: "build", progress: 0.5, title, subtitle: "마을 풍경을 불러오고 있어요" };
  return { done: false, stage: "almost", progress: 0.9, title, subtitle: "거의 다 됐어요" };
}
