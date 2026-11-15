/**
 * The memorial hall's solid surfaces as a triangle grid on the floor plan, for the seat framing's tests (seatFraming.ts): "is the
 * line from this camera spot to the seated body blocked?" and "is this camera spot inside, against or up among something solid?".
 *
 * Round 7 review: the hall model is merged by material (hall_lm_4 is every oak surface in the room, the lounge's louvres included),
 * so three.js's raycast tested every triangle of the whole room for every ray (its bounding-sphere test always passes) — tens of
 * milliseconds per seat — and a mesh's box says nothing about a single piece (the louvres could not be told from the floor). Here
 * every triangle is put once into the 0.5 m cells of the plan it covers; a test looks only at the cells along its own segment.
 * Pure maths over plain arrays (no three.js), built once when the hall mounts.
 */

/** Cell size of the plan grid (m). */
const CELL = 0.5;

export interface SolidIndex {
  /** Whether a solid triangle crosses the segment a → b short of its last `trimEnd` metres. */
  segmentBlocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number, trimEnd: number): boolean;
  /** Whether a solid triangle is nearer than `r` to the point. */
  nearSolid(x: number, y: number, z: number, r: number): boolean;
  /**
   * Whether the point is up among or above something hung from the ceiling: a triangle wholly above `from` (m) whose plan extent,
   * grown by `margin`, covers the point and whose lowest corner is less than `clear` above the point (or below it).
   */
  underHung(x: number, y: number, z: number, from: number, margin: number, clear: number): boolean;
  /** Triangle count (diagnostics). */
  readonly triangles: number;
}

/**
 * Index triangles given as a flat world-space array (x0 y0 z0 x1 y1 z1 x2 y2 z2 per triangle) over the plan extent
 * (`minX`..`maxX`, `minZ`..`maxZ`).
 */
export function buildSolidIndex(tri: Float32Array, minX: number, maxX: number, minZ: number, maxZ: number): SolidIndex {
  const n = Math.floor(tri.length / 9);
  const nx = Math.max(1, Math.ceil((maxX - minX) / CELL));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / CELL));
  const cellOf = (x: number, z: number) => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / CELL)));
    const k = Math.min(nz - 1, Math.max(0, Math.floor((z - minZ) / CELL)));
    return k * nx + i;
  };
  // per triangle: its plan box and its lowest y (for underHung)
  const box = new Float32Array(n * 5);
  const lists: number[][] = Array.from({ length: nx * nz }, () => []);
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const x0 = Math.min(tri[o]!, tri[o + 3]!, tri[o + 6]!);
    const x1 = Math.max(tri[o]!, tri[o + 3]!, tri[o + 6]!);
    const z0 = Math.min(tri[o + 2]!, tri[o + 5]!, tri[o + 8]!);
    const z1 = Math.max(tri[o + 2]!, tri[o + 5]!, tri[o + 8]!);
    box[t * 5] = x0;
    box[t * 5 + 1] = x1;
    box[t * 5 + 2] = z0;
    box[t * 5 + 3] = z1;
    box[t * 5 + 4] = Math.min(tri[o + 1]!, tri[o + 4]!, tri[o + 7]!);
    const i0 = Math.max(0, Math.floor((x0 - minX) / CELL));
    const i1 = Math.min(nx - 1, Math.floor((x1 - minX) / CELL));
    const k0 = Math.max(0, Math.floor((z0 - minZ) / CELL));
    const k1 = Math.min(nz - 1, Math.floor((z1 - minZ) / CELL));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) lists[k * nx + i]!.push(t);
  }
  const cells = lists.map((l) => Int32Array.from(l));
  const mark = new Uint32Array(n);
  let stamp = 0;
  const nextStamp = () => {
    stamp++;
    if (stamp === 0xffffffff) {
      mark.fill(0);
      stamp = 1;
    }
    return stamp;
  };

  /** Ray (o, unit d) against triangle t, double-sided: the distance, or -1. */
  const rayTri = (t: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number => {
    const o = t * 9;
    const ax = tri[o]!, ay = tri[o + 1]!, az = tri[o + 2]!;
    const e1x = tri[o + 3]! - ax, e1y = tri[o + 4]! - ay, e1z = tri[o + 5]! - az;
    const e2x = tri[o + 6]! - ax, e2y = tri[o + 7]! - ay, e2z = tri[o + 8]! - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return -1;
    const inv = 1 / det;
    const sx = ox - ax, sy = oy - ay, sz = oz - az;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    return (e2x * qx + e2y * qy + e2z * qz) * inv;
  };

  /** Squared distance from p to triangle t (Ericson, Real-Time Collision Detection 5.1.5). */
  const pointTri2 = (t: number, px: number, py: number, pz: number): number => {
    const o = t * 9;
    const ax = tri[o]!, ay = tri[o + 1]!, az = tri[o + 2]!;
    const bx = tri[o + 3]!, by = tri[o + 4]!, bz = tri[o + 5]!;
    const cx = tri[o + 6]!, cy = tri[o + 7]!, cz = tri[o + 8]!;
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    const d2s = (x: number, y: number, z: number) => (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
    if (d1 <= 0 && d2 <= 0) return d2s(ax, ay, az);
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return d2s(bx, by, bz);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      return d2s(ax + abx * v, ay + aby * v, az + abz * v);
    }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return d2s(cx, cy, cz);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      return d2s(ax + acx * w, ay + acy * w, az + acz * w);
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      return d2s(bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w);
    }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    return d2s(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
  };

  return {
    triangles: n,
    segmentBlocked(ax, ay, az, bx, by, bz, trimEnd) {
      let dx = bx - ax;
      let dy = by - ay;
      let dz = bz - az;
      const len = Math.hypot(dx, dy, dz);
      const far = len - trimEnd;
      if (far <= 0) return false;
      dx /= len;
      dy /= len;
      dz /= len;
      const s = nextStamp();
      const steps = Math.max(1, Math.ceil((far * Math.hypot(dx, dz)) / (CELL * 0.25)));
      let lastCell = -1;
      for (let j = 0; j <= steps; j++) {
        const f = (far * j) / steps;
        const c = cellOf(ax + dx * f, az + dz * f);
        if (c === lastCell) continue;
        lastCell = c;
        const list = cells[c]!;
        for (let q = 0; q < list.length; q++) {
          const t = list[q]!;
          if (mark[t] === s) continue;
          mark[t] = s;
          const d = rayTri(t, ax, ay, az, dx, dy, dz);
          if (d > 1e-4 && d < far) return true;
        }
      }
      return false;
    },
    nearSolid(x, y, z, r) {
      const s = nextStamp();
      const r2 = r * r;
      const i0 = Math.max(0, Math.floor((x - r - minX) / CELL));
      const i1 = Math.min(nx - 1, Math.floor((x + r - minX) / CELL));
      const k0 = Math.max(0, Math.floor((z - r - minZ) / CELL));
      const k1 = Math.min(nz - 1, Math.floor((z + r - minZ) / CELL));
      for (let k = k0; k <= k1; k++)
        for (let i = i0; i <= i1; i++) {
          const list = cells[k * nx + i]!;
          for (let q = 0; q < list.length; q++) {
            const t = list[q]!;
            if (mark[t] === s) continue;
            mark[t] = s;
            const b = t * 5;
            if (x < box[b]! - r || x > box[b + 1]! + r || z < box[b + 2]! - r || z > box[b + 3]! + r) continue;
            if (pointTri2(t, x, y, z) < r2) return true;
          }
        }
      return false;
    },
    underHung(x, y, z, from, margin, clear) {
      // every cell the margin reaches (a triangle is listed in each cell its plan box meets)
      const s = nextStamp();
      const i0 = Math.max(0, Math.floor((x - margin - minX) / CELL));
      const i1 = Math.min(nx - 1, Math.floor((x + margin - minX) / CELL));
      const k0 = Math.max(0, Math.floor((z - margin - minZ) / CELL));
      const k1 = Math.min(nz - 1, Math.floor((z + margin - minZ) / CELL));
      for (let k = k0; k <= k1; k++)
        for (let i = i0; i <= i1; i++) {
          const list = cells[k * nx + i]!;
          for (let q = 0; q < list.length; q++) {
            const t = list[q]!;
            if (mark[t] === s) continue;
            mark[t] = s;
            const b = t * 5;
            const low = box[b + 4]!;
            if (low < from || low >= y + clear) continue;
            if (x >= box[b]! - margin && x <= box[b + 1]! + margin && z >= box[b + 2]! - margin && z <= box[b + 3]! + margin) return true;
          }
        }
      return false;
    },
  };
}
