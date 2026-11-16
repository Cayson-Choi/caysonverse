// The lake's small waves (lake v2, owner 2026-11-16: "물이 멈춰있는데 약간 출렁 출렁"): a tileable normal map of short wind chop,
// made once from a sum of directional sine waves whose wave vectors are whole numbers of cycles across the tile (so it repeats
// seamlessly). The alpha channel holds a smooth tileable noise the shader uses for the wind's gust patches (cat's paws).
// Pure numbers + one DataTexture; no file to download.

import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping } from "three";

export const WAVE_TILE = 128;

/** Deterministic little PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The slope field (dh/dx, dh/dy) of the chop at texel (i, j), and the gust noise, in [0, 1] channels. Waves: mostly along the wind
 * (+x), spread +-60 deg, amplitude falling with frequency (a Phillips-like spectrum, small).
 */
export function waveData(size = WAVE_TILE, seed = 11): Uint8Array {
  const r = rng(seed);
  const waves: Array<{ kx: number; ky: number; a: number; ph: number }> = [];
  for (let n = 0; n < 28; n++) {
    const f = 2 + Math.floor(r() * r() * 14); // cycles per tile
    const ang = (r() - 0.5) * (Math.PI * 2) / 3 + (r() < 0.2 ? Math.PI : 0);
    const kx = Math.round(Math.cos(ang) * f);
    const ky = Math.round(Math.sin(ang) * f);
    if (kx === 0 && ky === 0) continue;
    const k = Math.hypot(kx, ky);
    waves.push({ kx, ky, a: 1 / Math.pow(k, 1.35), ph: r() * Math.PI * 2 });
  }
  const gusts: Array<{ kx: number; ky: number; a: number; ph: number }> = [];
  for (let n = 0; n < 6; n++) {
    const kx = Math.floor(r() * 3) - 1 || 1;
    const ky = Math.floor(r() * 3) - 1;
    gusts.push({ kx, ky, a: 0.5 + r() * 0.5, ph: r() * Math.PI * 2 });
  }
  const out = new Uint8Array(size * size * 4);
  let maxS = 1e-6;
  const sx = new Float32Array(size * size);
  const sy = new Float32Array(size * size);
  const g = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i / size) * Math.PI * 2;
      const v = (j / size) * Math.PI * 2;
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        const c = Math.cos(w.kx * u + w.ky * v + w.ph) * w.a;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      let gn = 0;
      for (const w of gusts) gn += Math.sin(w.kx * u + w.ky * v + w.ph) * w.a;
      const k = j * size + i;
      sx[k] = dx;
      sy[k] = dy;
      g[k] = gn;
      maxS = Math.max(maxS, Math.abs(dx), Math.abs(dy));
    }
  }
  let gMin = Infinity;
  let gMax = -Infinity;
  for (const v of g) {
    gMin = Math.min(gMin, v);
    gMax = Math.max(gMax, v);
  }
  for (let k = 0; k < size * size; k++) {
    out[k * 4] = Math.round((sx[k]! / maxS) * 127.5 + 127.5);
    out[k * 4 + 1] = Math.round((sy[k]! / maxS) * 127.5 + 127.5);
    out[k * 4 + 2] = 255;
    out[k * 4 + 3] = Math.round(((g[k]! - gMin) / (gMax - gMin || 1)) * 255);
  }
  return out;
}

let shared: DataTexture | null = null;
/** The chop's slope map (rg = slope x / y in -1..1, a = gust noise), made once. */
export function waveTexture(): DataTexture {
  if (shared) return shared;
  const t = new DataTexture(waveData(), WAVE_TILE, WAVE_TILE, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  shared = t;
  return t;
}
