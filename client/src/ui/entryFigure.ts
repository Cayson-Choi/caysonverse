/**
 * The entry screen as it stood at the press of 입장하기, for the "케이슨 마을로 가는 중" screen (owner 2026-11-27: "입장하기 누르면
 * ... 캐릭터 고르기 화면과 동일해야"). The builder's preview canvas registers a snapshot function (BuilderPreview FigureSnap); the
 * press takes one picture of the figure (a transparent PNG) together with where it stood on the screen and the stage's own
 * layout (.cv-entry's class and CSS variables: the art's box, the podium's glow and spotlight). VillageLoader draws the same art
 * at the same box and the figure at the same spot, so the screen does not jump. No new download, no second 3D view.
 */
let snapper: (() => string | null) | null = null;

export interface EntrySnapshot {
  /** the figure's picture (PNG data URL) */
  image: string;
  /** where the preview canvas was on the screen (px) */
  rect: { x: number; y: number; w: number; h: number };
  /** .cv-entry's class (its layout: is-wide | is-side | is-phone, is-sheet) */
  className: string;
  /** .cv-entry's CSS variables (the stage layout) */
  vars: Record<string, string>;
  /** which art (stageLayout ENTRY_ART key) */
  art: string;
}

let snapshot: EntrySnapshot | null = null;

/** The preview canvas: how to take its picture (null on unmount). */
export function registerFigureSnap(fn: (() => string | null) | null): void {
  snapper = fn;
}

/** 입장하기: take the figure's picture and the stage's layout now (kept until the next press). */
export function captureEntryFigure(): void {
  snapshot = null;
  try {
    const image = snapper ? snapper() : null;
    const canvas = document.querySelector(".cv-builder-stage canvas");
    const entry = document.querySelector<HTMLElement>(".cv-entry");
    if (!image || !canvas || !entry) return;
    const r = canvas.getBoundingClientRect();
    const vars: Record<string, string> = {};
    for (let i = 0; i < entry.style.length; i++) {
      const k = entry.style.item(i);
      if (k.startsWith("--")) vars[k] = entry.style.getPropertyValue(k);
    }
    snapshot = {
      image,
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      className: entry.className,
      vars,
      art: entry.dataset.art ?? "phone",
    };
  } catch {
    snapshot = null;
  }
}

/** The entry screen as it was at the press, or null (no preview was drawn). */
export function entrySnapshot(): EntrySnapshot | null {
  return snapshot;
}
