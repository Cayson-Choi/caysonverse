/**
 * Speech-bubble sprite: a multi-line, word-wrapped chat bubble rendered on the
 * SAME canvas -> texture -> billboard pipeline as the nametag (spriteCanvas.ts).
 * Word wrapping and the 3-line/ellipsis cap come from the pure `wrapText`
 * helper, measured with the real canvas font metrics.
 *
 * Each bubble owns its texture + material (unique, ephemeral text — no caching)
 * and exposes `dispose()` for its owner to call when the bubble is replaced or
 * its avatar leaves.
 *
 * Crisp text (fix/crisp-labels, spriteCanvas.ts): the bubble is rasterized at the size it is SHOWN at — its font in whole
 * device pixels (`setTextDevicePx`, from its owner every frame: the bubble's distance changes as people walk), every other
 * metric scaled from the design below and rounded to whole pixels — and drawn one texel per screen pixel by the label
 * shader. The lines are wrapped ONCE, at the design size, so a re-rasterized bubble never re-flows. Its world size stays
 * the design's (`heightM`); the sprite's origin is its bottom edge, so it sits on its anchor whatever size it is drawn at.
 */

import { Sprite, SpriteMaterial, type CanvasTexture } from "three";
import { wrapText } from "./bubbleWrap";
import { LABEL_SNAP, billboardSprite, canvas2d, canvasTexture, fontBucket, roundRect, takeRasterBudget } from "./spriteCanvas";
import { BUBBLE_BASE_HEIGHT } from "./constants";

/** The design (CSS-px-like units the layout and the world size are given in). */
const FONT_SIZE = 40;
const LINE_HEIGHT = Math.round(FONT_SIZE * 1.28); // px per rendered line
const PAD_X = 34;
const PAD_Y = 22;
const MAX_LINES = 3;
const CORNER = 24;
/** Content-width budget (px, at FONT_SIZE) before wrapping kicks in. */
const MAX_TEXT_WIDTH = 560;
/**
 * Metres per design pixel — the nametag's ORIGINAL text-to-world density (0.42m /
 * 76px canvas). Deliberately kept after the nametag shrank to 0.30 (design 22):
 * bubbles stay at the larger scale so they read as the visual protagonist.
 */
const WORLD_PER_PX = 0.42 / 76;

/** The font sizes (device px) a bubble is rasterized at; beyond them it is drawn scaled (very near or very far). */
export const BUBBLE_MIN_FONT_PX = 8;
export const BUBBLE_MAX_FONT_PX = 112;
/** What a bubble is first rasterized at before its owner has sized it (the old fixed raster: the design at 2x). */
export const BUBBLE_START_FONT_PX = 2 * FONT_SIZE;

const FAMILY = 'system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif';
const fontOf = (px: number) => `700 ${px}px ${FAMILY}`;
const FILL = "rgba(24, 20, 46, 0.9)";
const TEXT = "#ffffff";

/** The bubble text's on-screen height (CSS px) where a metre spans `ppm` CSS px (nametagLayout `pixelsPerMetre`). */
export function bubbleTextCssPx(ppm: number): number {
  return FONT_SIZE * WORLD_PER_PX * ppm;
}

/** Every size of a bubble drawn at font `fontPx`, in whole canvas pixels (the design scaled, then rounded). */
export interface BubbleMetrics {
  font: number;
  lineHeight: number;
  padX: number;
  padY: number;
  corner: number;
}

export function bubbleMetrics(fontPx: number): BubbleMetrics {
  const font = Math.max(1, Math.round(fontPx));
  const k = font / FONT_SIZE;
  return {
    font,
    lineHeight: Math.max(font + 1, Math.round(LINE_HEIGHT * k)),
    padX: Math.round(PAD_X * k),
    padY: Math.round(PAD_Y * k),
    corner: Math.round(CORNER * k),
  };
}

export interface BubbleSprite {
  sprite: Sprite;
  /** World height (m) of the bubble, so its owner can seat its bottom edge anywhere. */
  heightM: number;
  /**
   * The bubble's text is `px` DEVICE pixels tall on screen now: re-rasterize at that whole-pixel font size when it has
   * moved far enough from the current one (fontBucket) and this frame's raster budget allows.
   */
  setTextDevicePx(px: number): void;
  dispose(): void;
}

/** One 2D context for every measurement (no canvas per bubble or per raster). */
let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(font: string): CanvasRenderingContext2D {
  measureCtx ??= canvas2d(document.createElement("canvas"));
  measureCtx.font = font;
  return measureCtx;
}

/** Rasterize the (already wrapped) `lines` at font `fontPx`. */
function rasterize(lines: readonly string[], fontPx: number): { canvas: HTMLCanvasElement; aspect: number } {
  const m = bubbleMetrics(fontPx);
  const font = fontOf(m.font);
  const mc = measurer(font);
  const widths = lines.map((l) => mc.measureText(l).width);
  const textWidth = Math.ceil(Math.max(...widths));
  const width = textWidth + 2 * m.padX;
  const height = m.lineHeight * lines.length + 2 * m.padY;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas2d(canvas);
  ctx.fillStyle = FILL;
  roundRect(ctx, 0, 0, width, height, m.corner);
  ctx.fill();

  ctx.font = font;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = TEXT;
  // Each line centred, starting on a whole pixel.
  lines.forEach((line, i) => {
    const x = m.padX + Math.round((textWidth - widths[i]!) / 2);
    const y = m.padY + Math.round(m.lineHeight / 2) + i * m.lineHeight;
    ctx.fillText(line, x, y);
  });
  return { canvas, aspect: width / height };
}

/** Build a bubble sprite for `text` (first rasterized at `fontPx` device px), its bottom edge at BUBBLE_BASE_HEIGHT. */
export function createBubbleSprite(text: string, fontPx: number = BUBBLE_START_FONT_PX): BubbleSprite {
  // Wrap once, at the design size: the lines stay the same whatever size the bubble is drawn at.
  const mc = measurer(fontOf(FONT_SIZE));
  const measure = (s: string) => mc.measureText(s).width;
  const wrapped = wrapText(text, MAX_TEXT_WIDTH, MAX_LINES, measure);
  const lines = wrapped.length > 0 ? wrapped : [text];

  const cssHeight = LINE_HEIGHT * lines.length + PAD_Y * 2;
  const heightM = cssHeight * WORLD_PER_PX;

  const start = fontPx > 0 && Number.isFinite(fontPx) ? fontPx : BUBBLE_START_FONT_PX;
  let font = Math.min(BUBBLE_MAX_FONT_PX, Math.max(BUBBLE_MIN_FONT_PX, Math.round(start)));
  let disposed = false;
  let raster = rasterize(lines, font);
  let texture: CanvasTexture = canvasTexture(raster.canvas);
  const sprite = billboardSprite(texture, raster.aspect, heightM, 1000, { snap: LABEL_SNAP });
  const material = sprite.material as SpriteMaterial;
  // The origin is the bottom edge (its owner, useSpeechBubble, re-seats it every frame on top of the avatar's nametag).
  sprite.center.set(0.5, 0);
  sprite.position.set(0, BUBBLE_BASE_HEIGHT, 0);

  return {
    sprite,
    heightM,
    setTextDevicePx(px) {
      if (disposed) return;
      const next = fontBucket(px, font, BUBBLE_MIN_FONT_PX, BUBBLE_MAX_FONT_PX);
      if (next === font || !takeRasterBudget()) return;
      font = next;
      raster = rasterize(lines, font);
      const old = texture;
      texture = canvasTexture(raster.canvas);
      material.map = texture;
      sprite.scale.x = heightM * raster.aspect;
      old.dispose();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      texture.dispose();
      material.dispose();
    },
  };
}
