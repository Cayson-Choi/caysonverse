import { BufferGeometry, Float32BufferAttribute } from "three";

/** A tiny merged-geometry builder: positions, normals, uvs and vertex colours in plain arrays (no DOM; unit-testable in node). */
export type V3 = [number, number, number];

export class GeoBuilder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];

  get vertices(): number {
    return this.pos.length / 3;
  }
  get triangles(): number {
    return this.idx.length / 3;
  }

  private vert(p: V3, n: V3, u: number, v: number, c: V3): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }

  /**
   * A tube swept along `centers` (a ring of `sides` per centre, radial basis `a`/`b` per centre), closed ends optional. Rings
   * are shared between segments, so a curve has no gaps. v runs with the distance (`vPerM`), u round the tube.
   */
  sweep(centers: V3[], a: V3[], b: V3[], radius: number, sides: number, color: V3, vPerM = 0.5): void {
    const base = this.vertices;
    let dist = 0;
    for (let i = 0; i < centers.length; i++) {
      if (i > 0) dist += Math.hypot(centers[i]![0] - centers[i - 1]![0], centers[i]![1] - centers[i - 1]![1], centers[i]![2] - centers[i - 1]![2]);
      for (let s = 0; s <= sides; s++) {
        const th = (s / sides) * Math.PI * 2;
        const c = Math.cos(th);
        const sn = Math.sin(th);
        const n: V3 = [a[i]![0] * c + b[i]![0] * sn, a[i]![1] * c + b[i]![1] * sn, a[i]![2] * c + b[i]![2] * sn];
        this.vert([centers[i]![0] + n[0] * radius, centers[i]![1] + n[1] * radius, centers[i]![2] + n[2] * radius], n, s / sides, dist * vPerM, color);
      }
    }
    const ring = sides + 1;
    for (let i = 0; i < centers.length - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const p = base + i * ring + s;
        const q = p + ring;
        this.idx.push(p, q, p + 1, p + 1, q, q + 1);
      }
    }
  }

  /** A tapered cylinder from p0 to p1. */
  cylinder(p0: V3, p1: V3, r0: number, r1: number, sides: number, color: V3, cap = false): void {
    const d: V3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const t: V3 = [d[0] / l, d[1] / l, d[2] / l];
    const hint: V3 = Math.abs(t[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    const a = norm(cross(t, hint));
    const b = cross(t, a);
    const base = this.vertices;
    for (let k = 0; k < 2; k++) {
      const p = k === 0 ? p0 : p1;
      const r = k === 0 ? r0 : r1;
      for (let s = 0; s <= sides; s++) {
        const th = (s / sides) * Math.PI * 2;
        const n: V3 = [a[0] * Math.cos(th) + b[0] * Math.sin(th), a[1] * Math.cos(th) + b[1] * Math.sin(th), a[2] * Math.cos(th) + b[2] * Math.sin(th)];
        this.vert([p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r], n, s / sides, k * l * 0.5, color);
      }
    }
    const ring = sides + 1;
    for (let s = 0; s < sides; s++) this.idx.push(base + s, base + s + 1, base + ring + s, base + s + 1, base + ring + s + 1, base + ring + s);
    if (cap) {
      for (let k = 0; k < 2; k++) {
        const p = k === 0 ? p0 : p1;
        const n: V3 = k === 0 ? [-t[0], -t[1], -t[2]] : t;
        const c0 = this.vert(p, n, 0.5, 0.5, color);
        const rim = this.vertices;
        for (let s = 0; s <= sides; s++) {
          const th = (s / sides) * Math.PI * 2;
          const r = k === 0 ? r0 : r1;
          this.vert([p[0] + (a[0] * Math.cos(th) + b[0] * Math.sin(th)) * r, p[1] + (a[1] * Math.cos(th) + b[1] * Math.sin(th)) * r, p[2] + (a[2] * Math.cos(th) + b[2] * Math.sin(th)) * r], n, 0.5, 0.5, color);
        }
        for (let s = 0; s < sides; s++) this.idx.push(...(k === 0 ? [c0, rim + s + 1, rim + s] : [c0, rim + s, rim + s + 1]));
      }
    }
  }

  /**
   * A box centred at `c` with half sizes (hx, hy, hz) along the unit axes ax / ay (az = ax x ay). uvScale: metres per texture repeat
   * (0 = the whole face 0..1).
   */
  box(c: V3, ax: V3, ay: V3, hx: number, hy: number, hz: number, color: V3, uvScale = 0): void {
    const az = cross(ax, ay);
    const faces: [V3, V3, V3, number, number][] = [
      // normal, u axis, v axis, half u, half v
      [ax, az, ay, hz, hy],
      [neg(ax), neg(az), ay, hz, hy],
      [ay, ax, az, hx, hz],
      [neg(ay), ax, neg(az), hx, hz],
      [az, neg(ax), ay, hx, hy],
      [neg(az), ax, ay, hx, hy],
    ];
    const half = [hx, hx, hy, hy, hz, hz];
    faces.forEach(([n, u, v, hu, hv], f) => {
      const o: V3 = [c[0] + n[0] * half[f]!, c[1] + n[1] * half[f]!, c[2] + n[2] * half[f]!];
      const base = this.vertices;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const p: V3 = [o[0] + u[0] * hu * su + v[0] * hv * sv, o[1] + u[1] * hu * su + v[1] * hv * sv, o[2] + u[2] * hu * su + v[2] * hv * sv];
        const tu = uvScale > 0 ? (su * hu * 2) / uvScale / 2 + 0.5 : su > 0 ? 1 : 0;
        const tv = uvScale > 0 ? (sv * hv * 2) / uvScale / 2 + 0.5 : sv > 0 ? 1 : 0;
        this.vert(p, n, tu, tv, color);
      }
      const out = cross(u, v);
      if (out[0] * n[0] + out[1] * n[1] + out[2] * n[2] > 0) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    });
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
