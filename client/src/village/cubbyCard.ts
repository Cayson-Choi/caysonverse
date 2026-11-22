import { useSyncExternalStore } from "react";
import { SAMPLE_BY_ID, SAMPLE_PHOTO_ATLAS, type SampleCubby } from "./sampleCubbies";
import { cubbyColumn } from "./villageTargets";

/**
 * The close-up card of a cubby column (케이슨 마을 Task 9) — the pure part: its copy, which cubby it shows and the
 * store that opens and closes it. CubbyView draws it.
 *
 * Standing within 1.2 m of a column and pressing E (or the context button "가까이 보기") opens the card on that column,
 * on the filled cubby nearest eye height. "위 칸" / "아래 칸" step through the column's eight cubbies. A filled cubby shows
 * the portrait, the name, the years and the family's line, and "촛불 켜기" (it sends `LightCandle`; everyone in the hall
 * sees a small flame in that cubby for 60 s). An empty one says it will soon be possible to lay a pet to rest there.
 *
 * Copy rule: gentle, "~요", never "!".
 */

export const CUBBY_COPY = {
  empty: "곧 이 자리에 우리 아이를 모실 수 있어요",
  emptyTitle: "비어 있는 칸",
  /** owner 2026-11-20: a toggle — "촛불 밝히기" / "촛불 끄기". */
  light: "촛불 밝히기",
  lighting: "촛불을 켜고 있어요",
  putOut: "촛불 끄기",
  puttingOut: "촛불을 끄고 있어요",
  burning: "촛불이 켜져 있어요",
  onlyLighter: "켜 주신 분과 가족만 끌 수 있어요",
  wait: "잠시 뒤에 켤 수 있어요",
  fold: "접기",
  unfold: "펼치기",
  foldLabel: "카드 접기",
  unfoldLabel: "카드 펼치기",
  up: "위 칸",
  down: "아래 칸",
  close: "닫기",
  dialog: "추모 칸 가까이 보기",
  sample: "견본",
  sampleNote: "추모관을 보여 드리려고 꾸민 견본 칸이에요",
  exit: "가까이 보기 끝내기",
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

/** "방금" / "5분 전" / "1시간 전" (how long ago a candle was lit, from `agoMs`). */
export function agoLabel(agoMs: number): string {
  const min = Math.floor(Math.max(0, agoMs) / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전에`;
  return `${Math.floor(min / 60)}시간 전에`;
}

/**
 * "케이슨님이 32분 전에 켜 주셨어요" (owner 2026-11-13: so a family can see who came by); the visitor's own candle says so
 * ("내가 방금 켜 두었어요", 2026-11-20: then the card offers "촛불 끄기").
 */
export function litByLabel(by: string, agoMs = 0, mine = false): string {
  const when = agoLabel(agoMs);
  if (mine) return `내가 ${when} 켜 두었어요`;
  return by ? `${by}님이 ${when} 켜 주셨어요` : `${when} 켜진 촛불이에요`;
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

/** Open the card on a column (a key `A_11` or a target id `cubby:A_11`); an unknown column does nothing. */
export function openCubbyCard(columnOrId: string): void {
  const column = cubbyColumn(columnOrId);
  if (!column) return;
  set({ column: column.key, row: defaultRow(column.key) });
}

/**
 * Open the card on one cubby (a click or a tap on it — the top row as easily as the middle one; owner 2026-11-13). The
 * card is already open on another: it moves there.
 */
export function openCubbyAt(anchor: { bank: string; col: number; row: number }): boolean {
  const column = cubbyColumn(`${anchor.bank}_${anchor.col}`);
  if (!column || anchor.row < 0 || anchor.row >= column.rows.length) return false;
  if (state && state.column === column.key && state.row === anchor.row) return true;
  set({ column: column.key, row: anchor.row });
  return true;
}

/** The anchor of the cubby the card shows, or null. */
export function cubbyCardAnchor(s: CubbyCardState | null = state) {
  if (!s) return null;
  return cubbyColumn(s.column)?.rows[s.row] ?? null;
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
