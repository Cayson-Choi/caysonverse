import { CanvasTexture, SRGBColorSpace } from "three";

/** Smooth value noise on an integer lattice (deterministic hash, no table). */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export function fbm(x: number, y: number, octaves = 5): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * vnoise(x * f + i * 17.3, y * f - i * 9.1);
    amp *= 0.5;
    f *= 2.03;
  }
  return v;
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const HORIZON = [232, 240, 247];
const ZENITH = [95, 155, 224];

/**
 * The park's sky as one equirectangular picture for a sphere (u round the horizon, v 0 at the bottom pole): the same pale
 * horizon-to-blue gradient the park always had, with soft cumulus clouds that thin out toward the horizon (the village's dome
 * has clouds; the park had none). Painted once on the CPU, 512x256.
 */
export function parkSkyTexture(width = 512, height = 256): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(width, height);
  for (let j = 0; j < height; j++) {
    const v = 1 - (j + 0.5) / height;
    const theta = (1 - v) * Math.PI;
    const dy = Math.cos(theta);
    const sinT = Math.sin(theta);
    for (let i = 0; i < width; i++) {
      const phi = ((i + 0.5) / width) * Math.PI * 2;
      const dx = -Math.cos(phi) * sinT;
      const dz = Math.sin(phi) * sinT;
      const h = Math.max(0, dy);
      const g = Math.pow(h, 0.5);
      let r = HORIZON[0]! + (ZENITH[0]! - HORIZON[0]!) * g;
      let gg = HORIZON[1]! + (ZENITH[1]! - HORIZON[1]!) * g;
      let b = HORIZON[2]! + (ZENITH[2]! - HORIZON[2]!) * g;
      if (dy > 0.03) {
        const px = (dx / (dy + 0.16)) * 1.25;
        const pz = (dz / (dy + 0.16)) * 1.25;
        const f = fbm(px + 3.1, pz - 1.7);
        const cover = smooth(0.46, 0.74, f) * smooth(0.03, 0.2, dy);
        // lit tops, greyer bellies
        const shade = 0.86 + 0.14 * smooth(0.4, 0.8, fbm(px * 2.3 - 5, pz * 2.3 + 2, 3));
        const wr = 255 * shade;
        const wg = 255 * shade;
        const wb = 255 * (0.96 + 0.04 * shade);
        r += (wr - r) * cover * 0.95;
        gg += (wg - gg) * cover * 0.95;
        b += (wb - b) * cover * 0.95;
      }
      const o = (j * width + i) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
