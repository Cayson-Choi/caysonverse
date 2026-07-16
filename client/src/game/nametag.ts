/**
 * Canvas-generated nametag sprites for remote players.
 *
 * The text canvas + its GPU texture are generated ONCE per nickname and shared
 * across every avatar with that name via a reference-counted module cache — so
 * re-mounting (roster churn) never re-rasterizes, and the texture is disposed
 * only when its last owner unmounts. Each avatar still gets its own SpriteMaterial
 * (disposed on unmount) so opacity/state never bleeds between avatars.
 */

import { CanvasTexture, Sprite, SpriteMaterial } from "three";
import { NAMETAG_HEIGHT } from "./constants";
import { billboardSprite, canvas2d, canvasTexture, roundRect } from "./spriteCanvas";

interface CachedTag {
  texture: CanvasTexture;
  /** width / height of the source canvas, to keep the sprite's aspect right. */
  aspect: number;
  refs: number;
}

const cache = new Map<string, CachedTag>();

/**
 * World-space height (m) of the sprite; width follows the text aspect ratio.
 * Shrunk from the original 0.42 (design 22) so the speech bubble reads as the
 * visual protagonist; 0.30 (~71%) rather than the exact 2/3 (0.28) after the
 * review's 10m-legibility screenshots — mobile observers see roughly a third of
 * the desktop evidence's pixels. Only the WORLD scale shrinks — the canvas px
 * resolution (fontSize below) is untouched, so no blur.
 */
const SPRITE_HEIGHT = 0.30;

/** Rasterize the nickname onto a snug canvas with a subtle rounded backdrop. */
function renderCanvas(nickname: string): { canvas: HTMLCanvasElement; aspect: number } {
  const fontSize = 48;
  const padX = 26;
  const padY = 14;
  const font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif`;

  const measureCtx = canvas2d(document.createElement("canvas"));
  measureCtx.font = font;
  const textWidth = Math.ceil(measureCtx.measureText(nickname).width);

  const width = textWidth + padX * 2;
  const height = fontSize + padY * 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas2d(canvas);
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
    entry = { texture: canvasTexture(canvas), aspect, refs: 0 };
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
  const sprite = billboardSprite(entry.texture, entry.aspect, SPRITE_HEIGHT, 999);
  sprite.position.set(0, NAMETAG_HEIGHT, 0);

  return {
    sprite,
    dispose() {
      (sprite.material as SpriteMaterial).dispose();
      release(nickname);
    },
  };
}
