/**
 * Text-plate helpers for the 3D scenes' hanging labels (the village's plot markers draw their words with them). The file
 * keeps its old name: it first served the school hall's plates, which are gone.
 */

/**
 * The size, in px, of a label's canvas: dense enough to stay crisp from the camera's closest approach
 * (about 300 px per metre), never above the GPU-friendly 2048.
 */
export const LABEL_PX_PER_M = 300;
export function labelCanvasSize(spec: { w: number; h: number }): { width: number; height: number } {
  const clamp = (v: number): number => Math.max(32, Math.min(2048, Math.round(v)));
  return { width: clamp(spec.w * LABEL_PX_PER_M), height: clamp(spec.h * LABEL_PX_PER_M) };
}

/**
 * The font size (px) that fits `lines` into a w x h canvas: each line at most `maxWidth`(px wide as measured) and the
 * block at most 78% of the height. `measure(text, px)` gives a line's width at a font size (the canvas does that;
 * a test passes a stub).
 */
export function fitFontPx(
  lines: readonly string[],
  width: number,
  height: number,
  measure: (text: string, px: number) => number,
): number {
  const byHeight = (height * 0.78) / (lines.length + (lines.length - 1) * 0.12);
  const reference = 100;
  let px = byHeight;
  for (const line of lines) {
    const w = measure(line, reference);
    if (w > 0) px = Math.min(px, (width * 0.88 * reference) / w);
  }
  return Math.max(8, px);
}
