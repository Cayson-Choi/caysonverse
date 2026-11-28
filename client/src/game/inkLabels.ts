import type { Object3D } from "three";
import { acesFilmic, neutralToneMap } from "./quality";

/**
 * The scene's signs drawn crisp on a phone (fix/text-crisp2, owner 2026-11-28: the houses' number plates, the hall's zone signs,
 * the gate's welcome board, the lake's finger posts and the park's shop signs were only a little sharper after fix/pine-text, and on
 * a phone still soft).
 *
 * Why they stay soft in WebGL: the phone draws the scene at dpr 1 and the browser stretches it ~3x; a glyph is then a few
 * framebuffer pixels however sharp its texture is. So a sign's LETTERS (its "ink": only the lettering, on a transparent ground) are
 * drawn on the label overlay (labelOverlay.ts), at the device's own pixel ratio, mapped onto the sign's plane — while the sign's
 * BOARD stays in the 3D scene with its light, its shadows and its wood. While the overlay draws a sign's ink, its 3D ink is hidden
 * (`setInk(false)`: the sign shows its board-only texture), so there is one copy of the letters, the crisp one.
 *
 * What keeps it honest (inkLayer.ts):
 *  - walls, trees and avatars still hide the letters: the sign's plane is split into cells, and each cell is tested against the
 *    frame's depth buffer with a WebGL2 occlusion query; the overlay draws only the cells that passed;
 *  - the letters take the sign's light: a few pixels of the board are read back (async) and give the light falling on it, and the
 *    ink's colours go through that light and the renderer's tone curve (`InkTone`), as the 3D ink's did.
 * Where the scene is drawn at the device's resolution already (a PC at dpr 1, the rich tier's post chain), none of this runs: the
 * 3D ink is shown as before.
 */

/** Maps an sRGB albedo colour (css: #rgb, #rrggbb, rgb(), rgba()) to the colour it shows at under the sign's light now. */
export type InkTone = (css: string) => string;

export interface InkLabel {
  /** Its matrixWorld places the `w` x `h` (m) rectangle centred on its origin, in its local x-y plane, facing +z. Stays visible. */
  object: Object3D;
  w: number;
  h: number;
  /**
   * Paint the lettering on a transparent `w` x `h` canvas (px, the sign's own aspect: `w / h` = the label's), every colour
   * through `tone`. Called when the size or the light changes (cached in between).
   */
  paint(g: CanvasRenderingContext2D, w: number, h: number, tone: InkTone): void;
  /**
   * The light on it: read from the frame at this spot of the board (local m; plain board there, no lettering), whose sRGB albedo
   * is `albedo`. Without a probe the light is `light()` (default 1: an unlit sign, MeshBasicMaterial with a white colour).
   */
  probe?: { x: number; y: number; albedo: string };
  light?: () => number;
  /** Show (true) or hide (false) the sign's own 3D lettering. */
  setInk(on3d: boolean): void;
}

const labels = new Set<InkLabel>();
let version = 0;

/** Draw `label`'s ink on the overlay when it can (from the next frame on); the returned function takes it off (its 3D ink back on). */
export function addInkLabel(label: InkLabel): () => void {
  labels.add(label);
  version++;
  return () => {
    if (!labels.delete(label)) return;
    version++;
    label.setInk(true);
  };
}

/** The registered labels (the ink layer walks them each frame). */
export function inkLabels(): ReadonlySet<InkLabel> {
  return labels;
}

/** Changes whenever a label is added or removed. */
export function inkLabelsVersion(): number {
  return version;
}

// ───────────────────────────── sizes ─────────────────────────────

/** Raster steps: a quarter octave (the raster is at most 19% larger than the sign on screen, drawn down with smoothing). */
export const INK_STEPS_PER_OCTAVE = 4;
export const INK_MAX_W = 2048;
export const INK_MAX_H = 768;

/** The raster size for a sign `px` device px on screen: the next quarter-octave step up, within [8, max]. */
export function inkBucket(px: number, max: number): number {
  const p = Math.max(8, px);
  const b = Math.round(2 ** (Math.ceil(Math.log2(p) * INK_STEPS_PER_OCTAVE - 1e-9) / INK_STEPS_PER_OCTAVE));
  return Math.min(max, Math.max(8, b));
}

// ───────────────────────────── colour ─────────────────────────────

export type ToneCurveId = "neutral" | "aces" | "linear" | "none";

/** sRGB 0..1 -> linear. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** linear -> sRGB 0..1 (clamped). */
export function linearToSrgb(c: number): number {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** A css colour (#rgb, #rrggbb, rgb(), rgba()) as sRGB 0..1 and alpha; null when it is none of those. */
export function parseCss(css: string): [number, number, number, number] | null {
  const s = css.trim();
  if (s[0] === "#") {
    const h = s.slice(1);
    if (h.length === 3) return [parseInt(h[0]! + h[0]!, 16) / 255, parseInt(h[1]! + h[1]!, 16) / 255, parseInt(h[2]! + h[2]!, 16) / 255, 1];
    if (h.length === 6 || h.length === 8)
      return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    return null;
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (!m) return null;
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, m[4] === undefined ? 1 : Number(m[4])];
}

/** The renderer's tone curve on linear `rgb` at `exposure` (three's GLSL, quality.ts). */
export function toneCurve(rgb: readonly number[], curve: ToneCurveId, exposure: number): [number, number, number] {
  if (curve === "neutral") return neutralToneMap(rgb, exposure) as [number, number, number];
  if (curve === "aces") return acesFilmic(rgb, exposure) as [number, number, number];
  if (curve === "linear") return [Math.min(1, rgb[0]! * exposure), Math.min(1, rgb[1]! * exposure), Math.min(1, rgb[2]! * exposure)];
  return [Math.min(1, rgb[0]!), Math.min(1, rgb[1]!), Math.min(1, rgb[2]!)];
}

/**
 * The light on a board (linear rgb, x its albedo = what reached the tone curve) from a pixel of it read back from the frame
 * (`shown`, sRGB 0..1) and its albedo there (sRGB 0..1). Solved per channel by bisection through the tone curve; a channel the
 * albedo hardly has (a navy board's red) takes the luminance's light, and no channel strays past 1.6x / 0.6x of it.
 */
export function lightFromProbe(shown: readonly number[], albedo: readonly number[], curve: ToneCurveId, exposure: number): [number, number, number] {
  const A = [srgbToLinear(albedo[0]!), srgbToLinear(albedo[1]!), srgbToLinear(albedo[2]!)];
  const D = [srgbToLinear(shown[0]!), srgbToLinear(shown[1]!), srgbToLinear(shown[2]!)];
  // grey light first: the scale k with lum(T(A k)) = lum(D)
  const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  const target = lum(D);
  let lo = 0;
  let hi = 64;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (lum(toneCurve([A[0]! * mid, A[1]! * mid, A[2]! * mid], curve, exposure)) < target) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  const out: [number, number, number] = [k, k, k];
  // then each channel the albedo carries, the others held
  for (let round = 0; round < 2; round++)
    for (let c = 0; c < 3; c++) {
      if (A[c]! < 0.03) continue;
      let a = k * 0.6;
      let b = k * 1.6;
      for (let i = 0; i < 30; i++) {
        const mid = (a + b) / 2;
        const x = [A[0]! * out[0], A[1]! * out[1], A[2]! * out[2]];
        x[c] = A[c]! * mid;
        if (toneCurve(x, curve, exposure)[c]! < D[c]!) a = mid;
        else b = mid;
      }
      out[c] = (a + b) / 2;
    }
  return out;
}

/** A tone function: albedo css -> the colour shown under `light` (linear rgb) through the curve, as rgba() css. */
export function makeTone(light: readonly number[], curve: ToneCurveId, exposure: number): InkTone {
  const cache = new Map<string, string>();
  return (css) => {
    const hit = cache.get(css);
    if (hit !== undefined) return hit;
    const p = parseCss(css);
    let out = css;
    if (p) {
      const t = toneCurve([srgbToLinear(p[0]) * light[0]!, srgbToLinear(p[1]) * light[1]!, srgbToLinear(p[2]) * light[2]!], curve, exposure);
      const r = Math.round(linearToSrgb(t[0]) * 255);
      const g = Math.round(linearToSrgb(t[1]) * 255);
      const b = Math.round(linearToSrgb(t[2]) * 255);
      out = p[3] >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${p[3]})`;
    }
    cache.set(css, out);
    return out;
  };
}

/** A key for a light (2% steps), a curve and an exposure: the raster is redrawn when it changes. */
export function toneKey(light: readonly number[], curve: ToneCurveId, exposure: number): string {
  const q = (v: number) => Math.round(Math.log(Math.max(1e-4, v)) / Math.log(1.02));
  return `${q(light[0]!)},${q(light[1]!)},${q(light[2]!)}|${curve}|${Math.round(exposure * 100)}`;
}

// ───────────────────────────── the plane on screen ─────────────────────────────

/** How many query cells a `w` x `h` sign gets: two rows, columns about square (2..8). */
export function inkGrid(w: number, h: number): { cols: number; rows: number } {
  return { cols: Math.min(8, Math.max(2, Math.round((w / h) * 2))), rows: 2 };
}

/**
 * Clip coordinates of local point (lx, ly, lz) of a plane with world matrix `m`, seen through `view` and `proj` (column-major),
 * written to out[at..at+3].
 */
export function clipOf(m: ArrayLike<number>, lx: number, ly: number, lz: number, view: ArrayLike<number>, proj: ArrayLike<number>, out: Float32Array | number[], at: number): void {
  const wx = m[0]! * lx + m[4]! * ly + m[8]! * lz + m[12]!;
  const wy = m[1]! * lx + m[5]! * ly + m[9]! * lz + m[13]!;
  const wz = m[2]! * lx + m[6]! * ly + m[10]! * lz + m[14]!;
  const vx = view[0]! * wx + view[4]! * wy + view[8]! * wz + view[12]!;
  const vy = view[1]! * wx + view[5]! * wy + view[9]! * wz + view[13]!;
  const vz = view[2]! * wx + view[6]! * wy + view[10]! * wz + view[14]!;
  out[at] = proj[0]! * vx + proj[4]! * vy + proj[8]! * vz + proj[12]!;
  out[at + 1] = proj[1]! * vx + proj[5]! * vy + proj[9]! * vz + proj[13]!;
  out[at + 2] = proj[2]! * vx + proj[6]! * vy + proj[10]! * vz + proj[14]!;
  out[at + 3] = proj[3]! * vx + proj[7]! * vy + proj[11]! * vz + proj[15]!;
}

/**
 * The screen grid of a sign: (cols+1) x (rows+1) points in device px (x right, y down), row-major from the top-left corner.
 * Returns false when a point is behind the eye (or too close to it).
 */
export function screenGrid(m: ArrayLike<number>, w: number, h: number, cols: number, rows: number, view: ArrayLike<number>, proj: ArrayLike<number>, W: number, H: number, out: number[]): boolean {
  const c4 = [0, 0, 0, 0];
  let k = 0;
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      clipOf(m, -w / 2 + (w * i) / cols, h / 2 - (h * j) / rows, 0, view, proj, c4, 0);
      if (!(c4[3]! > 0.05)) return false;
      out[k++] = ((c4[0]! / c4[3]!) * 0.5 + 0.5) * W;
      out[k++] = (0.5 - (c4[1]! / c4[3]!) * 0.5) * H;
    }
  out.length = k;
  return true;
}

/** How far (px) one affine map through three corners misses the fourth corner of a quad (p0 top-left, p1 top-right, p2 bottom-left, p3 bottom-right). */
export function affineError(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): number {
  return Math.hypot(x1 + x2 - x0 - x3, y1 + y2 - y0 - y3);
}
