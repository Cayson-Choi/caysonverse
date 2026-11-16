import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, ClampToEdgeWrapping } from "three";

/**
 * Stand-ins for the art's textures (W2: `T_falls_flow` 512², `T_mist_atlas` 256² 4x4), made in code so the falls run
 * before the files exist and the file-less tests have something to sample. When the model carries its own
 * `T_falls_flow` it is used instead (fallsPrep.ts). Deterministic (a fixed seed), tileable.
 */

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Periodic value noise on a `px` x `py` lattice over the unit square. */
function periodicNoise(u: number, v: number, px: number, py: number, seed: number): number {
  const x = u * px;
  const y = v * py;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const at = (i: number, j: number) => hash2(((i % px) + px) % px, ((j % py) + py) % py, seed);
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

/**
 * The flow texture's texels (RGBA8): R and G are two vertical streak noises (stretched along v, the direction the water
 * runs), B is foam clumps (a soft cellular pattern), A is 255.
 */
export function flowTextureData(size = 128): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      const streak = (seed: number, nx: number) =>
        0.55 * periodicNoise(u, v, nx, 3, seed) + 0.3 * periodicNoise(u, v, nx * 2, 6, seed + 9) + 0.15 * periodicNoise(u, v, nx * 4, 12, seed + 17);
      const r = streak(3, 10);
      const g = streak(11, 14);
      // foam clumps: a threshold of two noises, soft edged
      const c = 0.6 * periodicNoise(u, v, 8, 8, 23) + 0.4 * periodicNoise(u, v, 16, 16, 29);
      const b = Math.min(1, Math.max(0, (c - 0.42) * 4));
      const o = (j * size + i) * 4;
      out[o] = Math.round(Math.min(1, Math.max(0, (r - 0.2) * 1.6)) * 255);
      out[o + 1] = Math.round(Math.min(1, Math.max(0, (g - 0.2) * 1.6)) * 255);
      out[o + 2] = Math.round(b * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

export function makeFlowTexture(size = 128): DataTexture {
  const t = new DataTexture(flowTextureData(size), size, size, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** The mist atlas: 4 x 4 tiles of `tile` px, each a soft puff (white, alpha = density), no two alike. */
export const MIST_ATLAS_TILES = 4;
export function mistAtlasData(tile = 32): Uint8Array {
  const n = tile * MIST_ATLAS_TILES;
  const out = new Uint8Array(n * n * 4);
  for (let ty = 0; ty < MIST_ATLAS_TILES; ty++) {
    for (let tx = 0; tx < MIST_ATLAS_TILES; tx++) {
      const seed = 41 + ty * MIST_ATLAS_TILES + tx;
      for (let j = 0; j < tile; j++) {
        for (let i = 0; i < tile; i++) {
          const u = (i + 0.5) / tile;
          const v = (j + 0.5) / tile;
          const d = Math.hypot(u - 0.5, v - 0.5) * 2; // 0 centre .. 1 edge
          const body = Math.max(0, 1 - d);
          const lumpy = 0.55 + 0.9 * (periodicNoise(u, v, 4, 4, seed) - 0.5) + 0.35 * (periodicNoise(u, v, 8, 8, seed + 5) - 0.5);
          const a = Math.min(1, Math.max(0, body * body * (3 - 2 * body) * 1.4 * lumpy));
          const o = ((ty * tile + j) * n + tx * tile + i) * 4;
          out[o] = 255;
          out[o + 1] = 255;
          out[o + 2] = 255;
          out[o + 3] = Math.round(a * 255);
        }
      }
    }
  }
  return out;
}

export function makeMistAtlas(tile = 32): DataTexture {
  const n = tile * MIST_ATLAS_TILES;
  const t = new DataTexture(mistAtlasData(tile), n, n, RGBAFormat);
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** A 1 x 1 teal texel: the pool's `uMap` (the village water treats a saturated map as "no foam"; the falls draw their own). */
export function makePoolBase(): DataTexture {
  const t = new DataTexture(new Uint8Array([13, 77, 66, 255]), 1, 1, RGBAFormat);
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}
