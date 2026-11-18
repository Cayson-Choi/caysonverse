import type { DataTexture, Mesh, Object3D } from "three";
import { depthMapTexture } from "./creek/depthWater";
import type { GroundSource } from "./creek/creekMap";

/**
 * A water body's bed, read back from the baked ground mesh (the way the creek does it: creek/creekMap.ts, which is fixed to the creek's
 * rectangle): `rasterBed` draws the ground's triangles into a height grid over any rectangle, `bedTexture` packs it for the depth water
 * (creek/depthWater.ts: R = bed height over `range`, G = foam). The fishing lake and the temple pond use it; pure functions, unit-tested.
 */

export interface BedRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** A height grid: `heights[j * w + i]` at the texel centre (x0 + (i + .5) res, z0 + (j + .5) res). NaN = no ground there. */
export interface BedGrid {
  rect: BedRect;
  res: number;
  w: number;
  h: number;
  heights: Float32Array;
}

export function newBedGrid(rect: BedRect, res: number): BedGrid {
  const w = Math.max(1, Math.round((rect.x1 - rect.x0) / res));
  const h = Math.max(1, Math.round((rect.z1 - rect.z0) / res));
  return { rect, res, w, h, heights: new Float32Array(w * h).fill(Number.NaN) };
}

/** Draw ground triangles into the grid (the highest surface wins where they overlap). */
export function rasterBed(grid: BedGrid, src: GroundSource): void {
  const p = src.position;
  const idx = src.index;
  const n = idx ? idx.length : p.length / 3;
  const { x0, z0, x1, z1 } = grid.rect;
  const res = grid.res;
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
    const i0 = Math.max(0, Math.floor((minX - x0) / res - 0.5));
    const i1 = Math.min(grid.w - 1, Math.ceil((maxX - x0) / res - 0.5));
    const j0 = Math.max(0, Math.floor((minZ - z0) / res - 0.5));
    const j1 = Math.min(grid.h - 1, Math.ceil((maxZ - z0) / res - 0.5));
    for (let j = j0; j <= j1; j++) {
      const z = z0 + (j + 0.5) * res;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * res;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
        const l3 = 1 - l1 - l2;
        const e = -1e-4;
        if (l1 < e || l2 < e || l3 < e) continue;
        const y = l1 * ay + l2 * by + l3 * cy;
        const k = j * grid.w + i;
        const old = grid.heights[k]!;
        if (Number.isNaN(old) || y > old) grid.heights[k] = y;
      }
    }
  }
}

/** Fill the texels no triangle reached from their neighbours (a few passes; what is still empty stays NaN). */
export function fillBedHoles(grid: BedGrid, passes = 3): void {
  const h = grid.heights;
  for (let pass = 0; pass < passes; pass++) {
    for (let j = 0; j < grid.h; j++) {
      for (let i = 0; i < grid.w; i++) {
        const k = j * grid.w + i;
        if (!Number.isNaN(h[k]!)) continue;
        let s = 0;
        let c = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= grid.w || jj >= grid.h) continue;
          const v = h[jj * grid.w + ii]!;
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

/** The world-space triangles of the non-instanced meshes under `root` whose (first) material the predicate accepts. */
export function groundSourcesOf(root: Object3D, accept: (materialName: string) => boolean): GroundSource[] {
  const out: GroundSource[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || (m as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!mat || !accept(mat.name)) return;
    const pos = m.geometry.getAttribute("position");
    const ind = m.geometry.getIndex();
    const arr = new Float32Array(pos.count * 3);
    const e = m.matrixWorld.elements;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      arr[i * 3] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      arr[i * 3 + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      arr[i * 3 + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    }
    out.push({ position: arr, index: ind ? (ind.array as ArrayLike<number>) : null });
  });
  return out;
}

/** The bed height at (x, z), bilinear over the grid; `fallback` where nothing is known. */
export function bedAt(grid: BedGrid, x: number, z: number, fallback = Number.NaN): number {
  if (x < grid.rect.x0 || x > grid.rect.x1 || z < grid.rect.z0 || z > grid.rect.z1) return fallback;
  const fx = (x - grid.rect.x0) / grid.res - 0.5;
  const fz = (z - grid.rect.z0) / grid.res - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  let s = 0;
  let wsum = 0;
  for (const [di, dj, w] of [[0, 0, (1 - tx) * (1 - tz)], [1, 0, tx * (1 - tz)], [0, 1, (1 - tx) * tz], [1, 1, tx * tz]] as const) {
    const ii = Math.min(grid.w - 1, Math.max(0, i + di));
    const jj = Math.min(grid.h - 1, Math.max(0, j + dj));
    const v = grid.heights[jj * grid.w + ii]!;
    if (Number.isNaN(v) || w <= 0) continue;
    s += v * w;
    wsum += w;
  }
  return wsum > 0 ? s / wsum : fallback;
}

/** The depth water's RG8 map of the grid: R = the bed height (an unknown texel reads as `unknown`), G = foam 0. */
export function bedTexture(grid: BedGrid, range: readonly [number, number], unknown = range[0]): DataTexture {
  const bed = new Float32Array(grid.heights.length);
  for (let k = 0; k < bed.length; k++) bed[k] = Number.isNaN(grid.heights[k]!) ? unknown : grid.heights[k]!;
  return depthMapTexture(grid.w, grid.h, bed, new Float32Array(bed.length), range);
}
