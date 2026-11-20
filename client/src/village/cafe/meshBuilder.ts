import { BufferGeometry, Color, Float32BufferAttribute } from "three";

/** A surface kind: glow (0..1, an emissive bulb) and gloss (0..1, a sheen from the lamps). */
export interface Mat {
  glow: number;
  gloss: number;
}
export const MATTE: Mat = { glow: 0, gloss: 0 };
export const WOOD: Mat = { glow: 0, gloss: 0.14 };
export const POLISH: Mat = { glow: 0, gloss: 0.45 };
export const BRASS: Mat = { glow: 0, gloss: 0.8 };
export const BULB: Mat = { glow: 1, gloss: 0 };
export const LEAF: Mat = { glow: 0, gloss: 0.1 };

export type V3 = readonly [number, number, number];

const col = new Color();
/** "#rrggbb" as linear RGB. */
export function lin(hex: string): V3 {
  col.set(hex);
  return [col.r, col.g, col.b];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Collects triangles (non-indexed, one normal per vertex, a vertex colour, a surface kind and a uv) and makes one geometry.
 * Winding follows the normal given (or the face's own), so a double-sided material lights both faces from the front side.
 */
export class MeshBuilder {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  m: number[] = [];
  uv: number[] = [];

  get triangles(): number {
    return this.p.length / 9;
  }

  private vert(p: V3, n: V3, c: V3, m: Mat, uv: readonly [number, number]): void {
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0], n[1], n[2]);
    this.c.push(c[0], c[1], c[2]);
    this.m.push(m.glow, m.gloss);
    this.uv.push(uv[0], uv[1]);
  }

  /** One triangle; `hint` is the way its normal should point (else the winding's own). `nv` gives per-vertex normals. */
  tri(a: V3, b: V3, c: V3, color: V3, m: Mat, hint?: V3, nv?: readonly [V3, V3, V3], uvs?: readonly [readonly [number, number], readonly [number, number], readonly [number, number]]): void {
    let g = cross(sub(b, a), sub(c, a));
    if (Math.hypot(g[0], g[1], g[2]) < 1e-12) return;
    g = norm(g);
    let flip = false;
    if (hint && dot(g, hint) < 0) flip = true;
    const [pa, pb, pc] = flip ? [a, c, b] : [a, b, c];
    const [ua, ub, uc] = uvs ? (flip ? [uvs[0], uvs[2], uvs[1]] : uvs) : [[0, 0], [0, 0], [0, 0]];
    const gn: V3 = flip ? [-g[0], -g[1], -g[2]] : g;
    const ns = nv ? (flip ? [nv[0], nv[2], nv[1]] : nv) : [gn, gn, gn];
    this.vert(pa, ns[0]!, color, m, ua as [number, number]);
    this.vert(pb, ns[1]!, color, m, ub as [number, number]);
    this.vert(pc, ns[2]!, color, m, uc as [number, number]);
  }

  /** A quad (a, b, c, d in order round it). */
  quad(a: V3, b: V3, c: V3, d: V3, color: V3, m: Mat, hint?: V3, uvs?: readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]]): void {
    const h = hint ?? norm(cross(sub(b, a), sub(c, a)));
    this.tri(a, b, c, color, m, h, undefined, uvs ? [uvs[0], uvs[1], uvs[2]] : undefined);
    this.tri(a, c, d, color, m, h, undefined, uvs ? [uvs[0], uvs[2], uvs[3]] : undefined);
  }

  /** An axis-aligned box; `skip` leaves faces out ("top" "bot" "xm" "xp" "zm" "zp"). */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: V3, m: Mat, skip: readonly string[] = []): void {
    const s = (k: string) => skip.includes(k);
    if (!s("top")) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], color, m, [0, 1, 0]);
    if (!s("bot")) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color, m, [0, -1, 0]);
    if (!s("xm")) this.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], color, m, [-1, 0, 0]);
    if (!s("xp")) this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], color, m, [1, 0, 0]);
    if (!s("zm")) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], color, m, [0, 0, -1]);
    if (!s("zp")) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, m, [0, 0, 1]);
  }

  /**
   * A quad whose uv are planar metres over the tile size (the PBR sets' real tile): u, v follow the face's dominant axes (a floor:
   * x, z; a wall along x: x, y; a wall along z: z, y), so a texture repeats at its true size on every wall without hand-set uv.
   */
  quadTiled(a: V3, b: V3, c: V3, d: V3, color: V3, m: Mat, hint: V3, tile: number): void {
    const n = norm(cross(sub(b, a), sub(c, a)));
    const ax = Math.abs(n[0]);
    const ay = Math.abs(n[1]);
    const az = Math.abs(n[2]);
    const uv = (p: V3): [number, number] => (ay >= ax && ay >= az ? [p[0] / tile, p[2] / tile] : ax >= az ? [p[2] / tile, -p[1] / tile] : [p[0] / tile, -p[1] / tile]);
    this.quad(a, b, c, d, color, m, hint, [uv(a), uv(b), uv(c), uv(d)]);
  }

  /** `box`, with tiled uv on every face (see `quadTiled`). */
  boxTiled(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: V3, m: Mat, tile: number, skip: readonly string[] = []): void {
    const s = (k: string) => skip.includes(k);
    if (!s("top")) this.quadTiled([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], color, m, [0, 1, 0], tile);
    if (!s("bot")) this.quadTiled([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color, m, [0, -1, 0], tile);
    if (!s("xm")) this.quadTiled([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], color, m, [-1, 0, 0], tile);
    if (!s("xp")) this.quadTiled([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], color, m, [1, 0, 0], tile);
    if (!s("zm")) this.quadTiled([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], color, m, [0, 0, -1], tile);
    if (!s("zp")) this.quadTiled([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, m, [0, 0, 1], tile);
  }

  /**
   * A solid of revolution about the vertical axis through (cx, cz): `profile` is (radius, y) pairs from the bottom up; the
   * normals are smooth round it and flat along each profile step.
   */
  lathe(cx: number, cz: number, profile: readonly (readonly [number, number])[], color: V3, m: Mat, segs = 10, tints?: readonly V3[]): void {
    for (let i = 0; i + 1 < profile.length; i++) {
      const [r0, y0] = profile[i]!;
      const [r1, y1] = profile[i + 1]!;
      const dr = r1 - r0;
      const dy = y1 - y0;
      const len = Math.hypot(dr, dy) || 1;
      const nr = dy / len;
      const ny = -dr / len;
      const cc = tints?.[i] ?? color;
      for (let k = 0; k < segs; k++) {
        const a0 = (k / segs) * Math.PI * 2;
        const a1 = ((k + 1) / segs) * Math.PI * 2;
        const c0 = Math.cos(a0);
        const s0 = Math.sin(a0);
        const c1 = Math.cos(a1);
        const s1 = Math.sin(a1);
        const A: V3 = [cx + r0 * c0, y0, cz + r0 * s0];
        const B: V3 = [cx + r0 * c1, y0, cz + r0 * s1];
        const C: V3 = [cx + r1 * c1, y1, cz + r1 * s1];
        const D: V3 = [cx + r1 * c0, y1, cz + r1 * s0];
        const n0: V3 = [nr * c0, ny, nr * s0];
        const n1: V3 = [nr * c1, ny, nr * s1];
        const hint = norm([n0[0] + n1[0], n0[1], n0[2] + n1[2]]);
        if (r0 > 1e-6) this.tri(A, B, C, cc, m, hint, [n0, n1, n1]);
        if (r1 > 1e-6) this.tri(A, C, D, cc, m, hint, [n0, n1, n0]);
      }
    }
  }

  /** A round tube along a path (no end caps): radius `r`, `segs` sides, smooth normals round it. */
  tube(path: readonly V3[], r: number, color: V3, m: Mat, segs = 5, r1?: number): void {
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const d = norm(sub(b, a));
      const up: V3 = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = norm(cross(d, up));
      const v = cross(d, u);
      const ra = i === 0 ? r : (r + (r1 ?? r)) / 2;
      const rb = r1 !== undefined && i + 2 === path.length ? r1 : r;
      for (let k = 0; k < segs; k++) {
        const t0 = (k / segs) * Math.PI * 2;
        const t1 = ((k + 1) / segs) * Math.PI * 2;
        const o0: V3 = [Math.cos(t0) * u[0] + Math.sin(t0) * v[0], Math.cos(t0) * u[1] + Math.sin(t0) * v[1], Math.cos(t0) * u[2] + Math.sin(t0) * v[2]];
        const o1: V3 = [Math.cos(t1) * u[0] + Math.sin(t1) * v[0], Math.cos(t1) * u[1] + Math.sin(t1) * v[1], Math.cos(t1) * u[2] + Math.sin(t1) * v[2]];
        const P = (p: V3, o: V3, rr: number): V3 => [p[0] + o[0] * rr, p[1] + o[1] * rr, p[2] + o[2] * rr];
        const h = norm([o0[0] + o1[0], o0[1] + o1[1], o0[2] + o1[2]]);
        this.tri(P(a, o0, ra), P(a, o1, ra), P(b, o1, rb), color, m, h, [o0, o1, o1]);
        this.tri(P(a, o0, ra), P(b, o1, rb), P(b, o0, rb), color, m, h, [o0, o1, o0]);
      }
    }
  }

  /** A prism over a convex polygon (x, z pairs, round it in order): top fan and side quads. */
  prism(poly: readonly (readonly [number, number])[], y0: number, y1: number, color: V3, m: Mat, sideColor?: V3): void {
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      this.tri([cx, y1, cz], [a[0], y1, a[1]], [b[0], y1, b[1]], color, m, [0, 1, 0]);
      const mx = (a[0] + b[0]) / 2 - cx;
      const mz = (a[1] + b[1]) / 2 - cz;
      this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], sideColor ?? color, m, norm([mx, 0, mz]));
    }
  }

  /** Everything added so far as one geometry (attributes: position, normal, color, aMat, uv). */
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.c, 3));
    g.setAttribute("aMat", new Float32BufferAttribute(this.m, 2));
    g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** A small deterministic random (0..1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
