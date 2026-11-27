import type { BufferGeometry } from "three";
import { barkTube, type BarkStyle } from "./barkGeometry";
import { GeoBuilder, type Rgba } from "./vegGeometry";
import { mulberry32 } from "./vegRandom";

/**
 * The Korean red pine (소나무, Pinus densiflora) of a temple yard, grown in code (owner 2026-11-21: "절에 나무가 왜 이모양이야
 * ... 실제같은 느낌이 나도록 수정해": the old one was round green pom-poms on smooth orange tubes, a lollipop). Built to reference
 * photos of temple pines (Myogaksa, Yeongtapsa, Songbulam, Unmunsa; docs/designs/temple-pines):
 *  - the trunk LEANS and bends (it rises at a slant, turns back up higher), bare for its lower half, its foot flared; the bark grey and
 *    deeply fissured at the foot, orange-red and flaky above (two bark pictures blended by the vertex alpha: vegMaterial `blend`);
 *  - few, long, irregular limbs that leave the trunk near level and zig-zag out, lifting at their ends, with side branches;
 *  - the needles in flat, layered PADS at the ends of the limbs and side branches (not a ball): each pad is a flattened cloud of
 *    alpha cards (pine_needles atlas, rendered from real 3D needles in Blender, render_pine_needles.py): flat sprays over its top,
 *    upright brush-like tufts round its rim and poking up from its top, flat sprays under it; gaps between pads where the sky
 *    shows; the crown open and one-sided;
 *  - light: a pad's top bright, its rim less, its underside dark; a pad under another pad darker again (its shade), the pads deep
 *    in the crown darker than the outer ones (`aLight`, baked).
 * Three variants (a slender leaning tree with tiered pads, a broad one with a long low limb, an upright twisting one). Sizes in metres
 * of the nominal tree (`PINE_VARIANTS[k].H`): an instance scales it; it leans toward its local +x (turn the instance to aim it).
 */

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface PineVariant {
  /** Nominal height (m), crown reach (m), trunk radius at the foot (m). */
  H: number;
  R: number;
  r0: number;
  /** The trunk's slant at the foot (rad off vertical, toward +x), how much it turns back up toward the top (rad), its sideways S. */
  lean: number;
  rightUp: number;
  sway: number;
  /** Where the limbs start / end on the trunk (share of its length), how many. */
  start: number;
  end: number;
  limbs: number;
  /** How strongly the limbs keep to the lean's side (0 all round .. 1 one-sided). */
  side: number;
  /** A long low limb (the broad variant): its share of R, or 0. */
  longLimb: number;
  /** Pad size (m, radius) at the limb ends. */
  pad: number;
}

export const PINE_VARIANTS: readonly PineVariant[] = [
  // slender, leaning, a few tiers of pads up its upper half and an umbrella of pads at the top (Myogaksa)
  { H: 9, R: 2.9, r0: 0.31, lean: 0.2, rightUp: 0.24, sway: 0.35, start: 0.5, end: 0.93, limbs: 8, side: 0.6, longLimb: 0, pad: 0.85 },
  // broad: a heavier trunk leaning more, a long limb reaching out low on the lean side, a wide flat crown (Songbulam)
  { H: 8.2, R: 3.1, r0: 0.36, lean: 0.3, rightUp: 0.38, sway: 0.25, start: 0.44, end: 0.92, limbs: 8, side: 0.65, longLimb: 1.15, pad: 0.9 },
  // upright and twisting: an S-bent trunk, limbs all round, a compact crown of overlapping pads (Yeongtapsa)
  { H: 8.6, R: 2.6, r0: 0.3, lean: 0.1, rightUp: 0.12, sway: 0.7, start: 0.48, end: 0.95, limbs: 9, side: 0.35, longLimb: 0, pad: 0.8 },
];

/**
 * The bark's colours (sRGB, through barkColour: the vertex colour carries the colour, the pictures their pattern): the upper trunk's
 * orange-red and the foot's grey-brown, set by eye against the reference photos in the game's light (the pictures' own means,
 * #8D553E and #625249, came out a dark rust there: the village's bark light deepens colour).
 */
export const PINE_BARK: BarkStyle = { pattern: "plates", old: "#9A6E58", young: "#8A644F" };
export const PINE_BASE_HEX = "#7E7068";

/** The needle atlas's two cells (u0, v0 = bottom edge, u1, v1): the spray (a pad's top, seen from above) and the tuft (seen from the side). */
const SPRAY: readonly [number, number, number, number] = [0.004, 0.004, 0.496, 0.996];
const TUFT: readonly [number, number, number, number] = [0.504, 0.004, 0.996, 0.996];

export interface PineGeo {
  bark: BufferGeometry;
  needles: BufferGeometry;
  H: number;
  R: number;
  tris: number;
  pads: number;
}

interface Pad {
  c: V3;
  /** Radius along / across its branch (m), thickness (m), the branch's direction (horizontal). */
  ra: number;
  rb: number;
  t: number;
  dir: V3;
}

/** A path from `p` along `d` for `L` in `n` steps, bending by `kink` (rad, random each step, mostly level) and lifting by `lift`. */
function limbPath(rnd: () => number, p: V3, d: V3, L: number, n: number, kink: number, lift: number, droop = 0): V3[] {
  const pts: V3[] = [p];
  let dir = norm(d);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    // a pine limb goes out in straight-ish pieces with elbows between them, sagging a little, then lifting toward its tip
    const yaw = (rnd() - 0.5) * 2 * kink;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    dir = norm([dir[0] * c - dir[2] * s, dir[1] + (t > 0.55 ? lift : -droop) / n + (rnd() - 0.5) * 0.12, dir[0] * s + dir[2] * c]);
    pts.push(add(pts[i - 1]!, mul(dir, L / n)));
  }
  return pts;
}

function radii(n: number, r0: number, r1: number, k = 0.8): number[] {
  return Array.from({ length: n }, (_, i) => r1 + (r0 - r1) * Math.pow(1 - i / (n - 1), k));
}

function at(pts: V3[], rs: number[], t: number): { p: V3; d: V3; r: number } {
  const f = clamp(t, 0, 1) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const u = f - i;
  return { p: add(pts[i]!, mul(sub(pts[i + 1]!, pts[i]!), u)), d: norm(sub(pts[i + 1]!, pts[i]!)), r: lerp(rs[i]!, rs[i + 1]!, u) };
}

/** A card (4 triangles, folded down the middle) from `base` along `up`, `w` wide along `side`, `h` long. */
function card(b: GeoBuilder, base: V3, up: V3, side: V3, w: number, h: number, uv: readonly [number, number, number, number], nrm: V3, col: Rgba, light: [number, number], wind: [number, number], fold: number): void {
  const n0 = norm(cross(side, up));
  const half = mul(side, w * 0.5);
  const top = add(base, mul(up, h));
  const bump = mul(n0, w * fold);
  const [u0, v0, u1, v1] = uv;
  const um = (u0 + u1) / 2;
  const bl = b.v(sub(base, half), nrm, col, [u0, v0], wind[0], light[0]);
  const bm = b.v(add(base, bump), nrm, col, [um, v0], wind[0], light[0]);
  const br = b.v(add(base, half), nrm, col, [u1, v0], wind[0], light[0]);
  const tl = b.v(add(sub(top, half), mul(bump, 0.3)), nrm, col, [u0, v1], wind[1], light[1]);
  const tm = b.v(add(top, bump), nrm, col, [um, v1], wind[1], light[1]);
  const tr = b.v(add(add(top, half), mul(bump, 0.3)), nrm, col, [u1, v1], wind[1], light[1]);
  b.tri(bl, bm, tm);
  b.tri(bl, tm, tl);
  b.tri(bm, br, tr);
  b.tri(bm, tr, tm);
}

export interface PineOptions {
  /** The phone: fewer cards, fewer bark sides. */
  low: boolean;
  /**
   * Keep the limbs out of this direction (the tree's own frame, horizontal unit x, z) within the cone `cos` (a limb pointing that
   * way is mirrored away): a pine beside a hall keeps its crown off the roof.
   */
  avoid?: { x: number; z: number; cos: number };
}

/** One red pine of variant `k` (0..2), `seed` varies it further. */
export function pineGeo(k: number, seed: number, o: PineOptions): PineGeo {
  const V = PINE_VARIANTS[k % PINE_VARIANTS.length]!;
  const rnd = mulberry32(seed * 6151 + k * 97 + 3);
  const bb = new GeoBuilder();
  bb.surface = true;
  const pads: Pad[] = [];
  const style = PINE_BARK;
  /** A horizontal direction (x, z) mirrored out of the avoided cone. */
  const steer = (x: number, z: number): [number, number] => {
    const a = o.avoid;
    if (!a) return [x, z];
    const l = Math.hypot(x, z) || 1;
    const d = (x * a.x + z * a.z) / l;
    if (d <= a.cos) return [x, z];
    // reflect across the plane facing the avoided direction, then a little further round
    const k = 2 * (x * a.x + z * a.z);
    return [x - k * a.x, z - k * a.z];
  };
  // ── the trunk: it leaves the ground at a slant toward +x, bends back up as it rises, swings a little sideways (z) ──
  const nT = o.low ? 12 : 18;
  const trunkLen = V.H * 0.9;
  const trunk: V3[] = [[0, 0, 0]];
  const swayPh = rnd() * 6.28;
  for (let i = 1; i <= nT; i++) {
    const t = i / nT;
    const tilt = V.lean - V.rightUp * smooth(0.25, 0.95, t) + 0.05 * Math.sin(t * 9 + swayPh);
    const sideA = V.sway * 0.22 * Math.sin(t * 5.2 + swayPh) * t;
    const d = norm([Math.sin(tilt), Math.cos(tilt), sideA]);
    trunk.push(add(trunk[i - 1]!, mul(d, trunkLen / nT)));
  }
  const trunkR = trunk.map((_, i) => {
    const t = i / nT;
    return lerp(V.r0, 0.05, Math.pow(t, 0.8)) * (1 + 0.12 * Math.exp(-t * 18));
  });
  const sideOf = (r: number) => (r > 0.15 ? (o.low ? 10 : 16) : r > 0.07 ? (o.low ? 7 : 10) : r > 0.03 ? (o.low ? 5 : 7) : 4);
  const light = (p: V3, n: V3) => {
    // the bark: the foot in the ground's shade, the wood under the crown darker, the sunny side a little brighter
    const foot = 0.68 + 0.32 * smooth(0, 1.1, p[1]);
    const under = 1 - 0.28 * smooth(V.H * 0.4, V.H * 0.65, p[1]);
    return foot * under * (0.86 + 0.14 * Math.max(0, n[0] * 0.4 + n[1] * 0.6 + n[2] * 0.3));
  };
  barkTube(bb, trunk, trunkR, sideOf(V.r0), style, light, { irregular: { k: 0.08, seed: seed + 5 }, flare: { k: 0.42, top: 0.9, seed: seed * 1.7, groundY: 0 }, wraps: Math.max(1, Math.round(V.r0 / 0.15)) });
  const top = trunk[nT]!;
  // ── the limbs ──
  const limbSpec: Array<{ t: number; az: number; L: number; long: boolean }> = [];
  const nL = V.limbs;
  for (let i = 0; i < nL; i++) {
    const u = (i + 0.2 + rnd() * 0.6) / nL;
    // the limbs keep mostly to the lean's side (+x), the rest spread round
    let az = i * 2.39996 + rnd() * 0.6;
    const toward = Math.atan2(Math.sin(az), Math.cos(az));
    az = toward * (1 - V.side * 0.6);
    const L = V.R * lerp(1.0, 0.45, Math.pow(u, 1.1)) * (0.8 + rnd() * 0.35);
    limbSpec.push({ t: lerp(V.start, V.end, u), az, L, long: false });
  }
  if (V.longLimb > 0) limbSpec.push({ t: V.start - 0.04, az: 0.35, L: V.R * V.longLimb, long: true });
  for (const ls of limbSpec) {
    const a = at(trunk, trunkR, ls.t);
    const [hx, hz] = steer(Math.cos(ls.az), Math.sin(ls.az));
    const d: V3 = [hx, lerp(0.25, 0.55, ls.t) + (rnd() - 0.5) * 0.2, hz];
    const segs = ls.long ? 7 : 5;
    const pts = limbPath(rnd, a.p, d, ls.L, segs, 0.32, ls.long ? 0.55 : 0.4, ls.long ? 0.35 : 0.15);
    const r0 = Math.max(0.035, a.r * (ls.long ? 0.62 : 0.5));
    const rs = radii(pts.length, r0, 0.022, 0.75);
    barkTube(bb, pts, rs, sideOf(r0), style, light, { wraps: 1 });
    const tip = pts[pts.length - 1]!;
    const dirH = norm([tip[0] - a.p[0], 0, tip[2] - a.p[2]]);
    const padK = V.pad * (0.75 + 0.35 * clamp(ls.L / V.R, 0, 1.2));
    pads.push({ c: add(tip, [0, 0.1, 0]), ra: padK * 1.15, rb: padK * 0.9, t: 0.42 * padK + 0.12, dir: dirH });
    // side branches off the outer half, level, each ending in a smaller pad; a long limb carries pads along it too
    const nS = ls.long ? 4 : ls.L > V.R * 0.6 ? 2 : 1;
    for (let s = 0; s < nS; s++) {
      const tt = lerp(0.42, 0.82, (s + 0.3 + rnd() * 0.4) / nS);
      const sa = at(pts, rs, tt);
      const sgn = s % 2 ? 1 : -1;
      const perp = norm(cross(sa.d, [0, 1, 0]));
      let sd = norm(add(add(mul(sa.d, 0.55), mul(perp, sgn * (0.8 + rnd() * 0.4))), [0, 0.1 + rnd() * 0.15, 0]));
      const [sx, sz] = steer(sd[0], sd[2]);
      sd = norm([sx, sd[1], sz]);
      const sL = ls.L * (0.3 + rnd() * 0.22);
      const sp = limbPath(rnd, sa.p, sd, sL, 3, 0.3, 0.3);
      const sr = radii(sp.length, Math.max(0.018, sa.r * 0.55), 0.012, 0.8);
      barkTube(bb, sp, sr, sideOf(sr[0]!), style, light, { wraps: 1 });
      const st = sp[sp.length - 1]!;
      const pk = V.pad * (0.6 + 0.25 * rnd());
      pads.push({ c: add(st, [0, 0.08, 0]), ra: pk * 1.1, rb: pk * 0.85, t: 0.38 * pk + 0.1, dir: norm([sd[0], 0, sd[2]]) });
    }
  }
  // the top: the leader's end splits into 3-4 short limbs, an umbrella of pads (the oldest pines' flat top)
  const nTop = 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < nTop; i++) {
    const az0 = (i / nTop) * Math.PI * 2 + rnd() * 0.8;
    const [tx, tz] = steer(Math.cos(az0), Math.sin(az0));
    const az = Math.atan2(tz, tx);
    const L = V.R * (0.32 + rnd() * 0.18);
    const pts = limbPath(rnd, top, [Math.cos(az), 0.55, Math.sin(az)], L, 3, 0.3, 0.2);
    const rs = radii(pts.length, 0.045, 0.016, 0.8);
    barkTube(bb, pts, rs, sideOf(0.045), style, light, { wraps: 1 });
    const pk = V.pad * (0.85 + rnd() * 0.25);
    pads.push({ c: add(pts[pts.length - 1]!, [0, 0.12, 0]), ra: pk * 1.1, rb: pk, t: 0.45 * pk + 0.12, dir: norm([Math.cos(az), 0, Math.sin(az)]) });
  }
  pads.push({ c: add(top, [0, 0.25, 0]), ra: V.pad * 1.0, rb: V.pad * 0.9, t: 0.5 * V.pad + 0.12, dir: [1, 0, 0] });

  // ── the bark's two pictures: the foot's (vertex alpha 1) up to ~2.4 m, the orange flaky bark above (0) ──
  const barkG = bb.build();
  {
    const pos = barkG.getAttribute("position");
    const col = barkG.getAttribute("color");
    const hex = parseInt(PINE_BASE_HEX.slice(1), 16);
    const base = [hex >> 16, (hex >> 8) & 255, hex & 255].map((c) => Math.pow(c / 255, 2.2) / 0.5);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const w = 1 - smooth(1.2, 3.0, y + 0.35 * Math.sin(pos.getX(i) * 7 + pos.getZ(i) * 5));
      col.setXYZW(i, lerp(col.getX(i), base[0]!, w), lerp(col.getY(i), base[1]!, w), lerp(col.getZ(i), base[2]!, w), w);
    }
  }

  // ── the pads: how much each is shaded by the pads above it and by the crown round it ──
  const lb = new GeoBuilder();
  const crownC: V3 = [top[0] * 0.6, V.H * 0.7, top[2] * 0.6];
  const keep = o.low ? 0.55 : 1;
  // each pad is a few overlapping clumps (a real pad is lumpy: tufts bunched round each shoot, not one smooth dome)
  const clumps: Pad[] = [];
  for (const p of pads) {
    const n = o.low ? (p.ra > 0.95 ? 2 : 1) : p.ra > 0.95 ? 3 : 2;
    const dB = norm(cross([0, 1, 0], p.dir));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 1.2;
      const off = n === 1 ? 0 : 0.42 + rnd() * 0.15;
      const c = add(p.c, add(add(mul(p.dir, Math.cos(a) * off * p.ra), mul(dB, Math.sin(a) * off * p.rb)), [0, (rnd() - 0.4) * p.t * 0.6, 0]));
      const k = 0.56 + rnd() * 0.12;
      clumps.push({ c, ra: p.ra * k, rb: p.rb * k, t: p.t * (0.8 + rnd() * 0.25), dir: norm(add(p.dir, mul(dB, (rnd() - 0.5) * 0.8))) });
    }
  }
  for (const p of clumps) {
    let above = 0;
    for (const q of clumps) {
      if (q === p || q.c[1] <= p.c[1] + 0.2) continue;
      const dxz = Math.hypot(q.c[0] - p.c[0], q.c[2] - p.c[2]);
      above += clamp(1 - dxz / (q.ra + p.ra * 0.6), 0, 1) * clamp((q.c[1] - p.c[1]) / 1.2, 0.3, 1);
    }
    const inner = clamp(Math.hypot(p.c[0] - crownC[0], p.c[2] - crownC[2]) / V.R, 0, 1);
    const ao = (1 - 0.38 * clamp(above, 0, 1.3) / 1.3) * (0.82 + 0.18 * inner);
    const windK = 0.35 + 0.65 * inner;
    const dA = p.dir;
    const dB = norm(cross([0, 1, 0], dA));
    const onPad = (u: number, v: number, h: number): V3 => add(p.c, add(add(mul(dA, u * p.ra), mul(dB, v * p.rb)), [0, h, 0]));
    // the needles' picture is a shaded dark green; lifted toward the photos' olive (sunlit tops yellow-olive, the inside deep green)
    const tint = (k: number): Rgba => {
      const g = (0.9 + rnd() * 0.22) * k;
      const hue = (rnd() - 0.5) * 0.14;
      return [g * 1.42 * (1 + hue), g * 1.36, g * 1.05 * (1 - hue), 0];
    };
    // the top: flat sprays, their twig pointing outward from the pad's middle, tilted a little up; the dome higher in the middle
    const area = Math.PI * p.ra * p.rb;
    const nTopC = Math.max(3, Math.round((area / 0.32) * keep));
    for (let i = 0; i < nTopC; i++) {
      const a = i * 2.39996 + rnd() * 0.5;
      const rr = Math.sqrt((i + 0.5) / nTopC) * 0.85;
      const u = Math.cos(a) * rr;
      const v = Math.sin(a) * rr;
      const dome = p.t * 0.5 * (1 - rr * rr) + (rnd() - 0.5) * 0.08;
      const at0 = onPad(u * 0.6, v * 0.6, dome);
      const out = norm(add(add(mul(dA, Math.cos(a)), mul(dB, Math.sin(a))), [0, 0.3 + rnd() * 0.3, 0]));
      const side = norm(cross(out, [0, 1, 0]));
      const sz = (0.62 + rnd() * 0.3) * Math.min(1.15, 0.6 + p.ra * 0.45);
      card(lb, sub(at0, mul(out, 0.15 * sz)), out, side, sz * 0.95, sz, SPRAY, [0, 1, 0], tint(1), [ao * 1.02, ao * 1.08], [windK * 0.5, windK], 0.06);
    }
    // the rim: upright brush-like tufts round the edge, leaning outward; a few standing up from the top
    const perim = Math.PI * (p.ra + p.rb);
    const nRim = Math.max(5, Math.round((perim / 0.34) * keep));
    for (let i = 0; i < nRim; i++) {
      const a = (i / nRim) * Math.PI * 2 + rnd() * 0.3;
      const rr = 0.78 + rnd() * 0.2;
      const radial = norm(add(mul(dA, Math.cos(a)), mul(dB, Math.sin(a))));
      const base = onPad(Math.cos(a) * rr, Math.sin(a) * rr, -p.t * 0.35);
      const up = norm(add(mul(radial, 0.55 + rnd() * 0.2), [0, 0.85, 0]));
      const side = norm(cross(up, radial));
      const sz = (0.48 + rnd() * 0.22) * Math.min(1.1, 0.6 + p.ra * 0.4);
      card(lb, base, up, side, sz * 1.15, sz, TUFT, norm(add(radial, [0, 0.5, 0])), tint(0.95), [ao * 0.7, ao * 0.95], [windK * 0.6, windK], 0.08);
    }
    const nUp = Math.max(2, Math.round(area * 1.6 * keep));
    for (let i = 0; i < nUp; i++) {
      const a = rnd() * 6.28;
      const rr = Math.sqrt(rnd()) * 0.6;
      const base = onPad(Math.cos(a) * rr, Math.sin(a) * rr, p.t * 0.05);
      const up = norm([(rnd() - 0.5) * 0.5, 1, (rnd() - 0.5) * 0.5]);
      const side = norm(cross(up, [Math.cos(a * 2), 0, Math.sin(a * 2)]));
      const sz = 0.45 + rnd() * 0.2;
      card(lb, base, up, side, sz * 1.15, sz, TUFT, [0, 1, 0], tint(1), [ao * 0.8, ao * 1.05], [windK * 0.6, windK], 0.08);
    }
    // the underside: flat sprays, dark (the pad's own shade; from below the sky shows between the pads, not through them)
    const nUnder = Math.max(1, Math.round((area / 0.6) * keep));
    for (let i = 0; i < nUnder; i++) {
      const a = i * 2.39996 + rnd();
      const rr = Math.sqrt((i + 0.5) / nUnder) * 0.7;
      const at0 = onPad(Math.cos(a) * rr * 0.6, Math.sin(a) * rr * 0.6, -p.t * 0.5);
      const out = norm(add(add(mul(dA, Math.cos(a)), mul(dB, Math.sin(a))), [0, -0.12, 0]));
      const side = norm(cross(out, [0, 1, 0]));
      const sz = (0.6 + rnd() * 0.25) * Math.min(1.1, 0.6 + p.ra * 0.45);
      card(lb, sub(at0, mul(out, 0.15 * sz)), out, side, sz * 0.95, sz, SPRAY, [0, -1, 0], tint(0.85), [ao * 0.42, ao * 0.5], [windK * 0.5, windK * 0.9], 0.04);
    }
  }
  const needles = lb.build();
  let R = 0;
  for (const p of pads) R = Math.max(R, Math.hypot(p.c[0], p.c[2]) + p.ra);
  return { bark: barkG, needles, H: V.H, R, tris: bb.triangleCount + lb.triangleCount, pads: pads.length };
}

/** The needle atlas (PC 1024 x 512, phone 512 x 256) and the two bark pictures' files (client/public/models/village/veg). */
export const PINE_FILES = {
  needles: (low: boolean) => `/models/village/veg/pine_needles_${low ? 512 : 1024}.webp`,
  bark: (low: boolean) => [`/models/village/veg/pine_bark_c${low ? 512 : 1024}.jpg`, `/models/village/veg/pine_bark_n${low ? 256 : 512}.jpg`] as const,
  base: (low: boolean) => [`/models/village/veg/pine_base_c${low ? 512 : 1024}.jpg`, `/models/village/veg/pine_base_n${low ? 256 : 512}.jpg`] as const,
};
