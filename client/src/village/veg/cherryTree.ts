import { DAY_SUN_DIRECTION } from "../dayNightBlend";
import { mulberry32, valueNoise3 } from "./vegRandom";
import type { Vec3 } from "./vegLod";
import {
  CHERRY_COLONISE,
  add,
  colonise,
  crownConnection,
  dot,
  envelopeRadius,
  isSkyGap,
  len,
  lerp,
  lumpyLimit,
  mul,
  norm,
  polyLength,
  pruneTwigs,
  skeletonBranches,
  sub,
  type Connection,
  type Envelope,
  type GrownTwig,
  type Hang,
} from "./crownGrowth";
import { PLAZA_CHERRY_SPECS, VILLAGE_TREE_SPECS, treeSkeleton, type Branch, type TreeSkeleton, type TreeSpec } from "./treeSkeleton";

/**
 * The blossom crowns (veg3d): the plaza's six cherries, the village's eleven, the street cherries and the orchards'
 * plum trees. Pure and seeded: unit-tested.
 *
 * 1. The skeleton the village file already has (treeSkeleton.ts): the trunk, limbs and side branches, replayed with
 *    Python's random (PyRandom) from the art script's own calls, so they are the very limbs baked in the file. They stay
 *    in the file and are drawn as they are; only the canopy's 1.2-3 m cards are hidden.
 * 2. `growCherry` grows thin twigs out of those limbs toward points scattered in the crown's shell (crownGrowth.colonise)
 *    and hangs blossom bunches (25-35 cm clusters of flowers, 3-6 flowers per spur, many spurs) on the outer part of
 *    every twig, each bunch's spur on its twig (within 5 cm). Twigs whose tip ends bare are cut back to their last
 *    bunch (crownGrowth.pruneTwigs). The crown keeps the old one's size and place (its baked ground shadow), is lumpy
 *    (a low-frequency noise on the envelope: the cotton-ball masses of a cherry) and has holes (the sky gaps).
 */

export type { Branch } from "./treeSkeleton";
export { envelopeRadius, isSkyGap, lumpyLimit } from "./crownGrowth";
export type CherrySkeleton = TreeSkeleton;

/** The village's own cherries beyond the plaza (parts_trees.village_trees), with the seeds the script gave them. */
export const OUTDOOR_CHERRY_SPECS: readonly TreeSpec[] = VILLAGE_TREE_SPECS.filter((s) => s.kind === "cherry");

export function outdoorCherrySkeletons(): CherrySkeleton[] {
  return OUTDOOR_CHERRY_SPECS.map(treeSkeleton);
}

export function plazaCherrySkeletons(): CherrySkeleton[] {
  return PLAZA_CHERRY_SPECS.map(treeSkeleton);
}

/** A blossom bunch: where it hangs, which way its flowers face, how big and how lit it is. */
export interface Bunch {
  x: number;
  y: number;
  z: number;
  /** Unit vector the bunch faces (outward from the crown, toward the light a little). */
  nx: number;
  ny: number;
  nz: number;
  /** Diameter (m). */
  size: number;
  /** Baked-like light (0..1.1): outer and sunny brighter, inner and underneath darker. */
  light: number;
  /** 0 at the crown's centre, 1 on its envelope. */
  depth: number;
  /** A hash in [0, 1) (thinning, roll, wind phase). */
  seed: number;
  /** Which tree. */
  tree: number;
  /** The branch it hangs on (>= 0: `twigs[twig]`; < 0: the skeleton branch -1 - twig, limbs then sides). */
  twig: number;
}

export interface CherryCrown {
  skeleton: CherrySkeleton;
  twigs: GrownTwig[];
  bunches: Bunch[];
  /** A sphere around the whole crown (LOD and culling). */
  bounds: { x: number; y: number; z: number; r: number };
}

/** The crown's envelope (game space): centre, horizontal radius, height above and below the centre. */
export function crownEnvelope(sk: CherrySkeleton): Envelope {
  // the old cards (2.2-3 m) sat on a shell of r 0.92 R round crown_c, from -0.35 to +1 crown_h: they reached about a
  // metre past it. The new crown fills about the same volume (the baked ground shadow), a little airier.
  return { c: sk.crownC, rx: sk.R * 1.08, up: sk.crownH * 0.9 + 0.7, down: sk.crownH * 0.55 + 0.35 };
}

export interface GrowOptions {
  /** Attractor points in the shell (twig count). */
  attractors: number;
  /** Bunch spacing along twigs (m). */
  bunchStep: number;
  /** The closest two bunches may be (m). */
  minD?: number;
}

export const CHERRY_GROW: GrowOptions = { attractors: 540, bunchStep: 0.08 };

const SUN = DAY_SUN_DIRECTION as Vec3;

/** Twigs and blossom bunches for one tree. */
export function growCherry(sk: CherrySkeleton, opts: GrowOptions = CHERRY_GROW): CherryCrown {
  const rand = mulberry32(9000 + sk.index * 7919);
  const env = crownEnvelope(sk);
  const salt = sk.index * 3 + 1;
  const grown = colonise(sk, env, salt, rand, { ...CHERRY_COLONISE, attractors: opts.attractors });

  // bunches along the outer part of every twig, and on the outer ends of the limbs' side branches
  const bunches: Bunch[] = [];
  const hangs: Hang[] = [];
  const grid = new Map<number, Bunch[]>();
  const gkey = (i: number, j: number, k: number) => ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048);
  const cell = 0.2;
  // bunches at least this far apart: a little closer than the spurs could sit before they had to stay on their twig
  const minD = opts.minD ?? 0.088;
  const tryBunch = (p0: Vec3, hang: Hang, force = false) => {
    const outward = norm([p0[0] - env.c[0], (p0[1] - env.c[1]) * 0.8 + 0.25, p0[2] - env.c[2]]);
    // the spur sits on its twig: at most ~4.5 cm off it
    const p = add(add(p0, mul(outward, 0.012 + rand() * 0.015)), [(rand() - 0.5) * 0.02, (rand() - 0.3) * 0.016, (rand() - 0.5) * 0.02]);
    const rho = envelopeRadius(env, p);
    if (!force && rho > lumpyLimit(p, salt) * 1.06) return;
    if (!force && isSkyGap(p, salt)) return;
    const i0 = Math.floor(p[0] / cell);
    const j0 = Math.floor(p[1] / cell);
    const k0 = Math.floor(p[2] / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          const list = grid.get(gkey(i0 + i, j0 + j, k0 + k));
          if (!list) continue;
          for (const b of list) {
            if ((b.x - p[0]) ** 2 + (b.y - p[1]) ** 2 + (b.z - p[2]) ** 2 < minD * minD * (force ? 0.25 : 1)) return;
          }
        }
    // light: outer and sunward brighter, the underside and the inside darker (the old cards' baked range 0.47-0.89)
    const depth = Math.min(1, rho);
    const sunny = Math.max(0, dot(outward, SUN));
    const under = outward[1] < 0 ? 1 + outward[1] * 0.35 : 1;
    const light = Math.min(1.08, (0.42 + 0.34 * depth + 0.28 * sunny) * under * (0.9 + 0.2 * valueNoise3(p[0] * 2, p[1] * 2, p[2] * 2, 77)));
    const face = norm(add(outward, mul(SUN, 0.25)));
    const b: Bunch = {
      x: p[0],
      y: p[1],
      z: p[2],
      nx: face[0],
      ny: face[1],
      nz: face[2],
      size: 0.24 + 0.1 * rand(),
      light,
      depth,
      seed: rand(),
      tree: sk.index,
      twig: hang.twig,
    };
    bunches.push(b);
    hangs.push(hang);
    const key = gkey(i0, j0, k0);
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push(b);
  };
  const along = (b: Branch, id: number, from: number, step: number) => {
    let total = 0;
    for (let i = 1; i < b.pts.length; i++) total += len(sub(b.pts[i]!, b.pts[i - 1]!));
    for (let s = total - 0.01; s >= from * total; s -= step * (0.8 + 0.4 * rand())) {
      let acc = 0;
      for (let i = 1; i < b.pts.length; i++) {
        const l = len(sub(b.pts[i]!, b.pts[i - 1]!));
        if (s <= acc + l + 1e-9) {
          tryBunch(lerp(b.pts[i - 1]!, b.pts[i]!, (s - acc) / (l || 1)), { twig: id, s });
          break;
        }
        acc += l;
      }
    }
  };
  grown.forEach((t, i) => along(t, i, 0.3, opts.bunchStep));
  const skel = skeletonBranches(sk);
  sk.sides.forEach((s, i) => along(s, -1 - (sk.limbs.length + i), 0.55, opts.bunchStep * 1.2));
  sk.limbs.forEach((l, i) => along(l, -1 - i, 0.8, opts.bunchStep * 1.2));
  // every baked limb and side branch ends in blossom
  skel.forEach((b, i) => tryBunch(b.pts[b.pts.length - 1]!, { twig: -1 - i, s: polyLength(b) }, true));

  // no twig ends in empty air: cut each back to its last bunch (or child twig)
  const pruned = pruneTwigs(grown, hangs);
  for (const b of bunches) if (b.twig >= 0) b.twig = pruned.map[b.twig]!;

  let r = 0;
  for (const b of bunches) r = Math.max(r, Math.hypot(b.x - env.c[0], b.y - env.c[1], b.z - env.c[2]) + b.size);
  return { skeleton: sk, twigs: pruned.twigs, bunches, bounds: { x: env.c[0], y: env.c[1], z: env.c[2], r } };
}

/** The connection measures of a blossom crown (crownGrowth.crownConnection). */
export function cherryConnection(c: CherryCrown): Connection {
  return crownConnection(skeletonBranches(c.skeleton), c.twigs, c.bunches);
}
