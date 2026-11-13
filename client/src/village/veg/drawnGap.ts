/**
 * The foliage's connection measured on what is drawn (the reviewer, 2026-11-13: the old check measured each cluster
 * against the very line it was placed on, so it always passed). Here every leaf spray's and blossom bunch's origin
 * (its instance's place) is measured against the triangles on screen: the twig meshes as built for the tier (the
 * phone's simplified ones too) and the village file's own bark (the trunks and limbs the clusters may hang on).
 * A point inside a closed bark tube (a cluster on a thick limb's axis) counts as touching. Pure: unit-tested.
 */

export type V3 = [number, number, number];

/** The closest point to `p` on the triangle a, b, c (Ericson, Real-Time Collision Detection 5.1.5). */
export function closestOnTriangle(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap: V3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u: V3, v: V3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const at = (o: V3, u: V3, s: number, v: V3 = [0, 0, 0], t = 0): V3 => [o[0] + u[0] * s + v[0] * t, o[1] + u[1] * s + v[1] * t, o[2] + u[2] * s + v[2] * t];
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp: V3 = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(a, ab, d1 / (d1 - d3));
  const cp: V3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
  }
  const denom = 1 / (va + vb + vc);
  return at(a, ab, vb * denom, ac, vc * denom);
}

/**
 * Triangles in a grid of `cell`-metre cubes (each triangle in every cell its box touches). Each triangle carries an
 * outward normal (the mesh's own vertex normals, or its winding).
 */
export class TriangleGrid {
  private readonly tris: number[] = [];
  private readonly cells = new Map<number, number[]>();
  constructor(readonly cell: number) {}

  private key(i: number, j: number, k: number): number {
    return ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048);
  }

  get size(): number {
    return this.tris.length / 12;
  }

  /** Add the triangle a, b, c with outward normal n (unit). */
  add(a: V3, b: V3, c: V3, n: V3): void {
    const id = this.tris.length / 12;
    this.tris.push(...a, ...b, ...c, ...n);
    const s = this.cell;
    const lo = [0, 1, 2].map((d) => Math.floor(Math.min(a[d]!, b[d]!, c[d]!) / s));
    const hi = [0, 1, 2].map((d) => Math.floor(Math.max(a[d]!, b[d]!, c[d]!) / s));
    for (let i = lo[0]!; i <= hi[0]!; i++)
      for (let j = lo[1]!; j <= hi[1]!; j++)
        for (let k = lo[2]!; k <= hi[2]!; k++) {
          const key = this.key(i, j, k);
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(id);
        }
  }

  /**
   * The gap from `p` to the nearest triangle (0 when `p` lies behind it: inside the tube), searched out to `maxR`
   * metres (Infinity past it).
   */
  gap(p: V3, maxR: number): number {
    const s = this.cell;
    const ci = Math.floor(p[0] / s);
    const cj = Math.floor(p[1] / s);
    const ck = Math.floor(p[2] / s);
    let best = Infinity;
    let inside = false;
    const seen = new Set<number>();
    const rings = Math.ceil(maxR / s) + 1;
    for (let ring = 0; ring <= rings; ring++) {
      if ((ring - 1) * s > best) break;
      for (let i = -ring; i <= ring; i++)
        for (let j = -ring; j <= ring; j++)
          for (let k = -ring; k <= ring; k++) {
            if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== ring) continue;
            const list = this.cells.get(this.key(ci + i, cj + j, ck + k));
            if (!list) continue;
            for (const id of list) {
              if (seen.has(id)) continue;
              seen.add(id);
              const o = id * 12;
              const t = this.tris;
              const q = closestOnTriangle(p, [t[o]!, t[o + 1]!, t[o + 2]!], [t[o + 3]!, t[o + 4]!, t[o + 5]!], [t[o + 6]!, t[o + 7]!, t[o + 8]!]);
              const dx = p[0] - q[0];
              const dy = p[1] - q[1];
              const dz = p[2] - q[2];
              const d = Math.hypot(dx, dy, dz);
              if (d < best) {
                best = d;
                inside = dx * t[o + 9]! + dy * t[o + 10]! + dz * t[o + 11]! < 0;
              }
            }
          }
    }
    if (best > maxR) return Infinity;
    return inside ? 0 : best;
  }
}

/** A face's unit normal by its winding (a, b, c counter-clockwise seen from outside). */
export function faceNormal(a: V3, b: V3, c: V3): V3 {
  const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

export interface DrawnGap {
  /** Clusters measured. */
  clusters: number;
  /** The largest gap (m) from a cluster's origin to the drawn twigs and bark. */
  maxGap: number;
  over2cm: number;
  over5cm: number;
  /** Per tree kind: clusters, the largest gap, and how many are over 5 cm. */
  byKind: Record<string, { clusters: number; maxGap: number; over5cm: number }>;
  /** The worst cluster. */
  worst: { tree: string; at: V3; gap: number } | null;
}
