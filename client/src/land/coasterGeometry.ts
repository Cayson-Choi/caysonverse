/**
 * The 별똥별 급행's static geometry, built from the shared track (shared/land/coaster.ts): per chunk of the circuit (so the camera
 * culls what it does not see) one painted-steel geometry (rails, spine, struts, supports; vertex colours) and one wood geometry
 * (the cross ties; photo texture). Plus the train car (one merged geometry, drawn as 6 instances).
 * Everything is in TRACK-LOCAL metres; the site's transform places it in the village.
 */
import type { BufferGeometry } from "three";
import { SEAT_HALF_GAP, SEAT_TOP, type CoasterTrack } from "@caysonverse/shared/land/coaster";
import { GeoBuilder, cross, norm, type V3 } from "./geoBuilder";

export const COLORS = {
  rail: [0.74, 0.76, 0.8] as V3,
  spine: [0.2, 0.22, 0.62] as V3, // brand indigo, a little deeper
  strut: [0.93, 0.9, 0.84] as V3, // cream
  support: [0.93, 0.9, 0.84] as V3,
  foot: [0.55, 0.55, 0.57] as V3,
  carBody: [0.22, 0.24, 0.66] as V3,
  carTrim: [0.95, 0.76, 0.3] as V3, // star gold
  seat: [1.0, 0.94, 0.8] as V3,
  seatDark: [0.28, 0.26, 0.3] as V3,
  bar: [0.86, 0.86, 0.9] as V3,
  pad: [0.2, 0.2, 0.24] as V3,
} as const;

export const GAUGE = 0.62; // each rail's distance from the centre line
const RAIL_R = 0.065;
const SPINE_R = 0.17;
const SPINE_DROP = 0.5;
const TIE_EVERY = 1.25;
export const CHUNKS = 24;

export interface TrackChunk {
  steel: BufferGeometry;
  wood: BufferGeometry;
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

export function buildTrack(track: CoasterTrack): TrackBuild {
  const chunks: TrackChunk[] = [];
  const per = Math.ceil(track.n / CHUNKS);
  const step = 2; // a ring every metre
  const loopFrom = track.marks.loopFrom ?? -1;
  const loopTo = track.marks.loopTo ?? -1;
  let triangles = 0;
  for (let c = 0; c < CHUNKS; c++) {
    const from = c * per;
    const to = Math.min(track.n, from + per);
    if (from >= to) break;
    const steel = new GeoBuilder();
    const wood = new GeoBuilder();
    // rings: the last one is the next chunk's first, so the chunks meet
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
      centreL.push([p[0] - r[0] * GAUGE, p[1] - r[1] * GAUGE, p[2] - r[2] * GAUGE]);
      centreR.push([p[0] + r[0] * GAUGE, p[1] + r[1] * GAUGE, p[2] + r[2] * GAUGE]);
      centreS.push([p[0] - u[0] * SPINE_DROP, p[1] - u[1] * SPINE_DROP, p[2] - u[2] * SPINE_DROP]);
      ba.push(r);
      bb.push(u);
    }
    steel.sweep(centreL, ba, bb, RAIL_R, 6, COLORS.rail, 0.5);
    steel.sweep(centreR, ba, bb, RAIL_R, 6, COLORS.rail, 0.5);
    steel.sweep(centreS, ba, bb, SPINE_R, 8, COLORS.spine, 0.35);

    // struts: a "V" from the spine up to both rails, every 3 m; and the wooden ties across the rails every TIE_EVERY m
    for (let i = from; i < to; i += 6) {
      const p = at(track, i);
      const u = upAt(track, i);
      const r = cross(tanAt(track, i), u);
      const spine: V3 = [p[0] - u[0] * SPINE_DROP, p[1] - u[1] * SPINE_DROP, p[2] - u[2] * SPINE_DROP];
      for (const sgn of [-1, 1]) {
        const rail: V3 = [p[0] + r[0] * GAUGE * sgn, p[1] + r[1] * GAUGE * sgn, p[2] + r[2] * GAUGE * sgn];
        steel.cylinder(spine, rail, 0.05, 0.05, 4, COLORS.strut);
      }
    }
    const tieEvery = Math.max(1, Math.round(TIE_EVERY / track.ds));
    for (let i = from; i < to; i += tieEvery) {
      const p = at(track, i);
      const u = upAt(track, i);
      const r = cross(tanAt(track, i), u);
      const cen: V3 = [p[0] - u[0] * 0.07, p[1] - u[1] * 0.07, p[2] - u[2] * 0.07];
      wood.box(cen, r, u, GAUGE + 0.16, 0.035, 0.075, [1, 1, 1], 0.6);
    }

    // supports: A-frames every 6 m, from the spine to the ground; the loop only at its two vertical runs
    for (let i = from; i < to; i += 12) {
      const p = at(track, i);
      const u = upAt(track, i);
      const spine: V3 = [p[0] - u[0] * SPINE_DROP, p[1] - u[1] * SPINE_DROP, p[2] - u[2] * SPINE_DROP];
      if (spine[1] < 2.6) continue;
      if (i > loopFrom && i < loopTo) {
        const rel = (i - loopFrom) / (loopTo - loopFrom);
        if (!(Math.abs(rel - 0.25) < 0.04 || Math.abs(rel - 0.75) < 0.04)) continue;
      }
      const lat = lateral(track, i);
      const h = spine[1];
      const spread = 1.1 + h * 0.07;
      const g1: V3 = [spine[0] + lat[0] * spread, 0.06, spine[2] + lat[2] * spread];
      const g2: V3 = [spine[0] - lat[0] * spread, 0.06, spine[2] - lat[2] * spread];
      const top1: V3 = [spine[0] + lat[0] * 0.35, spine[1] - 0.1, spine[2] + lat[2] * 0.35];
      const top2: V3 = [spine[0] - lat[0] * 0.35, spine[1] - 0.1, spine[2] - lat[2] * 0.35];
      const rTop = 0.13;
      const rBot = 0.13 + Math.min(0.1, h * 0.004);
      steel.cylinder(top1, g1, rTop, rBot, 6, COLORS.support);
      steel.cylinder(top2, g2, rTop, rBot, 6, COLORS.support);
      // cross braces every ~7 m of height between the legs, and a diagonal in the panel below
      const panels = Math.floor(h / 7);
      for (let k = 1; k <= panels; k++) {
        const f = (k * 7) / h;
        const a = lerp3(g1, top1, f);
        const b = lerp3(g2, top2, f);
        steel.cylinder(a, b, 0.045, 0.045, 4, COLORS.strut);
        const a2 = lerp3(g1, top1, ((k - 1) * 7) / h);
        steel.cylinder(a2, b, 0.04, 0.04, 4, COLORS.strut);
      }
      // footings: two concrete blocks
      for (const g of [g1, g2]) steel.box([g[0], 0.15, g[2]], [1, 0, 0], [0, 1, 0], 0.4, 0.15, 0.4, COLORS.foot);
    }
    triangles += steel.triangles + wood.triangles;
    chunks.push({ steel: steel.build(), wood: wood.build(), from, to });
  }
  return { chunks, triangles };
}

/**
 * One car, in car space (x right, y up, z forward; the origin on the centre line at track height), ~2.9 m long. Two seats side by side;
 * the lap bar is in front of the rider's knees, in view of the first-person camera.
 */
export function buildCar(): BufferGeometry {
  const b = new GeoBuilder();
  const X: V3 = [1, 0, 0];
  const Y: V3 = [0, 1, 0];
  // chassis: a floor tub with raised sides
  b.box([0, 0.18, 0], X, Y, 0.98, 0.08, 1.35, COLORS.carBody);
  b.box([-0.96, 0.4, -0.05], X, Y, 0.06, 0.22, 1.2, COLORS.carBody);
  b.box([0.96, 0.4, -0.05], X, Y, 0.06, 0.22, 1.2, COLORS.carBody);
  b.box([-0.985, 0.62, -0.05], X, Y, 0.045, 0.03, 1.2, COLORS.carTrim);
  b.box([0.985, 0.62, -0.05], X, Y, 0.045, 0.03, 1.2, COLORS.carTrim);
  // nose: a front panel and a rounded-off hood whose top edge is in the lower part of the first-person view
  b.box([0, 0.42, 1.28], X, Y, 0.9, 0.24, 0.1, COLORS.carBody);
  b.box([0, 0.34, 1.42], X, Y, 0.8, 0.16, 0.06, COLORS.carTrim);
  b.box([0, 0.78, 1.08], X, Y, 0.88, 0.2, 0.2, COLORS.carBody);
  b.box([0, 0.985, 1.02], X, Y, 0.88, 0.012, 0.22, COLORS.carBody);
  b.box([0, 0.99, 1.0], X, Y, 0.06, 0.012, 0.2, COLORS.carTrim); // a gold stripe down the middle of the hood
  b.box([-0.5, 0.99, 1.0], X, Y, 0.02, 0.012, 0.2, COLORS.carTrim);
  b.box([0.5, 0.99, 1.0], X, Y, 0.02, 0.012, 0.2, COLORS.carTrim);
  // the grab bar across the hood: two posts and a chrome tube, the first thing in the lower edge of the rider's view
  b.cylinder([-0.8, 0.95, 0.9], [-0.8, 1.16, 0.9], 0.03, 0.03, 6, COLORS.bar);
  b.cylinder([0.8, 0.95, 0.9], [0.8, 1.16, 0.9], 0.03, 0.03, 6, COLORS.bar);
  b.cylinder([-0.8, 1.16, 0.9], [0.8, 1.16, 0.9], 0.035, 0.035, 8, COLORS.bar);
  b.box([0, 0.5, -1.3], X, Y, 0.95, 0.34, 0.07, COLORS.carBody);
  // seats: cushion + back per rider, a headrest, and the lap bar
  for (const side of [-1, 1]) {
    const x = side * SEAT_HALF_GAP;
    b.box([x, SEAT_TOP - 0.06, -0.2], X, Y, 0.36, 0.06, 0.42, COLORS.seat); // cushion; its top is at SEAT_TOP
    b.box([x, SEAT_TOP + 0.38, -0.66], X, Y, 0.36, 0.42, 0.06, COLORS.seat); // back
    b.box([x, SEAT_TOP + 0.9, -0.66], X, Y, 0.2, 0.1, 0.07, COLORS.seatDark); // headrest
    // the lap bar: two posts from the floor and a padded bar across the thighs
    const y0 = SEAT_TOP + 0.2;
    const z0 = 0.28;
    b.cylinder([x - 0.3, 0.26, z0 + 0.04], [x - 0.3, y0 + 0.02, z0 - 0.02], 0.035, 0.035, 6, COLORS.bar);
    b.cylinder([x + 0.3, 0.26, z0 + 0.04], [x + 0.3, y0 + 0.02, z0 - 0.02], 0.035, 0.035, 6, COLORS.bar);
    b.cylinder([x - 0.31, y0 + 0.02, z0 - 0.02], [x + 0.31, y0 + 0.02, z0 - 0.02], 0.06, 0.06, 8, COLORS.pad, true);
  }
  // the bogies: 4 wheels per side (running on the rails at +-GAUGE)
  for (const sx of [-1, 1]) {
    for (const z of [-0.95, -0.55, 0.55, 0.95]) {
      b.cylinder([sx * GAUGE - 0.05, -0.02, z], [sx * GAUGE + 0.05, -0.02, z], 0.13, 0.13, 10, COLORS.pad, true);
    }
    b.box([sx * GAUGE, 0.07, 0], X, Y, 0.06, 0.07, 1.1, COLORS.carBody);
  }
  // coupler to the next car
  b.box([0, 0.1, 1.5], X, Y, 0.06, 0.05, 0.14, COLORS.pad);
  return b.build();
}
