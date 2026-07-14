/**
 * Shared canvas -> sprite plumbing for above-avatar UI (nametags and speech
 * bubbles). One pipeline: rasterize onto a 2D canvas, wrap it in a crisp
 * CanvasTexture, and mount it as a depth-independent billboard sprite. Both
 * nametag.ts and bubbleSprite.ts build on these primitives so there is a single
 * canvas/texture/sprite path, never two.
 */

import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, SRGBColorSpace } from "three";

/** Trace a rounded-rectangle path; the caller fills and/or strokes it. */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Obtain a 2D context or throw a clear error (canvas is unavailable). */
export function canvas2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

/** A CanvasTexture tuned for a non-power-of-two UI canvas (no mipmaps, sRGB). */
export function canvasTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter; // canvas is not power-of-two; avoid mipmaps
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * A billboard sprite showing `texture`, `heightM` metres tall with width from
 * the canvas `aspect`. Always readable: no depth test/write, high render order.
 * Each sprite gets its OWN material (disposed by the caller) so per-sprite state
 * never bleeds between avatars.
 */
export function billboardSprite(
  texture: CanvasTexture,
  aspect: number,
  heightM: number,
  renderOrder: number,
): Sprite {
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new Sprite(material);
  sprite.scale.set(heightM * aspect, heightM, 1);
  sprite.renderOrder = renderOrder;
  return sprite;
}
