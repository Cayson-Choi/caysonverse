/**
 * Emoji-reaction sprite: a single glyph rendered on the SAME canvas -> texture
 * -> billboard pipeline as the nametag/speech bubble (spriteCanvas.ts) — no
 * third canvas path. The glyph is rasterized ONCE at creation; the caller
 * (useEmoji.ts) drives the rise/fade every frame via `setProgress`, which only
 * mutates the sprite's position and material opacity (no per-frame canvas work,
 * no per-frame allocation).
 *
 * Owns its own texture + material (unique per active reaction — no caching,
 * mirroring bubbleSprite.ts) and exposes `dispose()` for the owner to call when
 * replaced or its avatar leaves.
 */

import { Sprite, SpriteMaterial } from "three";
import { billboardSprite, canvas2d, canvasTexture } from "./spriteCanvas";
import { EMOJI_BASE_HEIGHT, EMOJI_SPRITE_HEIGHT } from "./constants";

/** Square canvas resolution (px) the glyph is rasterized onto. */
const CANVAS_PX = 128;
const FONT = `${Math.round(CANVAS_PX * 0.78)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;

export interface EmojiSpriteHandle {
  sprite: Sprite;
  /** Apply this frame's float-animation state: rise (m, added above the base height) and opacity. */
  setProgress(offsetY: number, opacity: number): void;
  dispose(): void;
}

/** Rasterize `glyph` centred on a square canvas. */
function renderCanvas(glyph: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  const ctx = canvas2d(canvas);
  ctx.font = FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, CANVAS_PX / 2, CANVAS_PX / 2);
  return canvas;
}

/** Build an emoji sprite for `glyph`, initially positioned at EMOJI_BASE_HEIGHT. */
export function createEmojiSprite(glyph: string): EmojiSpriteHandle {
  const texture = canvasTexture(renderCanvas(glyph));
  const sprite = billboardSprite(texture, 1, EMOJI_SPRITE_HEIGHT, 1001);
  sprite.position.set(0, EMOJI_BASE_HEIGHT, 0);
  const material = sprite.material as SpriteMaterial;

  return {
    sprite,
    setProgress(offsetY, opacity) {
      sprite.position.y = EMOJI_BASE_HEIGHT + offsetY;
      material.opacity = opacity;
    },
    dispose() {
      texture.dispose();
      material.dispose();
    },
  };
}
