/**
 * Where the 별똥별 급행's supports stand: pure maths over the shared track (coaster.ts), so the park scene draws them and the tests check
 * them from the same list.
 *
 *  - a COLUMN (upright track, the rail's up within ~78 degrees of vertical): on a PC a box-truss lattice tower of four tapered corner tubes,
 *    on a phone a braced pair, from the spine down to concrete footings; its feet spread with its height (a 66 m lift tower stands on a
 *    ~13 m base);
 *  - a C-ARM (the track upside down: the loop's top, the roll's): a single tapered mast beside the track, up past the spine, and an arm
 *    across to it;
 *  - none on a knife edge, none under ~2.6 m (the track rides on its ties there), and none whose legs would pass through the train's
 *    envelope anywhere else on the circuit (a hill over a hill, the helix's laps, the brake run under the helix), the tunnel's walls, the
 *    station platform or the park's walkable lawn (z < -2.2).
 */
import { STATION_Y, type CoasterTrack } from "./coaster";

export type V3 = [number, number, number];

export type SupportDetail = "full" | "light";

export interface CoasterSupport {
  i: number;
  kind: "column" | "arm";
  /** the saddle under the spine */
  spine: V3;
  /** horizontal across the track (the rider's right, flattened) and along it */
  lat: V3;
  along: V3;
  /** each leg: its top and its foot (the foot on the ground, y = FOOT_Y) */
  legs: { top: V3; foot: V3 }[];
  /** C-arm only: the mast's top, where the arm leaves it for the spine */
  armFrom?: V3;
}

export const FOOT_Y = 0.34;
/** The train's envelope round the rail (m): how close a leg may pass (centre line to leg axis), and above / below the rail. */
export const ENVELOPE = { side: 2.2, above: 2.0, below: 1.0, belowInverted: 2.8 } as const;
/** The tunnel's half width (m): no leg inside it. */
export const TUNNEL_HALF = 3.8;
/** The park's lawn begins at z -2.2 (parkArea PARK_BOUNDS.maxZ): feet stay south of this. */
export const FEET_MIN_Z = -1.5;
/** The station platform's footprint (track-local), with a margin. */
const PLATFORM = { minX: -16, maxX: 19, minZ: -8.5, maxZ: 3 } as const;

const SPINE_DROP = 0.5;

const at = (t: CoasterTrack, i: number): V3 => {
  const k = ((i % t.n) + t.n) % t.n;
  return [t.pos[3 * k]!, t.pos[3 * k + 1]!, t.pos[3 * k + 2]!];
};
const upAt = (t: CoasterTrack, i: number): V3 => {
  const k = ((i % t.n) + t.n) % t.n;
  return [t.up[3 * k]!, t.up[3 * k + 1]!, t.up[3 * k + 2]!];
};
const tanAt = (t: CoasterTrack, i: number): V3 => {
  const k = ((i % t.n) + t.n) % t.n;
  return [t.tan[3 * k]!, t.tan[3 * k + 1]!, t.tan[3 * k + 2]!];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The horizontal direction across the track at sample `i`. */
export function lateralAt(t: CoasterTrack, i: number): V3 {
  const r = cross(tanAt(t, i), upAt(t, i));
  const h = Math.hypot(r[0], r[2]);
  if (h > 0.2) return [r[0] / h, 0, r[2] / h];
  const tt = tanAt(t, i);
  const k = Math.hypot(tt[0], tt[2]) || 1;
  return [tt[2] / k, 0, -tt[0] / k];
}
function alongAt(t: CoasterTrack, i: number): V3 {
  const tt = tanAt(t, i);
  const h = Math.hypot(tt[0], tt[2]);
  if (h > 0.2) return [tt[0] / h, 0, tt[2] / h];
  const l = lateralAt(t, i);
  return [-l[2], 0, l[0]];
}

/** How a column's feet spread with its height h (m): across the track and along it. */
export function columnSpread(h: number): { across: number; along: number } {
  return { across: 1.1 + h * 0.08, along: 0.4 + h * 0.03 };
}

function columnLegs(spine: V3, lat: V3, along: V3, detail: SupportDetail): { top: V3; foot: V3 }[] {
  const h = spine[1];
  const sp = columnSpread(h);
  const corners: [number, number][] = detail === "full" ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0]];
  return corners.map(([l, a]) => ({
    top: [spine[0] + lat[0] * l * 0.34 + along[0] * a * 0.4, spine[1] - 0.14, spine[2] + lat[2] * l * 0.34 + along[2] * a * 0.4] as V3,
    foot: [spine[0] + lat[0] * l * sp.across + along[0] * a * sp.along, FOOT_Y, spine[2] + lat[2] * l * sp.across + along[2] * a * sp.along] as V3,
  }));
}

/** Whether a leg (a straight tube from `foot` up to `top`) keeps clear of the train everywhere but near sample `self`. */
function legClear(t: CoasterTrack, self: number, top: V3, foot: V3, tunnel: [number, number] | null): boolean {
  if (foot[2] < FEET_MIN_Z) return false;
  if (foot[0] > PLATFORM.minX && foot[0] < PLATFORM.maxX && foot[2] > PLATFORM.minZ && foot[2] < PLATFORM.maxZ) return false;
  const near = Math.ceil(7 / t.ds);
  const y0 = Math.min(foot[1], top[1]);
  const y1 = Math.max(foot[1], top[1]);
  for (let j = 0; j < t.n; j += 2) {
    let d = Math.abs(j - self);
    d = Math.min(d, t.n - d);
    if (d < near) continue;
    const py = t.pos[3 * j + 1]!;
    const inverted = t.up[3 * j + 1]! < 0.3;
    const lo = py - (inverted ? ENVELOPE.belowInverted : ENVELOPE.below);
    const hi = py + ENVELOPE.above;
    const inTunnel = tunnel !== null && j >= tunnel[0] && j <= tunnel[1];
    // the tunnel's shed reaches the ground and 5 m up
    if (!inTunnel && (hi < y0 || lo > y1)) continue;
    if (inTunnel && y0 > py + 5) continue;
    // the leg's axis at the track's height (clamped to the leg)
    const yy = Math.min(y1, Math.max(y0, py));
    const f = top[1] === foot[1] ? 0 : (yy - foot[1]) / (top[1] - foot[1]);
    const lx = foot[0] + (top[0] - foot[0]) * f;
    const lz = foot[2] + (top[2] - foot[2]) * f;
    const dist = Math.hypot(t.pos[3 * j]! - lx, t.pos[3 * j + 2]! - lz);
    if (dist < (inTunnel ? TUNNEL_HALF + 0.6 : ENVELOPE.side)) return false;
  }
  return true;
}

const cache = new Map<string, CoasterSupport[]>();

/** The supports, every 10 m along the circuit on a PC (14 m on a phone), each one checked clear. */
export function coasterSupports(t: CoasterTrack, detail: SupportDetail = "full"): CoasterSupport[] {
  const key = `${detail}:${t.n}:${t.length}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const every = detail === "full" ? 20 : 28; // samples (10 m / 14 m)
  const tunnel: [number, number] | null = t.marks.tunnelFrom !== undefined && t.marks.tunnelTo !== undefined ? [t.marks.tunnelFrom, t.marks.tunnelTo] : null;
  const out: CoasterSupport[] = [];
  for (let i = 0; i < t.n; i += every) {
    // the station platform carries its own stretch
    const p = at(t, i);
    if (p[0] > PLATFORM.minX - 4 && p[0] < PLATFORM.maxX + 4 && Math.abs(p[2]) < 4 && p[1] < STATION_Y + 1) continue;
    const u = upAt(t, i);
    const spine: V3 = [p[0] - u[0] * SPINE_DROP, p[1] - u[1] * SPINE_DROP, p[2] - u[2] * SPINE_DROP];
    if (spine[1] < 2.6) continue;
    const lat = lateralAt(t, i);
    const along = alongAt(t, i);
    if (u[1] >= 0.2) {
      const legs = columnLegs(spine, lat, along, detail);
      if (legs.every((l) => legClear(t, i, l.top, l.foot, tunnel))) {
        out.push({ i, kind: "column", spine, lat, along, legs });
        continue;
      }
    }
    // a mast beside the track and an arm across: upside down on whichever side is clear; on a knife edge or a bank whose column would
    // stand in another stretch's way (the helix's top lap over its bottom one), on the side the train leans away from
    const lean = u[0] * lat[0] + u[2] * lat[2];
    const sides = u[1] < -0.3 ? (lean > 0 ? [-1, 1] : [1, -1]) : [lean > 0 ? -1 : 1];
    for (const side of sides) {
      const off = 3.4;
      const mastTop: V3 = [spine[0] + lat[0] * side * off, spine[1] + 0.25, spine[2] + lat[2] * side * off];
      const splay = Math.min(2.5, mastTop[1] * 0.05);
      const foot: V3 = [mastTop[0] + lat[0] * side * splay, FOOT_Y, mastTop[2] + lat[2] * side * splay];
      if (legClear(t, i, mastTop, foot, tunnel)) {
        out.push({ i, kind: "arm", spine, lat, along, legs: [{ top: mastTop, foot }], armFrom: mastTop });
        break;
      }
    }
  }
  cache.set(key, out);
  return out;
}
