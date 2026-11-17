/**
 * The 별똥별 급행's static geometry, built from the shared track (shared/land/coaster.ts), in TRACK-LOCAL metres (= park metres).
 *
 * Phase 2 construction (real tubular-steel coaster, owner: "허접해 보이면 안 되고"):
 *  - track: two running rails, a deep indigo spine tube, steel cross-ties with rail seats and a V-truss under every third tie;
 *  - supports: tapered tubular column PAIRS with base flanges and bolts on a concrete footing, collars at every panel joint, horizontal struts and
 *    X-bracing per panel; on the loop only at its two vertical runs;
 *  - the lift hill: a catwalk with a grating floor and a double handrail on its right, posts every 3 m, the anti-rollback rack and the chain;
 *  - the train car: a lofted fibreglass hull and nose with livery (indigo, a gold stripe, a star-gold swoosh), padded seat backs, contoured
 *    lap bars with rubber grips, rivet rows and panel seams.
 * `detail: "light"` (phones) drops the catwalk, the chain and rack, the rivets and thins the supports and ties.
 */
import type { BufferGeometry } from "three";
import { SEAT_HALF_GAP, SEAT_TOP, type CoasterTrack } from "@caysonverse/shared/land/coaster";
import { GeoBuilder, cross, norm, type V3 } from "./geoBuilder";

export const COLORS = {
  rail: [0.78, 0.8, 0.84] as V3,
  spine: [0.16, 0.18, 0.56] as V3, // brand indigo, deeper
  strut: [0.93, 0.9, 0.84] as V3, // cream
  support: [0.94, 0.91, 0.85] as V3,
  collar: [0.7, 0.68, 0.64] as V3,
  foot: [0.62, 0.62, 0.64] as V3,
  bolt: [0.45, 0.45, 0.5] as V3,
  tie: [0.22, 0.24, 0.3] as V3,
  grating: [0.35, 0.36, 0.4] as V3,
  chain: [0.12, 0.12, 0.14] as V3,
  carBody: [0.16, 0.18, 0.62] as V3,
  carBody2: [0.1, 0.12, 0.45] as V3,
  carTrim: [0.97, 0.78, 0.3] as V3, // star gold
  carWhite: [0.96, 0.94, 0.9] as V3,
  seat: [0.96, 0.9, 0.78] as V3,
  seatDark: [0.2, 0.19, 0.23] as V3,
  bar: [0.88, 0.89, 0.93] as V3,
  grip: [0.1, 0.1, 0.12] as V3,
  pad: [0.16, 0.16, 0.19] as V3,
} as const;

export const GAUGE = 0.62; // each rail's distance from the centre line
const RAIL_R = 0.065;
const SPINE_R = 0.17;
const SPINE_DROP = 0.5;
export const CHUNKS = 24;

export type TrackDetail = "full" | "light";

export interface TrackChunk {
  steel: BufferGeometry;
  from: number;
  to: number;
}

export interface TrackBuild {
  chunks: TrackChunk[];
  triangles: number;
}

const at = (track: CoasterTrack, i: number): V3 => {
  const k = ((i % track.n) + track.n) % track.n;
  return [track.pos[3 * k]!, track.pos[3 * k + 1]!, track.pos[3 * k + 2]!];
};
const upAt = (track: CoasterTrack, i: number): V3 => {
  const k = ((i % track.n) + track.n) % track.n;
  return [track.up[3 * k]!, track.up[3 * k + 1]!, track.up[3 * k + 2]!];
};
const tanAt = (track: CoasterTrack, i: number): V3 => {
  const k = ((i % track.n) + track.n) % track.n;
  return [track.tan[3 * k]!, track.tan[3 * k + 1]!, track.tan[3 * k + 2]!];
};

/** The horizontal direction across the track (the rider's right, flattened): where a support's legs spread. */
function lateral(track: CoasterTrack, i: number): V3 {
  const r = cross(tanAt(track, i), upAt(track, i));
  const h = Math.hypot(r[0], r[2]);
  return h > 0.2 ? [r[0] / h, 0, r[2] / h] : norm([tanAt(track, i)[2], 0, -tanAt(track, i)[0]]);
}

const lerp3 = (a: V3, b: V3, f: number): V3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
const off = (p: V3, d: V3, k: number): V3 => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];

/** One tapered tubular column pair from the spine to the footing, with collars, struts, X bracing, base flanges and bolts. */
function support(steel: GeoBuilder, spine: V3, lat: V3, detail: TrackDetail): void {
  const h = spine[1];
  const spread = 1.0 + h * 0.075;
  const top: [V3, V3] = [off([spine[0], spine[1] - 0.12, spine[2]], lat, 0.32), off([spine[0], spine[1] - 0.12, spine[2]], lat, -0.32)];
  const gnd: [V3, V3] = [off([spine[0], 0.34, spine[2]], lat, spread), off([spine[0], 0.34, spine[2]], lat, -spread)];
  const rTop = 0.16;
  const rBot = 0.2 + Math.min(0.12, h * 0.005);
  const sides = detail === "full" ? 8 : 6;
  steel.cylinder(top[0], gnd[0], rTop, rBot, sides, COLORS.support);
  steel.cylinder(top[1], gnd[1], rTop, rBot, sides, COLORS.support);
  // a saddle plate under the spine
  steel.box([spine[0], spine[1] - 0.26, spine[2]], lat, [0, 1, 0], 0.55, 0.045, 0.28, COLORS.collar);
  const panels = Math.max(1, Math.floor(h / 6));
  for (let k = 1; k <= panels; k++) {
    const f = k / (panels + 1);
    const a = lerp3(gnd[0], top[0], f);
    const b = lerp3(gnd[1], top[1], f);
    steel.cylinder(a, b, 0.055, 0.055, 5, COLORS.strut);
    if (detail === "full") {
      const f0 = (k - 1) / (panels + 1);
      const a0 = lerp3(gnd[0], top[0], f0);
      const b0 = lerp3(gnd[1], top[1], f0);
      steel.cylinder(a0, b, 0.04, 0.04, 4, COLORS.strut);
      steel.cylinder(b0, a, 0.04, 0.04, 4, COLORS.strut);
      // collars at the panel joints
      for (const pa of [a, b]) steel.cylinder([pa[0], pa[1] - 0.09, pa[2]], [pa[0], pa[1] + 0.09, pa[2]], 0.15, 0.15, 8, COLORS.collar, true);
    }
  }
  // base flange (a square plate with four bolts) on a concrete footing, each leg
  for (const g of gnd) {
    steel.box([g[0], 0.16, g[2]], [1, 0, 0], [0, 1, 0], 0.55, 0.16, 0.55, COLORS.foot);
    steel.box([g[0], 0.37, g[2]], [1, 0, 0], [0, 1, 0], 0.34, 0.04, 0.34, COLORS.collar);
    if (detail === "full") {
      for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]] as const) {
        steel.cylinder([g[0] + dx, 0.41, g[2] + dz], [g[0] + dx, 0.47, g[2] + dz], 0.035, 0.035, 6, COLORS.bolt, true);
      }
    }
  }
}

export function buildTrack(track: CoasterTrack, detail: TrackDetail = "full"): TrackBuild {
  const chunks: TrackChunk[] = [];
  const per = Math.ceil(track.n / CHUNKS);
  const step = detail === "full" ? 2 : 3; // a ring every metre (1.5 on a phone)
  const loopFrom = track.marks.loopFrom ?? -1;
  const loopTo = track.marks.loopTo ?? -1;
  const supportEvery = detail === "full" ? 14 : 22; // samples (7 m / 11 m)
  const tieEvery = Math.max(1, Math.round((detail === "full" ? 1.4 : 2.4) / track.ds));
  let triangles = 0;
  for (let c = 0; c < CHUNKS; c++) {
    const from = c * per;
    const to = Math.min(track.n, from + per);
    if (from >= to) break;
    const steel = new GeoBuilder();
    const idxs: number[] = [];
    for (let i = from; i <= to; i += step) idxs.push(i);
    if (idxs[idxs.length - 1] !== to) idxs.push(to);
    const centreL: V3[] = [];
    const centreR: V3[] = [];
    const centreS: V3[] = [];
    const ba: V3[] = [];
    const bb: V3[] = [];
    for (const i of idxs) {
      const p = at(track, i);
      const u = upAt(track, i);
      const r = cross(tanAt(track, i), u);
      centreL.push(off(p, r, -GAUGE));
      centreR.push(off(p, r, GAUGE));
      centreS.push(off(p, u, -SPINE_DROP));
      ba.push(r);
      bb.push(u);
    }
    steel.sweep(centreL, ba, bb, RAIL_R, 6, COLORS.rail, 0.5);
    steel.sweep(centreR, ba, bb, RAIL_R, 6, COLORS.rail, 0.5);
    steel.sweep(centreS, ba, bb, SPINE_R, detail === "full" ? 10 : 8, COLORS.spine, 0.35);

    // steel cross-ties with a rail seat under each rail, and a V-truss from the spine under every third tie
    let tieCount = 0;
    for (let i = from; i < to; i += tieEvery) {
      const p = at(track, i);
      const u = upAt(track, i);
      const r = cross(tanAt(track, i), u);
      steel.box(off(p, u, -0.1), r, u, GAUGE + 0.12, 0.03, 0.07, COLORS.tie);
      if (detail === "full") {
        for (const sgn of [-1, 1]) steel.box(off(off(p, r, sgn * GAUGE), u, -0.07), r, u, 0.1, 0.018, 0.09, COLORS.collar); // rail seat
        if (tieCount % 3 === 0) {
          const spine = off(p, u, -SPINE_DROP);
          for (const sgn of [-1, 1]) steel.cylinder(spine, off(off(p, r, sgn * GAUGE), u, -0.1), 0.045, 0.045, 4, COLORS.strut);
        }
      }
      tieCount++;
    }

    // supports
    for (let i = from; i < to; i += supportEvery) {
      const p = at(track, i);
      const u = upAt(track, i);
      const spine = off(p, u, -SPINE_DROP);
      if (spine[1] < 2.6) continue;
      if (i > loopFrom && i < loopTo) {
        const rel = (i - loopFrom) / (loopTo - loopFrom);
        if (!(Math.abs(rel - 0.25) < 0.04 || Math.abs(rel - 0.75) < 0.04)) continue;
      }
      support(steel, spine, lateral(track, i), detail);
    }

    // the lift hill: catwalk + handrails on the right, the chain and the anti-rollback rack
    if (detail === "full" && to > track.liftFrom && from < track.liftTo) {
      const a = Math.max(from, track.liftFrom);
      const b = Math.min(to, track.liftTo);
      for (let i = a; i < b; i += 4) {
        const p = at(track, i);
        const u = upAt(track, i);
        const t = tanAt(track, i);
        const r = cross(t, u);
        const c0 = off(off(p, r, 1.75), u, -0.62);
        steel.box(c0, r, u, 0.42, 0.022, 1.02, COLORS.grating);
        for (const dz of [-0.6, -0.2, 0.2, 0.6]) steel.box(off(c0, t, dz), r, u, 0.42, 0.03, 0.03, COLORS.collar);
        steel.cylinder(off(p, u, -SPINE_DROP), off(c0, u, -0.05), 0.04, 0.04, 4, COLORS.strut); // outrigger bracket
      }
      const railTop: V3[] = [];
      const railMid: V3[] = [];
      const ra: V3[] = [];
      const rb: V3[] = [];
      for (let i = a; i <= b; i += 4) {
        const p = at(track, i);
        const u = upAt(track, i);
        const r = cross(tanAt(track, i), u);
        const edge = off(off(p, r, 2.12), u, -0.6);
        railTop.push(off(edge, u, 1.05));
        railMid.push(off(edge, u, 0.55));
        ra.push(r);
        rb.push(u);
        if ((i - a) % 12 === 0) steel.cylinder(edge, off(edge, u, 1.05), 0.03, 0.03, 5, COLORS.strut);
      }
      if (railTop.length > 1) {
        steel.sweep(railTop, ra, rb, 0.028, 5, COLORS.strut, 0.5);
        steel.sweep(railMid, ra, rb, 0.02, 4, COLORS.strut, 0.5);
      }
      // the chain: dark links between the rails, a link every 0.5 m, and the rack's teeth beside it
      for (let i = a; i < b; i += 1) {
        const p = at(track, i);
        const u = upAt(track, i);
        const r = cross(tanAt(track, i), u);
        steel.box(off(p, u, -0.3), r, u, 0.055, 0.025, 0.2, COLORS.chain);
        if (i % 2 === 0) steel.box(off(off(p, u, -0.36), r, 0.24), r, u, 0.03, 0.04, 0.05, COLORS.bolt);
      }
    }
    triangles += steel.triangles;
    chunks.push({ steel: steel.build(), from, to });
  }
  return { chunks, triangles };
}

/**
 * One car, in car space (+z forward, y up, the origin on the centre line at track height; the instance matrix maps +x to the car's LEFT,
 * the car is symmetric). A lofted fibreglass hull and nose, padded seats, contoured lap bars, rivet rows. ~2.9 m long.
 */
export function buildCar(detail: TrackDetail = "full"): BufferGeometry {
  const b = new GeoBuilder();
  const X: V3 = [1, 0, 0];
  const Y: V3 = [0, 1, 0];
  // the hull's paint: indigo, a deeper indigo below the waterline (the gold stripes and white pinstripe are separate thin boxes, so colours do not bleed)
  const livery = (_a: number, _z: number, _x: number, y: number): V3 => (y < 0.2 ? COLORS.carBody2 : COLORS.carBody);
  // the hull: a rounded tub, low enough that the seats stand on its deck
  b.loft(
    [
      { z: -1.42, w: 0.82, h: 0.13, yc: 0.3 },
      { z: -1.28, w: 0.94, h: 0.17, yc: 0.31 },
      { z: -0.6, w: 1.0, h: 0.2, yc: 0.32 },
      { z: 0.4, w: 1.0, h: 0.2, yc: 0.32 },
      { z: 0.9, w: 0.97, h: 0.2, yc: 0.33 },
      { z: 1.2, w: 0.9, h: 0.17, yc: 0.33 },
      { z: 1.4, w: 0.7, h: 0.13, yc: 0.31 },
    ],
    20,
    3.2,
    livery,
  );
  // the hood: a sculpted snout rising to ~0.92 m at the dash, the lower edge of the rider's view
  b.loft(
    [
      { z: 0.62, w: 0.86, h: 0.1, yc: 0.68 },
      { z: 0.82, w: 0.9, h: 0.22, yc: 0.8 },
      { z: 1.05, w: 0.88, h: 0.24, yc: 0.78 },
      { z: 1.28, w: 0.74, h: 0.2, yc: 0.68 },
      { z: 1.46, w: 0.46, h: 0.14, yc: 0.54 },
      { z: 1.52, w: 0.2, h: 0.08, yc: 0.44 },
    ],
    20,
    3,
    livery,
  );
  // livery: a gold stripe down the hood and deck, a gold swoosh and a white pinstripe along each flank
  b.box([0, 1.026, 0.88], X, Y, 0.07, 0.008, 0.26, COLORS.carTrim);
  b.box([0, 0.5, -0.3], X, Y, 0.07, 0.006, 1.0, COLORS.carTrim);
  for (const sx of [-1, 1]) {
    b.box([sx * 1.003, 0.34, -0.1], X, Y, 0.006, 0.035, 1.05, COLORS.carTrim);
    b.box([sx * 1.003, 0.27, -0.1], X, Y, 0.006, 0.012, 1.1, COLORS.carWhite);
  }
  // padded rim along the cockpit sides, with stanchions
  for (const sx of [-1, 1]) {
    b.tube([[sx * 0.93, 0.6, -1.2], [sx * 0.97, 0.62, -0.3], [sx * 0.97, 0.62, 0.55], [sx * 0.9, 0.64, 0.75]], 0.06, 8, COLORS.seatDark);
    for (const z of [-1.0, -0.3, 0.4]) b.cylinder([sx * 0.95, 0.4, z], [sx * 0.95, 0.6, z], 0.025, 0.025, 5, COLORS.bar);
  }
  // seats: a padded cushion, a padded back and a headrest (lofts centred on x = 0, moved to the seat), and the lap bar
  const padded = (yc0: number, hh: number, z0: number, z1: number, ww: number, col: V3): void =>
    b.loft(
      [
        { z: z0, w: ww * 0.8, h: hh * 0.7, yc: yc0 },
        { z: z0 + (z1 - z0) * 0.15, w: ww, h: hh, yc: yc0 },
        { z: z1 - (z1 - z0) * 0.15, w: ww, h: hh, yc: yc0 },
        { z: z1, w: ww * 0.8, h: hh * 0.7, yc: yc0 },
      ],
      14,
      3.6,
      () => col,
    );
  for (const side of [-1, 1]) {
    const x = side * SEAT_HALF_GAP;
    const start = b.vertices;
    padded(SEAT_TOP - 0.07, 0.07, -0.64, 0.14, 0.34, COLORS.seat); // the cushion: its top is at SEAT_TOP
    padded(SEAT_TOP + 0.4, 0.42, -0.74, -0.56, 0.32, COLORS.seat); // the back
    padded(SEAT_TOP + 0.93, 0.1, -0.74, -0.56, 0.2, COLORS.seatDark); // the headrest
    for (let v = start; v < b.vertices; v++) b.pos[3 * v] = b.pos[3 * v]! + x;
    const y0 = SEAT_TOP + 0.26;
    const path: V3[] = [
      [x - 0.3, 0.44, 0.02],
      [x - 0.31, 0.6, 0.14],
      [x - 0.3, y0, 0.3],
      [x - 0.2, y0 + 0.07, 0.4],
      [x, y0 + 0.1, 0.43],
      [x + 0.2, y0 + 0.07, 0.4],
      [x + 0.3, y0, 0.3],
      [x + 0.31, 0.6, 0.14],
      [x + 0.3, 0.44, 0.02],
    ];
    b.tube(path, 0.028, 8, COLORS.bar);
    b.tube(path.slice(2, 7), 0.062, 10, COLORS.pad); // the padded section over the thighs
    for (const sg of [-1, 1]) b.cylinder([x + sg * 0.3, y0, 0.3], [x + sg * 0.25, y0 + 0.3, 0.5], 0.032, 0.028, 8, COLORS.grip, true);
  }
  // the grab bar across the hood
  b.tube([[-0.8, 0.95, 0.92], [-0.8, 1.06, 0.94], [0, 1.09, 0.97], [0.8, 1.06, 0.94], [0.8, 0.95, 0.92]], 0.024, 8, COLORS.bar);
  if (detail === "full") {
    for (const sx of [-1, 1]) {
      for (let z = -1.2; z <= 1.15; z += 0.16) {
        b.cylinder([sx * 1.0, 0.255, z], [sx * 1.028, 0.255, z], 0.017, 0.015, 5, COLORS.bolt);
        b.cylinder([sx * 1.0, 0.395, z], [sx * 1.026, 0.395, z], 0.014, 0.013, 5, COLORS.bolt);
      }
    }
    for (const z of [-0.95, -0.2, 0.55]) b.box([0, 0.512, z], X, Y, 0.97, 0.004, 0.006, COLORS.seatDark); // panel seams across the deck
  }
  // the bogies: 4 wheels per side (on the rails at +-GAUGE), and the coupler
  for (const sx of [-1, 1]) {
    for (const z of [-0.95, -0.55, 0.55, 0.95]) b.cylinder([sx * GAUGE - 0.05, -0.02, z], [sx * GAUGE + 0.05, -0.02, z], 0.13, 0.13, 12, COLORS.pad, true);
    b.box([sx * GAUGE, 0.08, 0], X, Y, 0.06, 0.07, 1.1, COLORS.carBody2);
  }
  b.box([0, 0.12, 1.55], X, Y, 0.06, 0.05, 0.14, COLORS.pad);
  return b.build();
}
