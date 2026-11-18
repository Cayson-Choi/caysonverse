// The village's ground paths, rebuilt (2026-11-18, the owner's "stickers" on the grass).
//
// village.glb bakes the six lanes from the ring road to the lots as flat 3 m strips (LM_walk, y 0.018) that stop in the grass
// 5 m short of the doors, start ON the ring's sidewalk at any angle and have no edge, and seven crossing "connectors" (2 triangles
// each, skewed, 3 m wide for a 4 m zebra) over the verge between the plaza and the road. This module takes those triangles out of
// a clone of the village (never in place: the loader's cache owns the geometry) and puts the same material back in the right
// shape, in the SAME light-mapped meshes (no new draw call, no new material):
//  - every lane is one ribbon from the sidewalk's outer edge (cut on its circle, the ring's curb opened) to its door (cut on the
//    lot's front edge), corners rounded, with a low granite edging (7 cm over the grass, chamfered) on both sides;
//  - every crossing gets a connector straight along the radius and as wide as the zebra (4.6 m for 4 m of stripes), the verge's
//    two curbs dropped where it crosses.
// The texture is the village's own world-planar mapping (u = x / 2, v = z / 2 + 1), so the cobbles run on across every join; the
// light-map coordinates come from the old triangles (barycentric where they covered the spot, the nearest vertex beyond).

import { BufferAttribute, BufferGeometry, Uint16BufferAttribute, Uint32BufferAttribute, type Material, type Mesh, type Object3D } from "three";

export interface P2 {
  x: number;
  z: number;
}

// ───────────────────────────────────────────── the layout ─────────────────────────────────────────────

/** The ring's sidewalk outer edge (m from the centre). */
export const SIDEWALK_OUT_R = 38.8;
/** Where the sidewalk's outer curb stands (the opening for a lane takes it out between these radii). */
export const SIDEWALK_CURB_R: readonly [number, number] = [38.4, 39.8];
/** The lanes' cobble width and the height of the baked layer they lie on (m). */
export const LANE_WIDTH = 3;
export const WALK_Y = 0.018;
/** The edging: 12 cm wide, 7.5 cm over the grass, chamfered 1.1 cm (profile: [outward offset, y]). */
export const EDGE_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, WALK_Y],
  [0, 0.064],
  [0.02, 0.075],
  [0.1, 0.075],
  [0.12, 0.064],
  [0.12, 0],
];

export interface LaneSpec {
  id: string;
  /** The centreline's corners (the start is placed on the ring by the first point's direction). */
  points: readonly P2[];
  /** Corner rounding: how far (m) before and after a corner the arc starts. */
  trim: number;
  /** The line the ribbon ends on: keep points with `a*x + b*z <= c`. */
  end: { a: number; b: number; c: number };
}

/**
 * The six lanes (villageLayout.ts lanes lane_plot_*, lane_bridge) to their doors (villageLots.ts `approach`): the first point
 * of each is the lane's own start on the ring's inner side, the ribbon begins where its edges cross the sidewalk's outer circle.
 */
export const LANES: readonly LaneSpec[] = [
  // north: to the memorial forecourt's front (z -47.5), straight
  { id: "n", points: [{ x: 0, z: -30 }, { x: 0, z: -52 }], trim: 1, end: { a: 0, b: -1, c: 47.5 } },
  // north-east: the lane's own heading to (38.5, -33), then to the chapel's door line (x 40, z -37)
  { id: "ne", points: [{ x: 24.72, z: -16.99 }, { x: 37.2, z: -36.7 }, { x: 42, z: -36.7 }], trim: 3.2, end: { a: 1, b: 0, c: 40.2 } },
  { id: "nw", points: [{ x: -24.72, z: -16.99 }, { x: -35.2, z: -37 }, { x: -42, z: -37 }], trim: 3.2, end: { a: -1, b: 0, c: 39.6 } },
  // east / west: to the school's and the library's gates (z 15)
  { id: "e", points: [{ x: 28.98, z: 7.76 }, { x: 47.5, z: 15 }, { x: 52, z: 16.8 }], trim: 1, end: { a: 1, b: 0, c: 49.2 } },
  { id: "w", points: [{ x: -28.98, z: 7.76 }, { x: -47.5, z: 15 }, { x: -54, z: 17.6 }], trim: 1, end: { a: -1, b: 0, c: 52.4 } },
  // south: to the church's front (z 50)
  { id: "s", points: [{ x: 0, z: 30 }, { x: 0, z: 52 }], trim: 1, end: { a: 0, b: 1, c: 50 } },
  // bridge lane: its own two legs with the corner rounded, to the bridge's foot (z 72)
  { id: "bridge", points: [{ x: -11, z: 27.91 }, { x: -24, z: 46 }, { x: -24, z: 74 }], trim: 7, end: { a: 0, b: 1, c: 72 } },
];

/** The seven crossings' centres on the ring (rad, atan2(z, x)): the middle of each zebra's road-texture patch (LM_road_x). */
export const CROSSING_ANGLES: readonly number[] = [-2.5083, -1.5705, -0.6329, 0.0297, 1.5711, 1.9762, 2.8671];
/** A connector: half its width (the zebra is 4 m long along the road), and the radii it spans (plaza edge .. road edge). */
export const CONNECTOR_HALF_W = 2.3;
export const CONNECTOR_R: readonly [number, number] = [29.5, 31.2];
/** The verge curbs' radii the connector cuts through. */
export const VERGE_CURB_R: readonly [number, number] = [29.4, 31.4];

// ───────────────────────────────────────────── polylines ─────────────────────────────────────────────

const dist = (a: P2, b: P2): number => Math.hypot(b.x - a.x, b.z - a.z);
const lerp = (a: P2, b: P2, t: number): P2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

/** Corners rounded with quadratic arcs, then resampled every `step` m (the ends are kept). */
export function smoothPolyline(pts: readonly P2[], trim: number, step = 0.5): P2[] {
  const raw: P2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const t1 = Math.min(trim, dist(a, b) / 2);
    const t2 = Math.min(trim, dist(b, c) / 2);
    const p0 = lerp(b, a, t1 / dist(a, b));
    const p2 = lerp(b, c, t2 / dist(b, c));
    const n = Math.max(4, Math.ceil((t1 + t2) / (step / 2)));
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      raw.push({
        x: (1 - u) * (1 - u) * p0.x + 2 * (1 - u) * u * b.x + u * u * p2.x,
        z: (1 - u) * (1 - u) * p0.z + 2 * (1 - u) * u * b.z + u * u * p2.z,
      });
    }
  }
  raw.push(pts[pts.length - 1]);
  return resample(raw, step);
}

/** Points every `step` m along a polyline (always including both ends). */
export function resample(line: readonly P2[], step: number): P2[] {
  const out: P2[] = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const seg = dist(line[i - 1], line[i]);
    if (seg < 1e-9) continue;
    let at = step - carry;
    while (at <= seg) {
      out.push(lerp(line[i - 1], line[i], at / seg));
      at += step;
    }
    carry = seg - (at - step);
  }
  const last = line[line.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.25) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

/** The left (+) / right (-) offset of a polyline at distance `d` (normals averaged at the samples). */
export function offsetLine(line: readonly P2[], d: number): P2[] {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    // left of the travel direction (x right, z down on the map): (tz, -tx)
    return { x: p.x + ((b.z - a.z) / len) * d, z: p.z - ((b.x - a.x) / len) * d };
  });
}

/** Part of a line from where `f` first turns >= 0 (the cut point included); `[]` when it never does. */
export function clipStart(line: readonly P2[], f: (p: P2) => number): P2[] {
  for (let i = 0; i < line.length; i++) {
    if (f(line[i]) >= 0) {
      if (i === 0) return line.slice();
      const f0 = f(line[i - 1]);
      const f1 = f(line[i]);
      return [lerp(line[i - 1], line[i], -f0 / (f1 - f0)), ...line.slice(i)];
    }
  }
  return [];
}

/** Part of a line up to where `f` first turns >= 0 (the cut point included). */
export function clipEnd(line: readonly P2[], f: (p: P2) => number): P2[] {
  for (let i = 0; i < line.length; i++) {
    if (f(line[i]) >= 0) {
      if (i === 0) return [];
      const f0 = f(line[i - 1]);
      const f1 = f(line[i]);
      return [...line.slice(0, i), lerp(line[i - 1], line[i], -f0 / (f1 - f0))];
    }
  }
  return line.slice();
}

/** `n` points along a polyline at equal arc length. */
export function resampleCount(line: readonly P2[], n: number): P2[] {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + dist(line[i - 1], line[i]));
  const total = cum[cum.length - 1];
  const out: P2[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const s = (total * k) / (n - 1);
    while (j < line.length - 1 && cum[j] < s) j++;
    const seg = cum[j] - cum[j - 1] || 1;
    out.push(lerp(line[j - 1], line[j], (s - cum[j - 1]) / seg));
  }
  return out;
}

// ───────────────────────────────────────────── a lane's pieces ─────────────────────────────────────────────

/**
 * The ribbon's two edges clipped at the start (`startF` turns >= 0) and the end (`endF` does), keeping them paired row by row: each
 * edge is cut where it crosses, and both then continue from the same sample, so every row stays square to the centreline.
 */
export function clipPair(left: readonly P2[], right: readonly P2[], startF: (p: P2) => number, endF: (p: P2) => number): { left: P2[]; right: P2[] } {
  const first = (line: readonly P2[], f: (p: P2) => number): number => {
    const i = line.findIndex((p) => f(p) >= 0);
    return i < 0 ? line.length : i;
  };
  const cut = (line: readonly P2[], i: number, f: (p: P2) => number): P2 => {
    if (i <= 0) return line[0];
    if (i >= line.length) return line[line.length - 1];
    const f0 = f(line[i - 1]);
    const f1 = f(line[i]);
    return lerp(line[i - 1], line[i], -f0 / (f1 - f0));
  };
  const iL = first(left, startF);
  const iR = first(right, startF);
  const k = Math.max(iL, iR, 1);
  let l = [cut(left, iL, startF), ...left.slice(k)];
  let r = [cut(right, iR, startF), ...right.slice(k)];
  const jL = first(l, endF);
  const jR = first(r, endF);
  const m = Math.max(1, Math.min(jL, jR));
  l = [...l.slice(0, m), cut(l, jL, endF)];
  r = [...r.slice(0, m), cut(r, jR, endF)];
  return { left: l, right: r };
}

export interface LaneShape {
  /** the cobble's two edges, paired row by row (start on the sidewalk's circle, end on the lot's line) */
  left: P2[];
  right: P2[];
  /** the edging's inner lines (the cobble's edges moved out by nothing) from just past the sidewalk's curb to the end */
  edgeLeft: P2[];
  edgeRight: P2[];
  /** the centreline (for the curb opening) */
  centre: P2[];
}

export function laneShape(spec: LaneSpec): LaneShape {
  // the first point lies inside the ring, so each edge crosses the sidewalk's circle once
  const centre = smoothPolyline(spec.points, spec.trim, 0.5);
  const half = LANE_WIDTH / 2;
  const endF = (p: P2): number => spec.end.a * p.x + spec.end.b * p.z - spec.end.c;
  const ringF = (r: number) => (p: P2): number => Math.hypot(p.x, p.z) - r;
  const build = (d: number, r: number): P2[] => clipEnd(clipStart(offsetLine(centre, d), ringF(r)), endF);
  const { left, right } = clipPair(offsetLine(centre, half), offsetLine(centre, -half), ringF(SIDEWALK_OUT_R), endF);
  const edgeLeft = build(half, SIDEWALK_OUT_R + 0.1);
  const edgeRight = build(-half, SIDEWALK_OUT_R + 0.1);
  return {
    left,
    right,
    edgeLeft: resampleCount(edgeLeft, Math.max(edgeLeft.length, 2)),
    edgeRight: resampleCount(edgeRight, Math.max(edgeRight.length, 2)),
    centre,
  };
}

// ───────────────────────────────────────────── what stands clear of them ─────────────────────────────────────────────

let laneCentres: P2[][] | null = null;

/** Distance (m) from a spot to the nearest lane's edging outer face (negative: on the lane or its edging). */
export function laneClearance(x: number, z: number): number {
  laneCentres ??= LANES.map((l) => laneShape(l).centre);
  let best = Infinity;
  for (const c of laneCentres) {
    for (let i = 1; i < c.length; i++) {
      const dx = c[i].x - c[i - 1].x;
      const dz = c[i].z - c[i - 1].z;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - c[i - 1].x) * dx + (z - c[i - 1].z) * dz) / l2));
      best = Math.min(best, Math.hypot(x - c[i - 1].x - dx * t, z - c[i - 1].z - dz * t));
    }
  }
  return best - (LANE_WIDTH / 2 + EDGE_PROFILE[EDGE_PROFILE.length - 1][0]);
}

// ───────────────────────────────────────────── triangles ─────────────────────────────────────────────

/** One new vertex: world position, normal, material uv (the planar mapping lives in the caller). */
export interface Vtx {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  u: number;
  v: number;
  /** where the light map is read for this vertex (default: its own spot) and from which set of old triangles (default 0) */
  sx?: number;
  sz?: number;
  group?: number;
}

export class TriBuilder {
  readonly verts: Vtx[] = [];
  readonly index: number[] = [];
  add(v: Vtx): number {
    this.verts.push(v);
    return this.verts.length - 1;
  }
  /** a triangle, wound so its geometric normal points the way (nx, ny, nz) of its first vertex's normal */
  tri(a: number, b: number, c: number): void {
    const A = this.verts[a];
    const B = this.verts[b];
    const C = this.verts[c];
    const ux = B.x - A.x;
    const uy = B.y - A.y;
    const uz = B.z - A.z;
    const vx = C.x - A.x;
    const vy = C.y - A.y;
    const vz = C.z - A.z;
    const gx = uy * vz - uz * vy;
    const gy = uz * vx - ux * vz;
    const gz = ux * vy - uy * vx;
    const nx = A.nx + B.nx + C.nx;
    const ny = A.ny + B.ny + C.ny;
    const nz = A.nz + B.nz + C.nz;
    if (gx * nx + gy * ny + gz * nz >= 0) this.index.push(a, b, c);
    else this.index.push(a, c, b);
  }
  quad(a: number, b: number, c: number, d: number): void {
    // a-b along one side, c-d the next row (a,c / b,d share the cross direction)
    this.tri(a, b, c);
    this.tri(b, d, c);
  }
}

/** The world-planar mapping of the village's cobble (LM_walk): the ring's sidewalk and the lanes share it. */
export const walkUv = (x: number, z: number): [number, number] => [x / 2, z / 2 + 1];

/** The cobble ribbon between two edges. */
export function addRibbon(b: TriBuilder, left: readonly P2[], right: readonly P2[], y = WALK_Y): void {
  const rows: Array<[number, number]> = left.map((l, i) => {
    const r = right[i];
    const [lu, lv] = walkUv(l.x, l.z);
    const [ru, rv] = walkUv(r.x, r.z);
    return [b.add({ x: l.x, y, z: l.z, nx: 0, ny: 1, nz: 0, u: lu, v: lv }), b.add({ x: r.x, y, z: r.z, nx: 0, ny: 1, nz: 0, u: ru, v: rv })];
  });
  for (let i = 0; i + 1 < rows.length; i++) b.quad(rows[i][0], rows[i][1], rows[i + 1][0], rows[i + 1][1]);
}

/**
 * The granite edging along one side: `line` is the cobble's edge, `outward` +1 / -1 the side it grows to (left / right of the
 * travel). The stone's mapping is the ring curb's own: 1 uv per metre, u along the stone, v down its face.
 */
export function addEdging(b: TriBuilder, line: readonly P2[], outward: 1 | -1): void {
  if (line.length < 2) return;
  // outward normals per sample
  const nrm = line.map((_p, i) => {
    const a = line[Math.max(0, i - 1)];
    const c = line[Math.min(line.length - 1, i + 1)];
    const len = Math.hypot(c.x - a.x, c.z - a.z) || 1;
    return { x: ((c.z - a.z) / len) * outward, z: (-(c.x - a.x) / len) * outward };
  });
  // the profile's segment normals (outward offset, up): rotate each segment's 2D normal
  const segN = EDGE_PROFILE.slice(1).map((q, j) => {
    const p = EDGE_PROFILE[j];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    // the profile walks from the cobble's edge up and over to the grass: its right-hand side faces out of the stone
    return { o: -dy / len, y: dx / len };
  });
  const vertN = EDGE_PROFILE.map((_, j) => {
    const a = segN[Math.max(0, j - 1)];
    const c = segN[Math.min(segN.length - 1, j)];
    const o = a.o + c.o;
    const y = a.y + c.y;
    const l = Math.hypot(o, y) || 1;
    return { o: o / l, y: y / l };
  });
  let along = 0;
  const rows: number[][] = [];
  line.forEach((p, i) => {
    if (i > 0) along += dist(line[i - 1], p);
    let s = 0;
    const ids: number[] = [];
    EDGE_PROFILE.forEach(([off, y], j) => {
      if (j > 0) s += Math.hypot(off - EDGE_PROFILE[j - 1][0], y - EDGE_PROFILE[j - 1][1]);
      const n = vertN[j];
      ids.push(
        b.add({
          x: p.x + nrm[i].x * off,
          y,
          z: p.z + nrm[i].z * off,
          nx: nrm[i].x * n.o,
          ny: n.y,
          nz: nrm[i].z * n.o,
          u: along,
          v: 1.003 - s,
          sx: line[0].x,
          sz: line[0].z,
        }),
      );
    });
    rows.push(ids);
  });
  for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j + 1 < EDGE_PROFILE.length; j++) b.quad(rows[i][j], rows[i + 1][j], rows[i][j + 1], rows[i + 1][j + 1]);
}

/** A crossing's connector: straight along the radius at angle `a`, from the plaza's edge to the road. */
export function addConnector(b: TriBuilder, a: number, halfW = CONNECTOR_HALF_W, r0 = CONNECTOR_R[0], r1 = CONNECTOR_R[1]): void {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const rows = 4;
  const ids: number[][] = [];
  for (let i = 0; i <= rows; i++) {
    const r = r0 + ((r1 - r0) * i) / rows;
    ids.push(
      [-halfW, halfW].map((w) => {
        const x = r * ca - w * sa;
        const z = r * sa + w * ca;
        const [u, v] = walkUv(x, z);
        return b.add({ x, y: WALK_Y, z, nx: 0, ny: 1, nz: 0, u, v, sx: 30.4 * ca, sz: 30.4 * sa, group: 1 });
      }),
    );
  }
  for (let i = 0; i < rows; i++) b.quad(ids[i][0], ids[i][1], ids[i + 1][0], ids[i + 1][1]);
}

// ───────────────────────────────────────────── editing a mesh's geometry ─────────────────────────────────────────────

const A_LANE_Y = (y: number): boolean => Math.abs(y - WALK_Y) < 0.0015;

/** The point's lateral distance from the first leg of a lane (+ left), and how far along it. */
function laneFrame(spec: LaneSpec, x: number, z: number): { lat: number; along: number } {
  const p = spec.points[0];
  const q = spec.points[1];
  const l = Math.hypot(q.x - p.x, q.z - p.z);
  const dx = (q.x - p.x) / l;
  const dz = (q.z - p.z) / l;
  return { lat: (x - p.x) * dz * -1 + (z - p.z) * dx, along: (x - p.x) * dx + (z - p.z) * dz };
}

/** Which triangles of a baked LM_walk mesh the new shapes replace. */
export function isOldWalkTri(vy: readonly number[], cx: number, cz: number): "lane" | "connector" | null {
  if (!vy.every(A_LANE_Y)) return null;
  const r = Math.hypot(cx, cz);
  if (r > SIDEWALK_OUT_R - 0.1) return "lane";
  if (r < 32.5) return "connector";
  return null;
}

/** Does the ring's outer curb triangle (all vertices low, at the sidewalk's edge) sit in a lane's opening? */
export function inLaneOpening(spec: LaneSpec, vs: ReadonlyArray<readonly [number, number, number]>): boolean {
  const cx = (vs[0][0] + vs[1][0] + vs[2][0]) / 3;
  const cz = (vs[0][2] + vs[1][2] + vs[2][2]) / 3;
  const r = Math.hypot(cx, cz);
  if (r < SIDEWALK_CURB_R[0] || r > SIDEWALK_CURB_R[1]) return false;
  if (vs.some((v) => v[1] > 0.1)) return false;
  return vs.some((v) => {
    const f = laneFrame(spec, v[0], v[2]);
    return Math.abs(f.lat) < LANE_WIDTH / 2 + 0.02 && f.along > 0;
  });
}

/** Does a verge curb triangle (r ~30 / ~31) lie in a crossing's cut? */
export function inConnectorCut(angle: number, vs: ReadonlyArray<readonly [number, number, number]>): boolean {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const cx = (vs[0][0] + vs[1][0] + vs[2][0]) / 3;
  const cz = (vs[0][2] + vs[1][2] + vs[2][2]) / 3;
  const r = Math.hypot(cx, cz);
  if (r < VERGE_CURB_R[0] || r > VERGE_CURB_R[1]) return false;
  if (vs.some((v) => v[1] > 0.1)) return false;
  if (cx * ca + cz * sa < 0) return false;
  const w = -cx * sa + cz * ca;
  return Math.abs(w) < CONNECTOR_HALF_W + 0.35;
}

interface Samp {
  uv1x: number;
  uv1y: number;
  col: number[];
}

/** Light-map coordinates and vertex colour for a spot: barycentric inside one of the candidate triangles, else the nearest vertex. */
function makeSampler(geo: BufferGeometry, cand: readonly number[]): (x: number, z: number) => Samp {
  const pos = geo.getAttribute("position");
  const uv1 = geo.getAttribute("uv1");
  const col = geo.getAttribute("color");
  const idx = geo.getIndex()!;
  const colAt = (i: number): number[] => {
    const out: number[] = [];
    if (col) for (let c = 0; c < col.itemSize; c++) out.push(c === 0 ? col.getX(i) : c === 1 ? col.getY(i) : c === 2 ? col.getZ(i) : col.getW(i));
    return out;
  };
  return (x, z) => {
    let best = -1;
    let bestD = Infinity;
    for (const t of cand) {
      const i0 = idx.getX(t);
      const i1 = idx.getX(t + 1);
      const i2 = idx.getX(t + 2);
      const ax = pos.getX(i0), az = pos.getZ(i0);
      const bx = pos.getX(i1), bz = pos.getZ(i1);
      const cx = pos.getX(i2), cz = pos.getZ(i2);
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) > 1e-9) {
        const l0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
        const l1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
        const l2 = 1 - l0 - l1;
        if (l0 >= -1e-6 && l1 >= -1e-6 && l2 >= -1e-6) {
          const cs = [colAt(i0), colAt(i1), colAt(i2)];
          return {
            uv1x: l0 * uv1.getX(i0) + l1 * uv1.getX(i1) + l2 * uv1.getX(i2),
            uv1y: l0 * uv1.getY(i0) + l1 * uv1.getY(i1) + l2 * uv1.getY(i2),
            col: cs[0].map((_, k) => l0 * cs[0][k] + l1 * cs[1][k] + l2 * cs[2][k]),
          };
        }
      }
      for (const i of [i0, i1, i2]) {
        const d = (pos.getX(i) - x) ** 2 + (pos.getZ(i) - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best < 0) return { uv1x: 0, uv1y: 0, col: [1, 1, 1, 1] };
    return { uv1x: uv1.getX(best), uv1y: uv1.getY(best), col: colAt(best) };
  };
}

export interface GeometryEdit {
  /** triangle start offsets in the index to drop */
  drop: Set<number>;
  /** triangles (index offsets of the OLD geometry) that light the new vertices, per group: each group is its own light-map chart */
  sample: Record<number, number[]>;
  add: TriBuilder;
  /** the stone mapping keeps its own uv; the walk's is planar (the builder's u, v are used as they are) */
}

/** A copy of `geo` without the dropped triangles and with the builder's triangles on the end. */
export function editGeometry(geo: BufferGeometry, edit: GeometryEdit): BufferGeometry {
  const idx = geo.getIndex()!;
  const pos = geo.getAttribute("position");
  const nv = edit.add.verts.length;
  const total = pos.count + nv;
  const samplers = new Map<number, (x: number, z: number) => Samp>();
  for (const [g, tris] of Object.entries(edit.sample)) samplers.set(Number(g), makeSampler(geo, tris));
  const out = new BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const src = geo.getAttribute(name) as BufferAttribute;
    const arr = new (src.array.constructor as new (n: number) => Float32Array)(total * src.itemSize);
    arr.set(src.array as ArrayLike<number>, 0);
    out.setAttribute(name, new BufferAttribute(arr, src.itemSize, src.normalized));
  }
  const P = out.getAttribute("position") as BufferAttribute;
  const N = out.getAttribute("normal") as BufferAttribute | undefined;
  const U = out.getAttribute("uv") as BufferAttribute | undefined;
  const U1 = out.getAttribute("uv1") as BufferAttribute | undefined;
  const C = out.getAttribute("color") as BufferAttribute | undefined;
  edit.add.verts.forEach((v, k) => {
    const i = pos.count + k;
    P.setXYZ(i, v.x, v.y, v.z);
    N?.setXYZ(i, v.nx, v.ny, v.nz);
    U?.setXY(i, v.u, v.v);
    const s = (samplers.get(v.group ?? 0) ?? samplers.get(0)!)(v.sx ?? v.x, v.sz ?? v.z);
    U1?.setXY(i, s.uv1x, s.uv1y);
    if (C) {
      C.setX(i, s.col[0] ?? 1);
      C.setY(i, s.col[1] ?? 1);
      C.setZ(i, s.col[2] ?? 1);
      if (C.itemSize > 3) C.setW(i, s.col[3] ?? 1);
    }
  });
  const kept: number[] = [];
  for (let t = 0; t < idx.count; t += 3) if (!edit.drop.has(t)) kept.push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
  for (const i of edit.add.index) kept.push(pos.count + i);
  out.setIndex(total > 65535 ? new Uint32BufferAttribute(kept, 1) : new Uint16BufferAttribute(kept, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// ───────────────────────────────────────────── applying it to a village clone ─────────────────────────────────────────────

export interface GroundPatchStats {
  lanesDrawn: number;
  connectorsDrawn: number;
  walkTrianglesRemoved: number;
  stoneTrianglesRemoved: number;
  trianglesAdded: number;
}

function findMesh(root: Object3D, material: string): Mesh | null {
  let best: Mesh | null = null;
  let bestN = -1;
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || (o as { isInstancedMesh?: boolean }).isInstancedMesh || !/^village_lm_/.test(m.name)) return;
    if (Array.isArray(m.material) || (m.material as Material).name !== material) return;
    const n = m.geometry.getAttribute("position")?.count ?? 0;
    if (n > bestN) {
      best = m;
      bestN = n;
    }
  });
  return best;
}

/** Rebuild the lanes and the crossings' connectors in a clone of the village. `restore()` puts the originals back. */
export function patchGroundPaths(root: Object3D): { stats: GroundPatchStats; restore(): void } {
  const stats: GroundPatchStats = { lanesDrawn: 0, connectorsDrawn: 0, walkTrianglesRemoved: 0, stoneTrianglesRemoved: 0, trianglesAdded: 0 };
  const undo: Array<() => void> = [];
  const walk = findMesh(root, "LM_walk");
  const stone = findMesh(root, "LM_stone");
  if (!walk || !stone) return { stats, restore() {} };
  root.updateWorldMatrix(true, true);

  // ── the cobble: the old lanes and connectors out, the ribbons and ramps in
  const wg = walk.geometry;
  const wpos = wg.getAttribute("position");
  const widx = wg.getIndex()!;
  const wdrop = new Set<number>();
  const wsample: Record<number, number[]> = { 0: [], 1: [] };
  for (let t = 0; t < widx.count; t += 3) {
    const ys: number[] = [];
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      const i = widx.getX(t + k);
      ys.push(wpos.getY(i));
      cx += wpos.getX(i) / 3;
      cz += wpos.getZ(i) / 3;
    }
    const kind = isOldWalkTri(ys, cx, cz);
    if (kind) {
      wdrop.add(t);
      wsample[kind === "lane" ? 0 : 1].push(t); // each old strip is its own light-map chart: a new triangle reads only its own chart
    }
  }
  const wb = new TriBuilder();
  const sb = new TriBuilder();
  const shapes = LANES.map((l) => ({ spec: l, shape: laneShape(l) }));
  for (const { shape } of shapes) {
    addRibbon(wb, shape.left, shape.right);
    addEdging(sb, shape.edgeLeft, 1);
    addEdging(sb, shape.edgeRight, -1);
    stats.lanesDrawn++;
  }
  for (const a of CROSSING_ANGLES) {
    addConnector(wb, a);
    stats.connectorsDrawn++;
  }
  const newWalk = editGeometry(wg, { drop: wdrop, sample: wsample, add: wb });
  stats.walkTrianglesRemoved = wdrop.size;

  // ── the stone: the verge curbs and the ring's outer curb opened where a connector / a lane crosses; the edgings added
  const sg = stone.geometry;
  const spos = sg.getAttribute("position");
  const sidx = sg.getIndex()!;
  const sdrop = new Set<number>();
  const ssample: Record<number, number[]> = { 0: [] };
  for (let t = 0; t < sidx.count; t += 3) {
    const vs: Array<[number, number, number]> = [];
    for (let k = 0; k < 3; k++) {
      const i = sidx.getX(t + k);
      vs.push([spos.getX(i), spos.getY(i), spos.getZ(i)]);
    }
    const r = Math.hypot((vs[0][0] + vs[1][0] + vs[2][0]) / 3, (vs[0][2] + vs[1][2] + vs[2][2]) / 3);
    if (CROSSING_ANGLES.some((a) => inConnectorCut(a, vs)) || LANES.some((l) => inLaneOpening(l, vs))) sdrop.add(t);
    if (r > 38.3 && r < 40) ssample[0].push(t); // the ring's outer curb lights the edgings
  }
  const newStone = editGeometry(sg, { drop: sdrop, sample: ssample, add: sb });
  stats.stoneTrianglesRemoved = sdrop.size;
  stats.trianglesAdded = (wb.index.length + sb.index.length) / 3;

  walk.geometry = newWalk;
  stone.geometry = newStone;
  undo.push(() => {
    if (walk.geometry === newWalk) walk.geometry = wg;
    if (stone.geometry === newStone) stone.geometry = sg;
    newWalk.dispose();
    newStone.dispose();
  });
  return {
    stats,
    restore() {
      for (const u of undo.reverse()) u();
      undo.length = 0;
    },
  };
}
