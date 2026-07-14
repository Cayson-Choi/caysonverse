/**
 * Speech-bubble sprite: a multi-line, word-wrapped chat bubble rendered on the
 * SAME canvas -> texture -> billboard pipeline as the nametag (spriteCanvas.ts).
 * Word wrapping and the 3-line/ellipsis cap come from the pure `wrapText`
 * helper, measured with the real canvas font metrics.
 *
 * Each bubble owns its texture + material (unique, ephemeral text — no caching)
 * and exposes `dispose()` for its owner to call when the bubble is replaced or
 * its avatar leaves.
 */

import { Sprite, SpriteMaterial } from "three";
import { wrapText } from "./bubbleWrap";
import { billboardSprite, canvas2d, canvasTexture, roundRect } from "./spriteCanvas";
import { BUBBLE_BASE_HEIGHT } from "./constants";

const FONT_SIZE = 40;
const LINE_HEIGHT = Math.round(FONT_SIZE * 1.28); // px per rendered line
const PAD_X = 34;
const PAD_Y = 22;
const MAX_LINES = 3;
const CORNER = 24;
/** Content-width budget (px, at FONT_SIZE) before wrapping kicks in. */
const MAX_TEXT_WIDTH = 560;
/** Super-sample factor for crisp text on the GPU texture. */
const DPR = 2;
/** Metres per CSS pixel — matches the nametag's text-to-world density. */
const WORLD_PER_PX = 0.42 / 76;

const FONT = `500 ${FONT_SIZE}px system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif`;

export interface BubbleSprite {
  sprite: Sprite;
  dispose(): void;
}

/** Build a bubble sprite for `text`, positioned above the avatar's nametag. */
export function createBubbleSprite(text: string): BubbleSprite {
  const measureCtx = canvas2d(document.createElement("canvas"));
  measureCtx.font = FONT;
  const measure = (s: string) => measureCtx.measureText(s).width;

  const wrapped = wrapText(text, MAX_TEXT_WIDTH, MAX_LINES, measure);
  const lines = wrapped.length > 0 ? wrapped : [text];

  const textWidth = Math.ceil(Math.max(...lines.map(measure)));
  const cssWidth = textWidth + PAD_X * 2;
  const cssHeight = LINE_HEIGHT * lines.length + PAD_Y * 2;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(cssWidth * DPR);
  canvas.height = Math.ceil(cssHeight * DPR);

  const ctx = canvas2d(canvas);
  ctx.scale(DPR, DPR);
  ctx.font = FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "rgba(24, 20, 46, 0.82)";
  roundRect(ctx, 0, 0, cssWidth, cssHeight, CORNER);
  ctx.fill();

  ctx.fillStyle = "#f4f1ff";
  const firstLineY = PAD_Y + LINE_HEIGHT / 2;
  lines.forEach((line, i) => ctx.fillText(line, cssWidth / 2, firstLineY + i * LINE_HEIGHT));

  const heightM = cssHeight * WORLD_PER_PX;
  const texture = canvasTexture(canvas);
  const sprite = billboardSprite(texture, cssWidth / cssHeight, heightM, 1000);
  // Anchor the bubble's bottom edge at BUBBLE_BASE_HEIGHT (sprite is centred).
  sprite.position.set(0, BUBBLE_BASE_HEIGHT + heightM / 2, 0);

  return {
    sprite,
    dispose() {
      texture.dispose();
      (sprite.material as SpriteMaterial).dispose();
    },
  };
}
