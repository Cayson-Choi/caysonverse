/**
 * Canvas-generated nametag sprites (controls-ux Task 13): a white rounded capsule with
 * dark text, an optional teacher crown / AI pill, and two transient variants — a
 * highlight border and a trailing "…" while the player types. Colors are placeholders
 * until the new-world design lands (spec §7).
 *
 * Each distinct look — keyed `badge|highlight|typing|text` — is rasterized onto a
 * canvas + GPU texture the FIRST time it is needed and shared by every avatar that
 * shows it, through a reference-counted module cache: roster churn never re-rasterizes,
 * and a texture is disposed only when its last owner lets go. A tag can switch looks
 * at any time (setHighlight / setTyping) and always releases the one it leaves. Each
 * tag still owns its own SpriteMaterial (disposed with it) so opacity never bleeds
 * between avatars.
 *
 * The per-frame setters (setHeight / setOpacity / setOffsetY, and setHighlight /
 * setTyping while unchanged) allocate nothing and touch no React state.
 */

import { CanvasTexture, LinearMipmapLinearFilter, Sprite, SpriteMaterial } from "three";
import {
  NAMETAG_BASE_HEIGHT_M,
  NAMETAG_FONT_PX,
  NAMETAG_HEIGHT,
  NAMETAG_PAD_Y_PX,
} from "./constants";
import { billboardSprite, canvas2d, canvasTexture, roundRect } from "./spriteCanvas";

/** Who the tag belongs to: a student/other (none), the teacher (👑 + gold border), or an AI 조교 (AI pill). */
export type NametagBadge = "none" | "teacher" | "ai";

export interface Nametag {
  /** The sprite to add above the avatar's head. */
  sprite: Sprite;
  /** World height (m) of the whole tag; the width follows the current look's aspect ratio. */
  setHeight(heightM: number): void;
  /** 0..1; at or below 0.01 the sprite is hidden outright (no draw call). */
  setOpacity(opacity: number): void;
  /** Lift the tag by `offsetM` above its resting height (NAMETAG_HEIGHT + offset). */
  setOffsetY(offsetM: number): void;
  /** Blue highlight border (somebody just spoke). */
  setHighlight(on: boolean): void;
  /** A trailing " …" (the player is typing a chat line). */
  setTyping(on: boolean): void;
  /** Dispose the per-avatar material and release the shared texture. Safe to call twice. */
  dispose(): void;
}

// ── look ──────────────────────────────────────────────────────────────────────

/** Korean + Latin + emoji on Windows, macOS and Android; measured with this same stack. */
const FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", ' +
  '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const TEXT_FONT = `600 ${NAMETAG_FONT_PX}px ${FONT_FAMILY}`;

const CAPSULE_FILL = "rgba(255, 255, 255, 0.92)";
const TEXT_COLOR = "#1d1b2e";
const TEACHER_BORDER = "#e0a100";
const TEACHER_BORDER_PX = 3;
const HIGHLIGHT_BORDER = "#4f8cff";
const HIGHLIGHT_BORDER_PX = 4;
const AI_PILL_FILL = "#5b4bd8";
const AI_PILL_TEXT = "#ffffff";
const AI_PILL_FONT = `700 26px ${FONT_FAMILY}`;
const AI_PILL_LABEL = "AI";
const AI_PILL_HEIGHT = 40;
const AI_PILL_PAD_X = 14;
/** Space between the capsule's left edge and the AI pill / between the pill and the text. */
const AI_PILL_INSET = 16;
const AI_PILL_GAP = 12;

/** Horizontal padding (px) between the capsule's edge and the text. */
const PAD_X = 26;
/** The canvas is always this tall, whatever the badge — so the text is a fixed fraction of it. */
const CANVAS_H = NAMETAG_FONT_PX + 2 * NAMETAG_PAD_Y_PX;

/** The string drawn in the dark text color: crown prefix for a teacher, " …" while typing. */
export function nametagLabel(text: string, badge: NametagBadge, typing: boolean): string {
  return (badge === "teacher" ? "👑 " : "") + text + (typing ? " …" : "");
}

/** Cache key: one texture per distinct look. */
export function nametagCacheKey(
  text: string,
  badge: NametagBadge,
  highlight: boolean,
  typing: boolean,
): string {
  return `${badge}|${highlight ? 1 : 0}|${typing ? 1 : 0}|${text}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(font: string, s: string): number {
  measureCtx ??= canvas2d(document.createElement("canvas"));
  measureCtx.font = font;
  return Math.ceil(measureCtx.measureText(s).width);
}

/** Rasterize one look onto a snug canvas. */
function renderCanvas(
  text: string,
  badge: NametagBadge,
  highlight: boolean,
  typing: boolean,
): { canvas: HTMLCanvasElement; aspect: number } {
  const label = nametagLabel(text, badge, typing);
  const labelWidth = measure(TEXT_FONT, label);
  const pillWidth = badge === "ai" ? measure(AI_PILL_FONT, AI_PILL_LABEL) + 2 * AI_PILL_PAD_X : 0;
  const textX = badge === "ai" ? AI_PILL_INSET + pillWidth + AI_PILL_GAP : PAD_X;
  const width = textX + labelWidth + PAD_X;
  const height = CANVAS_H;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas2d(canvas);

  // Capsule.
  ctx.fillStyle = CAPSULE_FILL;
  roundRect(ctx, 0, 0, width, height, height / 2);
  ctx.fill();

  // Border, drawn inside the canvas edge: the highlight wins over the teacher's gold.
  const borderPx = highlight ? HIGHLIGHT_BORDER_PX : badge === "teacher" ? TEACHER_BORDER_PX : 0;
  if (borderPx > 0) {
    ctx.lineWidth = borderPx;
    ctx.strokeStyle = highlight ? HIGHLIGHT_BORDER : TEACHER_BORDER;
    roundRect(ctx, borderPx / 2, borderPx / 2, width - borderPx, height - borderPx, (height - borderPx) / 2);
    ctx.stroke();
  }

  ctx.textBaseline = "middle";

  // AI pill.
  if (badge === "ai") {
    const pillY = (height - AI_PILL_HEIGHT) / 2;
    ctx.fillStyle = AI_PILL_FILL;
    roundRect(ctx, AI_PILL_INSET, pillY, pillWidth, AI_PILL_HEIGHT, AI_PILL_HEIGHT / 2);
    ctx.fill();
    ctx.font = AI_PILL_FONT;
    ctx.textAlign = "center";
    ctx.fillStyle = AI_PILL_TEXT;
    ctx.fillText(AI_PILL_LABEL, AI_PILL_INSET + pillWidth / 2, height / 2 + 1);
  }

  // Text.
  ctx.font = TEXT_FONT;
  ctx.textAlign = "left";
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(label, textX, height / 2 + 2);

  return { canvas, aspect: width / height };
}

// ── shared, reference-counted texture cache ───────────────────────────────────

interface CachedTag {
  key: string;
  texture: CanvasTexture;
  /** width / height of the source canvas, to keep the sprite's aspect right. */
  aspect: number;
  refs: number;
}

const cache = new Map<string, CachedTag>();

function acquire(text: string, badge: NametagBadge, highlight: boolean, typing: boolean): CachedTag {
  const key = nametagCacheKey(text, badge, highlight, typing);
  let entry = cache.get(key);
  if (!entry) {
    const { canvas, aspect } = renderCanvas(text, badge, highlight, typing);
    const texture = canvasTexture(canvas);
    // The text is drawn at 48 px but shown at 12–16 CSS px: mipmaps keep that
    // minification smooth instead of shimmering as the camera moves (WebGL2 has NPOT mipmaps).
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    entry = { key, texture, aspect, refs: 0 };
    cache.set(key, entry);
  }
  entry.refs += 1;
  return entry;
}

/** Let go of one reference; the last owner disposes the texture. */
function release(entry: CachedTag): void {
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.texture.dispose();
  // A newer entry may have taken the key since this one was last released — leave it be.
  if (cache.get(entry.key) === entry) cache.delete(entry.key);
}

/** How many textures are cached right now — for tests. */
export function nametagCacheSize(): number {
  return cache.size;
}

// ── the tag ───────────────────────────────────────────────────────────────────

/** Below this opacity the sprite is not drawn at all. */
const HIDDEN_OPACITY = 0.01;

/** Create a nametag for `text`, positioned above the avatar's head. */
export function createNametag(text: string, badge: NametagBadge = "none"): Nametag {
  let highlight = false;
  let typing = false;
  let heightM = NAMETAG_BASE_HEIGHT_M;
  let entry = acquire(text, badge, highlight, typing);
  let disposed = false;

  const sprite = billboardSprite(entry.texture, entry.aspect, heightM, 999);
  sprite.position.set(0, NAMETAG_HEIGHT, 0);
  const material = sprite.material as SpriteMaterial;

  /** Show the look for the current flags: take the new texture first, then let go of the old. */
  function swapLook(): void {
    if (disposed) return; // a disposed tag owns nothing: switching now would leak a texture reference
    const next = acquire(text, badge, highlight, typing);
    release(entry);
    entry = next;
    material.map = next.texture;
    sprite.scale.x = heightM * next.aspect;
  }

  return {
    sprite,
    setHeight(h) {
      heightM = h;
      sprite.scale.set(h * entry.aspect, h, 1);
    },
    setOpacity(opacity) {
      material.opacity = opacity;
      sprite.visible = opacity > HIDDEN_OPACITY;
    },
    setOffsetY(offsetM) {
      sprite.position.y = NAMETAG_HEIGHT + offsetM;
    },
    setHighlight(on) {
      if (on === highlight) return;
      highlight = on;
      swapLook();
    },
    setTyping(on) {
      if (on === typing) return;
      typing = on;
      swapLook();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      material.dispose();
      release(entry);
    },
  };
}
