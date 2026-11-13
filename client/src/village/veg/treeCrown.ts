import { DAY_SUN_DIRECTION } from "../dayNightBlend";
import { mulberry32, valueNoise3 } from "./vegRandom";
import type { Vec3 } from "./vegLod";
import {
  add,
  colonise,
  cross,
  crownConnection,
  dressExposed,
  dot,
  envelopeRadius,
  isSkyGap,
  len,
  lumpyLimit,
  mul,
  norm,
  pointAt,
  polyLength,
  pruneTwigs,
  skeletonBranches,
  sub,
  type ColoniseOptions,
  type Connection,
  type Envelope,
  type GrownTwig,
  type Hang,
  type KeepOut,
} from "./crownGrowth";
import type { Branch, TreeSkeleton } from "./treeSkeleton";

/**
 * The leafy crowns (veg3d): the broadleaf trees (the village's greens, the street greens, the memorial's young trees)
 * and the creek's weeping willows, grown out of their replayed skeletons (treeSkeleton.ts). Pure and seeded.
 *
 * Broadleaf (`growBroadleaf`): twigs grow from the baked limbs and side branches toward the crown's shell (space
 * colonisation, crownGrowth.colonise), then leaf sprays (a short shoot of 8 folded leaves, vegGeometry.leafSpray) sit
 * on the twigs: one at every twig's tip continuing it, the others along its outer part as side shoots, and one at the
 * end of every baked limb and side branch. A spray's origin is a point of its twig, so every leaf cluster is attached;
 * twigs left without a spray at their tip are cut back (crownGrowth.pruneTwigs). The crown fills the old one's volume,
 * lumpy, with sky gaps; leaves face the sky and out of the crown, the inner and lower ones darker.
 *
 * Willow (`growWillow`): branches grow from the limbs up and out into a wide dome (space colonisation again); from
 * them, and from the limbs' outer parts, short arches tip over and long thin strands hang down, drifting out a little,
 * to a metre or two above the ground; narrow-leaf sprays (vegGeometry.willowSpray) follow every strand to its tip.
 */

/** A leaf spray: its origin on a twig, the way the shoot grows (axis), the way its leaves face, size and light. */
export interface Leaf {
  x: number;
  y: number;
  z: number;
  /** The shoot's direction (unit; the spray's local +y). */
  ax: number;
  ay: number;
  az: number;
  /** The way the leaf blades face (unit, perpendicular to the axis; the spray's local +z). */
  fx: number;
  fy: number;
  fz: number;
  /** Scale of the spray geometry. */
  size: number;
  light: number;
  /** A hash in [0, 1) (thinning, tint). */
  seed: number;
  /** The branch it is on (>= 0: `twigs[twig]`; < 0: the skeleton branch -1 - twig). */
  twig: number;
}

export type LeafKind = "green" | "young" | "willow";

export interface LeafCrown {
  kind: LeafKind;
  skeleton: TreeSkeleton;
  twigs: GrownTwig[];
  leaves: Leaf[];
  env: Envelope;
  bounds: { x: number; y: number; z: number; r: number };
}

export interface BroadleafOptions {
  colonise: ColoniseOptions;
  /** Attractors per m^3 of the envelope's box (rx^2 (up + down)), and at least `minAttractors`. */
  density: number;
  minAttractors: number;
  /** Envelope: horizontal radius (x R), height above and below crown_c (x crownH, + m). */
  rx: number;
  up: [number, number];
  down: [number, number];
  /** Spray spacing along twigs (m), the closest two sprays' origins may be (m), spray scale. */
  step: number;
  minD: number;
  size: number;
  /** Where sprays start along twigs, side branches and limbs (share of their length). */
  twigFrom: number;
  sideFrom: number;
  limbFrom: number;
}

export const GREEN_GROW: BroadleafOptions = {
  colonise: { attractors: 0, rhoMin: 0.42, rhoSpan: 0.62, nodeStep: 0.24, limbFrom: 0.22, sideFrom: 0.1, maxLen: 1.3, reach: 2.4, maxKids: 3, gap: 0.72 },
  density: 10.5,
  minAttractors: 120,
  rx: 1.1,
  up: [0.95, 0.6],
  down: [0.7, 0.45],
  step: 0.15,
  minD: 0.125,
  size: 1.18,
  twigFrom: 0.3,
  sideFrom: 0.45,
  limbFrom: 0.72,
};

export const YOUNG_GROW: BroadleafOptions = {
  colonise: { attractors: 0, rhoMin: 0.35, rhoSpan: 0.7, nodeStep: 0.12, limbFrom: 0.25, sideFrom: 0.1, maxLen: 0.55, reach: 1.1, maxKids: 3, gap: 0.74 },
  density: 40,
  minAttractors: 80,
  rx: 1.15,
  up: [0.95, 0.25],
  down: [0.7, 0.15],
  step: 0.09,
  minD: 0.075,
  size: 0.6,
  twigFrom: 0.2,
  sideFrom: 0.35,
  limbFrom: 0.6,
};

const SUN = DAY_SUN_DIRECTION as Vec3;
const UP: Vec3 = [0, 1, 0];

/** The broadleaf envelope: the old crown's volume, wide enough for every baked branch tip. */
export function broadleafEnvelope(sk: TreeSkeleton, o: BroadleafOptions): Envelope {
  let rx = sk.R * o.rx;
  for (const b of skeletonBranches(sk)) {
    const tip = b.pts[b.pts.length - 1]!;
    rx = Math.max(rx, Math.hypot(tip[0] - sk.crownC[0], tip[2] - sk.crownC[2]) + 0.25);
  }
  return { c: sk.crownC, rx, up: sk.crownH * o.up[0] + o.up[1], down: sk.crownH * o.down[0] + o.down[1] };
}

/** Light of a cluster at `p` facing out along `outward`: outer and sunward brighter, the underside and inside darker. */
function leafLight(env: Envelope, p: Vec3, outward: Vec3, salt: number): number {
  const depth = Math.min(1, envelopeRadius(env, p));
  const sunny = Math.max(0, dot(outward, SUN));
  const under = outward[1] < 0 ? 1 + outward[1] * 0.3 : 1;
  return Math.min(1.08, (0.46 + 0.32 * depth + 0.26 * sunny) * under * (0.9 + 0.2 * valueNoise3(p[0] * 1.7, p[1] * 1.7, p[2] * 1.7, salt + 41)));
}

/** A spatial hash for "is there already a cluster within d of p". */
class Spacing {
  private readonly grid = new Map<number, Vec3[]>();
  constructor(private readonly cell: number) {}
  private key(i: number, j: number, k: number): number {
    return ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096);
  }
  near(p: Vec3, d: number): boolean {
    const c = this.cell;
    const i0 = Math.floor(p[0] / c);
    const j0 = Math.floor(p[1] / c);
    const k0 = Math.floor(p[2] / c);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          const list = this.grid.get(this.key(i0 + i, j0 + j, k0 + k));
          if (!list) continue;
          for (const q of list) if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2 < d * d) return true;
        }
    return false;
  }
  add(p: Vec3): void {
    const c = this.cell;
    const k = this.key(Math.floor(p[0] / c), Math.floor(p[1] / c), Math.floor(p[2] / c));
    let list = this.grid.get(k);
    if (!list) this.grid.set(k, (list = []));
    list.push(p);
  }
}

/** A unit vector perpendicular to `d`, turned `angle` round it. */
function perpendicular(d: Vec3, angle: number): Vec3 {
  const helper: Vec3 = Math.abs(d[1]) < 0.9 ? UP : [1, 0, 0];
  const a = norm(cross(d, helper));
  const b = cross(d, a);
  return norm(add(mul(a, Math.cos(angle)), mul(b, Math.sin(angle))));
}

/** The facing of a spray: up and out of the crown, perpendicular to its axis. */
function facing(axis: Vec3, outward: Vec3, jitter: Vec3): Vec3 {
  const f0 = norm(add(add(mul(UP, 0.8), mul(outward, 0.55)), jitter));
  const f = sub(f0, mul(axis, dot(f0, axis)));
  return len(f) > 1e-3 ? norm(f) : perpendicular(axis, 0);
}

/** Twigs and leaf sprays of a broadleaf tree (see the file header). */
export function growBroadleaf(sk: TreeSkeleton, o: BroadleafOptions = GREEN_GROW, kind: LeafKind = "green", keepOut?: KeepOut): LeafCrown {
  const rand = mulberry32(7000 + sk.index * 7919);
  const env = broadleafEnvelope(sk, o);
  const salt = sk.index * 5 + 2;
  const attractors = Math.max(o.minAttractors, Math.round(o.density * env.rx * env.rx * (env.up + env.down)));
  const grown = colonise(sk, env, salt, rand, { ...o.colonise, attractors, keepOut });
  const leaves: Leaf[] = [];
  const hangs: Hang[] = [];
  const spacing = new Spacing(0.25);
  const trySpray = (p: Vec3, dir: Vec3, hang: Hang, tip: boolean, force: boolean) => {
    const outward = norm([p[0] - env.c[0], (p[1] - env.c[1]) * 0.8 + 0.2 * env.rx, p[2] - env.c[2]]);
    const j1 = rand();
    const j2 = rand();
    const j3 = rand();
    if (!force && envelopeRadius(env, p) > lumpyLimit(p, salt) * 1.08) return;
    if (!force && isSkyGap(p, salt, o.colonise.gap)) return;
    if (spacing.near(p, force ? o.minD * 0.5 : o.minD)) return;
    if (keepOut?.(p)) return;
    let axis: Vec3;
    if (tip) axis = norm(add(add(dir, mul(outward, 0.35)), [0, 0.2, 0]));
    else {
      let side = perpendicular(dir, j1 * Math.PI * 2);
      if (dot(side, add(outward, mul(UP, 0.6))) < 0) side = mul(side, -1);
      axis = norm(add(mul(dir, 0.5), mul(side, 0.85)));
    }
    const face = facing(axis, outward, [(j2 - 0.5) * 0.5, 0, (j3 - 0.5) * 0.5]);
    spacing.add(p);
    leaves.push({
      x: p[0],
      y: p[1],
      z: p[2],
      ax: axis[0],
      ay: axis[1],
      az: axis[2],
      fx: face[0],
      fy: face[1],
      fz: face[2],
      size: o.size * (0.85 + 0.3 * rand()),
      light: leafLight(env, p, outward, salt),
      seed: rand(),
      twig: hang.twig,
    });
    hangs.push(hang);
  };
  const along = (b: Branch, id: number, from: number, forceTip: boolean) => {
    const total = polyLength(b);
    for (let s = total - 0.004; s >= from * total; s -= o.step * (0.8 + 0.4 * rand())) {
      const at = pointAt(b, s);
      const isTip = s >= total - 0.01;
      trySpray(at.p, at.dir, { twig: id, s }, isTip, isTip && forceTip);
    }
  };
  // twigs first, tips first (a twig's tip spray is placed before its neighbours can crowd it)
  grown.forEach((t, i) => {
    const total = polyLength(t);
    const at = pointAt(t, total);
    trySpray(at.p, at.dir, { twig: i, s: total }, true, false);
  });
  grown.forEach((t, i) => along(t, i, o.twigFrom, false));
  const skel = skeletonBranches(sk);
  skel.forEach((b, i) => along(b, -1 - i, i < sk.limbs.length ? o.limbFrom : o.sideFrom, true));
  // no bare branch shows from outside the crown (a limb poking out with one spray at its tip): dress it
  const placed: Vec3[] = leaves.map((l) => [l.x, l.y, l.z]);
  const dress = exposedDressing(kind, o);
  dressExposed([...skel, ...grown], placed, env, { ...dress, step: o.step }, (i, s, p, dir) => {
    const n = leaves.length;
    trySpray(p, dir, { twig: i < skel.length ? -1 - i : i - skel.length, s }, false, true);
    return leaves.slice(n).map((l): Vec3 => [l.x, l.y, l.z]);
  });

  const pruned = pruneTwigs(grown, hangs);
  for (const l of leaves) if (l.twig >= 0) l.twig = pruned.map[l.twig]!;
  return { kind, skeleton: sk, twigs: pruned.twigs, leaves, env, bounds: leafBounds(env, leaves, 0.5) };
}

/**
 * How the crowns' bare stretches are found (crownGrowth.dressExposed and pokingRuns): a branch point is covered by a
 * spray whose origin is within `reach` (about the spray's length), and hidden from outside by a cluster within `cover`
 * of the line from the crown's centre out through it.
 */
export function exposedDressing(kind: LeafKind, o?: Pick<BroadleafOptions, "size">): { reach: number; cover: number } {
  if (kind === "willow") return { reach: 0.3, cover: 0.45 };
  const size = o?.size ?? (kind === "young" ? YOUNG_GROW.size : GREEN_GROW.size);
  return { reach: 0.4 * size, cover: Math.max(0.25, 0.38 * size) };
}

function leafBounds(env: Envelope, leaves: readonly Leaf[], reach: number): LeafCrown["bounds"] {
  let r = 0;
  for (const l of leaves) r = Math.max(r, Math.hypot(l.x - env.c[0], l.y - env.c[1], l.z - env.c[2]) + l.size * reach);
  return { x: env.c[0], y: env.c[1], z: env.c[2], r: Math.max(r, 0.5) };
}

export interface WillowOptions {
  /** Branches grown into the dome (space colonisation) and the spacing of the strands hung from them (m). */
  dome: ColoniseOptions;
  strandStep: number;
  /** Strand spray spacing (m), spray scale. */
  sprayStep: number;
  size: number;
  /** The strands end this far above the trunk's base (m): min + random span. */
  floor: [number, number];
}

export const WILLOW_GROW: WillowOptions = {
  dome: { attractors: 110, rhoMin: 0.55, rhoSpan: 0.5, nodeStep: 0.3, limbFrom: 0.3, sideFrom: 0.15, maxLen: 1.6, reach: 3.2, maxKids: 3, gap: 0.8 },
  strandStep: 0.6,
  sprayStep: 0.25,
  size: 1.1,
  floor: [0.5, 1.6],
};

/** The willow's dome: wider and higher than the old crown, the strands hang from all over it. */
export function willowEnvelope(sk: TreeSkeleton): Envelope {
  return { c: add(sk.crownC, [0, sk.crownH * 0.25, 0]), rx: sk.R * 1.3, up: sk.crownH * 0.85 + 0.6, down: sk.crownH * 0.45 };
}

/** Dome branches, hanging strands and narrow-leaf sprays of a weeping willow (see the file header). */
export function growWillow(sk: TreeSkeleton, o: WillowOptions = WILLOW_GROW): LeafCrown {
  const rand = mulberry32(5000 + sk.index * 7919);
  const salt = sk.index * 5 + 3;
  const groundY = sk.base[1];
  const env = willowEnvelope(sk);
  // the branches that carry the strands: grown from the limbs into the dome, up and out
  const dome = colonise(sk, env, salt, rand, o.dome);
  const twigs: GrownTwig[] = [...dome];
  const leaves: Leaf[] = [];
  const hangs: Hang[] = [];
  const addSpray = (at: { p: Vec3; dir: Vec3 }, out: Vec3, hang: Hang) => {
    // the spray follows the strand (its axis the strand's direction); its leaves face out of the tree
    const axis = at.dir;
    const face = facing(axis, out, [(rand() - 0.5) * 0.6, -0.8, (rand() - 0.5) * 0.6]);
    const outward = norm([at.p[0] - env.c[0], (at.p[1] - env.c[1]) * 0.6, at.p[2] - env.c[2]]);
    leaves.push({
      x: at.p[0],
      y: at.p[1],
      z: at.p[2],
      ax: axis[0],
      ay: axis[1],
      az: axis[2],
      fx: face[0],
      fy: face[1],
      fz: face[2],
      size: o.size * (0.85 + 0.3 * rand()),
      light: leafLight(env, at.p, outward, salt),
      seed: rand(),
      twig: hang.twig,
    });
    hangs.push(hang);
  };
  const strand = (from: Vec3, parent: number, parentS: number) => {
    let out = norm([from[0] - sk.base[0] + (rand() - 0.5) * 0.8, 0, from[2] - sk.base[2] + (rand() - 0.5) * 0.8]);
    if (!Number.isFinite(out[0]) || len(out) < 0.5) out = [1, 0, 0];
    // a short arch over (up a little, out), then the strand drifts out and hangs straight down
    const La = 0.22 + rand() * 0.3;
    const arch: Vec3[] = [from, add(from, add(mul(out, La * 0.5), [0, La * 0.35, 0])), add(from, add(mul(out, La), [0, La * 0.2, 0]))];
    const archRadii = [0.008, 0.0068, 0.006];
    const archId = twigs.length;
    twigs.push({ pts: arch, radii: archRadii, parent, parentS });
    const top = arch[2]!;
    const bottom = Math.max(groundY + o.floor[0] + rand() * o.floor[1], 0);
    const length = Math.min(5.6, Math.max(1.0, top[1] - bottom));
    const pts: Vec3[] = [top];
    let drift = 0.14 + rand() * 0.1;
    let p = top;
    const segs = Math.max(4, Math.round(length / 0.3));
    const phase = rand() * Math.PI * 2;
    for (let k = 1; k <= segs; k++) {
      const swayK = Math.sin(phase + k * 0.45) * 0.03;
      p = add(p, add(mul(out, drift), [-out[2] * swayK, -length / segs, out[0] * swayK]));
      drift *= 0.6;
      pts.push(p);
    }
    const radii = pts.map((_, k) => 0.0056 + (0.0024 - 0.0056) * (k / segs));
    const id = twigs.length;
    const archLen = polyLength({ pts: arch, radii: archRadii });
    twigs.push({ pts, radii, parent: archId, parentS: archLen });
    // narrow-leaf sprays along the strand, the last at its tip, and on the arch
    const b = { pts, radii };
    const total = polyLength(b);
    for (let s = 0.06 + rand() * 0.1; s < total; s += o.sprayStep * (0.85 + 0.3 * rand())) addSpray(pointAt(b, s), out, { twig: id, s });
    addSpray(pointAt(b, total), out, { twig: id, s: total });
    addSpray(pointAt({ pts: arch, radii: archRadii }, archLen * 0.55), out, { twig: archId, s: archLen * 0.55 });
  };
  // strands from the dome's branches, the limbs' and side branches' outer parts and every tip
  dome.forEach((t, i) => {
    const total = polyLength(t);
    for (let s = total * (0.25 + 0.3 * rand()); s < total - 0.05; s += o.strandStep * (0.8 + 0.4 * rand())) strand(pointAt(t, s).p, i, s);
    strand(t.pts[t.pts.length - 1]!, i, total);
  });
  const skel = skeletonBranches(sk);
  skel.forEach((b, i) => {
    const total = polyLength(b);
    const from = i < sk.limbs.length ? 0.45 : 0.3;
    for (let s = from * total; s < total; s += o.strandStep * 1.6 * (0.8 + 0.4 * rand())) strand(pointAt(b, s).p, -1 - i, s);
    strand(b.pts[b.pts.length - 1]!, -1 - i, total);
  });
  // no bare limb shows over or beside the dome: a strand hangs from every exposed stretch
  const placed: Vec3[] = leaves.map((l) => [l.x, l.y, l.z]);
  dressExposed(skel, placed, env, { ...exposedDressing("willow"), step: 0.3 }, (i, s, p) => {
    const n = leaves.length;
    strand(p, -1 - i, s);
    return leaves.slice(n).map((l): Vec3 => [l.x, l.y, l.z]);
  });
  // the dome's branches carry leaves along their outer half too
  dome.forEach((t, i) => {
    const total = polyLength(t);
    for (let s = total * 0.5; s < total - 0.05; s += o.sprayStep * 1.4) {
      const at = pointAt(t, s);
      addSpray({ p: at.p, dir: norm(add(at.dir, [0, -1.2, 0])) }, norm([at.p[0] - sk.base[0], 0, at.p[2] - sk.base[2]]), { twig: i, s });
    }
  });
  // every dome branch has strands at its tip: nothing to prune; kept for the general rule
  const pruned = pruneTwigs(twigs, hangs);
  for (const l of leaves) if (l.twig >= 0) l.twig = pruned.map[l.twig]!;
  return { kind: "willow", skeleton: sk, twigs: pruned.twigs, leaves, env, bounds: leafBounds(env, leaves, 0.4) };
}

/** The connection measures of a leafy crown (crownGrowth.crownConnection). Sprays are ~0.4 m long at scale 1. */
export function leafConnection(c: LeafCrown): Connection {
  return crownConnection(skeletonBranches(c.skeleton), c.twigs, c.leaves.map((l) => ({ x: l.x, y: l.y, z: l.z, size: l.size * 0.4, twig: l.twig })));
}
