import { DAY_SUN_DIRECTION } from "../dayNightBlend";
import { PyRandom, mulberry32, valueNoise3 } from "./vegRandom";
import type { Vec3 } from "./vegLod";

/**
 * The plaza's six cherry trees, volumetric (veg3d). Pure and seeded: unit-tested.
 *
 * 1. The skeleton the village file already has: `art/village/tools/parts_trees.tree(kind="cherry")` drew each tree's
 *    trunk, 5 limbs and 2 side branches per limb as light-mapped bark (`LM_bark`), with Python's `random.Random(100+i)`.
 *    `plazaCherrySkeletons` replays those calls (PyRandom) and gets the same limbs; they stay in the file and are drawn
 *    as they are (baked light and all). Only the canopy's 2.2-3 m cards are hidden.
 * 2. `growCherry` grows thin twigs out of those limbs toward points scattered in the crown's shell (one pass of
 *    space colonisation: each attractor is reached by a twig from the nearest branch node, and new twigs are nodes for
 *    the next), and hangs blossom bunches (25-35 cm clusters of flowers, research spec §2.2: 3-6 flowers per spur,
 *    many spurs) along the outer part of every twig. The crown keeps the old one's size and place (its baked ground
 *    shadow), is lumpy (a low-frequency noise on the envelope: the cotton-ball masses of cherry_street) and has holes
 *    (a second noise: the sky gaps of cherry_lookup).
 */

const deg = (d: number) => (d * Math.PI) / 180;

/** A branch as a polyline with a radius at each point (game coordinates: y up). */
export interface Branch {
  pts: Vec3[];
  radii: number[];
}

export interface CherrySkeleton {
  index: number;
  /** Trunk base (on the planter's soil). */
  base: Vec3;
  fork: Vec3;
  H: number;
  R: number;
  /** The old crown's centre and half-height (parts_trees: crown_c, crown_h). */
  crownC: Vec3;
  crownH: number;
  /** The 5 limbs and their 10 side branches, as the file has them. */
  limbs: Branch[];
  sides: Branch[];
}

/** The plaza cherries (parts_trees.plaza_trees): r 19 round the fountain, in round planters 0.38 m high. */
export const PLAZA_CHERRY_ANGLES = [-118, -62, -16, 40, 65, 138] as const;
export const PLAZA_CHERRY_RING = 19;
export const PLAZA_CHERRY_Y0 = 0.38;

/** Blender (x, y, z) -> game (x, z, -y) (vlib.V and the glTF export). */
const g = (b: Vec3): Vec3 => [b[0], b[2], -b[1]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** One plaza cherry's skeleton: parts_trees.tree(F, x, z, "cherry", H, 3.0, 100 + i, y0=0.38), replayed. */
export function cherrySkeleton(i: number): CherrySkeleton {
  const a = deg(PLAZA_CHERRY_ANGLES[i]!);
  const x = PLAZA_CHERRY_RING * Math.cos(a);
  const z = PLAZA_CHERRY_RING * Math.sin(a);
  const H = 6.2 + (i % 3) * 0.4;
  const R = 3.0;
  const rng = new PyRandom(100 + i);
  const trunkR = 0.13;
  const forkH = H * 0.36; // KINDS["cherry"]["fork"]
  // Blender space from here (z up, y = -game z), as the script
  const base: Vec3 = [x, -z, PLAZA_CHERRY_Y0];
  const la = rng.uniform(0, 2 * Math.PI);
  const leanv: Vec3 = mul([Math.cos(la), Math.sin(la), 0], 0.06 * forkH);
  const fork = add(add(base, [0, 0, forkH]), leanv);
  const crownC = add(add(base, [0, 0, forkH + (H - forkH) * 0.5]), leanv);
  const crownH = (H - forkH) * 0.6;
  const limbs: Branch[] = [];
  const sides: Branch[] = [];
  const nl = 5;
  for (let li = 0; li < nl; li++) {
    const az = (2 * Math.PI * li) / nl + rng.uniform(-0.3, 0.3);
    const el = deg(rng.uniform(30, 58));
    const d: Vec3 = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
    let Lb = (R * rng.uniform(0.75, 0.95)) / Math.max(0.35, Math.cos(el));
    Lb = Math.min(Lb, (H - forkH) * 1.1);
    const p0 = sub(fork, [0, 0, 0.1]);
    const p1 = add(p0, mul(d, Lb * 0.35));
    const p2 = add(add(p0, mul(d, Lb * 0.7)), [0, 0, Lb * 0.06]);
    const p3 = add(add(p0, mul(d, Lb)), [0, 0, -Lb * 0.05]);
    const r0 = trunkR * 0.55;
    limbs.push({ pts: [p0, p1, p2, p3].map(g), radii: [r0, r0 * 0.7, r0 * 0.45, 0.02] });
    for (let j = 0; j < 2; j++) {
      const t = rng.uniform(0.45, 0.8);
      const q0 = t < 0.6 ? lerp(p1, p2, t) : lerp(p2, p3, t - 0.5);
      const az2 = az + rng.uniform(-0.9, 0.9);
      const el2 = el + rng.uniform(-0.2, 0.4);
      const d2: Vec3 = [Math.cos(az2) * Math.cos(el2), Math.sin(az2) * Math.cos(el2), Math.sin(el2)];
      const q1 = add(q0, mul(d2, Lb * 0.45));
      sides.push({ pts: [q0, lerp(q0, q1, 0.5), q1].map(g), radii: [r0 * 0.3, r0 * 0.18, 0.012] });
    }
  }
  return { index: i, base: g(base), fork: g(fork), H, R, crownC: g(crownC), crownH, limbs, sides };
}

export function plazaCherrySkeletons(): CherrySkeleton[] {
  return PLAZA_CHERRY_ANGLES.map((_, i) => cherrySkeleton(i));
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
}

export interface CherryCrown {
  skeleton: CherrySkeleton;
  twigs: Branch[];
  bunches: Bunch[];
  /** A sphere around the whole crown (LOD and culling). */
  bounds: { x: number; y: number; z: number; r: number };
}

/** The crown's envelope (game space): centre, horizontal radius, height above and below the centre. */
export function crownEnvelope(sk: CherrySkeleton): { c: Vec3; rx: number; up: number; down: number } {
  // the old cards (2.2-3 m) sat on a shell of r 0.92 R round crown_c, from -0.35 to +1 crown_h: they reached about a
  // metre past it. The new crown fills about the same volume (the baked ground shadow), a little airier.
  return { c: sk.crownC, rx: sk.R * 1.08, up: sk.crownH * 0.9 + 0.7, down: sk.crownH * 0.55 + 0.35 };
}

/** Normalised radius of a point in the envelope (1 = on it). */
export function envelopeRadius(env: ReturnType<typeof crownEnvelope>, p: Vec3): number {
  const dx = (p[0] - env.c[0]) / env.rx;
  const dz = (p[2] - env.c[2]) / env.rx;
  const dyRaw = p[1] - env.c[1];
  const dy = dyRaw / (dyRaw >= 0 ? env.up : env.down);
  return Math.hypot(dx, dy, dz);
}

/** The lumpy envelope: 1 +- 0.15 with a 1.2 m noise (the cotton-ball masses). */
export function lumpyLimit(p: Vec3, salt: number): number {
  return 1 + 0.3 * (valueNoise3(p[0] / 1.25, p[1] / 1.25, p[2] / 1.25, salt) - 0.5);
}

/** True where the crown has a hole (the sky between masses), ~22 % of the shell. */
export function isSkyGap(p: Vec3, salt: number): boolean {
  return valueNoise3(p[0] / 0.75 + 31.7, p[1] / 0.75, p[2] / 0.75, salt + 3) > 0.66;
}

export interface GrowOptions {
  /** Attractor points in the shell (twig count). */
  attractors: number;
  /** Bunch spacing along twigs (m). */
  bunchStep: number;
}

export const CHERRY_GROW: GrowOptions = { attractors: 540, bunchStep: 0.08 };

const SUN = DAY_SUN_DIRECTION as Vec3;
/** Twigs one branch node may feed. */
const MAX_KIDS = 3;

/** Twigs and blossom bunches for one tree. */
export function growCherry(sk: CherrySkeleton, opts: GrowOptions = CHERRY_GROW): CherryCrown {
  const rand = mulberry32(9000 + sk.index * 7919);
  const env = crownEnvelope(sk);
  const salt = sk.index * 3 + 1;
  type Node = { p: Vec3; r: number; dir: Vec3; gen: number; kids: number };
  const nodes: Node[] = [];
  const addBranchNodes = (b: Branch, from: number, gen: number) => {
    let total = 0;
    const segs: number[] = [];
    for (let i = 1; i < b.pts.length; i++) {
      const l = len(sub(b.pts[i]!, b.pts[i - 1]!));
      segs.push(l);
      total += l;
    }
    const step = 0.28;
    for (let s = from * total; s <= total; s += step) {
      let acc = 0;
      for (let i = 0; i < segs.length; i++) {
        const l = segs[i]!;
        if (s <= acc + l || i === segs.length - 1) {
          const t = Math.min(1, (s - acc) / (l || 1));
          const p = lerp(b.pts[i]!, b.pts[i + 1]!, t);
          const r = b.radii[i]! + (b.radii[i + 1]! - b.radii[i]!) * t;
          nodes.push({ p, r, dir: norm(sub(b.pts[i + 1]!, b.pts[i]!)), gen, kids: 0 });
          break;
        }
        acc += l;
      }
    }
  };
  for (const l of sk.limbs) addBranchNodes(l, 0.3, 0);
  for (const s of sk.sides) addBranchNodes(s, 0.15, 0);

  // attractors in the shell, inner ones first (twigs reaching out can then branch off the earlier ones)
  const attractors: Vec3[] = [];
  let guard = 0;
  while (attractors.length < opts.attractors && guard++ < opts.attractors * 60) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const rr = Math.sqrt(1 - u * u);
    const rho = 0.5 + 0.55 * Math.sqrt(rand());
    const dir: Vec3 = [rr * Math.cos(th), u, rr * Math.sin(th)];
    const p: Vec3 = [
      env.c[0] + dir[0] * env.rx * rho,
      env.c[1] + dir[1] * (dir[1] >= 0 ? env.up : env.down) * rho,
      env.c[2] + dir[2] * env.rx * rho,
    ];
    if (envelopeRadius(env, p) > lumpyLimit(p, salt)) continue;
    if (isSkyGap(p, salt)) continue;
    attractors.push(p);
  }
  const axisDist = (p: Vec3) => Math.hypot(p[0] - env.c[0], (p[1] - env.c[1]) * 0.7, p[2] - env.c[2]);
  attractors.sort((a, b) => axisDist(a) - axisDist(b));

  const twigs: Branch[] = [];
  for (const a of attractors) {
    // the best node: near, and pointing the way the twig goes
    let best: Node | null = null;
    let bestScore = Infinity;
    for (const n of nodes) {
      // a node feeds at most 3 twigs: no starbursts of twigs from one point
      if (n.kids >= MAX_KIDS) continue;
      const dx = a[0] - n.p[0];
      const dy = a[1] - n.p[1];
      const dz = a[2] - n.p[2];
      const l2 = dx * dx + dy * dy + dz * dz;
      if (l2 < 0.0225 || l2 > 6.76) continue;
      const l = Math.sqrt(l2);
      const along = (n.dir[0] * dx + n.dir[1] * dy + n.dir[2] * dz) / l;
      const score = l * (1.35 - 0.35 * along) + n.gen * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    if (!best) continue;
    best.kids++;
    const d = sub(a, best.p);
    const L = Math.min(len(d), 1.5);
    const dirN = norm(d);
    // a gently bowed twig: up a little in the middle, a small sideways wiggle
    const side = norm([-dirN[2], 0, dirN[0]]);
    const wig = (rand() - 0.5) * 0.12 * L;
    const pts: Vec3[] = [];
    const n = L > 0.7 ? 4 : 3;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const bow = Math.sin(t * Math.PI) * 0.07 * L;
      pts.push(add(add(add(best.p, mul(dirN, L * t)), [0, bow, 0]), mul(side, wig * Math.sin(t * Math.PI))));
    }
    const r0 = Math.min(best.r * 0.8, 0.0075 + 0.0045 * L);
    const radii = pts.map((_, k) => r0 + (0.0032 - r0) * (k / n));
    twigs.push({ pts, radii });
    for (let k = 1; k <= n; k++) nodes.push({ p: pts[k]!, r: radii[k]!, dir: dirN, gen: best.gen + 1, kids: 0 });
  }

  // bunches along the outer part of every twig, and on the outer ends of the limbs' side branches
  const bunches: Bunch[] = [];
  const grid = new Map<number, Bunch[]>();
  const gkey = (i: number, j: number, k: number) => ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048);
  const cell = 0.2;
  const minD = 0.1;
  const tryBunch = (p0: Vec3, tree: number) => {
    const outward = norm([p0[0] - env.c[0], (p0[1] - env.c[1]) * 0.8 + 0.25, p0[2] - env.c[2]]);
    const p = add(add(p0, mul(outward, 0.03 + rand() * 0.04)), [(rand() - 0.5) * 0.08, (rand() - 0.3) * 0.06, (rand() - 0.5) * 0.08]);
    const rho = envelopeRadius(env, p);
    if (rho > lumpyLimit(p, salt) * 1.06) return;
    if (isSkyGap(p, salt)) return;
    const i0 = Math.floor(p[0] / cell);
    const j0 = Math.floor(p[1] / cell);
    const k0 = Math.floor(p[2] / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          const list = grid.get(gkey(i0 + i, j0 + j, k0 + k));
          if (!list) continue;
          for (const b of list) {
            if ((b.x - p[0]) ** 2 + (b.y - p[1]) ** 2 + (b.z - p[2]) ** 2 < minD * minD) return;
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
      tree,
    };
    bunches.push(b);
    const key = gkey(i0, j0, k0);
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push(b);
  };
  const along = (b: Branch, from: number, step: number) => {
    let total = 0;
    for (let i = 1; i < b.pts.length; i++) total += len(sub(b.pts[i]!, b.pts[i - 1]!));
    for (let s = total - 0.01; s >= from * total; s -= step * (0.8 + 0.4 * rand())) {
      let acc = 0;
      for (let i = 1; i < b.pts.length; i++) {
        const l = len(sub(b.pts[i]!, b.pts[i - 1]!));
        if (s <= acc + l + 1e-9) {
          tryBunch(lerp(b.pts[i - 1]!, b.pts[i]!, (s - acc) / (l || 1)), sk.index);
          break;
        }
        acc += l;
      }
    }
  };
  for (const t of twigs) along(t, 0.3, opts.bunchStep);
  for (const s of sk.sides) along(s, 0.55, opts.bunchStep * 1.2);
  for (const l of sk.limbs) along(l, 0.8, opts.bunchStep * 1.2);

  let r = 0;
  for (const b of bunches) r = Math.max(r, Math.hypot(b.x - env.c[0], b.y - env.c[1], b.z - env.c[2]) + b.size);
  return { skeleton: sk, twigs, bunches, bounds: { x: env.c[0], y: env.c[1], z: env.c[2], r } };
}
