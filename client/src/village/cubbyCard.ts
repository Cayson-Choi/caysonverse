import { useSyncExternalStore } from "react";
import { SAMPLE_BY_ID, SAMPLE_PHOTO_ATLAS, type SampleCubby } from "./sampleCubbies";
import { cubbyColumn } from "./villageTargets";

/**
 * The close-up card of a cubby column (케이슨 마을 Task 9) — the pure part: its copy, which cubby it shows and the
 * store that opens and closes it. CubbyView draws it.
 *
 * Standing within 1.2 m of a column and pressing E (or the context button "가까이 보기") opens the card on that column,
 * on the filled cubby nearest eye height. "위 칸" / "아래 칸" step through the column's seven cubbies. A filled cubby shows
 * the portrait, the name, the years and the family's line, and "촛불 켜기" (it sends `LightCandle`; everyone in the hall
 * sees a small flame in that cubby for 60 s). An empty one says it will soon be possible to lay a pet to rest there.
 *
 * Copy rule: gentle, "~요", never "!".
 */

export const CUBBY_COPY = {
  empty: "곧 이 자리에 우리 아이를 모실 수 있어요",
  emptyTitle: "비어 있는 칸",
  light: "촛불 켜기",
  lighting: "촛불을 켜고 있어요",
  burning: "촛불이 켜져 있어요",
  wait: "잠시 뒤에 켤 수 있어요",
  up: "위 칸",
  down: "아래 칸",
  close: "닫기",
  dialog: "추모 칸 가까이 보기",
} as const;

/** "아래에서 4번째 칸" (rows counted from the bottom, 1-based). */
export function rowLabel(row: number): string {
  return `아래에서 ${row + 1}번째 칸`;
}

/** "2011 – 2024" */
export function yearsLabel(s: Pick<SampleCubby, "born" | "passed">): string {
  return `${s.born} – ${s.passed}`;
}

/** "초코의 사진" / "하늘이의 사진" */
export function photoAlt(name: string): string {
  return `${name}의 사진`;
}

/** "케이슨 님이 촛불을 켰어요" */
export function litByLabel(by: string): string {
  return by ? `${by} 님이 촛불을 켰어요` : CUBBY_COPY.burning;
}

/** The CSS background of a portrait tile (the atlas, sized to the card's box). */
export function photoBackground(tile: number): { backgroundImage: string; backgroundSize: string; backgroundPosition: string } {
  const { cols, rows, url } = SAMPLE_PHOTO_ATLAS;
  const c = tile % cols;
  const r = Math.floor(tile / cols) % rows;
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: `${cols * 100}% ${rows * 100}%`,
    backgroundPosition: `${(c / (cols - 1)) * 100}% ${(r / (rows - 1)) * 100}%`,
  };
}

/** The row at eye height (row 3: about 1.6 m up). */
export const EYE_ROW = 3;

/** The row the card opens on: the filled cubby nearest eye height (the lower one on a tie), else eye height. */
export function defaultRow(columnKey: string, samples: ReadonlyMap<string, SampleCubby> = SAMPLE_BY_ID): number {
  const column = cubbyColumn(columnKey);
  if (!column) return EYE_ROW;
  let best = -1;
  for (const a of column.rows) {
    if (!samples.has(a.id)) continue;
    if (best === -1 || Math.abs(a.row - EYE_ROW) < Math.abs(best - EYE_ROW)) best = a.row;
  }
  return best === -1 ? EYE_ROW : best;
}

/** The cubby id at `row` of a column. */
export function cubbyIdAt(columnKey: string, row: number): string | null {
  return cubbyColumn(columnKey)?.rows[row]?.id ?? null;
}

/** What the card shows: a column and a row in it. */
export interface CubbyCardState {
  column: string;
  row: number;
}

let state: CubbyCardState | null = null;
const listeners = new Set<() => void>();

function set(next: CubbyCardState | null): void {
  state = next;
  for (const l of [...listeners]) l();
}

/** Open the card on a column (a key `n_10` or a target id `cubby:n_10`); an unknown column does nothing. */
export function openCubbyCard(columnOrId: string): void {
  const column = cubbyColumn(columnOrId);
  if (!column) return;
  set({ column: column.key, row: defaultRow(column.key) });
}

/** Step `delta` rows up (+1) or down (-1), staying in the column. */
export function moveCubbyRow(delta: number): void {
  if (!state) return;
  const column = cubbyColumn(state.column);
  if (!column) return;
  const row = Math.min(column.rows.length - 1, Math.max(0, state.row + delta));
  if (row !== state.row) set({ ...state, row });
}

export function closeCubbyCard(): void {
  if (state) set(null);
}

export function cubbyCardState(): CubbyCardState | null {
  return state;
}

export function subscribeCubbyCard(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React: the open card, or null. */
export function useCubbyCard(): CubbyCardState | null {
  return useSyncExternalStore(subscribeCubbyCard, cubbyCardState, cubbyCardState);
}
