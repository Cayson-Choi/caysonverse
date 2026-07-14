/**
 * Canvas-generated nametag sprites for remote players.
 *
 * The text canvas + its GPU texture are generated ONCE per nickname and shared
 * across every avatar with that name via a reference-counted module cache — so
 * re-mounting (roster churn) never re-rasterizes, and the texture is disposed
 * only when its last owner unmounts. Each avatar still gets its own SpriteMaterial
 * (disposed on unmount) so opacity/state never bleeds between avatars.
 */

import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, SRGBColorSpace } from "three";
import { NAMETAG_HEIGHT } from "./constants";

interface CachedTag {
  texture: CanvasTexture;
  /** width / height of the source canvas, to keep the sprite's aspect right. */
  aspect: number;
  refs: number;
}

const cache = new Map<string, CachedTag>();

/** World-space height (m) of the sprite; width follows the text aspect ratio. */
const SPRITE_HEIGHT = 0.42;

function roundRect(
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

/** Rasterize the nickname onto a snug canvas with a subtle rounded backdrop. */
function renderCanvas(nickname: string): { canvas: HTMLCanvasElement; aspect: number } {
  const fontSize = 48;
  const padX = 26;
  const padY = 14;
  const font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif`;

  const measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) throw new Error("2D canvas context unavailable");
  measureCtx.font = font;
  const textWidth = Math.ceil(measureCtx.measureText(nickname).width);

  const width = textWidth + padX * 2;
  const height = fontSize + padY * 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "rgba(20, 16, 40, 0.66)";
  roundRect(ctx, 0, 0, width, height, height / 2);
  ctx.fill();

  ctx.fillStyle = "#f2eeff";
  ctx.fillText(nickname, width / 2, height / 2 + 2);

  return { canvas, aspect: width / height };
}

function acquire(nickname: string): CachedTag {
  let entry = cache.get(nickname);
  if (!entry) {
    const { canvas, aspect } = renderCanvas(nickname);
    const texture = new CanvasTexture(canvas);
    texture.minFilter = LinearFilter; // canvas is not power-of-two; avoid mipmaps
    texture.colorSpace = SRGBColorSpace;
    entry = { texture, aspect, refs: 0 };
    cache.set(nickname, entry);
  }
  entry.refs += 1;
  return entry;
}

function release(nickname: string): void {
  const entry = cache.get(nickname);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    entry.texture.dispose();
    cache.delete(nickname);
  }
}

export interface Nametag {
  /** The sprite to add above the avatar's head. */
  sprite: Sprite;
  /** Dispose the per-avatar material and release the shared texture. */
  dispose(): void;
}

/** Create a nametag sprite for `nickname`, positioned above the avatar's head. */
export function createNametag(nickname: string): Nametag {
  const entry = acquire(nickname);
  const material = new SpriteMaterial({
    map: entry.texture,
    transparent: true,
    depthTest: false, // always readable, never clipped by the body
    depthWrite: false,
  });
  const sprite = new Sprite(material);
  sprite.scale.set(SPRITE_HEIGHT * entry.aspect, SPRITE_HEIGHT, 1);
  sprite.position.set(0, NAMETAG_HEIGHT, 0);
  sprite.renderOrder = 999;

  return {
    sprite,
    dispose() {
      material.dispose();
      release(nickname);
    },
  };
}
