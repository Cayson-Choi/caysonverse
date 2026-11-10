/**
 * Emoji-reaction sprite: a single glyph rendered on the SAME canvas -> texture
 * -> billboard pipeline as the nametag/speech bubble (spriteCanvas.ts) — no
 * third canvas path. The glyph is rasterized ONCE at creation; the caller
 * (useEmoji.ts) drives the rise/fade every frame via `setProgress`, which only
 * mutates the sprite's position and material opacity (no per-frame canvas work,
 * no per-frame allocation).
 *
 * The glyph's texture is made once per glyph and shared (perf/interaction-latency: there are six glyphs, and drawing
 * one onto a fresh canvas and uploading it on every reaction cost 6-9 ms of the click's frame, 20+ ms on a slow CPU);
 * `prewarmEmojiTextures` uploads them all in idle time when a scene starts, so even the first reaction uploads
 * nothing. Each reaction still owns its material (its opacity fades on its own), released by `dispose()` when it is
 * replaced or its avatar leaves; the shared texture stays.
 */

import { Sprite, SpriteMaterial, type CanvasTexture, type WebGLRenderer } from "three";
import { EMOJIS } from "@caysonverse/shared/constants";
import { billboardSprite, canvas2d, canvasTexture } from "./spriteCanvas";
import { EMOJI_BASE_HEIGHT, EMOJI_SPRITE_HEIGHT } from "./constants";

/** Square canvas resolution (px) the glyph is rasterized onto. */
const CANVAS_PX = 128;
const FONT = `${Math.round(CANVAS_PX * 0.78)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;

export interface EmojiSpriteHandle {
  sprite: Sprite;
  /**
   * Apply this frame's float-animation state: rise (m, added above the base height) and
   * opacity. `baseY` is where the rise starts (default EMOJI_BASE_HEIGHT; the avatar's hook
   * passes a height clear of its name tag and speech bubble, see emojiBaseHeight).
   */
  setProgress(offsetY: number, opacity: number, baseY?: number): void;
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

const textures = new Map<string, CanvasTexture>();

/** The shared texture of `glyph` (drawn the first time it is asked for). */
export function emojiTexture(glyph: string): CanvasTexture {
  let texture = textures.get(glyph);
  if (!texture) {
    texture = canvasTexture(renderCanvas(glyph));
    textures.set(glyph, texture);
  }
  return texture;
}

/**
 * Draw and upload every reaction glyph ahead of time, one per idle slot (each is a canvas draw and a texture upload), so
 * no reaction's frame does it. Returns a cancel.
 */
export function prewarmEmojiTextures(gl: Pick<WebGLRenderer, "initTexture">, glyphs: readonly string[] = EMOJIS): () => void {
  let i = 0;
  let cancelled = false;
  const idle: (cb: () => void) => void =
    typeof requestIdleCallback === "function" ? (cb) => requestIdleCallback(cb, { timeout: 2000 }) : (cb) => setTimeout(cb, 50);
  const next = () => {
    if (cancelled || i >= glyphs.length) return;
    gl.initTexture(emojiTexture(glyphs[i++]!));
    idle(next);
  };
  idle(next);
  return () => {
    cancelled = true;
  };
}

/** Build an emoji sprite for `glyph`, initially positioned at EMOJI_BASE_HEIGHT. */
export function createEmojiSprite(glyph: string): EmojiSpriteHandle {
  const texture = emojiTexture(glyph);
  const sprite = billboardSprite(texture, 1, EMOJI_SPRITE_HEIGHT, 1001);
  sprite.position.set(0, EMOJI_BASE_HEIGHT, 0);
  const material = sprite.material as SpriteMaterial;

  return {
    sprite,
    setProgress(offsetY, opacity, baseY = EMOJI_BASE_HEIGHT) {
      sprite.position.y = baseY + offsetY;
      material.opacity = opacity;
    },
    dispose() {
      // The texture is the glyph's, shared by every reaction with it (emojiTexture).
      material.dispose();
    },
  };
}
