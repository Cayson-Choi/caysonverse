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
//  - 2026-11-28 (owner, the library: "도서관 문에 맞게 도로가 연결되어야 이쁘지"): every lane ends straight and centred on its
//    door, flush with the step; every house and the café get a front walk the same way (a second-row house's leaves the side
//    of the nearest paving, `start`), and the gate's forecourt a walk from the footbridge round the fountain to the arch. Where
//    one walk joins another neither edging crosses the join (edgingRuns).
// The texture is the village's own world-planar mapping (u = x / 2, v = z / 2 + 1), so the cobbles run on across every join; the
// light-map coordinates come from the old triangles (barycentric where they covered the spot, the nearest vertex beyond; the
// house walks read one open spot, OPEN_WALK_LIGHT).

import { BufferAttribute, BufferGeometry, Uint16BufferAttribute, Uint32BufferAttribute, type Material, type Mesh, type Object3D } from "three";
import { houseLocalToWorld, porchStairsLocal } from "@caysonverse/shared/village/houseExterior";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { TRIM_KEEP_FROM } from "../street/streetTrim";

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
  /** The cobble's width (m); default LANE_WIDTH. A house's front walk is a little wider than its door (2.4 m). */
  width?: number;
  /**
   * A walk that does not start on the ring's sidewalk (a house's walk joining a lane or another walk): the ribbon starts where
   * `a*x + b*z >= c` (a few cm inside the other paving), and the ring's curb is left alone.
   */
  start?: { a: number; b: number; c: number };
  /** Where the cobble's baked light is read: the old lane strip under each spot (default) or one spot in open sun (a house's walk). */
  light?: "lane" | "open";
}

/**
 * Where a house's front walk reads its baked light: one spot in the middle of an old lane strip (the west lane's, between the
 * ring and the library, where the redrawn lane's cobble reads too), the same for every vertex, so the walks and the lanes wear
 * one tone. The baked strips ran nowhere near most houses: a vertex's nearest old strip vertex can be 20 m away, in a wall's or
 * a tree's baked shade (the south lane's, between the church walls, is blue-grey).
 */
export const OPEN_WALK_LIGHT: P2 = { x: -40, z: 12.07 };

/** A lane's cobble width. */
export const laneWidth = (spec: Pick<LaneSpec, "width">): number => spec.width ?? LANE_WIDTH;

/** A house's front steps: the bottom tread's front edge at the door's centre line, the way out of the door, the steps' half width. */
export function houseSteps(id: string): { step: P2; out: P2; half: number } {
  const h = VILLAGE_LAYOUT.sceneryHouses.find((x) => x.id === id);
  if (!h) throw new Error(`no house ${id}`);
  const st = porchStairsLocal(id);
  const step = houseLocalToWorld(h, 0, st.z1);
  const o = houseLocalToWorld(h, 0, st.z1 + 1);
  return { step, out: { x: o.x - step.x, z: o.z - step.z }, half: (st.x1 - st.x0) / 2 };
}

/** The houses' front walks: a little wider than the 1.8 m door, never wider than the steps. */
export const HOUSE_WALK_WIDTH = 2.4;
/** How far (m) a walk's end tucks under the bottom tread or a terrace's edge (no sliver of grass at the threshold). */
export const THRESHOLD_TUCK = 0.03;

/** The line a walk heading INTO a door ends on: `step` is the threshold's centre, `out` the way out of the door. */
const endAt = (step: P2, out: P2, tuck = THRESHOLD_TUCK): LaneSpec["end"] => ({ a: -out.x, b: -out.z, c: -(out.x * step.x + out.z * step.z) + tuck });

/** A walk straight out of a door (`step`, `out`) to the ring's sidewalk (the door's line crosses the sidewalk within `reach` m). */
function doorToRing(id: string, step: P2, out: P2, reach: number): LaneSpec {
  return {
    id,
    points: [{ x: step.x + out.x * reach, z: step.z + out.z * reach }, { x: step.x - out.x * 0.5, z: step.z - out.z * 0.5 }],
    trim: 1,
    end: endAt(step, out),
    width: HOUSE_WALK_WIDTH,
    light: "open",
  };
}
const houseToRing = (id: string, reach: number): LaneSpec => {
  const { step, out } = houseSteps(id);
  return doorToRing(`walk_${id}`, step, out, reach);
};

/**
 * The start line of a walk that leaves the side of another straight piece of paving (from `a` to `b`, `half` m wide) towards
 * `toward`: the paving's edge on that side, 5 cm inside it (the walk's cobble tucks under the edge, no sliver of grass).
 */
function sideStart(a: P2, b: P2, half: number, toward: P2): NonNullable<LaneSpec["start"]> {
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  let nx = (b.z - a.z) / l;
  let nz = -(b.x - a.x) / l;
  if (nx * (toward.x - a.x) + nz * (toward.z - a.z) < 0) {
    nx = -nx;
    nz = -nz;
  }
  return { a: nx, b: nz, c: nx * a.x + nz * a.z + half - 0.05 };
}

/** Where a straight piece of paving (a to b) crosses the line x = `x` (or z = `z`). */
function onLeg(a: P2, b: P2, at: { x: number } | { z: number }): P2 {
  const t = "x" in at ? (at.x - a.x) / (b.x - a.x) : (at.z - a.z) / (b.z - a.z);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * A house's walk that leaves the side of a straight piece of paving (a to b, `half` m wide) where that crosses the line `at`, turns
 * at the `via` corners and runs on to its door.
 */
function houseOffLeg(id: string, a: P2, b: P2, half: number, at: { x: number } | { z: number }, via: readonly P2[] = [], trim = 1): LaneSpec {
  const { step, out } = houseSteps(id);
  return {
    id: `walk_${id}`,
    points: [onLeg(a, b, at), ...via, { x: step.x - out.x * 0.5, z: step.z - out.z * 0.5 }],
    trim,
    start: sideStart(a, b, half, via[0] ?? step),
    end: endAt(step, out),
    width: HOUSE_WALK_WIDTH,
    light: "open",
  };
}

/**
 * The lanes to the lot buildings' doors (villageLots.ts: each door's centre line, `approach` on the lot's front edge) and the houses'
 * front walks (owner 2026-11-28, the library: "도서관 문에 맞게 도로가 연결되어야 이쁘지" — every path ends straight on its door,
 * centred, flush with the step). A lane's first point is its own start on the ring's inner side: the ribbon begins where its edges
 * cross the sidewalk's outer circle; a walk with a `start` leaves the side of other paving. Each ends straight on its door's centre line.
 */
export const LANES: readonly LaneSpec[] = [
  // north: to the memorial forecourt's front (z -47.5), straight
  { id: "n", points: [{ x: 0, z: -30 }, { x: 0, z: -52 }], trim: 1, end: { a: 0, b: -1, c: 47.5 } },
  // north-east / north-west: the lane's own heading, then onto the chapel's / the temple gate's door line (z -37) to the stone
  // forecourt (x 40.2 / -39.6). The chapel's used to end on z -36.7, 30 cm off its door; its first leg keeps its heading (the
  // moved tree_37, shared/village/pathPlants.ts, stays clear of it)
  { id: "ne", points: [{ x: 24.72, z: -16.99 }, { x: 37.39, z: -37 }, { x: 44, z: -37 }], trim: 2.4, end: { a: 1, b: 0, c: 40.2 } },
  { id: "nw", points: [{ x: -24.72, z: -16.99 }, { x: -35.2, z: -37 }, { x: -42, z: -37 }], trim: 3.2, end: { a: -1, b: 0, c: 39.6 } },
  // east / west: the lane's own heading to its corner on the door line (z 15), then straight along it. The old ribbons kept the
  // heading past the corner (to z 16.8 / 17.6) and met the fronts 0.7 m / 2 m left of the doors: the library's half on its wall
  // and bay window. The corner keeps its place (the trees and shrubs beside the first leg stay clear of it).
  // east: through the schoolyard's gate (the fence's 5.2 m opening, x 48.5) on across the yard to the porch's stone step (x 58.8)
  { id: "e", points: [{ x: 28.98, z: 7.76 }, { x: 47.5, z: 15 }, { x: 62, z: 15 }], trim: 1.5, end: { a: 1, b: 0, c: 58.8 + THRESHOLD_TUCK } },
  // west: to the library's entrance, between the topiaries' planters (x -52.4)
  { id: "w", points: [{ x: -28.98, z: 7.76 }, { x: -47.5, z: 15 }, { x: -56, z: 15 }], trim: 1.5, end: { a: -1, b: 0, c: 52.4 } },
  // south: to the church porch's stone step (z 53.2); it stopped 3 m short on the lawn
  { id: "s", points: [{ x: 0, z: 30 }, { x: 0, z: 56 }], trim: 1, end: { a: 0, b: 1, c: 53.2 + THRESHOLD_TUCK } },
  // bridge lane: its own two legs with the corner rounded, to the bridge's foot (z 72)
  { id: "bridge", points: [{ x: -11, z: 27.91 }, { x: -24, z: 46 }, { x: -24, z: 74 }], trim: 7, end: { a: 0, b: 1, c: 72 } },
  // the houses that face the ring: straight out of the door to the sidewalk
  houseToRing("house_1", 7),
  houseToRing("house_2", 7),
  houseToRing("house_3", 9.5),
  houseToRing("house_5", 5.5),
  houseToRing("house_10", 8.5),
  // the café: straight out of its door (z -15.1) to the terrace deck's front edge (x 40.6, the planters' line; the 3 cm deck is
  // walkable to the door), the cobble tucked under it
  doorToRing("walk_cafe", { x: 40.6, z: -15.1 }, { x: -1, z: 0 }, 6.5),
  // the second-row houses and house 4 leave the side of the nearest paving (a T) and run straight to their doors:
  // house 4 (its door's line would cross house 10's walk) off house 10's walk
  houseOffLeg("house_4", houseSteps("house_10").step, { x: -26, z: 26.4 }, HOUSE_WALK_WIDTH / 2, { x: -32.4 }),
  // house 7 / 9 behind house 1 / 2: off the chapel's / the temple's lane (its first leg), past house 1's / 2's side
  houseOffLeg("house_7", { x: 24.72, z: -16.99 }, { x: 37.39, z: -37 }, LANE_WIDTH / 2, { x: 31 }),
  houseOffLeg("house_9", { x: -24.72, z: -16.99 }, { x: -35.2, z: -37 }, LANE_WIDTH / 2, { x: -31 }),
  // house 6 behind house 3: off house 3's walk (z 29.5), along the lawn north of house 3 and round to its door
  houseOffLeg("house_6", { x: 29, z: 20 }, houseSteps("house_3").step, HOUSE_WALK_WIDTH / 2, { z: 29.5 }, [{ x: 42, z: 29.5 }], 2.2),
  // house 8 behind house 4: off house 4's walk (z 33.6, between house 10's side and house 4's front), along house 4's front, round its corner and to the door
  houseOffLeg("house_8", { x: -32.4, z: 26.4 }, houseSteps("house_4").step, HOUSE_WALK_WIDTH / 2, { z: 33.6 }, [{ x: -40.6, z: 33.6 }, { x: -40.6, z: 40.6 }], 2),
  // 케이슨랜드's gate: from the footbridge's south end (z 78) to the fountain's flagstone ring (r 2.5 round (-24, 88.225); the
  // cobble tucks under the ring where its chord is the walk's width), and on from the ring through the arch to the gate's leaves
  // (z 94.6; the queue's stanchions stand on it)
  {
    id: "gate_n",
    points: [{ x: -24, z: 76 }, { x: -24, z: 88 }],
    trim: 1,
    start: { a: 0, b: 1, c: 78 - 0.05 },
    end: { a: 0, b: 1, c: 88.225 - 2 + 0.02 },
    light: "open",
  },
  {
    id: "gate_s",
    points: [{ x: -24, z: 89 }, { x: -24, z: 97 }],
    trim: 1,
    start: { a: 0, b: 1, c: 88.225 + 2 - 0.02 },
    end: { a: 0, b: 1, c: 94.6 + THRESHOLD_TUCK },
    light: "open",
  },
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
  // a ring lane's first point lies inside the ring, so each edge crosses the sidewalk's circle once; a joining walk's first point
  // lies on the other paving, before its start line
  const centre = smoothPolyline(spec.points, spec.trim, 0.5);
  const half = laneWidth(spec) / 2;
  const endF = (p: P2): number => spec.end.a * p.x + spec.end.b * p.z - spec.end.c;
  const ringF = (r: number) => (p: P2): number => Math.hypot(p.x, p.z) - r;
  const st = spec.start;
  const startF = st ? (p: P2): number => st.a * p.x + st.b * p.z - st.c : ringF(SIDEWALK_OUT_R);
  const edgeStartF = st ? startF : ringF(SIDEWALK_OUT_R + 0.1);
  const build = (d: number): P2[] => clipEnd(clipStart(offsetLine(centre, d), edgeStartF), endF);
  const { left, right } = clipPair(offsetLine(centre, half), offsetLine(centre, -half), startF, endF);
  const edgeLeft = build(half);
  const edgeRight = build(-half);
  return {
    left,
    right,
    edgeLeft: resampleCount(edgeLeft, Math.max(edgeLeft.length, 2)),
    edgeRight: resampleCount(edgeRight, Math.max(edgeRight.length, 2)),
    centre,
  };
}

/** The cobble's own centreline (the middle of each row, start line to end line) and its half width. */
export function laneCobble(spec: LaneSpec): { mid: P2[]; half: number } {
  const s = laneShape(spec);
  return { mid: s.left.map((l, i) => ({ x: (l.x + s.right[i].x) / 2, z: (l.z + s.right[i].z) / 2 })), half: laneWidth(spec) / 2 };
}

/** Distance (m) from a spot to a polyline. */
export function polylineDistance(line: readonly P2[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const dx = line[i].x - line[i - 1].x;
    const dz = line[i].z - line[i - 1].z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - line[i - 1].x) * dx + (z - line[i - 1].z) * dz) / l2));
    best = Math.min(best, Math.hypot(x - line[i - 1].x - dx * t, z - line[i - 1].z - dz * t));
  }
  return best;
}

/**
 * An edging line cut where it runs over another lane's cobble (a walk joining a lane: neither the lane's kerb across the join nor
 * the walk's kerb inside the lane): the runs of samples that stay off every other cobble (8 cm of slack for the stone's width).
 */
export function edgingRuns(line: readonly P2[], others: ReadonlyArray<{ mid: P2[]; half: number }>): P2[][] {
  const runs: P2[][] = [];
  let cur: P2[] = [];
  for (const p of line) {
    const covered = others.some((o) => o.mid.length > 1 && polylineDistance(o.mid, p.x, p.z) < o.half + 0.08);
    if (covered) {
      if (cur.length > 1) runs.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

// ───────────────────────────────────────────── what stands clear of them ─────────────────────────────────────────────

let laneCentres: Array<{ c: P2[]; half: number }> | null = null;

/** Distance (m) from a spot to the nearest lane's edging outer face (negative: on the lane or its edging). */
export function laneClearance(x: number, z: number): number {
  laneCentres ??= LANES.map((l) => ({ c: laneShape(l).centre, half: laneWidth(l) / 2 }));
  let best = Infinity;
  for (const { c, half } of laneCentres) best = Math.min(best, polylineDistance(c, x, z) - half);
  return best - EDGE_PROFILE[EDGE_PROFILE.length - 1][0];
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
export function addRibbon(
  b: TriBuilder,
  left: readonly P2[],
  right: readonly P2[],
  y = WALK_Y,
  light?: (p: P2) => { sx: number; sz: number; group: number },
): void {
  const vert = (p: P2): number => {
    const [u, v] = walkUv(p.x, p.z);
    return b.add({ x: p.x, y, z: p.z, nx: 0, ny: 1, nz: 0, u, v, ...(light ? light(p) : {}) });
  };
  const rows: Array<[number, number]> = left.map((l, i) => [vert(l), vert(right[i])]);
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
  if (spec.start) return false; // a joining walk does not cross the ring's curb
  const cx = (vs[0][0] + vs[1][0] + vs[2][0]) / 3;
  const cz = (vs[0][2] + vs[1][2] + vs[2][2]) / 3;
  const r = Math.hypot(cx, cz);
  if (r < SIDEWALK_CURB_R[0] || r > SIDEWALK_CURB_R[1]) return false;
  if (vs.some((v) => v[1] > 0.1)) return false;
  return vs.some((v) => {
    const f = laneFrame(spec, v[0], v[2]);
    return Math.abs(f.lat) < laneWidth(spec) / 2 + 0.02 && f.along > 0;
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
  const keepFrom = kept.length / 3 - edit.add.index.length / 3;
  out.setIndex(total > 65535 ? new Uint32BufferAttribute(kept, 1) : new Uint16BufferAttribute(kept, 1));
  // the new triangles stay whatever a later trim of old pieces covers (housesPrep.ts cutOldHouses: the old porches' cut reaches
  // past the new steps, over the front walks' edging)
  out.userData[TRIM_KEEP_FROM] = keepFrom;
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
  const shapes = LANES.map((l) => ({ spec: l, shape: laneShape(l), cobble: laneCobble(l) }));
  const openLight = (): { sx: number; sz: number; group: number } => ({ sx: OPEN_WALK_LIGHT.x, sz: OPEN_WALK_LIGHT.z, group: 0 });
  for (const { spec, shape } of shapes) {
    const others = shapes.filter((o) => o.spec !== spec).map((o) => o.cobble);
    addRibbon(wb, shape.left, shape.right, WALK_Y, spec.light === "open" ? openLight : undefined);
    for (const run of edgingRuns(shape.edgeLeft, others)) addEdging(sb, run, 1);
    for (const run of edgingRuns(shape.edgeRight, others)) addEdging(sb, run, -1);
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
