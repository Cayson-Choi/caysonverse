// Worn road paint (2026-11-18, the owner's "glossy flat white" zebra).

/** The largest road texture (px) worn at load: the pass touches every pixel once. */
export const WORN_MAX_PX = 2048;

/**
 * The zebra's and the lines' white paint, worn: slightly off-white, with a low mottle (traffic polishes and dirties it in patches)
 * and fine grit where the asphalt shows through. Done once on a copy of the road texture's image (a canvas), so the baked layout,
 * the light map and the draw call stay as they are. Yellow paint (the centre line) keeps its colour. Returns what puts the
 * original image back, or null when the texture is not an image this can read.
 */
export function wearRoadPaint(tex: { image: unknown; needsUpdate: boolean }): (() => void) | null {
  const src = tex.image as { width?: number; height?: number } | null;
  if (!src || !src.width || !src.height || src.width > WORN_MAX_PX || typeof document === "undefined") return null;
  const w = src.width;
  const h = src.height;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(src as CanvasImageSource, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    wearPixels(img.data, w, h);
    ctx.putImageData(img, 0, 0);
  } catch {
    return null;
  }
  const original = tex.image;
  tex.image = c;
  tex.needsUpdate = true;
  return () => {
    tex.image = original;
    tex.needsUpdate = true;
  };
}

/** The wear itself, on RGBA bytes (exported for the unit test). */
export function wearPixels(d: Uint8ClampedArray, w: number, h: number): void {
  let seed = 20261118;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // a coarse mottle grid, bilinear
  const G = 48;
  const grid = new Float32Array((G + 1) * (G + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  for (let y = 0; y < h; y++) {
    const gy = (y / h) * G;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const r = d[o];
      const g = d[o + 1];
      const b = d[o + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx < 150 || mx - mn > 40) continue; // not white paint (asphalt, yellow)
      const gx = (x / w) * G;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const i00 = y0 * (G + 1) + x0;
      const m = (grid[i00] * (1 - fx) + grid[i00 + 1] * fx) * (1 - fy) + (grid[i00 + G + 1] * (1 - fx) + grid[i00 + G + 2] * fx) * fy;
      let k = 0.8 + 0.18 * m; // 0.80 .. 0.98
      if (rnd() < 0.05) k *= 0.62; // grit: the asphalt shows through
      d[o] = r * k * 0.99;
      d[o + 1] = g * k * 0.97;
      d[o + 2] = b * k * 0.92;
    }
  }
}
