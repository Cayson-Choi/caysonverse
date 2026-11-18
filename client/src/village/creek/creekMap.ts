/**
 * The creek's ground, read back from the village model (owner 2026-11-18: "여기가 너무 허접해"): the water shader, the bank
 * dressing and the stone placement all need to know where the carved channel's bed lies, and the only truth is the baked
 * ground mesh. `rasterGround` draws that mesh's triangles into a height grid over the creek's rectangle; `CreekGrid` then
 * answers `bedAt(x, z)`, the creek's centre line and its two waterlines. Pure functions, unit-tested (creek.test.ts).
 */

/** The rectangle (m) the creek map covers: the whole walkable creek, south of the plots. */
export const CREEK_RECT = { x0: -128, x1: 100, z0: -62, z1: 92 } as const;
/** Metres per texel of the map (and of the height grid). */
export const CREEK_RES = 0.25;
export const CREEK_W = Math.round((CREEK_RECT.x1 - CREEK_RECT.x0) / CREEK_RES);
export const CREEK_H = Math.round((CREEK_RECT.z1 - CREEK_RECT.z0) / CREEK_RES);
/** The bed height range the map's red channel encodes (m). */
export const BED_MIN = -1.6;
export const BED_MAX = 0.4;

/** The two small cascades (m, x of the drop's upstream edge): the water steps down eastward (parts_nature.py CASCADES). */
export const CASCADES = [
  { x: -40.0, zc: 73.64, upY: -0.43, downY: -0.57, width: 5.5 },
  { x: 32.0, zc: 76.55, upY: -0.57, downY: -0.71, width: 5.5 },
] as const;
/** The three water levels of the creek, west to east. */
export const CREEK_LEVELS = [-0.43, -0.57, -0.71] as const;

/** The creek's water level at x (m). */
export function creekLevelAt(x: number): number {
  return x < CASCADES[0].x ? CREEK_LEVELS[0] : x < CASCADES[1].x ? CREEK_LEVELS[1] : CREEK_LEVELS[2];
}

/** The feeder stream's (x < FEEDER_X, from the falls south to the creek) water level, falling from -0.30 at the falls to the creek's -0.43. */
export const FEEDER_X = -95;
export function feederLevelAt(z: number): number {
  return -0.3 - 0.13 * Math.max(0, Math.min(1, (z + 58) / 124));
}

/** The water level anywhere along the stream (m). */
export function waterLevelAt(x: number, z: number): number {
  return x < FEEDER_X && z < 66 ? feederLevelAt(z) : creekLevelAt(x);
}

export interface GroundSource {
  /** World-space xyz, flattened. */
  position: ArrayLike<number>;
  index: ArrayLike<number> | null;
}

/** A height grid over CREEK_RECT: `heights[j * CREEK_W + i]` at texel centre (x0 + (i + .5) res, z0 + (j + .5) res). NaN = not covered. */
export interface CreekGrid {
  heights: Float32Array;
}

export function newGrid(): CreekGrid {
  return { heights: new Float32Array(CREEK_W * CREEK_H).fill(Number.NaN) };
}

/** Draw ground triangles into the grid (the highest surface wins where they overlap). */
export function rasterGround(grid: CreekGrid, src: GroundSource): void {
  const p = src.position;
  const idx = src.index;
  const n = idx ? idx.length : p.length / 3;
  const { x0, z0, x1, z1 } = CREEK_RECT;
  for (let t = 0; t < n; t += 3) {
    const a = idx ? idx[t]! : t;
    const b = idx ? idx[t + 1]! : t + 1;
    const c = idx ? idx[t + 2]! : t + 2;
    const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
    const bx = p[b * 3]!, by = p[b * 3 + 1]!, bz = p[b * 3 + 2]!;
    const cx = p[c * 3]!, cy = p[c * 3 + 1]!, cz = p[c * 3 + 2]!;
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx);
    const minZ = Math.min(az, bz, cz), maxZ = Math.max(az, bz, cz);
    if (maxX < x0 || minX > x1 || maxZ < z0 || minZ > z1) continue;
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-9) continue;
    const i0 = Math.max(0, Math.floor((minX - x0) / CREEK_RES - 0.5));
    const i1 = Math.min(CREEK_W - 1, Math.ceil((maxX - x0) / CREEK_RES - 0.5));
    const j0 = Math.max(0, Math.floor((minZ - z0) / CREEK_RES - 0.5));
    const j1 = Math.min(CREEK_H - 1, Math.ceil((maxZ - z0) / CREEK_RES - 0.5));
    for (let j = j0; j <= j1; j++) {
      const z = z0 + (j + 0.5) * CREEK_RES;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * CREEK_RES;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
        const l3 = 1 - l1 - l2;
        const e = -1e-4;
        if (l1 < e || l2 < e || l3 < e) continue;
        const y = l1 * ay + l2 * by + l3 * cy;
        const k = j * CREEK_W + i;
        const old = grid.heights[k]!;
        if (Number.isNaN(old) || y > old) grid.heights[k] = y;
      }
    }
  }
}

/** Fill the texels no ground triangle reached (holes under the bridge deck's footing) from their neighbours, once. */
export function fillHoles(grid: CreekGrid): void {
  const h = grid.heights;
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < CREEK_H; j++) {
      for (let i = 0; i < CREEK_W; i++) {
        const k = j * CREEK_W + i;
        if (!Number.isNaN(h[k]!)) continue;
        let s = 0;
        let c = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= CREEK_W || jj >= CREEK_H) continue;
          const v = h[jj * CREEK_W + ii]!;
          if (!Number.isNaN(v)) {
            s += v;
            c++;
          }
        }
        if (c) h[k] = s / c;
      }
    }
  }
}

/** The ground height at (x, z), bilinear; NaN outside the rectangle. */
export function bedAt(grid: CreekGrid, x: number, z: number): number {
  const fx = (x - CREEK_RECT.x0) / CREEK_RES - 0.5;
  const fz = (z - CREEK_RECT.z0) / CREEK_RES - 0.5;
  if (fx < 0 || fz < 0 || fx > CREEK_W - 1 || fz > CREEK_H - 1) return Number.NaN;
  const i = Math.min(CREEK_W - 2, Math.floor(fx));
  const j = Math.min(CREEK_H - 2, Math.floor(fz));
  const tx = fx - i, tz = fz - j;
  const h = grid.heights;
  const a = h[j * CREEK_W + i]!, b = h[j * CREEK_W + i + 1]!, c = h[(j + 1) * CREEK_W + i]!, d = h[(j + 1) * CREEK_W + i + 1]!;
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** The creek's centre line z at x: the lowest ground in that column (the bed's deepest point). */
export function centreZ(grid: CreekGrid, x: number): number {
  let best = Infinity;
  let bz = (CREEK_RECT.z0 + CREEK_RECT.z1) / 2;
  const sum = { w: 0, z: 0 };
  for (let z = 62; z < 90; z += 0.1) {
    const y = bedAt(grid, x, z);
    if (!Number.isNaN(y) && y < best) {
      best = y;
      bz = z;
    }
  }
  for (let z = bz - 3; z <= bz + 3; z += 0.1) {
    const y = bedAt(grid, x, z);
    if (Number.isNaN(y) || y > best + 0.04) continue;
    sum.w++;
    sum.z += z;
  }
  return sum.w ? sum.z / sum.w : bz;
}

/** The two waterlines at x for a water level: where the ground crosses `level` going out from the centre (south = +z). */
export function shoreAt(grid: CreekGrid, x: number, level: number): { north: number; south: number; centre: number } {
  const c = centreZ(grid, x);
  let north = c;
  let south = c;
  for (let z = c; z > c - 9; z -= 0.05) {
    const y = bedAt(grid, x, z);
    if (Number.isNaN(y) || y > level) break;
    north = z;
  }
  for (let z = c; z < c + 9; z += 0.05) {
    const y = bedAt(grid, x, z);
    if (Number.isNaN(y) || y > level) break;
    south = z;
  }
  return { north, south, centre: c };
}

// ───────────────────────────── foam splats ─────────────────────────────

/** The foam channel: 0..1 per texel. */
export function newFoam(): Float32Array {
  return new Float32Array(CREEK_W * CREEK_H);
}

function put(foam: Float32Array, x: number, z: number, v: number): void {
  const i = Math.floor((x - CREEK_RECT.x0) / CREEK_RES);
  const j = Math.floor((z - CREEK_RECT.z0) / CREEK_RES);
  if (i < 0 || j < 0 || i >= CREEK_W || j >= CREEK_H) return;
  const k = j * CREEK_W + i;
  if (v > foam[k]!) foam[k] = v;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A collar of foam round a stone in the water (radius r) and a wake running east (the creek flows east) behind it. */
export function splatStone(foam: Float32Array, cx: number, cz: number, r: number, strength = 1): void {
  const wake = r * 5;
  const ext = r + 0.45;
  for (let x = cx - ext; x <= cx + ext + wake; x += CREEK_RES * 0.5) {
    for (let z = cz - ext; z <= cz + ext; z += CREEK_RES * 0.5) {
      const dx = x - cx, dz = z - cz;
      const d = Math.hypot(dx, dz);
      let v = d < r * 0.75 ? 0 : (1 - smooth(r, r + 0.4, d)) * 0.95;
      if (dx > 0) {
        const t = dx / wake;
        const half = r * 0.9 * (1 - t * 0.6);
        if (t < 1 && Math.abs(dz) < half * 1.3) v = Math.max(v, (1 - t) * 0.8 * (1 - smooth(half * 0.5, half * 1.3, Math.abs(dz))));
      }
      if (v > 0.02) put(foam, x, z, v * strength);
    }
  }
}

/** The churn at the foot of a cascade: a thick band downstream of the sill, thinner foam trailing on, and a line along the lip. */
export function splatWeir(foam: Float32Array, sillX: number, z0: number, z1: number): void {
  for (let x = sillX - 0.5; x <= sillX + 3.4; x += CREEK_RES * 0.5) {
    const dx = x - sillX;
    const along = dx < 0 ? 0.55 * (1 - smooth(0, 0.5, -dx)) : dx < 0.7 ? 1 : 0.8 * (1 - smooth(0.7, 3.4, dx));
    for (let z = z0 - 0.3; z <= z1 + 0.3; z += CREEK_RES * 0.5) {
      const edge = smooth(z0 - 0.3, z0 + 0.35, z) * (1 - smooth(z1 - 0.35, z1 + 0.3, z));
      put(foam, x, z, along * (0.35 + 0.65 * edge));
    }
  }
}

// ───────────────────────────── the map texture's bytes ─────────────────────────────

/** RG8 bytes: R = bed height (BED_MIN..BED_MAX), G = foam. */
export function mapBytes(grid: CreekGrid, foam: Float32Array): Uint8Array {
  const out = new Uint8Array(CREEK_W * CREEK_H * 2);
  for (let k = 0; k < CREEK_W * CREEK_H; k++) {
    const y = grid.heights[k]!;
    const r = Number.isNaN(y) ? 0 : Math.round(Math.max(0, Math.min(1, (y - BED_MIN) / (BED_MAX - BED_MIN))) * 255);
    out[k * 2] = r;
    out[k * 2 + 1] = Math.round(Math.max(0, Math.min(1, foam[k]!)) * 255);
  }
  return out;
}
