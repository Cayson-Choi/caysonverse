/**
 * The player's figure on the "케이슨 마을로 가는 중" screen (owner 2026-11-27: "입장하기 버튼 누르고 케이슨 마을 가는중이라고 나올때
 * 캐릭터가 표시되도록"). The builder's preview canvas registers a snapshot function (BuilderPreview FigureSnap); 입장하기 takes
 * one picture of the figure as it stands there (a transparent PNG), and VillageLoader shows it above its card. No new
 * download, no second 3D view: the preview canvas unmounts with the entry screen.
 */
let snapper: (() => string | null) | null = null;
let image: string | null = null;

/** The preview canvas: how to take its picture (null on unmount). */
export function registerFigureSnap(fn: (() => string | null) | null): void {
  snapper = fn;
}

/** 입장하기: take the figure's picture now (kept until the next press). */
export function captureEntryFigure(): void {
  try {
    image = snapper ? snapper() : null;
  } catch {
    image = null;
  }
}

/** The picture for the loading screen, or null (no preview was drawn). */
export function entryFigureImage(): string | null {
  return image;
}
