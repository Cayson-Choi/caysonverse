/**
 * The village's ground beyond the baked one (2026-11-18 terrain pass). village.glb's lawn ends at about +-150 m and the fishing lake's
 * ground at x 190; past that the old backdrop (flat dark-green low-poly hills) and the far forest cards stood on nothing, and from any
 * height the map ended in a void. This builds the missing ground at run time, once, as ONE mesh (a single draw call, no per-frame cost):
 *
 *  1. the baked ground (village lawn + the lake's ground) is rasterised into a 1.5 m height grid (`rasterize`);
 *  2. a chamfer distance transform gives, for every cell outside it, the height of the nearest baked ground cell (`edge`) and the
 *     distance to it; for every cell inside it, the depth under the surface;
 *  3. outside, the height eases from the baked rim's own height to gentle rolling foothills over 60 m and settles at the foot of the
 *     distant ridges (`TERRAIN_FOOT`), so the join has no step and no cliff; inside, the mesh lies 2.5 m under the baked ground
 *     (never visible) so the two overlap with no crack;
 *  4. only the cells near the rim and outside are meshed (the interior is skipped), with vertex colours that shade slopes (relief on
 *     phones, where the lit ground has none) and grey the steepest ones toward rock.
 */
import { BufferGeometry, Float32BufferAttribute, Mesh, Uint32BufferAttribute, Vector3, type Object3D } from "three";
import { fbm } from "../land/parkSkyTexture";

export const OG_HALF = 262;
export const OG_STEP = 1.5;
export const OG_N = Math.round((2 * OG_HALF) / OG_STEP) + 1;
/** The mesh's own cell size (m): twice the grid's. */
export const OG_MESH_STEP = 3;
/** Where the distant ridges' feet stand (y, after the mountains' lift): the outer ground settles here at r >= TERRAIN_FOOT_R. */
export const MOUNTAIN_LIFT = 11;
export const TERRAIN_FOOT = 12.15;
export const TERRAIN_FOOT_R = 200;
const SINK = 2.5;
/** The outer ground is meshed out to this radius (m): the ridges' shell stands over everything beyond it. */
const MESH_RADIUS = 236;
/** The baked ground's name prefixes: the village lawn mesh (LM_grass) and the lake's ground. */
export const GROUND_MESH_NAMES = /^(village_lm_\d+_\d+|lake_ground_\d+)$/;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface HeightGrid {
  /** Surface height of the baked ground per cell (NaN = none). */
  h: Float32Array;
  covered: Uint8Array;
  /** Outside: metres to the nearest baked cell; inside: metres to the nearest edge (depth). */
  dist: Float32Array;
  /** Outside: height of the nearest baked cell. */
  edge: Float32Array;
}

const idx = (ix: number, iz: number) => iz * OG_N + ix;
const cellOf = (v: number) => Math.min(OG_N - 1, Math.max(0, Math.round((v + OG_HALF) / OG_STEP)));

/** Rasterise the ground meshes' top surface (world space) into the grid. */
export function rasterize(meshes: readonly Mesh[]): { h: Float32Array; covered: Uint8Array } {
  const h = new Float32Array(OG_N * OG_N).fill(-1e9);
  const covered = new Uint8Array(OG_N * OG_N);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const g = mesh.geometry;
    const p = g.getAttribute("position");
    const ix3 = g.index;
    const tris = ix3 ? ix3.count / 3 : p.count / 3;
    for (let t = 0; t < tris; t++) {
      const i0 = ix3 ? ix3.getX(t * 3) : t * 3;
      const i1 = ix3 ? ix3.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = ix3 ? ix3.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(p, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(p, i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(p, i2).applyMatrix4(mesh.matrixWorld);
      const minX = Math.min(a.x, b.x, c.x);
      const maxX = Math.max(a.x, b.x, c.x);
      const minZ = Math.min(a.z, b.z, c.z);
      const maxZ = Math.max(a.z, b.z, c.z);
      if (maxX < -OG_HALF || minX > OG_HALF || maxZ < -OG_HALF || minZ > OG_HALF) continue;
      const x0 = Math.max(0, Math.ceil((minX + OG_HALF) / OG_STEP));
      const x1 = Math.min(OG_N - 1, Math.floor((maxX + OG_HALF) / OG_STEP));
      const z0 = Math.max(0, Math.ceil((minZ + OG_HALF) / OG_STEP));
      const z1 = Math.min(OG_N - 1, Math.floor((maxZ + OG_HALF) / OG_STEP));
      const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(det) < 1e-9) continue;
      for (let iz = z0; iz <= z1; iz++) {
        const pz = iz * OG_STEP - OG_HALF;
        for (let ix = x0; ix <= x1; ix++) {
          const px = ix * OG_STEP - OG_HALF;
          const l1 = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / det;
          const l2 = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / det;
          const l3 = 1 - l1 - l2;
          const e = -1e-4;
          if (l1 < e || l2 < e || l3 < e) continue;
          const y = l1 * a.y + l2 * b.y + l3 * c.y;
          const k = idx(ix, iz);
          if (y > h[k]!) h[k] = y;
          covered[k] = 1;
        }
      }
    }
  }
  // close pinholes (a cell with 3+ covered neighbours is covered), twice
  for (let pass = 0; pass < 2; pass++) {
    const add: number[] = [];
    for (let iz = 1; iz < OG_N - 1; iz++) {
      for (let ix = 1; ix < OG_N - 1; ix++) {
        const k = idx(ix, iz);
        if (covered[k]) continue;
        const n = [k - 1, k + 1, k - OG_N, k + OG_N].filter((q) => covered[q]);
        if (n.length >= 3) add.push(k);
      }
    }
    for (const k of add) {
      const n = [k - 1, k + 1, k - OG_N, k + OG_N].filter((q) => covered[q]);
      h[k] = n.reduce((s, q) => s + h[q]!, 0) / n.length;
      covered[k] = 1;
    }
  }
  return { h, covered };
}

/** Chamfer distance (in cells) from every cell to the nearest `source` cell, with that cell's index. */
function chamfer(source: Uint8Array): { d: Float32Array; s: Int32Array } {
  const N = OG_N;
  const d = new Float32Array(N * N).fill(1e9);
  const s = new Int32Array(N * N).fill(-1);
  for (let k = 0; k < N * N; k++) if (source[k]) {
    d[k] = 0;
    s[k] = k;
  }
  const relax = (k: number, q: number, w: number) => {
    if (q < 0 || s[q]! < 0) return;
    const nd = d[q]! + w;
    if (nd < d[k]!) {
      d[k] = nd;
      s[k] = s[q]!;
    }
  };
  const R2 = Math.SQRT2;
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const k = idx(ix, iz);
      if (ix > 0) relax(k, k - 1, 1);
      if (iz > 0) {
        relax(k, k - N, 1);
        if (ix > 0) relax(k, k - N - 1, R2);
        if (ix < N - 1) relax(k, k - N + 1, R2);
      }
    }
  }
  for (let iz = N - 1; iz >= 0; iz--) {
    for (let ix = N - 1; ix >= 0; ix--) {
      const k = idx(ix, iz);
      if (ix < N - 1) relax(k, k + 1, 1);
      if (iz < N - 1) {
        relax(k, k + N, 1);
        if (ix < N - 1) relax(k, k + N + 1, R2);
        if (ix > 0) relax(k, k + N - 1, R2);
      }
    }
  }
  return { d, s };
}

export function buildHeightGrid(meshes: readonly Mesh[]): HeightGrid {
  const { h, covered } = rasterize(meshes);
  const out = chamfer(covered);
  const inv = new Uint8Array(covered.length);
  for (let k = 0; k < covered.length; k++) inv[k] = covered[k] ? 0 : 1;
  const inner = chamfer(inv);
  const dist = new Float32Array(covered.length);
  const edge = new Float32Array(covered.length);
  for (let k = 0; k < covered.length; k++) {
    if (covered[k]) {
      dist[k] = inner.d[k]! * OG_STEP;
      edge[k] = h[k]!;
    } else {
      dist[k] = out.d[k]! * OG_STEP;
      edge[k] = out.s[k]! >= 0 ? h[out.s[k]!]! : TERRAIN_FOOT;
    }
  }
  return { h, covered, dist, edge };
}

/** The foothills the outer ground eases into (y, m): about TERRAIN_FOOT +- 3.5 inside r 150, flat at the ridges' foot beyond r 200. */
export function foothills(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const n = fbm(x * 0.017 + 11, z * 0.017 - 4, 4) * 2 - 1; // about -0.6 .. 0.6
  const n2 = fbm(x * 0.06 - 3, z * 0.06 + 8, 3) * 2 - 1;
  const calm = 1 - smooth(150, TERRAIN_FOOT_R, r);
  return TERRAIN_FOOT + (n * 7 + n2 * 1.6) * calm - 3.5 * calm;
}

/** The outer ground's height at a point (m): hidden under the baked ground inside it, easing to the foothills outside. */
export function outerHeight(g: HeightGrid, x: number, z: number): number {
  const k = idx(cellOf(x), cellOf(z));
  if (g.covered[k]) return g.h[k]! - SINK;
  const d = g.dist[k]!;
  const w = smooth(0, 70, d);
  const rim = g.edge[k]! + 0.04 * (1 - w);
  return rim * (1 - w) + foothills(x, z) * w;
}

const LIGHT = new Vector3(0.45, 0.8, 0.35).normalize();

export interface OuterGround {
  geometry: BufferGeometry;
  /** Surface height of the ground (baked or outer) for placing things; NaN beyond the grid. */
  heightAt(x: number, z: number): number;
  grid: HeightGrid;
}

export function buildOuterGround(meshes: readonly Mesh[]): OuterGround {
  const grid = buildHeightGrid(meshes);
  const M = Math.round((2 * OG_HALF) / OG_MESH_STEP) + 1;
  const hs = new Float32Array(M * M);
  const deep = new Uint8Array(M * M);
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) {
      const x = i * OG_MESH_STEP - OG_HALF;
      const z = j * OG_MESH_STEP - OG_HALF;
      hs[j * M + i] = outerHeight(grid, x, z);
      const k = idx(cellOf(x), cellOf(z));
      deep[j * M + i] = grid.covered[k] && grid.dist[k]! > 8 ? 1 : 0;
    }
  }
  const used = new Int32Array(M * M).fill(-1);
  const cells: number[] = [];
  let nv = 0;
  for (let j = 0; j < M - 1; j++) {
    for (let i = 0; i < M - 1; i++) {
      const a = j * M + i;
      if (deep[a] && deep[a + 1] && deep[a + M] && deep[a + M + 1]) continue;
      // past the ridges' foot (r 205+) the ground lies under the mountains' shell: nothing of it can be seen
      const cx = (i + 0.5) * OG_MESH_STEP - OG_HALF;
      const cz = (j + 0.5) * OG_MESH_STEP - OG_HALF;
      if (Math.hypot(cx, cz) > MESH_RADIUS) continue;
      cells.push(a);
      for (const q of [a, a + 1, a + M, a + M + 1]) if (used[q]! < 0) used[q] = nv++;
    }
  }
  const pos = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const col = new Float32Array(nv * 3);
  const index = new Uint32Array(cells.length * 6);
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) {
      const q = used[j * M + i]!;
      if (q < 0) continue;
      const x = i * OG_MESH_STEP - OG_HALF;
      const z = j * OG_MESH_STEP - OG_HALF;
      const y = hs[j * M + i]!;
      pos.set([x, y, z], q * 3);
      uv.set([x, z], q * 2);
      const hl = hs[j * M + Math.max(i - 1, 0)]!;
      const hr = hs[j * M + Math.min(i + 1, M - 1)]!;
      const hd = hs[Math.max(j - 1, 0) * M + i]!;
      const hu = hs[Math.min(j + 1, M - 1) * M + i]!;
      const dx = (hr - hl) / (2 * OG_MESH_STEP);
      const dz = (hu - hd) / (2 * OG_MESH_STEP);
      const l = Math.hypot(dx, 1, dz);
      const nx = -dx / l;
      const ny = 1 / l;
      const nz = -dz / l;
      const lit = 0.7 + 0.4 * Math.max(nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z, 0);
      const rock = smooth(0.32, 0.62, 1 - ny);
      col.set([lit * (1 - 0.18 * rock), lit * (1 - 0.3 * rock), lit * (1 - 0.42 * rock)], q * 3);
    }
  }
  let t = 0;
  for (const a of cells) {
    const A = used[a]!;
    const B = used[a + 1]!;
    const C = used[a + M]!;
    const D = used[a + M + 1]!;
    index[t++] = A;
    index[t++] = C;
    index[t++] = B;
    index[t++] = B;
    index[t++] = C;
    index[t++] = D;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(col, 3));
  geometry.setIndex(new Uint32BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return {
    geometry,
    grid,
    heightAt: (x, z) => {
      if (Math.abs(x) > OG_HALF || Math.abs(z) > OG_HALF) return NaN;
      const k = idx(cellOf(x), cellOf(z));
      return grid.covered[k] ? grid.h[k]! : outerHeight(grid, x, z);
    },
  };
}

/** The meshes of the baked ground in a scene (the village's lawn mesh clone, the lake's ground). */
export function groundMeshesIn(roots: readonly Object3D[]): Mesh[] {
  const out: Mesh[] = [];
  for (const root of roots) {
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !GROUND_MESH_NAMES.test(m.name)) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      // lawns, dirt, mud, gravel, rock: every flat ground layer; not the village's stone / wood / atlas props
      if (mats.some((q) => /^LM_(grass|dirt|mud|gravel|rock)$/.test(q.name))) out.push(m);
    });
  }
  return out;
}
