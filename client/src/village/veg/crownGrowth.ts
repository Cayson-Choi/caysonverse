import { valueNoise3 } from "./vegRandom";
import type { Vec3 } from "./vegLod";
import type { Branch, TreeSkeleton } from "./treeSkeleton";

/**
 * Growing a crown out of a replayed skeleton (veg3d), shared by every tree kind. Pure: unit-tested.
 *
 *  - `colonise`: one pass of space colonisation. Attractor points are scattered in the crown's shell; each is reached
 *    by a thin twig from the best branch node (near, pointing its way, at most 3 twigs per node), and the new twig's
 *    points are nodes for the later ones. The nodes start on the replayed limbs and side branches, so every twig is
 *    connected, through its parents, to the baked bark.
 *  - `pruneTwigs`: a twig whose tip carries no foliage (and no other twig) is cut back to its last leaf cluster or
 *    child twig, or dropped when it has neither: no twig ends in empty air.
 *  - `crownConnection`: the measure of the above, for the tests and the e2e (window.__cvVeg): the largest gap between
 *    a cluster and the branch it hangs on, the twigs whose tip ends bare, the clusters with no branch.
 */

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The crown's envelope (game space): centre, horizontal radius, height above and below the centre. */
export interface Envelope {
  c: Vec3;
  rx: number;
  up: number;
  down: number;
}

/** Normalised radius of a point in the envelope (1 = on it). */
export function envelopeRadius(env: Envelope, p: Vec3): number {
  const dx = (p[0] - env.c[0]) / env.rx;
  const dz = (p[2] - env.c[2]) / env.rx;
  const dyRaw = p[1] - env.c[1];
  const dy = dyRaw / (dyRaw >= 0 ? env.up : env.down);
  return Math.hypot(dx, dy, dz);
}

/** The lumpy envelope: 1 +- 0.15 with a 1.25 m noise (the masses of a crown). */
export function lumpyLimit(p: Vec3, salt: number): number {
  return 1 + 0.3 * (valueNoise3(p[0] / 1.25, p[1] / 1.25, p[2] / 1.25, salt) - 0.5);
}

/** True where the crown has a hole (the sky between masses), ~22 % of the shell at the default threshold. */
export function isSkyGap(p: Vec3, salt: number, threshold = 0.66): boolean {
  return valueNoise3(p[0] / 0.75 + 31.7, p[1] / 0.75, p[2] / 0.75, salt + 3) > threshold;
}

/** A grown twig: its polyline and the branch it starts on (`parent` >= 0: a twig; < 0: skeleton branch -1 - parent). */
export interface GrownTwig extends Branch {
  parent: number;
  /** Arc length along the parent where this twig starts. */
  parentS: number;
}

/** The skeleton's branches as the crowns number them: the limbs, then the side branches. */
export function skeletonBranches(sk: Pick<TreeSkeleton, "limbs" | "sides">): Branch[] {
  return [...sk.limbs, ...sk.sides];
}

export interface ColoniseOptions {
  attractors: number;
  /** Attractors' normalised radius: rhoMin + rhoSpan * sqrt(u). */
  rhoMin: number;
  rhoSpan: number;
  /** Node spacing on the skeleton (m). */
  nodeStep: number;
  /** Where nodes start along the limbs and side branches (share of their length). */
  limbFrom: number;
  sideFrom: number;
  /** Longest twig (m) and the reach (m) of a node. */
  maxLen: number;
  reach: number;
  /** Twigs one node may feed. */
  maxKids: number;
  /** Sky-gap threshold for attractors (higher: fewer holes). */
  gap: number;
  /** Space the crown must keep out of (a house, a neighbour's crown): no attractor there, so no twig grows into it. */
  keepOut?: KeepOut;
}

/** True where a crown must not grow (game space): a house beside it, the part of the air a neighbour's crown owns. */
export type KeepOut = (p: Vec3) => boolean;

export const CHERRY_COLONISE: ColoniseOptions = {
  attractors: 540,
  rhoMin: 0.5,
  rhoSpan: 0.55,
  nodeStep: 0.28,
  limbFrom: 0.3,
  sideFrom: 0.15,
  maxLen: 1.5,
  reach: 2.6,
  maxKids: 3,
  gap: 0.66,
};

interface Node {
  p: Vec3;
  r: number;
  dir: Vec3;
  gen: number;
  kids: number;
  twig: number;
  s: number;
}

/** The grid cell (m) of colonise's node search. */
const GROW_CELL = 0.8;

/** Twigs grown from the skeleton toward attractors in the envelope (see the file header). */
export function colonise(sk: Pick<TreeSkeleton, "limbs" | "sides">, env: Envelope, salt: number, rand: () => number, o: ColoniseOptions): GrownTwig[] {
  const nodes: Node[] = [];
  const addBranchNodes = (b: Branch, from: number, id: number) => {
    let total = 0;
    const segs: number[] = [];
    for (let i = 1; i < b.pts.length; i++) {
      const l = len(sub(b.pts[i]!, b.pts[i - 1]!));
      segs.push(l);
      total += l;
    }
    for (let s = from * total; s <= total; s += o.nodeStep) {
      let acc = 0;
      for (let i = 0; i < segs.length; i++) {
        const l = segs[i]!;
        if (s <= acc + l || i === segs.length - 1) {
          const t = Math.min(1, (s - acc) / (l || 1));
          const p = lerp(b.pts[i]!, b.pts[i + 1]!, t);
          const r = b.radii[i]! + (b.radii[i + 1]! - b.radii[i]!) * t;
          nodes.push({ p, r, dir: norm(sub(b.pts[i + 1]!, b.pts[i]!)), gen: 0, kids: 0, twig: -1 - id, s: acc + l * t });
          break;
        }
        acc += l;
      }
    }
  };
  sk.limbs.forEach((l, i) => addBranchNodes(l, o.limbFrom, i));
  sk.sides.forEach((s, i) => addBranchNodes(s, o.sideFrom, sk.limbs.length + i));
  // the skeleton's branches with a bounding sphere each (the twigs must not run into another one, below)
  const skel = skeletonBranches(sk).map((b) => {
    let c: Vec3 = [0, 0, 0];
    for (const p of b.pts) c = add(c, p);
    c = mul(c, 1 / b.pts.length);
    let r = 0;
    for (const p of b.pts) r = Math.max(r, len(sub(p, c)));
    return { b, c, r };
  });
  /**
   * How far along (share of `L`) a twig from `from` toward `dirN` may run before it meets another skeleton branch than
   * its own `parent` (4 cm off its line): 1 when it meets none. A twig ending on another limb reads as a closed loop of
   * branches from under the crown (review r1, 2026-11-13: young07); it stops short of it instead.
   */
  const freeRun = (from: Vec3, dirN: Vec3, L: number, parent: number): number => {
    const mid = add(from, mul(dirN, L * 0.5));
    for (let k = 7; k <= 20; k++) {
      const t = k / 20;
      const p = add(from, mul(dirN, L * t));
      for (let j = 0; j < skel.length; j++) {
        if (j === parent) continue;
        const e = skel[j]!;
        if (len(sub(mid, e.c)) > e.r + L * 0.5 + 0.05) continue;
        if (distToPolyline(p, e.b) < 0.065) return t; // the twig bows and wiggles a little off this line
      }
    }
    return 1;
  };

  // attractors in the shell, inner ones first (twigs reaching out can then branch off the earlier ones)
  const attractors: Vec3[] = [];
  let guard = 0;
  while (attractors.length < o.attractors && guard++ < o.attractors * 60) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const rr = Math.sqrt(1 - u * u);
    const rho = o.rhoMin + o.rhoSpan * Math.sqrt(rand());
    const dir: Vec3 = [rr * Math.cos(th), u, rr * Math.sin(th)];
    const p: Vec3 = [env.c[0] + dir[0] * env.rx * rho, env.c[1] + dir[1] * (dir[1] >= 0 ? env.up : env.down) * rho, env.c[2] + dir[2] * env.rx * rho];
    if (envelopeRadius(env, p) > lumpyLimit(p, salt)) continue;
    if (isSkyGap(p, salt, o.gap)) continue;
    if (o.keepOut?.(p)) continue;
    attractors.push(p);
  }
  const axisDist = (p: Vec3) => Math.hypot(p[0] - env.c[0], (p[1] - env.c[1]) * 0.7, p[2] - env.c[2]);
  attractors.sort((a, b) => axisDist(a) - axisDist(b));

  const min2 = 0.0225;
  const max2 = o.reach * o.reach;
  const twigs: GrownTwig[] = [];
  // the nodes in a grid, searched outward ring by ring from the attractor: a node's score is at least its distance,
  // so once a ring lies farther than the best score so far nothing beyond it can win (the very node a scan of every
  // node in order would pick: equal scores go to the earlier node)
  const grid = new Map<number, number[]>();
  const cellOf = (v: number) => Math.floor(v / GROW_CELL);
  const keyOf = (i: number, j: number, k: number) => ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
  const index = (id: number) => {
    const p = nodes[id]!.p;
    const key = keyOf(cellOf(p[0]), cellOf(p[1]), cellOf(p[2]));
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push(id);
  };
  nodes.forEach((_, id) => index(id));
  const maxRing = Math.ceil(o.reach / GROW_CELL) + 1;
  for (const a of attractors) {
    let best: Node | null = null;
    let bestScore = Infinity;
    let bestId = Infinity;
    const ci = cellOf(a[0]);
    const cj = cellOf(a[1]);
    const ck = cellOf(a[2]);
    for (let ring = 0; ring <= maxRing; ring++) {
      if ((ring - 1) * GROW_CELL > bestScore) break;
      for (let i = -ring; i <= ring; i++)
        for (let j = -ring; j <= ring; j++)
          for (let k = -ring; k <= ring; k++) {
            if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== ring) continue;
            const list = grid.get(keyOf(ci + i, cj + j, ck + k));
            if (!list) continue;
            for (const id of list) {
              const n = nodes[id]!;
              const dx = a[0] - n.p[0];
              const dy = a[1] - n.p[1];
              const dz = a[2] - n.p[2];
              const l2 = dx * dx + dy * dy + dz * dz;
              if (l2 < min2 || l2 > max2) continue;
              const l = Math.sqrt(l2);
              const along = (n.dir[0] * dx + n.dir[1] * dy + n.dir[2] * dz) / l;
              const score = l * (1.35 - 0.35 * along) + n.gen * 0.05;
              if (score < bestScore || (score === bestScore && id < bestId)) {
                bestScore = score;
                bestId = id;
                best = n;
              }
            }
          }
    }
    if (!best) continue;
    best.kids++;
    if (best.kids >= o.maxKids) {
      // full: out of the search (the lists' order does not matter, ties go by id)
      const list = grid.get(keyOf(cellOf(best.p[0]), cellOf(best.p[1]), cellOf(best.p[2])))!;
      const at = list.indexOf(bestId);
      list[at] = list[list.length - 1]!;
      list.pop();
    }
    const d = sub(a, best.p);
    const dirN = norm(d);
    const L0 = Math.min(len(d), o.maxLen);
    const meet = freeRun(best.p, dirN, L0, best.twig < 0 ? -1 - best.twig : -1);
    const L = meet < 1 ? L0 * (meet - 0.15) : L0;
    // a gently bowed twig: up a little in the middle, a small sideways wiggle
    const side = norm([-dirN[2], 0, dirN[0]]);
    const wig = (rand() - 0.5) * 0.12 * L;
    if (L < 0.12) continue; // it would only be a stub against the other branch: none
    const pts: Vec3[] = [];
    const n = L > 0.7 ? 4 : 3;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const bow = Math.sin(t * Math.PI) * 0.07 * L;
      pts.push(add(add(add(best.p, mul(dirN, L * t)), [0, bow, 0]), mul(side, wig * Math.sin(t * Math.PI))));
    }
    const r0 = Math.min(best.r * 0.8, 0.0075 + 0.0045 * L);
    const radii = pts.map((_, k) => r0 + (0.0032 - r0) * (k / n));
    const id = twigs.length;
    twigs.push({ pts, radii, parent: best.twig, parentS: best.s });
    let s = 0;
    for (let k = 1; k <= n; k++) {
      s += len(sub(pts[k]!, pts[k - 1]!));
      nodes.push({ p: pts[k]!, r: radii[k]!, dir: dirN, gen: best.gen + 1, kids: 0, twig: id, s });
      index(nodes.length - 1);
    }
  }
  return twigs;
}

/** The point at arc length `s` along a polyline, and the segment's direction there. */
export function pointAt(b: Branch, s: number): { p: Vec3; dir: Vec3; r: number } {
  let acc = 0;
  for (let i = 1; i < b.pts.length; i++) {
    const a = b.pts[i - 1]!;
    const c = b.pts[i]!;
    const l = len(sub(c, a));
    if (s <= acc + l + 1e-9 || i === b.pts.length - 1) {
      const t = Math.max(0, Math.min(1, (s - acc) / (l || 1)));
      return { p: lerp(a, c, t), dir: norm(sub(c, a)), r: b.radii[i - 1]! + (b.radii[i]! - b.radii[i - 1]!) * t };
    }
    acc += l;
  }
  const n = b.pts.length;
  return { p: b.pts[n - 1]!, dir: norm(sub(b.pts[n - 1]!, b.pts[n - 2]!)), r: b.radii[n - 1]! };
}

export function polyLength(b: Branch): number {
  let l = 0;
  for (let i = 1; i < b.pts.length; i++) l += len(sub(b.pts[i]!, b.pts[i - 1]!));
  return l;
}

/** The polyline cut at arc length `s` (its radius tapering to `tip` there). */
export function cutAt(b: Branch, s: number, tip = 0.0028): Branch {
  const pts: Vec3[] = [b.pts[0]!];
  const radii: number[] = [b.radii[0]!];
  let acc = 0;
  for (let i = 1; i < b.pts.length; i++) {
    const l = len(sub(b.pts[i]!, b.pts[i - 1]!));
    if (acc + l >= s - 1e-6) {
      const t = Math.max(0, Math.min(1, (s - acc) / (l || 1)));
      pts.push(lerp(b.pts[i - 1]!, b.pts[i]!, t));
      radii.push(Math.min(tip, b.radii[i - 1]! + (b.radii[i]! - b.radii[i - 1]!) * t));
      break;
    }
    pts.push(b.pts[i]!);
    radii.push(b.radii[i]!);
    acc += l;
  }
  return { pts, radii };
}

/** Where a cluster hangs: the branch (>= 0 a twig, < 0 the skeleton branch -1 - k) and the arc length on it. */
export interface Hang {
  twig: number;
  s: number;
}

/**
 * Cut back every twig to its outermost cluster or child twig (+ `over` m, the twig ends inside its cluster), drop
 * twigs with neither, and renumber what is left. Twigs are visited last first (children come after their parents).
 * Returns the kept twigs and the old -> new index map (-1: dropped).
 */
export function pruneTwigs(twigs: readonly GrownTwig[], hangs: readonly Hang[], over = 0.02): { twigs: GrownTwig[]; map: Int32Array } {
  const n = twigs.length;
  const reach = new Float64Array(n).fill(-1);
  for (const h of hangs) if (h.twig >= 0) reach[h.twig] = Math.max(reach[h.twig]!, h.s + over);
  const keep = new Uint8Array(n);
  const cut: Array<GrownTwig | null> = new Array(n).fill(null);
  for (let i = n - 1; i >= 0; i--) {
    const t = twigs[i]!;
    if (reach[i]! < 0) continue; // no cluster and no kept child: dropped
    keep[i] = 1;
    const total = polyLength(t);
    cut[i] = reach[i]! >= total - 1e-6 ? t : { ...cutAt(t, Math.max(0.03, reach[i]!)), parent: t.parent, parentS: t.parentS };
    if (t.parent >= 0) reach[t.parent] = Math.max(reach[t.parent]!, t.parentS);
  }
  const map = new Int32Array(n).fill(-1);
  const out: GrownTwig[] = [];
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    map[i] = out.length;
    out.push(cut[i]!);
  }
  for (const t of out) if (t.parent >= 0) t.parent = map[t.parent]!;
  return { twigs: out, map };
}

/** Distance from a point to a polyline. */
export function distToPolyline(p: Vec3, b: Branch): number {
  let best = Infinity;
  for (let i = 1; i < b.pts.length; i++) {
    const a = b.pts[i - 1]!;
    const ab = sub(b.pts[i]!, a);
    const l2 = dot(ab, ab);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
    const d = len(sub(p, add(a, mul(ab, t))));
    if (d < best) best = d;
  }
  return best;
}

/** A cluster as the connection check sees it: where it is attached, its size, the branch it hangs on. */
export interface Attached {
  x: number;
  y: number;
  z: number;
  size: number;
  twig: number;
}

export interface Connection {
  clusters: number;
  twigs: number;
  /** Largest distance (m) from a cluster's attachment to the branch it hangs on. */
  maxGap: number;
  /** Clusters with no branch (an index that is not a twig or a skeleton branch). */
  unattached: number;
  /** Grown twigs whose tip has no cluster within half its size and no other twig starting within 5 cm. */
  bareTips: number;
}

/** The crown's connection measures (see the file header). */
export function crownConnection(skeleton: readonly Branch[], twigs: readonly GrownTwig[], clusters: readonly Attached[]): Connection {
  let maxGap = 0;
  let unattached = 0;
  const cell = 0.5;
  const grid = new Map<string, Attached[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const c of clusters) {
    const b = c.twig >= 0 ? twigs[c.twig] : skeleton[-1 - c.twig];
    if (!b) {
      unattached++;
      continue;
    }
    maxGap = Math.max(maxGap, distToPolyline([c.x, c.y, c.z], b));
    const k = key(c.x, c.y, c.z);
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(c);
  }
  const starts = new Map<string, Vec3[]>();
  for (const t of twigs) {
    const p = t.pts[0]!;
    const k = key(p[0], p[1], p[2]);
    let list = starts.get(k);
    if (!list) starts.set(k, (list = []));
    list.push(p);
  }
  let bareTips = 0;
  for (const t of twigs) {
    const tip = t.pts[t.pts.length - 1]!;
    const i0 = Math.floor(tip[0] / cell);
    const j0 = Math.floor(tip[1] / cell);
    const k0 = Math.floor(tip[2] / cell);
    let covered = false;
    for (let i = -1; i <= 1 && !covered; i++)
      for (let j = -1; j <= 1 && !covered; j++)
        for (let k = -1; k <= 1 && !covered; k++) {
          const kk = `${i0 + i},${j0 + j},${k0 + k}`;
          for (const c of grid.get(kk) ?? []) {
            if (Math.hypot(c.x - tip[0], c.y - tip[1], c.z - tip[2]) <= Math.max(0.05, c.size * 0.5)) {
              covered = true;
              break;
            }
          }
          if (!covered)
            for (const s of starts.get(kk) ?? []) {
              if (s !== t.pts[0] && Math.hypot(s[0] - tip[0], s[1] - tip[1], s[2] - tip[2]) <= 0.05) {
                covered = true;
                break;
              }
            }
        }
    if (!covered) bareTips++;
  }
  return { clusters: clusters.length, twigs: twigs.length, maxGap, unattached, bareTips };
}

/** Below this (the y of the unit direction from the crown's centre) a branch point is on the crown's underside. */
const UNDERSIDE = -0.35;
/** Past this normalised radius a branch point is in the crown's outer shell. */
const OUTER_SHELL = 0.82;

/** A bare stretch of a branch on the crown's outside (crownGrowth.pokingRuns). */
export interface PokingRun {
  /** The branch (as `Attached.twig`: >= 0 a twig, < 0 the skeleton branch -1 - k) and the run's length (m). */
  branch: number;
  length: number;
  /** Where the run ends (its outer end). */
  at: Vec3;
}

/**
 * Bare branch poking out of the crown (the owner, 2026-11-13: no limb may stick out of a crown with a leaf at its tip):
 * every branch is sampled every 5 cm; a sample is bare when no cluster is within `reach` m of it, and on the outside
 * when no cluster lies beyond it on the line from the crown's centre out through it (within `cover` m of that line):
 * nothing hides it from a viewer outside the crown; in the crown's outer shell (normalised radius > 0.82) every bare
 * point counts (seen from below or the side it stands against the sky). The crown's underside is left out: the limbs seen from under a
 * tree are bare in a real one too. A run is a stretch of samples that are both. Returns every run of
 * at least `min` m. Slow (every sample against every cluster): for the tests and checks only.
 */
export function pokingRuns(skeleton: readonly Branch[], twigs: readonly Branch[], clusters: readonly Vec3[], env: Envelope, reach: number, min = 0.25, cover = 0.45): PokingRun[] {
  const cell = Math.max(0.2, reach);
  const grid = new Map<string, Vec3[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const c of clusters) {
    const k = key(c[0], c[1], c[2]);
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(c);
  }
  const bare = (p: Vec3) => {
    const i0 = Math.floor(p[0] / cell);
    const j0 = Math.floor(p[1] / cell);
    const k0 = Math.floor(p[2] / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++)
          for (const c of grid.get(`${i0 + i},${j0 + j},${k0 + k}`) ?? []) if (Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) <= reach) return false;
    return true;
  };
  const outside = (p: Vec3) => {
    const u = norm(sub(p, env.c));
    // the crown's underside (limbs seen from under the tree against the sky) may be bare, as a real tree's is
    if (u[1] < UNDERSIDE) return false;
    // in the crown's outer shell a bare stretch shows against the sky from below or the side whatever lies beyond it
    if (envelopeRadius(env, p) > OUTER_SHELL) return true;
    for (const c of clusters) {
      const d = sub(c, p);
      const t = dot(d, u);
      if (t > 0 && dot(d, d) - t * t < cover * cover) return false;
    }
    return true;
  };
  const out: PokingRun[] = [];
  const scan = (b: Branch, id: number) => {
    const total = polyLength(b);
    let run = 0;
    let last: Vec3 = b.pts[0]!;
    const flush = () => {
      if (run >= min) out.push({ branch: id, length: run, at: last });
      run = 0;
    };
    for (let s = 0; s <= total + 1e-9; s += 0.05) {
      const p = pointAt(b, Math.min(s, total)).p;
      if (bare(p) && outside(p)) {
        run += 0.05;
        last = p;
      } else flush();
    }
    flush();
  };
  skeleton.forEach((b, i) => scan(b, -1 - i));
  twigs.forEach((b, i) => scan(b, i));
  return out;
}

/**
 * Dress the bare stretches of `branches` that show from outside the crown (as `pokingRuns` sees them): each branch is
 * walked from its tip in, `step` m at a time, and where a point is bare (no cluster within `reach`) and on the outside
 * (no cluster beyond it within `cover` of the line from the crown's centre), `place` hangs foliage there and returns
 * the clusters it added (none: the point stays bare, e.g. a house's keep-out). `clusters` is added to in place.
 */
export function dressExposed(
  branches: readonly Branch[],
  clusters: Vec3[],
  env: Envelope,
  o: { reach: number; cover: number; step: number },
  place: (branch: number, s: number, p: Vec3, dir: Vec3) => Vec3[],
): number {
  const cell = Math.max(0.2, o.reach);
  const grid = new Map<number, Vec3[]>();
  const key = (i: number, j: number, k: number) => ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096);
  const put = (c: Vec3) => {
    const k = key(Math.floor(c[0] / cell), Math.floor(c[1] / cell), Math.floor(c[2] / cell));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(c);
  };
  clusters.forEach(put);
  const bare = (p: Vec3) => {
    const i0 = Math.floor(p[0] / cell);
    const j0 = Math.floor(p[1] / cell);
    const k0 = Math.floor(p[2] / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++)
          for (const c of grid.get(key(i0 + i, j0 + j, k0 + k)) ?? []) if ((c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2 <= o.reach * o.reach) return false;
    return true;
  };
  const outside = (p: Vec3) => {
    const u = norm(sub(p, env.c));
    // the crown's underside (limbs seen from under the tree against the sky) may be bare, as a real tree's is
    if (u[1] < UNDERSIDE) return false;
    // in the crown's outer shell a bare stretch shows against the sky from below or the side whatever lies beyond it
    if (envelopeRadius(env, p) > OUTER_SHELL) return true;
    for (const c of clusters) {
      const d = sub(c, p);
      const t = dot(d, u);
      if (t > 0 && dot(d, d) - t * t < o.cover * o.cover) return false;
    }
    return true;
  };
  let added = 0;
  branches.forEach((b, i) => {
    const total = polyLength(b);
    for (let s = total; s >= 0; s -= o.step) {
      const at = pointAt(b, s);
      if (!bare(at.p) || !outside(at.p)) continue;
      for (const c of place(i, s, at.p, at.dir)) {
        clusters.push(c);
        put(c);
        added++;
      }
    }
  });
  return added;
}
