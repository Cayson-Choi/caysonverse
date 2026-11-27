/**
 * The label overlay (fix/crisp-labels, owner 2026-11-27: "모바일에서 왜 이렇게 글자 가독성이 안좋지? 뭔가 또렷하지않아 닉네임을
 * 봐봐"): every label sprite (name tags, speech bubbles, emoji; spriteCanvas.ts `billboardSprite`) is drawn on a transparent
 * 2D canvas laid over the WebGL canvas, at the DEVICE's pixel ratio — not by WebGL into the 3D canvas.
 *
 * Why: a phone's 3D canvas is drawn at dpr 1 (the light tier, for the frame rate: renderProfile.ts / quality.ts) and the
 * browser stretches it ~3x over a dpr-3 screen. A label drawn into it was three device pixels per texel — soft, next to the
 * HUD's HTML text, which the browser draws at the screen's own resolution. Raising the canvas's dpr would cost the whole
 * scene ~9x the pixels. The overlay costs a few small image copies per frame: the labels are already rasterized canvases
 * (made at the size they are shown, in device pixels), so drawing one is a 1:1 copy at a whole-pixel position.
 *
 * What it draws, each frame (NametagSystem's after-effect, after the frame is drawn, so the matrices are this frame's —
 * the same ones WebGL drew the scene with): every live label sprite that is in `scene`, visible together with all its
 * ancestors, with a map canvas and an opacity above zero, in front of the camera and on screen; ordered as three orders
 * transparent sprites (renderOrder, then far to near); at the place the sprite projects to (`placeLabel`: the anchor's
 * projection, the sprite's `center`, its world scale), with globalAlpha = the material's opacity. A text label whose
 * projected size is within its `snap` of its canvas's size is drawn at exactly the canvas's size with its corner on a
 * whole device pixel, so every texel is one screen pixel.
 *
 * Only what the previous frame drew is cleared (its rects), unless that is many rects. Nothing per frame allocates beyond
 * a pool of entries that grows to the most labels seen.
 */

import type { Camera, Object3D, Sprite, SpriteMaterial } from "three";
import { labelInfo, labelSprites } from "./spriteCanvas";

/** The overlay's pixel ratio is the device's, held inside [MIN, MAX] (a dpr-5 screen gains nothing visible past 4). */
export const MIN_LABEL_DPR = 0.5;
export const MAX_LABEL_DPR = 4;

/**
 * The pixel ratio the labels are drawn and rasterized at: the device's own (window.devicePixelRatio), not the 3D canvas's.
 * A tag's font is its on-screen CSS height times this (nametagFrame / useSpeechBubble).
 */
export function labelPixelRatio(): number {
  const d = typeof window === "undefined" ? 1 : Number(window.devicePixelRatio) || 1;
  return Math.min(MAX_LABEL_DPR, Math.max(MIN_LABEL_DPR, d));
}

/** Where one label is drawn on the overlay: device px, top-left origin. `depth` is the anchor's clip w (larger = farther). */
export interface LabelPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

/**
 * Place a label sprite on a `W` x `H` device-pixel overlay — the label vertex shader's rule (and three's sprite shader's,
 * for an unsnapped one), on the CPU. `world` is the sprite's matrixWorld elements (its anchor and scale), `view` the
 * camera's matrixWorldInverse, `proj` its projectionMatrix (all column-major, as three keeps them), `centerX/Y` the
 * sprite's center (0..1, y up), `texW x texH` its canvas's size. Returns false when the anchor is behind the camera or past
 * the far plane.
 */
export function placeLabel(
  world: ArrayLike<number>,
  view: ArrayLike<number>,
  proj: ArrayLike<number>,
  centerX: number,
  centerY: number,
  texW: number,
  texH: number,
  snap: number,
  W: number,
  H: number,
  out: LabelPlacement,
): boolean {
  const wx = world[12]!;
  const wy = world[13]!;
  const wz = world[14]!;
  const mx = view[0]! * wx + view[4]! * wy + view[8]! * wz + view[12]!;
  const my = view[1]! * wx + view[5]! * wy + view[9]! * wz + view[13]!;
  const mz = view[2]! * wx + view[6]! * wy + view[10]! * wz + view[14]!;
  const cx = proj[0]! * mx + proj[4]! * my + proj[8]! * mz + proj[12]!;
  const cy = proj[1]! * mx + proj[5]! * my + proj[9]! * mz + proj[13]!;
  const cz = proj[2]! * mx + proj[6]! * my + proj[10]! * mz + proj[14]!;
  const cw = proj[3]! * mx + proj[7]! * my + proj[11]! * mz + proj[15]!;
  if (!(cw > 1e-6) || cz > cw || cz < -cw) return false;
  const sx = Math.hypot(world[0]!, world[1]!, world[2]!);
  const sy = Math.hypot(world[4]!, world[5]!, world[6]!);
  const sizeW = ((sx * proj[0]!) / cw) * 0.5 * W;
  const sizeH = ((sy * proj[5]!) / cw) * 0.5 * H;
  const ax = ((cx / cw) * 0.5 + 0.5) * W;
  const ay = (0.5 - (cy / cw) * 0.5) * H;
  const tw = Math.max(1, texW);
  const th = Math.max(1, texH);
  out.depth = cw;
  if (snap > 0 && Math.abs(sizeW / tw - 1) <= snap && Math.abs(sizeH / th - 1) <= snap) {
    // One texel per pixel, the corner on a whole pixel.
    out.w = tw;
    out.h = th;
    out.x = Math.floor(ax - centerX * tw + 0.5);
    out.y = Math.floor(ay - (1 - centerY) * th + 0.5);
  } else {
    out.w = sizeW;
    out.h = sizeH;
    out.x = ax - centerX * sizeW;
    out.y = ay - (1 - centerY) * sizeH;
  }
  return true;
}

interface Entry extends LabelPlacement {
  order: number;
  alpha: number;
  image: CanvasImageSource;
}

/** Past this many rects to clear, one clear of the whole overlay is cheaper. */
const MAX_DIRTY_RECTS = 48;

/** The minimum of the 2D context the overlay uses (a test passes a recording stand-in). */
export type OverlayContext = Pick<
  CanvasRenderingContext2D,
  "clearRect" | "drawImage" | "globalAlpha" | "imageSmoothingEnabled" | "imageSmoothingQuality"
>;

export interface OverlayCanvas {
  width: number;
  height: number;
  style: Partial<CSSStyleDeclaration> | CSSStyleDeclaration;
  getContext(kind: "2d", options?: CanvasRenderingContext2DSettings): OverlayContext | null;
  remove?(): void;
}

/** One overlay per 3D canvas. `canvas` goes into the 3D canvas's container (NametagSystem), over it. */
export class LabelOverlay {
  readonly canvas: OverlayCanvas;
  private readonly ctx: OverlayContext;
  private readonly entries: Entry[] = [];
  private readonly pool: Entry[] = [];
  /** x, y, w, h of every rect drawn on the last frame (whole pixels, grown by one). */
  private dirty: number[] = [];
  private cssW = -1;
  private cssH = -1;
  /** How many labels the last draw drew, and what it cost (ms): the DEV probe. */
  lastDrawn = 0;
  lastMs = 0;
  /** Sums over every draw since the overlay was made (the e2e perf probe reads their change over a window). */
  totalMs = 0;
  totalFrames = 0;
  totalDrawn = 0;

  constructor(canvas?: OverlayCanvas) {
    this.canvas = canvas ?? (document.createElement("canvas") as unknown as OverlayCanvas);
    const ctx = this.canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    const s = this.canvas.style;
    s.position = "absolute";
    s.left = "0";
    s.top = "0";
    s.pointerEvents = "none";
    s.display = "block";
  }

  /** Size the overlay to `cssW x cssH` CSS px at `dpr` (resizing clears it). */
  private fit(cssW: number, cssH: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (cssW !== this.cssW || cssH !== this.cssH) {
      this.cssW = cssW;
      this.cssH = cssH;
      this.canvas.style.width = `${cssW}px`;
      this.canvas.style.height = `${cssH}px`;
    }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.dirty.length = 0; // a resize clears the canvas
    }
  }

  /** Draw this frame's labels of `scene` as `camera` sees them, over a `cssW x cssH` view, at `dpr`. Returns how many. */
  draw(scene: Object3D, camera: Camera, cssW: number, cssH: number, dpr: number = labelPixelRatio()): number {
    const t0 = performance.now();
    this.fit(cssW, cssH, dpr);
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx = this.ctx;

    // clear what the last frame drew
    const d = this.dirty;
    if (d.length > MAX_DIRTY_RECTS * 4) ctx.clearRect(0, 0, W, H);
    else for (let i = 0; i < d.length; i += 4) ctx.clearRect(d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!);
    d.length = 0;

    // collect
    const entries = this.entries;
    entries.length = 0;
    const view = camera.matrixWorldInverse.elements;
    const proj = camera.projectionMatrix.elements;
    for (const sprite of labelSprites()) {
      const material = sprite.material as SpriteMaterial;
      const alpha = material.opacity;
      if (!(alpha > 0)) continue;
      const image = material.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
      if (!image || !(image.width > 0) || !(image.height > 0)) continue;
      if (!shownIn(sprite, scene)) continue;
      const e = this.pool[entries.length] ?? (this.pool[entries.length] = { x: 0, y: 0, w: 0, h: 0, depth: 0, order: 0, alpha: 0, image });
      if (!placeLabel(sprite.matrixWorld.elements, view, proj, sprite.center.x, sprite.center.y, image.width, image.height, labelInfo(sprite).snap, W, H, e)) continue;
      if (e.x >= W || e.y >= H || e.x + e.w <= 0 || e.y + e.h <= 0 || !(e.w >= 0.5) || !(e.h >= 0.5)) continue;
      e.order = sprite.renderOrder;
      e.alpha = Math.min(1, alpha);
      e.image = image;
      entries.push(e);
    }
    entries.sort(byDrawOrder);

    // draw
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (const e of entries) {
      ctx.globalAlpha = e.alpha;
      ctx.drawImage(e.image, e.x, e.y, e.w, e.h);
      const x0 = Math.max(0, Math.floor(e.x) - 1);
      const y0 = Math.max(0, Math.floor(e.y) - 1);
      d.push(x0, y0, Math.min(W, Math.ceil(e.x + e.w) + 1) - x0, Math.min(H, Math.ceil(e.y + e.h) + 1) - y0);
    }
    ctx.globalAlpha = 1;
    this.lastDrawn = entries.length;
    entries.length = 0; // keep no image alive past the frame (the pool keeps its last, until reused)
    this.lastMs = performance.now() - t0;
    this.totalMs += this.lastMs;
    this.totalFrames += 1;
    this.totalDrawn += this.lastDrawn;
    return this.lastDrawn;
  }

  /** Take the overlay off the page. */
  dispose(): void {
    this.canvas.remove?.();
    this.entries.length = 0;
    this.pool.length = 0;
    this.dirty.length = 0;
  }
}

/** three's order for transparent sprites: renderOrder, then far to near. */
function byDrawOrder(a: Entry, b: Entry): number {
  return a.order - b.order || b.depth - a.depth;
}

/** The sprite and all its ancestors are visible, and its root is `scene`. */
function shownIn(sprite: Sprite, scene: Object3D): boolean {
  let o: Object3D = sprite;
  for (;;) {
    if (!o.visible) return false;
    if (!o.parent) return o === scene;
    o = o.parent;
  }
}
