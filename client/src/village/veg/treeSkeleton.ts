import { PyRandom } from "./vegRandom";
import type { Vec3 } from "./vegLod";

/**
 * Every tree the village file has, replayed exactly (veg3d). Pure and seeded: unit-tested against the art script.
 *
 * `art/village/tools/parts_trees.tree(F, x, z, kind, H, R, seed, trunk_r, y0)` drew each tree with Python's
 * `random.Random(seed)`: the trunk, the limbs and two side branches per limb as bark (light-mapped `LM_bark` for the
 * trees placed one by one, `M_bark` for the instanced variants), then the canopy as flat leaf cards round the limbs'
 * ends and a shell of points on the crown's ellipsoid. `treeSkeleton` makes the same calls in the same order
 * (`PyRandom`) and so gets the very limbs the file has (every limb and side tip within the tubes' 2 cm end radius of
 * the baked bark, checked against `village.glb`), and the very cards (their centres within a millimetre), so the cards
 * can be found and hidden exactly and the new crowns grow out of the real limbs.
 *
 * Coordinates: the script works in Blender space (`vlib.V(x, z, y)` = Blender (x, -z, y)); the glTF export turns
 * Blender (x, y, z) into game (x, z, -y). Everything returned here is in game space (y up).
 */

export type TreeKind = "cherry" | "zelkova" | "green" | "young" | "willow" | "orchard";

/** parts_trees.KINDS: fork height (share of H), limbs, leaf-card size range, shell points, cards per cluster. */
export const TREE_KINDS: Readonly<Record<TreeKind, { fork: number; limbs: number; card: [number, number]; shell: number; per: number; trunkR: number }>> = {
  cherry: { fork: 0.36, limbs: 5, card: [2.2, 3.0], shell: 84, per: 4, trunkR: 0.13 },
  zelkova: { fork: 0.3, limbs: 7, card: [2.4, 3.3], shell: 70, per: 3, trunkR: 0.7 },
  green: { fork: 0.38, limbs: 5, card: [1.7, 2.4], shell: 24, per: 3, trunkR: 0.14 },
  young: { fork: 0.45, limbs: 4, card: [0.9, 1.3], shell: 8, per: 3, trunkR: 0.05 },
  willow: { fork: 0.35, limbs: 6, card: [1.6, 2.4], shell: 26, per: 3, trunkR: 0.2 },
  orchard: { fork: 0.42, limbs: 4, card: [1.2, 1.6], shell: 16, per: 3, trunkR: 0.08 },
};

/** A branch as a polyline with a radius at each point (game coordinates: y up). */
export interface Branch {
  pts: Vec3[];
  radii: number[];
}

export interface TreeSpec {
  /** A unique id (stats, seeds of the runtime's own randomness). */
  index: number;
  kind: TreeKind;
  x: number;
  z: number;
  H: number;
  R: number;
  seed: number;
  trunkR?: number;
  y0?: number;
}

/** A leaf card the art script drew (centre, game space; size). */
export interface BakedCard {
  c: Vec3;
  s: number;
}

export interface TreeSkeleton {
  index: number;
  kind: TreeKind;
  /** Trunk base (on the ground, or the planter's soil). */
  base: Vec3;
  fork: Vec3;
  H: number;
  R: number;
  /** The old crown's centre and half-height (parts_trees: crown_c, crown_h). */
  crownC: Vec3;
  crownH: number;
  /** The trunk tube (4 points, from 0.15 m under the ground to the fork). */
  trunk: Branch;
  /** The limbs and their two side branches each, as the file has them. */
  limbs: Branch[];
  sides: Branch[];
  /** The canopy cards (to be hidden) and, for cherries and orchards, the petal cards lying on the ground (kept). */
  cards: BakedCard[];
  petals: BakedCard[];
}

/** Blender (x, y, z) -> game (x, z, -y). */
const g = (b: Vec3): Vec3 => [b[0], b[2], -b[1]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const deg = (d: number) => (d * Math.PI) / 180;

/** Replay `parts_trees.tree(F, x, z, kind, H, R, seed, trunk_r, y0)` (lean 0), cards included. */
export function treeSkeleton(spec: TreeSpec): TreeSkeleton {
  const { kind, H, R } = spec;
  const k = TREE_KINDS[kind];
  const rng = new PyRandom(spec.seed);
  const trunkR = spec.trunkR ?? k.trunkR;
  // Blender space from here (z up, y = -game z), exactly as the script
  const base: Vec3 = [spec.x, -spec.z, spec.y0 ?? 0];
  const forkH = H * k.fork;
  const la = rng.uniform(0, 2 * Math.PI);
  const leanv = mul([Math.cos(la), Math.sin(la), 0], (kind !== "zelkova" ? 0.06 : 0.1) * forkH);
  const tp: Vec3[] = [
    add(base, [0, 0, -0.15]),
    add(add(base, [0, 0, forkH * 0.35]), mul(leanv, 0.3)),
    add(add(base, [0, 0, forkH * 0.7]), mul(leanv, 0.7)),
    add(add(base, [0, 0, forkH]), leanv),
  ];
  const tr = [trunkR * (kind === "zelkova" ? 1.5 : 1.25), trunkR, trunkR * 0.92, trunkR * 0.8];
  const fork = tp[3]!;
  const crownC = add(add(base, [0, 0, forkH + (H - forkH) * 0.5]), leanv);
  const crownH = (H - forkH) * 0.6;
  const clusters: Vec3[] = [];
  const limbs: Branch[] = [];
  const sides: Branch[] = [];
  for (let i = 0; i < k.limbs; i++) {
    const az = (2 * Math.PI * i) / k.limbs + rng.uniform(-0.3, 0.3);
    let el = deg(kind !== "willow" ? rng.uniform(30, 58) : rng.uniform(40, 65));
    if (kind === "zelkova") el = deg(rng.uniform(28, 50));
    const d: Vec3 = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
    let Lb = (R * rng.uniform(0.75, 0.95)) / Math.max(0.35, Math.cos(el));
    Lb = Math.min(Lb, (H - forkH) * 1.1);
    const p0 = sub(fork, [0, 0, 0.1]);
    const p1 = add(p0, mul(d, Lb * 0.35));
    const p2 = add(add(p0, mul(d, Lb * 0.7)), [0, 0, Lb * 0.06]);
    const p3 = add(add(p0, mul(d, Lb)), [0, 0, kind !== "willow" ? -Lb * 0.05 : -Lb * 0.12]);
    const r0 = trunkR * 0.55;
    // the file ends every limb 2 cm thick and every side branch 1.2 cm (a young tree's limb hardly tapers at all): the
    // runtime draws them tapering on to a fine tip, as real ones do (review r1, 2026-11-13: sawn-off ends from below)
    limbs.push({ pts: [p0, p1, p2, p3].map(g), radii: [r0, r0 * 0.7, r0 * 0.45, Math.min(0.02, r0 * 0.16)] });
    clusters.push(p3, p2);
    for (let j = 0; j < 2; j++) {
      const t = rng.uniform(0.45, 0.8);
      const q0 = t < 0.6 ? lerp(p1, p2, t) : lerp(p2, p3, t - 0.5);
      const az2 = az + rng.uniform(-0.9, 0.9);
      const el2 = el + rng.uniform(-0.2, 0.4);
      const d2: Vec3 = [Math.cos(az2) * Math.cos(el2), Math.sin(az2) * Math.cos(el2), Math.sin(el2)];
      const q1 = add(q0, mul(d2, Lb * 0.45));
      sides.push({ pts: [q0, lerp(q0, q1, 0.5), q1].map(g), radii: [r0 * 0.3, r0 * 0.18, Math.min(0.012, r0 * 0.1)] });
      clusters.push(q1);
    }
  }
  // the silhouette shell points on the crown's ellipsoid
  for (let i = 0; i < k.shell; i++) {
    const u = rng.uniform(-0.35, 1.0);
    const th = rng.uniform(0, 2 * Math.PI);
    const rr = Math.sqrt(Math.max(0, 1 - u * u));
    clusters.push(add(crownC, [Math.cos(th) * rr * R * 0.92, Math.sin(th) * rr * R * 0.92, u * crownH * 0.9]));
  }
  // the canopy cards: only their centres and sizes are kept, but every draw is made (the sequence must not slip)
  const cards: BakedCard[] = [];
  const blossom = kind === "cherry" || kind === "orchard";
  for (const p of clusters) {
    for (let j = 0; j < k.per; j++) {
      rng.random(); // n: 3 uniforms
      rng.random();
      rng.random();
      rng.random(); // up: 2 uniforms
      rng.random();
      const s = rng.uniform(k.card[0], k.card[1]);
      const jx = rng.uniform(-0.3, 0.3);
      const jy = rng.uniform(-0.3, 0.3);
      const jz = rng.uniform(-0.2, 0.2);
      rng.randrange(kind === "cherry" ? 3 : 4);
      cards.push({ c: g(add(p, [jx * s, jy * s, jz * s])), s });
    }
  }
  const petals: BakedCard[] = [];
  if (blossom) {
    for (let j = 0; j < 5; j++) {
      const a = rng.uniform(0, 2 * Math.PI);
      const rr = rng.uniform(0.6, R * 0.9);
      const s = rng.uniform(1.2, 2.0);
      petals.push({ c: g(add(base, [Math.cos(a) * rr, -Math.sin(a) * rr, (spec.y0 ?? 0) < 0.1 ? 0.015 : 0])), s });
    }
  }
  return {
    index: spec.index,
    kind,
    base: g(base),
    fork: g(fork),
    H,
    R,
    crownC: g(crownC),
    crownH,
    trunk: { pts: tp.map(g), radii: tr },
    limbs,
    sides,
    cards,
    petals,
  };
}

/** `parts_trees.shrub(F, x, z, H, R, seed, y0)`: the 12 card centres and sizes, and the bush's centre (game space). */
export function shrubCards(x: number, z: number, H: number, R: number, seed: number, y0 = 0): { centre: Vec3; cards: BakedCard[] } {
  const rng = new PyRandom(seed);
  const cc: Vec3 = [x, -z, y0 + H * 0.5];
  const cards: BakedCard[] = [];
  for (let i = 0; i < 12; i++) {
    const p = add(cc, [rng.uniform(-R, R) * 0.7, rng.uniform(-R, R) * 0.7, rng.uniform(-H, H) * 0.25]);
    rng.random(); // n: 3 uniforms
    rng.random();
    rng.random();
    const s = rng.uniform(0.8, 1.15) * Math.max(H, R * 1.6);
    rng.randrange(4);
    cards.push({ c: g(p), s });
  }
  return { centre: g(cc), cards };
}

// ─────────────────────────────────────────── the village's trees ───────────────────────────────────────────

/** parts_trees.plaza_trees: six cherries on the 19 m ring, in round planters 0.38 m high. */
export const PLAZA_CHERRY_ANGLES = [-118, -62, -16, 40, 65, 138] as const;
export const PLAZA_CHERRY_RING = 19;
export const PLAZA_CHERRY_Y0 = 0.38;

export const PLAZA_CHERRY_SPECS: readonly TreeSpec[] = PLAZA_CHERRY_ANGLES.map((d, i) => ({
  index: i,
  kind: "cherry" as const,
  x: PLAZA_CHERRY_RING * Math.cos(deg(d)),
  z: PLAZA_CHERRY_RING * Math.sin(deg(d)),
  H: 6.2 + (i % 3) * 0.4,
  R: 3.0,
  seed: 100 + i,
  y0: PLAZA_CHERRY_Y0,
}));

/** The plaza zelkova (round deck at (-25, -5)): removed at the owner's word, only its parts are needed to hide them. */
export const PLAZA_ZELKOVA_SPEC: TreeSpec = { index: 99, kind: "zelkova", x: -25, z: -5, H: 13.5, R: 8.5, seed: 7, trunkR: 0.62 };

/** parts_trees.village_trees: (kind, x, z, H, R), seed 300 + its place in this list (cherries and greens together). */
const VILLAGE_SPOTS: ReadonlyArray<[TreeKind, number, number, number, number]> = [
  ["cherry", -13.5, 36.0, 6.0, 2.9], ["cherry", -15.5, 44.5, 6.4, 3.0], ["cherry", -27.5, 52.0, 6.0, 2.8],
  ["cherry", -20.0, 58.0, 5.8, 2.7],
  ["green", 35.5, 41.5, 8.0, 3.4], ["cherry", 23.0, 42.5, 5.8, 2.7],
  ["green", -35.0, 42.0, 8.4, 3.5], ["cherry", -31.0, 46.5, 5.6, 2.6], ["green", -52.0, -14.0, 8.0, 3.3],
  ["cherry", -51.5, -1.0, 6.0, 2.8], ["green", 54.5, -6.5, 8.6, 3.5], ["cherry", 55.0, -19.5, 6.2, 2.8],
  ["green", 70.0, -15.0, 9.0, 3.8], ["green", 74.0, 2.0, 8.0, 3.4], ["green", -70.0, -12.0, 9.2, 3.8],
  ["green", -73.0, 0.0, 8.2, 3.4], ["green", 30.0, -62.0, 9.0, 3.8], ["green", -30.0, -62.0, 8.6, 3.6],
  ["green", 60.0, 45.0, 9.0, 3.8], ["green", -60.0, 45.0, 8.8, 3.7], ["cherry", 18.0, 62.0, 6.0, 2.8],
  ["cherry", 70.0, 30.0, 6.0, 2.8], ["cherry", -72.0, 30.0, 6.2, 2.8], ["green", 80.0, -45.0, 9.0, 3.6],
  ["green", -80.0, -48.0, 9.0, 3.6], ["green", 45.0, -70.0, 8.8, 3.6], ["green", -46.0, -70.0, 8.8, 3.6],
];

export const VILLAGE_TREE_SPECS: readonly TreeSpec[] = VILLAGE_SPOTS.map(([kind, x, z, H, R], i) => ({ index: 100 + i, kind, x, z, H, R, seed: 300 + i }));

/** The creek willows on the banks: tree(F, x, z, "willow", 8.5, 3.6, 400 + i). */
export const WILLOW_SPECS: readonly TreeSpec[] = [
  [-60.0, 66.6],
  [-10.0, 70.0],
  [38.0, 71.0],
  [70.0, 68.0],
].map(([x, z], i) => ({ index: 200 + i, kind: "willow" as const, x: x!, z: z!, H: 8.5, R: 3.6, seed: 400 + i }));

/** The memorial's young trees (parts_buildings.memorial): tree(F, x, z, "young", H, H * 0.32, 500 + i). */
export const YOUNG_SPECS: readonly TreeSpec[] = (() => {
  const spots: Array<[number, number, number]> = [];
  for (const zz of [-51.5, -56.0, -60.5]) spots.push([-8.2, zz, 2.9], [8.2, zz, 2.7]);
  for (const xx of [-6.0, -2.0, 2.0, 6.0]) spots.push([xx, -65.6, 2.6]);
  return spots.map(([x, z, H], i) => ({ index: 300 + i, kind: "young" as const, x, z, H, R: H * 0.32, seed: 500 + i }));
})();

/** The instanced variants (parts_fill.fill), each drawn once at the origin and placed by the file's instance matrices. */
export const VARIANT_SPECS = {
  street_green: { index: 400, kind: "green", x: 0, z: 0, H: 6.8, R: 2.4, seed: 11, trunkR: 0.1 },
  street_cherry: { index: 401, kind: "cherry", x: 0, z: 0, H: 5.6, R: 2.5, seed: 12, trunkR: 0.1 },
  orchard: { index: 402, kind: "orchard", x: 0, z: 0, H: 3.8, R: 1.8, seed: 13, trunkR: 0.08 },
} as const satisfies Record<string, TreeSpec>;

/** The instanced shrub variant: shrub(F, 0, 0, 0.9, 0.6, 14). */
export const SHRUB_VARIANT = { H: 0.9, R: 0.6, seed: 14 } as const;

/** Length of a polyline. */
export function branchLength(b: Branch): number {
  let l = 0;
  for (let i = 1; i < b.pts.length; i++) l += len(sub(b.pts[i]!, b.pts[i - 1]!));
  return l;
}
