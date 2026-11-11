/**
 * Canvas-generated nametag sprites (controls-ux Task 13): a white rounded capsule with
 * dark text, an optional teacher crown / AI pill, and two transient variants — a
 * highlight border and a trailing "…" while the player types. Colors are placeholders
 * until the new-world design lands (spec §7).
 *
 * Each distinct look — keyed `badge|highlight|typing|text` — is rasterized onto a
 * canvas + GPU texture the FIRST time it is needed and shared by every avatar that
 * shows it, through a reference-counted module cache: roster churn never re-rasterizes,
 * and a texture's GPU copy is freed (`dispose`) as soon as its last owner lets go. A tag
 * can switch looks at any time (setHighlight / setTyping) and always releases the one it
 * leaves. Each tag still owns its own SpriteMaterial (disposed with it) so opacity never
 * bleeds between avatars.
 *
 * A released look is not thrown away: its canvas stays in a bounded pool of idle looks
 * (NAMETAG_IDLE_LOOKS, oldest dropped first), so a tag that types, speaks and goes quiet
 * again — three look switches per chat line — gets its old look back without
 * rasterizing a new canvas each time (measured: that was ~1 ms per switch on a throttled
 * phone-class CPU, and the largest part of the name tags' frame cost). three re-uploads
 * a disposed texture by itself when it is drawn again.
 *
 * The per-frame setters (setHeight / setOpacity / setOffsetY, setTextDevicePx, and setHighlight /
 * setTyping while unchanged) allocate nothing and touch no React state.
 *
 * Crisp text (fix/crisp-labels, spriteCanvas.ts): a look is rasterized at the size it is SHOWN at — its font in whole
 * device pixels (the tag's projected text height x dpr, `setTextDevicePx`), every other metric scaled from the 48 px design
 * and rounded to whole pixels — and drawn one texel per screen pixel by the label shader. The font size is part of the
 * look's key, so a tag that walks nearer moves through a few sizes (12-16 CSS px: 7 sizes at dpr 1.5), each rasterized
 * once and kept like any other look; a frame rasterizes at most RASTERS_PER_FRAME new ones (the rest wait a frame).
 */

import { CanvasTexture, Sprite, SpriteMaterial } from "three";
import {
  NAMETAG_BASE_HEIGHT_M,
  NAMETAG_FONT_PX,
  NAMETAG_HEIGHT,
  NAMETAG_PAD_Y_PX,
} from "./constants";
import {
  LABEL_SNAP,
  billboardSprite,
  canvas2d,
  canvasTexture,
  fontBucket,
  roundRect,
  takeRasterBudget,
} from "./spriteCanvas";

/** Who the tag belongs to: a student/other (none), the teacher (👑 + gold border), or an AI 조교 (AI pill). */
export type NametagBadge = "none" | "teacher" | "ai";

export interface Nametag {
  /** The sprite to add above the avatar's head. */
  sprite: Sprite;
  /** World height (m) of the whole tag; the width follows the current look's aspect ratio. */
  setHeight(heightM: number): void;
  /** 0..1; at or below 0.01 the sprite is hidden outright (no draw call). */
  setOpacity(opacity: number): void;
  /** Lift the tag by `offsetM` above its resting height (the one it was created with + offset). */
  setOffsetY(offsetM: number): void;
  /** Blue highlight border (somebody just spoke). */
  setHighlight(on: boolean): void;
  /** A trailing " …" (the player is typing a chat line). */
  setTyping(on: boolean): void;
  /**
   * The tag's text is `px` DEVICE pixels tall on screen now (projected CSS px x dpr): re-rasterize at that whole-pixel font
   * size when it has moved far enough from the current one (fontBucket) and this frame's raster budget allows.
   */
  setTextDevicePx(px: number): void;
  /** Dispose the per-avatar material and release the shared texture. Safe to call twice. */
  dispose(): void;
}

// ── look ──────────────────────────────────────────────────────────────────────

/** Korean + Latin + emoji on Windows, macOS and Android; measured with this same stack. */
export const FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", ' +
  '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const TEXT_WEIGHT = 600;

const CAPSULE_FILL = "rgba(255, 255, 255, 0.92)";
const TEXT_COLOR = "#1d1b2e";
const TEACHER_BORDER = "#e0a100";
const HIGHLIGHT_BORDER = "#4f8cff";
const AI_PILL_FILL = "#5b4bd8";
const AI_PILL_TEXT = "#ffffff";
const AI_PILL_LABEL = "AI";

/** The smallest and largest font (device px) a tag is rasterized at: 12-16 CSS px from dpr 0.67 to 4. */
export const NAMETAG_MIN_FONT_PX = 8;
export const NAMETAG_MAX_FONT_PX = 64;

/** Every size of a tag drawn at font `fontPx`, in whole canvas pixels (the 48 px design scaled, then rounded). */
export interface NametagMetrics {
  font: number;
  /** Canvas height: font + 2 x padY (so the text is ~NAMETAG_TEXT_FRACTION of the tag at any size). */
  height: number;
  padY: number;
  /** Horizontal padding between the capsule's edge and the text. */
  padX: number;
  teacherBorder: number;
  highlightBorder: number;
  pillFont: number;
  pillHeight: number;
  pillPadX: number;
  /** Space between the capsule's left edge and the AI pill / between the pill and the text. */
  pillInset: number;
  pillGap: number;
  /** Text baseline (textBaseline "middle") below the canvas's centre. */
  textDy: number;
}

/** The 48 px design (NAMETAG_FONT_PX) scaled to a `fontPx` font and rounded to whole pixels — so edges fall on pixels. */
export function nametagMetrics(fontPx: number): NametagMetrics {
  const font = Math.max(1, Math.round(fontPx));
  const k = font / NAMETAG_FONT_PX;
  const padY = Math.round(NAMETAG_PAD_Y_PX * k);
  return {
    font,
    height: font + 2 * padY,
    padY,
    padX: Math.round(26 * k),
    teacherBorder: Math.max(1, Math.round(3 * k)),
    highlightBorder: Math.max(1, Math.round(4 * k)),
    pillFont: Math.max(1, Math.round(26 * k)),
    pillHeight: Math.round(40 * k),
    pillPadX: Math.round(14 * k),
    pillInset: Math.round(16 * k),
    pillGap: Math.round(12 * k),
    textDy: Math.round(2 * k),
  };
}

/** The string drawn in the dark text color: crown prefix for a teacher, " …" while typing. */
export function nametagLabel(text: string, badge: NametagBadge, typing: boolean): string {
  return (badge === "teacher" ? "👑 " : "") + text + (typing ? " …" : "");
}

/** Cache key: one texture per distinct look and font size. */
export function nametagCacheKey(
  text: string,
  badge: NametagBadge,
  highlight: boolean,
  typing: boolean,
  fontPx: number = NAMETAG_FONT_PX,
): string {
  return `${fontPx}|${badge}|${highlight ? 1 : 0}|${typing ? 1 : 0}|${text}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(font: string, s: string): number {
  measureCtx ??= canvas2d(document.createElement("canvas"));
  measureCtx.font = font;
  return Math.ceil(measureCtx.measureText(s).width);
}

/** Rasterize one look onto a snug canvas, at font `fontPx` (whole pixels: positions are whole too). */
function renderCanvas(
  text: string,
  badge: NametagBadge,
  highlight: boolean,
  typing: boolean,
  fontPx: number,
): { canvas: HTMLCanvasElement; aspect: number } {
  const m = nametagMetrics(fontPx);
  const textFont = `${TEXT_WEIGHT} ${m.font}px ${FONT_FAMILY}`;
  const pillFont = `700 ${m.pillFont}px ${FONT_FAMILY}`;
  const label = nametagLabel(text, badge, typing);
  const labelWidth = measure(textFont, label);
  const pillWidth = badge === "ai" ? measure(pillFont, AI_PILL_LABEL) + 2 * m.pillPadX : 0;
  const textX = badge === "ai" ? m.pillInset + pillWidth + m.pillGap : m.padX;
  const width = textX + labelWidth + m.padX;
  const height = m.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas2d(canvas);

  // Capsule.
  ctx.fillStyle = CAPSULE_FILL;
  roundRect(ctx, 0, 0, width, height, height / 2);
  ctx.fill();

  // Border, drawn inside the canvas edge: the highlight wins over the teacher's gold.
  const borderPx = highlight ? m.highlightBorder : badge === "teacher" ? m.teacherBorder : 0;
  if (borderPx > 0) {
    ctx.lineWidth = borderPx;
    ctx.strokeStyle = highlight ? HIGHLIGHT_BORDER : TEACHER_BORDER;
    roundRect(ctx, borderPx / 2, borderPx / 2, width - borderPx, height - borderPx, (height - borderPx) / 2);
    ctx.stroke();
  }

  ctx.textBaseline = "middle";
  const midY = Math.round(height / 2);

  // AI pill.
  if (badge === "ai") {
    const pillY = Math.round((height - m.pillHeight) / 2);
    ctx.fillStyle = AI_PILL_FILL;
    roundRect(ctx, m.pillInset, pillY, pillWidth, m.pillHeight, m.pillHeight / 2);
    ctx.fill();
    ctx.font = pillFont;
    ctx.textAlign = "center";
    ctx.fillStyle = AI_PILL_TEXT;
    ctx.fillText(AI_PILL_LABEL, m.pillInset + Math.round(pillWidth / 2), midY + Math.round(m.textDy / 2));
  }

  // Text.
  ctx.font = textFont;
  ctx.textAlign = "left";
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(label, textX, midY + m.textDy);

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

/** Every cached look, shown or idle. */
const cache = new Map<string, CachedTag>();
/**
 * The looks nobody shows right now (refs === 0), least recently released first — a Map
 * keeps insertion order, so the first key is the oldest. Their textures are already
 * disposed (GPU copy gone); only the canvas is kept.
 */
const idle = new Map<string, CachedTag>();

/**
 * How many released looks are kept for reuse (≈ 96 × 10-40 KB of canvas at the shown sizes). Covers ~30 chatty players'
 * variants, or a dozen tags' last few sizes.
 */
export const NAMETAG_IDLE_LOOKS = 96;

/** Whether the look is rasterized already (shown or parked): taking it costs no canvas draw. */
function hasLook(text: string, badge: NametagBadge, highlight: boolean, typing: boolean, fontPx: number): boolean {
  return cache.has(nametagCacheKey(text, badge, highlight, typing, fontPx));
}

function acquire(text: string, badge: NametagBadge, highlight: boolean, typing: boolean, fontPx: number): CachedTag {
  const key = nametagCacheKey(text, badge, highlight, typing, fontPx);
  let entry = cache.get(key);
  if (!entry) {
    const { canvas, aspect } = renderCanvas(text, badge, highlight, typing, fontPx);
    // Shown at one texel per pixel (the label shader): no mipmaps, a plain linear filter.
    const texture = canvasTexture(canvas);
    entry = { key, texture, aspect, refs: 0 };
    cache.set(key, entry);
  } else if (entry.refs === 0) {
    idle.delete(key); // back in use
  }
  entry.refs += 1;
  return entry;
}

/** Let go of one reference; the last owner frees the GPU copy and parks the canvas in the idle pool. */
function release(entry: CachedTag): void {
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.texture.dispose();
  idle.set(entry.key, entry);
  while (idle.size > NAMETAG_IDLE_LOOKS) {
    const [oldestKey, oldest] = idle.entries().next().value as [string, CachedTag];
    idle.delete(oldestKey);
    if (cache.get(oldestKey) === oldest) cache.delete(oldestKey);
  }
}

/** How many looks are shown by some tag right now — for tests. */
export function nametagCacheSize(): number {
  return cache.size - idle.size;
}

/** How many released looks are parked for reuse — for tests. */
export function nametagIdleSize(): number {
  return idle.size;
}

/** Drop every parked look (tests; a fresh world). Looks that a tag still shows are untouched. */
export function clearIdleNametagLooks(): void {
  for (const key of idle.keys()) cache.delete(key);
  idle.clear();
}

// ── the tag ───────────────────────────────────────────────────────────────────

/** Below this opacity the sprite is not drawn at all. */
const HIDDEN_OPACITY = 0.01;

/**
 * The font a new tag starts at: the size the last tag was sized to (a new tag usually shows at about the same size), so
 * it is not rasterized once at a size it is never shown at. NAMETAG_FONT_PX until a tag has been sized.
 */
let startFontPx: number = NAMETAG_FONT_PX;

/** Forget the remembered start size (tests). */
export function resetNametagStartFont(): void {
  startFontPx = NAMETAG_FONT_PX;
}

/**
 * Create a nametag for `text`, positioned above the avatar's head. `restHeightM` is the height of
 * the sprite's centre above the avatar's group at rest (an avatar passes nametagRestHeight of its
 * top, so a hat or halo never pokes through the tag); the default is NAMETAG_HEIGHT.
 */
export function createNametag(
  text: string,
  badge: NametagBadge = "none",
  restHeightM: number = NAMETAG_HEIGHT,
): Nametag {
  let highlight = false;
  let typing = false;
  let heightM = NAMETAG_BASE_HEIGHT_M;
  let fontPx = startFontPx;
  let entry = acquire(text, badge, highlight, typing, fontPx);
  let disposed = false;

  const sprite = billboardSprite(entry.texture, entry.aspect, heightM, 999, { snap: LABEL_SNAP });
  sprite.position.set(0, restHeightM, 0);
  const material = sprite.material as SpriteMaterial;

  /** Show the look for the current flags: take the new texture first, then let go of the old. */
  function swapLook(): void {
    if (disposed) return; // a disposed tag owns nothing: switching now would leak a texture reference
    const next = acquire(text, badge, highlight, typing, fontPx);
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
      sprite.position.y = restHeightM + offsetM;
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
    setTextDevicePx(px) {
      if (disposed) return;
      const next = fontBucket(px, fontPx, NAMETAG_MIN_FONT_PX, NAMETAG_MAX_FONT_PX);
      if (next === fontPx) return;
      if (!hasLook(text, badge, highlight, typing, next) && !takeRasterBudget()) return; // next frame
      fontPx = next;
      startFontPx = next;
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
