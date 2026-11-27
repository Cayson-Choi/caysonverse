/**
 * Shared canvas -> sprite plumbing for above-avatar UI (nametags, speech bubbles, emoji reactions, the overview's room
 * names). One pipeline: rasterize onto a 2D canvas, wrap it in a CanvasTexture, and mount it as a depth-independent
 * billboard sprite. Every label builds on these primitives so there is a single canvas/texture/sprite path, never two.
 *
 * Crisp text (fix/crisp-labels — the owner: "글씨가 왜 이렇게 흐리게 나오는거야?", and on a phone 2026-11-27: "모바일에서 왜
 * 이렇게 글자 가독성이 안좋지? ... 닉네임을 봐봐"). The labels came out soft for these reasons, each fixed here or by the code
 * that sizes them:
 *  1. They were drawn INTO the WebGL canvas, at its resolution. A phone's canvas is drawn at dpr 1 (the light tier:
 *     renderProfile / quality.ts, for the frame rate) and the browser stretches it ~3x over a dpr-3 screen, so every glyph
 *     came out three device pixels wide and soft, next to the HUD's sharp HTML text; the rich tier stretched them by its
 *     frame governor's render scale, FXAA'd and tone-mapped them. WebGL no longer draws them at all: the label overlay
 *     (labelOverlay.ts) draws every label sprite's canvas on a 2D canvas laid over the WebGL one at the DEVICE's pixel
 *     ratio, after the frame — no stretch, no FXAA, no tone curve, no fog — while the 3D scene keeps its own resolution.
 *  2. A tag's text was rasterized at 48 px and shown at 12-16 CSS px. The tags and bubbles are now rasterized at the size
 *     they are SHOWN at, in device pixels (font px = on-screen CSS px x the device's dpr, `labelPixelRatio`, re-rasterized
 *     only when that whole-pixel bucket changes: `fontBucket`).
 *  3. Even at the right size a label lands on a fractional pixel position, and filtering then spreads every glyph edge over
 *     two pixels. The overlay draws a label whose projected size is within `snap` of its canvas's size at EXACTLY the
 *     canvas's size, its corner on a whole device pixel (`placeLabel`): every texel lands on one screen pixel, as the
 *     browser's own text does. Farther from it (a size the canvas was not made for yet) it draws the projected size.
 * Sprites that are not text keep a smooth, unsnapped size (the emoji: a 256 px glyph scaled down with high-quality
 * smoothing).
 *
 * The labels stay three.js Sprites on LABEL_LAYER (parented to their avatars, sized and faded by their owners as before);
 * their CanvasTexture is only the holder of the canvas the overlay draws — no camera sees the layer, so it is never
 * uploaded to the GPU.
 */

import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, SRGBColorSpace } from "three";

/**
 * The layer every label sprite is on (and only on). No camera sees it: WebGL never draws a label, the label overlay does
 * (labelOverlay.ts). The rich tier's post chain still takes it out of its scene pass, in case a camera was told to.
 */
export const LABEL_LAYER = 30;

/**
 * How far (as a share) a text label's projected size may be from its texture's for it to be drawn at exactly the texture's
 * size, pixel-aligned. Its texture is made for the size it is shown at (within half a font pixel, `fontBucket`), so in
 * practice it always is; 0.2 still covers the smallest fonts' rounding (an 8 px font: its 2 px paddings are ±0.5 px).
 */
export const LABEL_SNAP = 0.3;

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

/** A CanvasTexture holding a label's canvas (the overlay draws the canvas; the texture is never uploaded): no mipmaps, linear, sRGB. */
export function canvasTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * The whole-pixel font size to rasterize a text label at, for text that shows `desiredPx` device pixels tall now and was
 * last rasterized at `currentPx`: the nearest whole pixel, kept inside [min, max] — but the current size stays until the
 * wanted one is at least `hysteresis` px away from it, so a size hovering on a half pixel (a camera bobbing with the walk)
 * does not re-rasterize every frame. A non-finite or non-positive `desiredPx` keeps the current size.
 */
export function fontBucket(desiredPx: number, currentPx: number, min: number, max: number, hysteresis = 0.75): number {
  if (!(desiredPx > 0) || !Number.isFinite(desiredPx)) return currentPx;
  const d = Math.min(max, Math.max(min, desiredPx));
  if (Math.abs(d - currentPx) < hysteresis) return currentPx;
  return Math.min(max, Math.max(min, Math.round(d)));
}

/** New label canvases one frame may rasterize for size changes (a canvas draw + upload: ~0.2-1 ms each on a slow CPU). */
export const RASTERS_PER_FRAME = 2;
let budgetFrame = Number.NaN;
let budgetLeft = 0;

/** The current frame's key: the rAF timestamp (`document.timeline.currentTime` is the same for all of a frame's callbacks). */
function frameKey(): number {
  const t = typeof document === "undefined" ? undefined : document.timeline?.currentTime;
  return typeof t === "number" ? t : performance.now();
}

/**
 * Take one of this frame's re-rasterizations (true), or none is left (false: keep the current texture and ask again next
 * frame). `frame` identifies the frame (default: its rAF timestamp); a new value starts a fresh budget.
 */
export function takeRasterBudget(frame: number = frameKey(), perFrame: number = RASTERS_PER_FRAME): boolean {
  if (frame !== budgetFrame) {
    budgetFrame = frame;
    budgetLeft = perFrame;
  }
  if (budgetLeft <= 0) return false;
  budgetLeft -= 1;
  return true;
}

// ── the label sprite ─────────────────────────────────────────────────────────

/** Every live label sprite (made by `billboardSprite`, gone when its material is disposed): what the label overlay draws. */
const liveLabels = new Set<Sprite>();

/** The label sprites alive now (labelOverlay.ts draws the ones that are in the scene and visible). Read-only. */
export function labelSprites(): ReadonlySet<Sprite> {
  return liveLabels;
}

/** What the label overlay needs to know about a label sprite beyond the sprite itself. */
export interface LabelSpriteInfo {
  /** Pixel snap tolerance (see LABEL_SNAP); 0: always drawn at its projected size. */
  snap: number;
}

export interface LabelSpriteOptions {
  /** Pixel snap tolerance (LABEL_SNAP for text; 0, the default: always the projected size, never snapped). */
  snap?: number;
}

/** The overlay's per-sprite settings (`billboardSprite` writes them; a sprite made otherwise reads as unsnapped). */
export function labelInfo(sprite: Sprite): LabelSpriteInfo {
  return (sprite.userData.label as LabelSpriteInfo | undefined) ?? { snap: 0 };
}

/**
 * A billboard sprite showing `texture`, `heightM` metres tall with width from the canvas `aspect`, on LABEL_LAYER. WebGL
 * never draws it (no camera sees LABEL_LAYER): the label overlay (labelOverlay.ts) draws its canvas (`material.map.image`)
 * at the sprite's projected place, with `material.opacity`, in `renderOrder` order, at the device's own pixel ratio. Each
 * sprite gets its OWN material (disposed by the caller: that also takes it off the overlay) so per-sprite state never
 * bleeds between avatars. The material keeps the settings a WebGL draw would need (no depth, no tone mapping, no fog) so
 * the sprite still reads right if a camera is ever told to see the layer.
 */
export function billboardSprite(
  texture: CanvasTexture,
  aspect: number,
  heightM: number,
  renderOrder: number,
  options: LabelSpriteOptions = {},
): Sprite {
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const sprite = new Sprite(material);
  sprite.scale.set(heightM * aspect, heightM, 1);
  sprite.renderOrder = renderOrder;
  sprite.layers.set(LABEL_LAYER);
  sprite.userData.label = { snap: options.snap ?? 0 } satisfies LabelSpriteInfo;
  liveLabels.add(sprite);
  material.addEventListener("dispose", () => liveLabels.delete(sprite));
  return sprite;
}
