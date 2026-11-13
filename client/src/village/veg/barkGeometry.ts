import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType, type BufferGeometry } from "three";
import { linearHex } from "./flowerPlacement";
import { mulberry32 } from "./vegRandom";
import type { Vec3 } from "./vegLod";
import type { Branch, TreeKind, TreeSkeleton } from "./treeSkeleton";
import { GeoBuilder, TWIG_SIMPLIFY_TOL, simplifyLine } from "./vegGeometry";

/**
 * Every tree's bark drawn at runtime, from the ground to the tip of its last twig (the owner, 2026-11-13: the light-mapped
 * trunk of the file, pale beige on some trees, met the runtime's dark limbs with a visible break). The trunk, the limbs
 * and the side branches of the replayed skeleton (treeSkeleton.ts) and the grown twigs (crownGrowth.ts) are one bark:
 *  - one colour rule for the whole tree: the colour follows the branch's radius (the trunk's and the limbs' bark, the
 *    thin twigs' younger bark), so where a twig leaves a limb, or a limb the trunk, both are the same colour;
 *  - one light rule: `barkLight`, darker inside the crown and at the foot, the same function for trunk, limbs and
 *    twigs (the vegetation material shades each side by the baked sun's direction on top);
 *  - one texture per kind of bark (drawn here in code, no photo): a cherry's smooth bark with its horizontal lenticels,
 *    the broadleaf trees' grey-brown plates and fissures, a willow's deep criss-cross furrows, a young tree's
 *    smooth bark, a plum's rough dark scales. u goes once round a branch, v along it (a tile is 2.2 circumferences
 *    tall), so the pattern keeps its shape on every branch;
 *  - the trunk flares out at the ground over its roots and is closed at the fork.
 * The light-mapped bark of the same trees is cut out of the village file (VillageVegetation), so nothing is drawn twice.
 */

type Rgba = [number, number, number, number];

/** Bark patterns (one texture each). */
export type BarkPattern = "cherry" | "plates" | "willow" | "smooth" | "plum";

export interface BarkStyle {
  pattern: BarkPattern;
  /** sRGB: the old bark (trunk and thick limbs, radius >= 6 cm), the young bark (twigs, radius <= 6 mm). */
  old: string;
  young: string;
}

/**
 * Bark colours, matched by eye against photos of each tree (sRGB, before light): a Yoshino cherry's grey-brown with a
 * purple cast, a zelkova's / street tree's grey-brown, a weeping willow's dark grey-brown with olive young shoots, a
 * young tree's smooth grey-brown, a plum's near-black brown-grey.
 */
export const BARK_STYLE: Readonly<Record<TreeKind, BarkStyle>> = {
  cherry: { pattern: "cherry", old: "#5E4D48", young: "#6E4B40" },
  zelkova: { pattern: "plates", old: "#6B635B", young: "#74624F" },
  green: { pattern: "plates", old: "#67605A", young: "#71604F" },
  young: { pattern: "smooth", old: "#716559", young: "#76604D" },
  willow: { pattern: "willow", old: "#5E544A", young: "#857A4E" },
  orchard: { pattern: "plum", old: "#4F4541", young: "#64493C" },
};

/** The textures' mean value (linear): the vertex colours are divided by it, so the bark's average colour is `old`. */
const TEX_MEAN = 0.78;

/** A branch's radius (m) at which its bark is old (and below which young). */
const OLD_R = 0.06;
const YOUNG_R = 0.006;

/** The bark colour (linear, divided by the texture's mean) at radius `r`. */
export function barkColour(style: BarkStyle, r: number): Rgba {
  const a = linearHex(style.old);
  const b = linearHex(style.young);
  const t = Math.max(0, Math.min(1, Math.log(OLD_R / Math.max(r, 1e-4)) / Math.log(OLD_R / YOUNG_R)));
  return [(a[0] + (b[0] - a[0]) * t) / TEX_MEAN, (a[1] + (b[1] - a[1]) * t) / TEX_MEAN, (a[2] + (b[2] - a[2]) * t) / TEX_MEAN, 0];
}

/**
 * The bark's light at `p` (normal `n`) of a tree whose crown is centred at `c` (radius `R`) and stands on `groundY`:
 * darker inside the crown (its own shade), a little darker at the foot (the grass's), a little brighter toward the sun.
 * `fork` (its point and the trunk's radius there): the crotch where the limbs part is shaded too, as a real one is (the
 * limbs close round it), so where each limb swells out of the trunk shows no bright seam. The same for trunk, limbs
 * and twigs: no step where they meet.
 */
export function barkLight(c: Vec3, R: number, groundY: number, sun: Vec3, fork?: { p: Vec3; r: number }) {
  return (p: Vec3, n: Vec3) => {
    const rho = Math.min(1, Math.hypot(p[0] - c[0], (p[1] - c[1]) * 1.4, p[2] - c[2]) / R);
    const foot = 0.82 + 0.18 * Math.min(1, Math.max(0, (p[1] - groundY) / 0.8));
    let crotch = 1;
    if (fork) {
      const d = Math.hypot(p[0] - fork.p[0], p[1] - fork.p[1], p[2] - fork.p[2]);
      const t = Math.max(0, Math.min(1, (d - fork.r * 0.8) / (fork.r * 4)));
      crotch = 0.74 + 0.26 * t * t * (3 - 2 * t);
    }
    return (0.4 + 0.45 * rho) * foot * crotch * (0.88 + 0.12 * Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]));
  };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A tile of the texture is this many circumferences tall. */
const TILE_ASPECT = 2.2;

export interface BarkTubeOptions {
  /** Radius bumps round the trunk's foot (the roots): how strong (share of the radius) up to `flareTop` m. */
  flare?: { k: number; top: number; seed: number; groundY: number };
  /** The texture's v at the first ring (a limb continues the trunk's pattern where it leaves it). */
  v0?: number;
  /** The first ring's u = 0 direction (a limb leaving the trunk takes the trunk's there: the pattern runs on). */
  tx0?: Vec3;
}

/** Each ring's texture v and u = 0 direction (a limb can take them up where it leaves). */
export interface TubeFrames {
  v: number[];
  tx: Vec3[];
}

/**
 * A branch as a textured tube: `sides` faces round (a seam ring of `sides + 1` vertices for the texture), u once round,
 * v along it by the circumference. Colour by radius (`barkColour`), light per vertex (`light`).
 */
export function barkTube(b: GeoBuilder, pts: readonly Vec3[], radii: readonly number[], sides: number, style: BarkStyle, light: (p: Vec3, n: Vec3) => number, o: BarkTubeOptions = {}): TubeFrames {
  const frames: TubeFrames = { v: [], tx: [] };
  if (pts.length < 2) return frames;
  const first = norm(sub(pts[1]!, pts[0]!));
  let tx: Vec3 = o.tx0 ?? norm(cross(first, Math.abs(first[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const rings: number[][] = [];
  let v = o.v0 ?? 0;
  for (let i = 0; i < pts.length; i++) {
    const d = norm(i === 0 ? sub(pts[1]!, pts[0]!) : i === pts.length - 1 ? sub(pts[i]!, pts[i - 1]!) : sub(pts[i + 1]!, pts[i - 1]!));
    tx = norm(sub(tx, mul(d, dot(tx, d))));
    const ty = cross(d, tx);
    frames.tx.push(tx);
    if (i > 0) {
      const l = len(sub(pts[i]!, pts[i - 1]!));
      const circ = Math.PI * (radii[i]! + radii[i - 1]!);
      v += l / Math.max(0.02, circ * TILE_ASPECT);
    }
    frames.v.push(v);
    const r = radii[i]!;
    const colour = barkColour(style, r);
    const ring: number[] = [];
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const nrm = add(mul(tx, Math.cos(a)), mul(ty, Math.sin(a)));
      let rr = r;
      if (o.flare) {
        const h = Math.max(0, pts[i]![1] - o.flare.groundY);
        const k = o.flare.k * Math.max(0, 1 - h / o.flare.top) ** 2;
        // five roots, unevenly spaced
        const bump = Math.max(0, Math.cos(5 * a + o.flare.seed) + 0.35 * Math.cos(3 * a + o.flare.seed * 1.7));
        rr = r * (1 + k * bump);
      }
      const p = add(pts[i]!, mul(nrm, rr));
      ring.push(b.v(p, nrm, colour, [s / sides, v], 0, light(p, nrm)));
    }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < rings.length; i++) {
    const r0 = rings[i]!;
    const r1 = rings[i + 1]!;
    for (let s = 0; s < sides; s++) {
      b.tri(r0[s]!, r1[s]!, r1[s + 1]!);
      b.tri(r0[s]!, r1[s + 1]!, r0[s + 1]!);
    }
  }
  return frames;
}

/** A limb's or side branch's radius (m) at its last point, after `taperBranch`: a twig's (crownGrowth's twigs end at 3.2 mm). */
export const TIP_R = 0.004;

/** The point on a polyline nearest to `p`: its arc length and radius there, and the distance. */
function nearestOn(b: Branch, p: Vec3): { s: number; r: number; d: number } {
  let best = { s: 0, r: b.radii[0]!, d: Infinity };
  let acc = 0;
  for (let i = 1; i < b.pts.length; i++) {
    const a = b.pts[i - 1]!;
    const ab = sub(b.pts[i]!, a);
    const l2 = dot(ab, ab) || 1e-12;
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
    const d = len(sub(p, add(a, mul(ab, t))));
    const l = Math.sqrt(l2);
    if (d < best.d) best = { s: acc + l * t, r: b.radii[i - 1]! + (b.radii[i]! - b.radii[i - 1]!) * t, d };
    acc += l;
  }
  return best;
}

/**
 * A branch tapering evenly along its whole length, as a real one does (review r2, 2026-11-13: the file's limbs keep
 * 16 % of their base radius to their last point, a limb cut back short of a house keeps all of it, and a short cone
 * closed them there: telescoped ends and little horns from under the crown). The radius falls in a straight line from
 * the base (`r0`, or the branch's own) to `TIP_R` (or finer) at the last point, on toward the point where it would close
 * (`pointedEnd` carries it there): no step and no sudden cone anywhere. The points stay where they are.
 */
export function taperBranch(b: Branch, r0 = b.radii[0]!): Branch {
  let L = 0;
  for (let i = 1; i < b.pts.length; i++) L += len(sub(b.pts[i]!, b.pts[i - 1]!));
  // a long thin branch ends finer, so that it closes within 30 cm past its last point at the same taper
  const rt = Math.min(TIP_R, r0 * 0.3, (0.3 * r0) / (L + 0.3));
  const close = L + (L * rt) / Math.max(1e-6, r0 - rt);
  let s = 0;
  const radii = b.pts.map((p, i) => {
    if (i) s += len(sub(p, b.pts[i - 1]!));
    return r0 * (1 - s / close);
  });
  return { pts: b.pts, radii };
}

/**
 * The skeleton with every limb and side branch tapering evenly (`taperBranch`); a side branch never thicker where it
 * leaves its limb than 0.7 of the limb there. Run before the crown is grown on it (the twigs take their radius from
 * the branch they leave) and again by the bark (it changes nothing the second time).
 */
export function taperSkeleton<T extends { limbs: Branch[]; sides: Branch[] }>(sk: T): T {
  const limbs = sk.limbs.map((l) => taperBranch(l));
  const sides = sk.sides.map((side) => {
    let at = { s: 0, r: side.radii[0]!, d: Infinity };
    for (const l of limbs) {
      const q = nearestOn(l, side.pts[0]!);
      if (q.d < at.d) at = q;
    }
    return taperBranch(side, at.d < 0.1 ? Math.min(side.radii[0]!, at.r * 0.7) : side.radii[0]!);
  });
  return { ...sk, limbs, sides };
}

/**
 * A branch's tip: it never thickens toward it, and runs on past its last point at the same taper to where it closes
 * (30 cm at most, inside the leaves at its tip), ending in a point of under a millimetre.
 */
export function pointedEnd(b: Branch): Branch {
  const n = b.pts.length;
  const last = b.pts[n - 1]!;
  const seg = len(sub(last, b.pts[n - 2]!));
  const d = norm(sub(last, b.pts[n - 2]!));
  const radii = [...b.radii];
  for (let i = 1; i < n; i++) radii[i] = Math.min(radii[i]!, radii[i - 1]!);
  const r = radii[n - 1]!;
  const slope = (radii[n - 2]! - r) / Math.max(seg, 1e-6);
  const ext = Math.max(r * 3, Math.min(0.3, slope > 1e-6 ? r / slope : 0.3));
  return { pts: [...b.pts, add(last, mul(d, ext * 0.5)), add(last, mul(d, ext))], radii: [...radii, r * 0.5, Math.min(0.0008, r * 0.2)] };
}

/** The faces round a branch of radius `r` (`low`: the phone tier). */
export function barkSides(r: number, low: boolean): number {
  if (r >= 0.09) return low ? 8 : 12;
  if (r >= 0.04) return low ? 6 : 9;
  if (r >= 0.015) return low ? 5 : 8;
  if (r >= 0.009) return low ? 3 : 4;
  return 3;
}

/**
 * A tree's trunk, limbs and side branches as one bark mesh (local to the skeleton's own coordinates): the trunk from
 * under the ground, flaring over its roots at the foot, closed above the fork; every limb and side branch tapering to
 * its tip. `light` is the tree's barkLight.
 */
export function skeletonBark(sk: TreeSkeleton, low: boolean, light: (p: Vec3, n: Vec3) => number): BufferGeometry {
  const b = new GeoBuilder();
  skeletonBarkInto(b, sk, low, light);
  return b.build();
}

/** The point `t` (0..1) of the cubic from `a` (leaving along `da`) to `b` (arriving along `db`), `k` the handles' length. */
function cubic(a: Vec3, da: Vec3, b: Vec3, db: Vec3, k: number, t: number): Vec3 {
  const c1 = add(a, mul(da, k));
  const c2 = sub(b, mul(db, k));
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return [a[0] * w0 + c1[0] * w1 + c2[0] * w2 + b[0] * w3, a[1] * w0 + c1[1] * w1 + c2[1] * w2 + b[1] * w3, a[2] * w0 + c1[2] * w1 + c2[2] * w2 + b[2] * w3];
}

/** The point and radius at arc length `s` along a branch, and the index of the first point past it. */
function alongBranch(b: Branch, s: number): { p: Vec3; r: number; next: number } {
  let acc = 0;
  for (let i = 1; i < b.pts.length; i++) {
    const a = b.pts[i - 1]!;
    const c = b.pts[i]!;
    const l = len(sub(c, a));
    if (s <= acc + l || i === b.pts.length - 1) {
      const t = Math.max(0, Math.min(1, (s - acc) / (l || 1)));
      return { p: [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t], r: b.radii[i - 1]! + (b.radii[i]! - b.radii[i - 1]!) * t, next: i };
    }
    acc += l;
  }
  return { p: b.pts[b.pts.length - 1]!, r: b.radii[b.radii.length - 1]!, next: b.pts.length };
}

/**
 * A limb as it grows out of the trunk (review r1, 2026-11-13: the trunk ended in a collar under the fork and the limbs
 * stuck out of its top like pipes, a step in shape and pattern round every willow's fork). Every limb of a tree starts
 * on one ring: the trunk's last, `part` (its centre, radius `partR`), a little below the fork. There it IS the trunk,
 * the same ring (and the same pattern: the trunk's `v` and u direction carry on), so nothing shows where the trunk
 * ends; it runs on up the trunk's line and bends out along a smooth curve onto the limb's own line, narrowing to its
 * own thickness. The limbs part from each other as a real fork does, in V-shaped crotches, with no rim anywhere.
 */
export function forkLimb(limb: Branch, part: Vec3, partR: number, dirT: Vec3): Branch {
  const p0 = limb.pts[0]!;
  const d = norm(sub(limb.pts[1]!, p0));
  const l01 = len(sub(limb.pts[1]!, p0));
  const q = alongBranch(limb, Math.min(l01 * 0.5, Math.max(0.4, partR * 3.2)));
  const handle = len(sub(q.p, part)) * 0.45;
  const pts: Vec3[] = [];
  const radii: number[] = [];
  const N = 6;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    pts.push(cubic(part, dirT, q.p, d, handle, t));
    radii.push(partR + (q.r - partR) * t * t * (3 - 2 * t));
  }
  pts.push(q.p);
  radii.push(q.r);
  for (let i = q.next; i < limb.pts.length; i++) {
    pts.push(limb.pts[i]!);
    radii.push(limb.radii[i]!);
  }
  return { pts, radii };
}

/**
 * A branch with its corners rounded (review r2, 2026-11-13: the file's limbs bend 10-30 degrees at their middle points,
 * and seen from below a limb turning there away from the eye ended in a flat lip, its open ring, with the rest of it a
 * thin spike behind): every corner sharper than 6 degrees is replaced by a short curve (a quadratic from `f` before it
 * to `f` after it, `f` at most 30 cm and 40 % of either side), the radius following the arc length as before. The curve
 * passes within a few centimetres of the corner: the twigs and side branches grown off it stay inside the bark.
 */
export function roundCorners(b: Branch, f = 0.3): Branch {
  const n = b.pts.length;
  if (n < 3) return b;
  const pts: Vec3[] = [b.pts[0]!];
  const radii: number[] = [b.radii[0]!];
  for (let i = 1; i < n - 1; i++) {
    const p = b.pts[i]!;
    const a = sub(p, b.pts[i - 1]!);
    const c = sub(b.pts[i + 1]!, p);
    const la = len(a);
    const lc = len(c);
    const da = mul(a, 1 / (la || 1));
    const dc = mul(c, 1 / (lc || 1));
    const turn = (Math.acos(Math.max(-1, Math.min(1, dot(da, dc)))) * 180) / Math.PI;
    if (turn < 6 || la < 1e-4 || lc < 1e-4) {
      pts.push(p);
      radii.push(b.radii[i]!);
      continue;
    }
    const g = Math.min(f, la * 0.4, lc * 0.4);
    const A = sub(p, mul(da, g));
    const B = add(p, mul(dc, g));
    const rA = b.radii[i]! + (b.radii[i - 1]! - b.radii[i]!) * (g / la);
    const rB = b.radii[i]! + (b.radii[i + 1]! - b.radii[i]!) * (g / lc);
    // a ring every 12 degrees of the turn (2 to 3 short pieces for the file's 10-30 degree bends)
    const K = Math.max(2, Math.min(3, Math.ceil(turn / 12)));
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      const u = 1 - t;
      pts.push([A[0] * u * u + 2 * p[0] * u * t + B[0] * t * t, A[1] * u * u + 2 * p[1] * u * t + B[1] * t * t, A[2] * u * u + 2 * p[2] * u * t + B[2] * t * t]);
      radii.push(rA + (rB - rA) * t);
    }
  }
  pts.push(b.pts[n - 1]!);
  radii.push(b.radii[n - 1]!);
  return { pts, radii };
}

/** The bark's shapes of a tree as drawn (`skeletonBarkInto`): the trunk (to where the limbs part), its limbs, its sides. */
export interface DrawnBark {
  trunk: Branch;
  limbs: Branch[];
  sides: Branch[];
}

/** A tree's trunk, limbs and side branches as the bark draws them (tapered, the limbs out of the trunk, pointed). */
export function drawnBark(skIn: TreeSkeleton): DrawnBark {
  const sk = taperSkeleton(skIn);
  const trunk = sk.trunk;
  const r0 = trunk.radii[1]!;
  const ground = sk.base;
  const dirT = norm(sub(trunk.pts[3]!, trunk.pts[0]!));
  // the foot: from under the ground up past the flare, then the file's trunk up to where the limbs part (a little
  // below the fork): there the limbs take over, from the trunk's own last ring
  const top = trunk.pts[3]!;
  const forkR = trunk.radii[3]!;
  const below = 0.1 + forkR * 0.8;
  const segL = len(sub(top, trunk.pts[2]!));
  const f = Math.max(0, 1 - below / Math.max(segL, 1e-3));
  const part: Vec3 = [trunk.pts[2]![0] + (top[0] - trunk.pts[2]![0]) * f, trunk.pts[2]![1] + (top[1] - trunk.pts[2]![1]) * f, trunk.pts[2]![2] + (top[2] - trunk.pts[2]![2]) * f];
  const partR = trunk.radii[2]! + (forkR - trunk.radii[2]!) * f;
  return {
    trunk: {
      pts: [trunk.pts[0]!, [ground[0], ground[1], ground[2]], add(ground, mul(dirT, 0.12)), add(ground, mul(dirT, 0.3)), trunk.pts[1]!, trunk.pts[2]!, part],
      radii: [r0 * 1.5, r0 * 1.45, r0 * 1.25, r0 * 1.1, trunk.radii[1]!, trunk.radii[2]!, partR],
    },
    limbs: sk.limbs.map((limb) => {
      // the bends of the limb past the fork's curve (that curve is smooth already: 7 points)
      const f = forkLimb(limb, part, partR, dirT);
      const rest = roundCorners({ pts: f.pts.slice(6), radii: f.radii.slice(6) });
      return pointedEnd({ pts: [...f.pts.slice(0, 6), ...rest.pts], radii: [...f.radii.slice(0, 6), ...rest.radii] });
    }),
    sides: sk.sides.map((side) => pointedEnd(roundCorners(side))),
  };
}

/** `skeletonBark` added to a builder (several trees in one mesh). */
export function skeletonBarkInto(b: GeoBuilder, sk: TreeSkeleton, low: boolean, light: (p: Vec3, n: Vec3) => number): void {
  const style = BARK_STYLE[sk.kind];
  const d = drawnBark(sk);
  const r0 = sk.trunk.radii[1]!;
  const sides = barkSides(r0, low);
  const frames = barkTube(b, d.trunk.pts, d.trunk.radii, sides, style, light, { flare: { k: 0.35, top: 0.45, seed: sk.index * 1.37, groundY: sk.base[1] } });
  const v0 = frames.v[frames.v.length - 1] ?? 0;
  const tx0 = frames.tx[frames.tx.length - 1];
  // the limbs with the trunk's faces round (their first ring is the trunk's last)
  for (const tip of d.limbs) barkTube(b, tip.pts, tip.radii, sides, style, light, { v0, tx0 });
  for (const tip of d.sides) barkTube(b, tip.pts, tip.radii, barkSides(tip.radii[0]!, low), style, light, { v0: 0.71 });
}

/** A phone's twig: fewer rings, its shape kept within 1 cm (the clusters placed on the full line stay on it). */
export function simplifyTwig(b: Branch): Branch {
  if (b.pts.length <= 3) return b;
  const keep = simplifyLine(b.pts, TWIG_SIMPLIFY_TOL);
  return { pts: keep.map((i) => b.pts[i]!), radii: keep.map((i) => b.radii[i]!) };
}

/**
 * The grown twigs as one bark mesh, in the tree's bark (style, light): its limbs' colour where they leave them. `near`:
 * twigs a player can have within arm's reach (the memorial's young trees, 2.6-2.9 m tall: review r1, 2026-11-13, their
 * twigs 30 cm from the eye read as sawn-off sticks): rounder (5 faces where thicker than 6 mm) and closed in a short
 * point at the tip.
 */
export function twigBark(twigs: readonly Branch[], style: BarkStyle, low: boolean, light: (p: Vec3, n: Vec3) => number, simplify?: (b: Branch) => Branch, minR = 0, near = false): BufferGeometry {
  const b = new GeoBuilder();
  for (const t of twigs) {
    let branch = simplify ? simplify(t) : t;
    // a floor on the radius: a thinner tube breaks into dots on screen (pixels catch it only here and there)
    if (minR > 0) branch = { pts: branch.pts, radii: branch.radii.map((r) => Math.max(r, minR)) };
    let sides = !low && branch.radii[0]! > 0.012 ? 4 : 3;
    if (near) {
      sides = branch.radii[0]! > 0.006 ? 5 : 4;
      const n = branch.pts.length;
      const last = branch.pts[n - 1]!;
      const d = norm(sub(last, branch.pts[n - 2]!));
      const r = branch.radii[n - 1]!;
      branch = { pts: [...branch.pts, add(last, mul(d, r * 5))], radii: [...branch.radii, 0.0006] };
    }
    barkTube(b, branch.pts, branch.radii, sides, style, light);
  }
  return b.build();
}

// ───────────────────────────────────────────── textures ─────────────────────────────────────────────

const TEX_W = 128;
const TEX_H = 256;

/** Periodic value noise on a `px` x `py` lattice over the unit square (wraps both ways). */
function periodicNoise(seed: number, px: number, py: number) {
  const rand = mulberry32(seed);
  const lattice = new Float32Array(px * py).map(() => rand());
  const at = (i: number, j: number) => lattice[(((j % py) + py) % py) * px + (((i % px) + px) % px)]!;
  return (u: number, v: number) => {
    const x = u * px;
    const y = v * py;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const c = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (c - a) * sy;
  };
}

/** Periodic Worley noise: the distances to the nearest and second nearest of `nx` x `ny` jittered points (cell units). */
function periodicWorley(seed: number, nx: number, ny: number) {
  const rand = mulberry32(seed);
  const pts = new Float32Array(nx * ny * 2).map(() => 0.1 + 0.8 * rand());
  return (u: number, v: number): [number, number] => {
    const x = u * nx;
    const y = v * ny;
    const i0 = Math.floor(x);
    const j0 = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    for (let j = j0 - 1; j <= j0 + 1; j++)
      for (let i = i0 - 1; i <= i0 + 1; i++) {
        const ii = ((i % nx) + nx) % nx;
        const jj = ((j % ny) + ny) % ny;
        const k = (jj * nx + ii) * 2;
        const d = Math.hypot(i + pts[k]! - x, j + pts[k + 1]! - y);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
    return [f1, f2];
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A pattern's value (0..~1.3, before normalising) at (u, v) of the tile. */
function patternOf(pattern: BarkPattern): (u: number, v: number) => number {
  const grain = periodicNoise(91, 64, 128);
  const streak = periodicNoise(19, 40, 6);
  const mottle = periodicNoise(17, 6, 10);
  switch (pattern) {
    case "plates": {
      // a zelkova's / street tree's bark: smooth grey-brown, fine vertical streaks, soft lighter and darker patches
      // where thin scales have flaked off, and small pale lenticels
      const w = periodicWorley(5, 6, 5);
      const patchTone = periodicNoise(29, 6, 5);
      const edge = periodicNoise(33, 12, 10);
      const dots = lenticels(71, 60, 0.07, 0.01);
      return (u, v) => {
        const [f1, f2] = w(u + (edge(u, v) - 0.5) * 0.05, v + (edge(v, u) - 0.5) * 0.05);
        const inPatch = smooth(0.12, 0.3, f2 - f1);
        const tone = 0.82 + 0.36 * patchTone(Math.floor(u * 6) / 6 + 0.01, Math.floor(v * 5) / 5 + 0.01);
        const patch = 1 + (tone - 1) * inPatch * 0.9;
        return patch * (0.9 + 0.2 * mottle(u, v)) * (0.86 + 0.28 * streak(u, v)) * (0.9 + 0.2 * grain(u, v)) * (1 + 0.25 * dots(u, v));
      };
    }
    case "willow": {
      // deep furrows running up the trunk and joining: dark grooves, rounded ridges between them (a criss-cross net
      // from two slightly slanted sets of grooves)
      const warp = periodicNoise(41, 8, 3);
      const warp2 = periodicNoise(43, 8, 3);
      const ridge = (x: number) => {
        const f = x - Math.floor(x);
        return 1 - Math.abs(2 * f - 1);
      };
      return (u, v) => {
        const a = ridge(u * 7 + v + (warp(u, v) - 0.5) * 1.6);
        const b = ridge(u * 7 - v + 0.5 + (warp2(u, v) - 0.5) * 1.6);
        const r = Math.max(a, b);
        return (0.34 + 0.66 * smooth(0.25, 0.7, r) * (0.75 + 0.35 * r)) * (0.88 + 0.24 * mottle(u, v)) * (0.82 + 0.36 * grain(u, v)) * (0.9 + 0.2 * streak(u, v));
      };
    }
    case "plum": {
      // a plum's dark bark: rough and flaky (soft scales, shallow cracks between them), short horizontal lenticels
      const w = periodicWorley(13, 14, 10);
      const warp = periodicNoise(47, 10, 8);
      const dots = lenticels(83, 90, 0.06, 0.01);
      return (u, v) => {
        const [f1, f2] = w(u + (warp(u, v) - 0.5) * 0.04, v + (warp(v, u) - 0.5) * 0.04);
        const crack = 0.72 + 0.28 * smooth(0.02, 0.25, f2 - f1);
        return crack * (0.8 + 0.35 * mottle(u, v)) * (0.78 + 0.44 * grain(u, v)) * (0.9 + 0.2 * streak(u, v)) * (1 - 0.35 * dots(u, v));
      };
    }
    case "smooth": {
      // smooth young bark: a faint mottle, fine streaks and a few small pale lenticels
      const dots = lenticels(71, 70, 0.05, 0.012);
      return (u, v) => (0.86 + 0.24 * mottle(u, v)) * (0.92 + 0.16 * streak(u, v)) * (0.94 + 0.12 * grain(u, v)) * (1 + 0.22 * dots(u, v));
    }
    case "cherry":
    default: {
      // a cherry's smooth bark, faintly banded round the trunk, with its horizontal lenticels (dark dashes)
      const dots = lenticels(23, 150, 0.11, 0.012);
      const band = periodicNoise(57, 2, 24);
      return (u, v) => (0.82 + 0.22 * mottle(u, v)) * (0.9 + 0.18 * band(u, v)) * (0.93 + 0.14 * grain(u, v)) * (1 - 0.5 * dots(u, v));
    }
  }
}

/** Horizontal dashes (0..1 coverage) on the tile: `n` of them, `w` wide (share of the circumference), `h` tall (of the tile). */
function lenticels(seed: number, n: number, w: number, h: number): (u: number, v: number) => number {
  const rand = mulberry32(seed);
  const list = Array.from({ length: n }, () => ({ u: rand(), v: rand(), w: w * (0.5 + rand()), h: h * (0.6 + 0.8 * rand()) }));
  // binned by v for speed
  const bins: Array<typeof list> = Array.from({ length: 32 }, () => []);
  for (const l of list) for (const dv of [-1, 0, 1]) bins[(Math.floor(l.v * 32) + dv + 32) % 32]!.push(l);
  return (u, v) => {
    let c = 0;
    for (const l of bins[Math.floor(v * 32) % 32]!) {
      let du = Math.abs(u - l.u);
      du = Math.min(du, 1 - du);
      let dv = Math.abs(v - l.v);
      dv = Math.min(dv, 1 - dv);
      const e = (du / (l.w / 2)) ** 2 + (dv / (l.h / 2)) ** 2;
      if (e < 1) c = Math.max(c, 1 - e * e);
    }
    return c;
  };
}

/** A pattern's tile as RGBA bytes (linear values, normalised to the mean TEX_MEAN). Pure (tests). */
export function barkPixels(pattern: BarkPattern): Uint8Array {
  const f = patternOf(pattern);
  const values = new Float32Array(TEX_W * TEX_H);
  let sum = 0;
  for (let y = 0; y < TEX_H; y++)
    for (let x = 0; x < TEX_W; x++) {
      const val = f((x + 0.5) / TEX_W, (y + 0.5) / TEX_H);
      values[y * TEX_W + x] = val;
      sum += val;
    }
  const k = TEX_MEAN / (sum / values.length);
  const out = new Uint8Array(TEX_W * TEX_H * 4);
  values.forEach((val, i) => {
    const b = Math.max(0, Math.min(255, Math.round(val * k * 255)));
    out[i * 4] = b;
    out[i * 4 + 1] = b;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  });
  return out;
}

/** A pattern's texture (linear values: a multiplier on the bark colour), repeating, mipmapped. */
export function barkTexture(pattern: BarkPattern): DataTexture {
  const t = new DataTexture(barkPixels(pattern), TEX_W, TEX_H, RGBAFormat, UnsignedByteType);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.name = `T_veg_bark_${pattern}`;
  t.needsUpdate = true;
  return t;
}
