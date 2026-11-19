/**
 * The 별똥별 급행's tunnel on the brake run (shared/land/coaster.ts marks tunnelFrom .. tunnelTo): a vaulted shed the train shoots through at
 * ~80 km/h just after passing under the helix's top lap, in TRACK-LOCAL metres. Cream walls under an indigo vault, both portals framed in
 * sandstone voussoirs with a gold keystone and a star, the inside dark. One merged geometry (metre uvs for the concrete set).
 */
import type { BufferGeometry } from "three";
import type { CoasterTrack } from "@caysonverse/shared/land/coaster";
import { GeoBuilder, type V3 } from "./geoBuilder";

export const TUNNEL = {
  /** half width outside / inside, the walls' height and the vault's rise (m) */
  outer: 3.95,
  inner: 3.6,
  wallH: 3.3,
  rise: 2.1,
  /** how far past each end of the marked run the shed reaches (m) */
  overhang: 2,
} as const;

const WALL: V3 = [0.93, 0.9, 0.84];
const WALL_IN: V3 = [0.34, 0.33, 0.36];
const VAULT: V3 = [0.32, 0.34, 0.78];
const STONE: V3 = [0.86, 0.78, 0.62];
const GOLD: V3 = [0.97, 0.78, 0.3];

/** The arch's profile (lateral offset, height) for a half width `w`, `n` steps over the vault. */
function profile(w: number, rise: number, n: number): [number, number][] {
  const out: [number, number][] = [[-w, 0], [-w, TUNNEL.wallH]];
  for (let k = 1; k < n; k++) {
    const a = Math.PI - (k / n) * Math.PI;
    out.push([w * Math.cos(a), TUNNEL.wallH + rise * Math.sin(a)]);
  }
  out.push([w, TUNNEL.wallH], [w, 0]);
  return out;
}

export function buildTunnel(track: CoasterTrack): BufferGeometry | null {
  const a = track.marks.tunnelFrom;
  const b = track.marks.tunnelTo;
  if (a === undefined || b === undefined || b <= a) return null;
  const g = new GeoBuilder();
  const over = Math.round(TUNNEL.overhang / track.ds);
  const step = 3; // a ring every 1.5 m
  const idx: number[] = [];
  for (let i = a - over; i < b + over; i += step) idx.push(i);
  idx.push(b + over);
  const C: V3[] = [];
  const L: V3[] = [];
  for (const i of idx) {
    const k = ((i % track.n) + track.n) % track.n;
    const tx = track.tan[3 * k]!;
    const tz = track.tan[3 * k + 2]!;
    const h = Math.hypot(tx, tz) || 1;
    C.push([track.pos[3 * k]!, 0, track.pos[3 * k + 2]!]);
    L.push([-tz / h, 0, tx / h]);
  }
  const point = (c: V3, l: V3, d: number, y: number): V3 => [c[0] + l[0] * d, y, c[2] + l[2] * d];
  // one surface: the profile swept along the run, faces turned outward (sgn 1) or inward (-1), coloured by height
  const surface = (prof: [number, number][], sgn: number, colorOf: (y: number) => V3): void => {
    let dist = 0;
    for (let r = 0; r + 1 < C.length; r++) {
      const seg = Math.hypot(C[r + 1]![0] - C[r]![0], C[r + 1]![2] - C[r]![2]);
      for (let p = 0; p + 1 < prof.length; p++) {
        const [d0, y0] = prof[p]!;
        const [d1, y1] = prof[p + 1]!;
        // the face normal in the cross plane: perpendicular to the profile segment, pointing away from the axis (times sgn)
        const ex = d1 - d0;
        const ey = y1 - y0;
        let nd = ey;
        let ny = -ex;
        const mx = (d0 + d1) / 2;
        const my = (y0 + y1) / 2 - TUNNEL.wallH * 0.6;
        if (nd * mx + ny * my < 0) {
          nd = -nd;
          ny = -ny;
        }
        const nl = Math.hypot(nd, ny) || 1;
        nd = (nd / nl) * sgn;
        ny = (ny / nl) * sgn;
        const col = colorOf(Math.max(y0, y1));
        const v: number[] = [];
        for (const [rr, d, y] of [[r, d0, y0], [r, d1, y1], [r + 1, d1, y1], [r + 1, d0, y0]] as const) {
          const l = L[rr]!;
          const n: V3 = [l[0] * nd, ny, l[2] * nd];
          v.push(g.rawVertex(point(C[rr]!, l, d, y), n, (dist + (rr - r) * seg) / 2, (Math.abs(d) + y) / 2, col));
        }
        // wind so the front face is the normal's side
        const pa = g.pos.slice(3 * v[0]!, 3 * v[0]! + 3);
        const pb = g.pos.slice(3 * v[1]!, 3 * v[1]! + 3);
        const pc = g.pos.slice(3 * v[2]!, 3 * v[2]! + 3);
        const e1 = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
        const e2 = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
        const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
        const nn = g.nor.slice(3 * v[0]!, 3 * v[0]! + 3);
        if (cr[0]! * nn[0]! + cr[1]! * nn[1]! + cr[2]! * nn[2]! > 0) g.idx.push(v[0]!, v[1]!, v[2]!, v[0]!, v[2]!, v[3]!);
        else g.idx.push(v[0]!, v[2]!, v[1]!, v[0]!, v[3]!, v[2]!);
      }
      dist += seg;
    }
  };
  surface(profile(TUNNEL.outer, TUNNEL.rise + 0.3, 10), 1, (y) => (y > TUNNEL.wallH + 0.05 ? VAULT : WALL));
  surface(profile(TUNNEL.inner, TUNNEL.rise, 10), -1, () => WALL_IN);
  // a plinth course along both walls and the eaves' cornice
  for (let r = 0; r + 1 < C.length; r += 1) {
    const c: V3 = [(C[r]![0] + C[r + 1]![0]) / 2, 0, (C[r]![2] + C[r + 1]![2]) / 2];
    const l = L[r]!;
    const along: V3 = [l[2], 0, -l[0]];
    const seg = Math.hypot(C[r + 1]![0] - C[r]![0], C[r + 1]![2] - C[r]![2]) / 2 + 0.02;
    for (const s of [-1, 1]) {
      g.box(point(c, l, s * (TUNNEL.outer + 0.08), 0.3), l, [0, 1, 0], 0.1, 0.3, seg, STONE, 2);
      g.box(point(c, l, s * (TUNNEL.outer + 0.1), TUNNEL.wallH + 0.05), l, [0, 1, 0], 0.16, 0.09, seg, STONE, 2);
    }
    void along;
  }
  // the portals: voussoirs round the arch, a keystone and a gold star over it, pilasters down both sides
  for (const end of [0, C.length - 1]) {
    const c = C[end]!;
    const l = L[end]!;
    const nb = end === 0 ? 1 : C.length - 2;
    const fwd: V3 = [C[nb]![0] - c[0], 0, C[nb]![2] - c[2]];
    const fl = Math.hypot(fwd[0], fwd[2]) || 1;
    const f: V3 = [fwd[0] / fl, 0, fwd[2] / fl];
    const prof = profile((TUNNEL.outer + TUNNEL.inner) / 2, TUNNEL.rise + 0.15, 9);
    for (let p = 1; p + 2 < prof.length; p++) {
      const [d0, y0] = prof[p]!;
      const [d1, y1] = prof[p + 1]!;
      const mid = point(c, l, (d0 + d1) / 2, (y0 + y1) / 2);
      const ax: V3 = [l[0] * (d1 - d0), y1 - y0, l[2] * (d1 - d0)];
      const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
      const u: V3 = [ax[0] / al, ax[1] / al, ax[2] / al];
      // the voussoir's face is across the run: build it with x along the arch, y across (radial), z along the run
      const radial: V3 = [u[1] * f[2] * 0 + (-(u[1]) * l[0]), u[0] * l[0] + u[2] * l[2], -(u[1]) * l[2]];
      const rl = Math.hypot(radial[0], radial[1], radial[2]) || 1;
      g.box([mid[0] - f[0] * 0.15, mid[1], mid[2] - f[2] * 0.15], u, [radial[0] / rl, radial[1] / rl, radial[2] / rl], al / 2 + 0.03, 0.45, 0.42, p % 2 === 0 ? STONE : [0.8, 0.72, 0.56], 2);
    }
    const topY = TUNNEL.wallH + TUNNEL.rise + 0.35;
    g.box([c[0] - f[0] * 0.2, topY, c[2] - f[2] * 0.2], l, [0, 1, 0], 0.32, 0.42, 0.5, GOLD, 1);
    g.cylinder([c[0] - f[0] * 0.75, topY + 1.15, c[2] - f[2] * 0.75], [c[0] - f[0] * 0.55, topY + 1.15, c[2] - f[2] * 0.55], 0.62, 0.62, 5, GOLD, true);
    for (const s of [-1, 1]) g.box(point([c[0] - f[0] * 0.15, 0, c[2] - f[2] * 0.15], l, s * (TUNNEL.outer + 0.15), TUNNEL.wallH / 2), l, [0, 1, 0], 0.4, TUNNEL.wallH / 2, 0.45, STONE, 2);
  }
  return g.build();
}
