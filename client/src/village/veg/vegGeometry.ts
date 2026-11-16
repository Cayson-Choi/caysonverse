import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from "three";
import { TUFT, linearHex } from "./flowerPlacement";
import { mulberry32 } from "./vegRandom";
import { SOLID_UV } from "./plantCells";
import type { Vec3 } from "./vegLod";

/**
 * The runtime vegetation's meshes (veg3d), built in code: no texture cards standing in for many plants. Every leaf,
 * petal and flower is its own small piece of geometry with real depth (folded leaves, funnel-shaped petunias, cupped
 * pansy petals, bell spikes, tulip cups), so a bed reads as plants from any angle, close up and from above.
 *
 * Vertex attributes (the vegetation material, vegMaterial.ts, reads them):
 *  - `color` (rgba, linear): rgb is the albedo; a is how much the instance's colour (`instanceColor`, the flower's
 *    colour) multiplies it: 1 on petals, 0 on leaves, stems and the dark blotches and eyes that keep their own colour;
 *  - `aWind`: how far the vertex moves in the wind (0 at the ground, 1 at the top of the plant);
 *  - `aLight`: 1 (the instance's light multiplies it; the twigs carry their own light here instead);
 *  - `uv`: the cherry's blossom pieces use the blossom atlas (vegAtlas.ts); the grass tufts the plant atlas's white
 *    cell (they are drawn with the bedding plants, vegPlants.ts / vegPlantAtlas.ts).
 * Sizes are real: metres, a petunia mound 25-30 cm across, its flowers 5-6 cm.
 */

export type Rgba = [number, number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Two unit vectors perpendicular to `n` (and each other). */
export function basis(n: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t = norm(cross(helper, n));
  const b = cross(n, t);
  return [t, b];
}

/** sRGB hex -> linear rgba with a tint weight. */
export const rgba = (hex: string, tint = 0, k = 1): Rgba => {
  const c = linearHex(hex);
  return [c[0] * k, c[1] * k, c[2] * k, tint];
};
export const mix = (a: Rgba, b: Rgba, t: number): Rgba => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
  a[3] + (b[3] - a[3]) * t,
];

/** Collects vertices and triangles, then makes a BufferGeometry. */
export class GeoBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];
  readonly wind: number[] = [];
  readonly light: number[] = [];
  readonly idx: number[] = [];
  /** Wind weight given to vertices by height (m) when no weight is passed: y / windHeight. */
  windHeight = 0.3;
  /** The uv of vertices given none (the plant atlas's white cell for the plants: plantCells.SOLID_UV). */
  defaultUv: [number, number] = [0.5, 0.5];

  get vertexCount(): number {
    return this.pos.length / 3;
  }
  get triangleCount(): number {
    return this.idx.length / 3;
  }

  v(p: Vec3, n: Vec3, c: Rgba, uv: [number, number] = this.defaultUv, wind?: number, light = 1): number {
    this.pos.push(p[0], p[1], p[2]);
    const nn = norm(n);
    this.nrm.push(nn[0], nn[1], nn[2]);
    this.col.push(c[0], c[1], c[2], c[3]);
    this.uv.push(uv[0], uv[1]);
    this.wind.push(wind ?? Math.max(0, Math.min(1, p[1] / this.windHeight)));
    this.light.push(light);
    return this.vertexCount - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 4));
    g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    g.setAttribute("aWind", new Float32BufferAttribute(this.wind, 1));
    g.setAttribute("aLight", new Float32BufferAttribute(this.light, 1));
    g.setIndex(this.vertexCount > 65535 ? new Uint32BufferAttribute(this.idx, 1) : new Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ─────────────────────────────────────────────── parts ───────────────────────────────────────────────

const LEAF = {
  dark: rgba("#2F5A1E"),
  mid: rgba("#4C7F2A"),
  light: rgba("#79A548"),
  stem: rgba("#5E8A35"),
};

/**
 * A leaf folded along its midrib (a shallow V: the two halves rise from the rib), drooping toward its tip. 8 triangles
 * (`detail` 1) or 2 (`detail` 0: a folded diamond). Ovate unless `strap` (a long narrow strap: tulip, muscari).
 * `detail` 2 (16 triangles): a real leaf's outline for the nearest look (a young tree's leaves 0.5 m from the eye,
 * review r1 2026-11-13: the 8-triangle blade read as a flat diamond plate there): a rounded base, widest a third of the
 * way up, a drawn-out tip, and its edges curling down a little.
 */
export function leaf(
  b: GeoBuilder,
  base: Vec3,
  dir: Vec3,
  up: Vec3,
  length: number,
  width: number,
  opts: { fold?: number; droop?: number; detail?: 0 | 1 | 2; strap?: boolean; colour?: { rib: Rgba; edge: Rgba; base: Rgba } } = {},
): void {
  const fold = opts.fold ?? 0.35;
  const droop = opts.droop ?? 0.25;
  const d = norm(dir);
  const side = norm(cross(d, up));
  const n = norm(cross(side, d));
  const c = opts.colour ?? { rib: LEAF.light, edge: LEAF.mid, base: LEAF.dark };
  const at = (t: number, s: number): Vec3 => {
    // along the leaf t (0..1), across s (-1..1 of half width)
    const hw = width / 2;
    const w = opts.strap ? hw * (1 - 0.7 * t * t) : hw * Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.8;
    const drop = -droop * length * t * t;
    const lift = fold * w * Math.abs(s);
    return add(add(add(base, mul(d, length * t)), mul(side, w * s)), mul(n, drop + lift));
  };
  const nl = norm(add(n, mul(side, fold)));
  const nr = norm(sub(n, mul(side, fold)));
  if ((opts.detail ?? 1) === 0) {
    const v0 = b.v(base, n, c.base);
    const v1 = b.v(at(0.45, -1), nl, c.edge);
    const v2 = b.v(at(1, 0), n, c.rib);
    const v3 = b.v(at(0.45, 1), nr, c.edge);
    b.tri(v0, v1, v2);
    b.tri(v0, v2, v3);
    return;
  }
  if (opts.detail === 2 && !opts.strap) {
    // the ovate outline: half width at t (0..1), widest near 0.35, round at the base, drawn out to the tip
    const hw = width / 2;
    const half = (t: number) => hw * 1.08 * Math.sin(Math.PI * Math.min(1, t ** 0.78)) ** 0.75;
    const edge = (t: number, s: -1 | 1): Vec3 => {
      const w = half(t);
      const drop = -droop * length * t * t;
      // the halves rise from the rib (the fold) and their outer edge curls back down a little
      const lift = fold * w * 0.8 - 0.18 * w;
      return add(add(add(base, mul(d, length * t)), mul(side, w * s)), mul(n, drop + lift));
    };
    const rib = (t: number): Vec3 => add(add(base, mul(d, length * t)), mul(n, -droop * length * t * t));
    const rows = [0.12, 0.34, 0.58, 0.8];
    const m0 = b.v(base, n, c.base);
    const L: number[] = [];
    const M: number[] = [];
    const R: number[] = [];
    rows.forEach((t, i) => {
      const k = i / (rows.length - 1);
      L.push(b.v(edge(t, -1), nl, mix(mix(c.base, c.edge, 0.6), c.edge, k)));
      M.push(b.v(rib(t), n, mix(mix(c.base, c.rib, 0.7), c.rib, k)));
      R.push(b.v(edge(t, 1), nr, mix(mix(c.base, c.edge, 0.6), c.edge, k)));
    });
    const tip = b.v(rib(1), n, c.edge);
    b.tri(m0, L[0]!, M[0]!);
    b.tri(m0, M[0]!, R[0]!);
    for (let i = 0; i + 1 < rows.length; i++) {
      b.tri(L[i]!, L[i + 1]!, M[i + 1]!);
      b.tri(L[i]!, M[i + 1]!, M[i]!);
      b.tri(M[i]!, M[i + 1]!, R[i + 1]!);
      b.tri(M[i]!, R[i + 1]!, R[i]!);
    }
    b.tri(L[rows.length - 1]!, tip, M[rows.length - 1]!);
    b.tri(M[rows.length - 1]!, tip, R[rows.length - 1]!);
    return;
  }
  const m0 = b.v(base, n, c.base);
  const l1 = b.v(at(0.3, -1), nl, mix(c.base, c.edge, 0.6));
  const r1 = b.v(at(0.3, 1), nr, mix(c.base, c.edge, 0.6));
  const m1 = b.v(at(0.3, 0), n, mix(c.base, c.rib, 0.7));
  const l2 = b.v(at(0.68, -1), nl, c.edge);
  const r2 = b.v(at(0.68, 1), nr, c.edge);
  const m2 = b.v(at(0.68, 0), n, c.rib);
  const tip = b.v(at(1, 0), n, c.edge);
  b.tri(m0, l1, m1);
  b.tri(m0, m1, r1);
  b.tri(l1, l2, m2);
  b.tri(l1, m2, m1);
  b.tri(m1, m2, r2);
  b.tri(m1, r2, r1);
  b.tri(l2, tip, m2);
  b.tri(m2, tip, r2);
}

/** A thin stalk: an n-sided tube along a polyline (3 sides for stems, more for spikes). */
export function tube(b: GeoBuilder, pts: Vec3[], radii: number[], sides: number, colour: (t: number, around: number) => Rgba, wind?: (t: number) => number, light?: (p: Vec3, n: Vec3) => number): void {
  if (pts.length < 2) return;
  let [tx] = basis(norm(sub(pts[1]!, pts[0]!)));
  const rings: number[][] = [];
  for (let i = 0; i < pts.length; i++) {
    const d = norm(i === 0 ? sub(pts[1]!, pts[0]!) : i === pts.length - 1 ? sub(pts[i]!, pts[i - 1]!) : sub(pts[i + 1]!, pts[i - 1]!));
    // parallel transport of the frame
    tx = norm(sub(tx, mul(d, dot(tx, d))));
    const ty = cross(d, tx);
    const ring: number[] = [];
    const t = i / (pts.length - 1);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const nrm = add(mul(tx, Math.cos(a)), mul(ty, Math.sin(a)));
      const p = add(pts[i]!, mul(nrm, radii[i]!));
      ring.push(b.v(p, nrm, colour(t, nrm[1]), b.defaultUv, wind ? wind(t) : undefined, light ? light(p, nrm) : 1));
    }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < rings.length; i++) {
    const r0 = rings[i]!;
    const r1 = rings[i + 1]!;
    for (let s = 0; s < sides; s++) {
      const s1 = (s + 1) % sides;
      b.tri(r0[s]!, r1[s]!, r1[s1]!);
      b.tri(r0[s]!, r1[s1]!, r0[s1]!);
    }
  }
}

// ─────────────────── grass and reeds (the bedding plants and the bushes: vegPlants.ts, 2026-11-16) ───────────────────

/**
 * A tuft of grass (or a clump of reeds by the water): blades rising from one root, spreading and arching out, each a
 * narrow blade folded along its middle (a shallow V, so it has body seen edge-on), tapering to a point. Seen from any
 * side or above it is a tuft, not a card or a ball. `simple`: fewer, plainer blades (mid distance).
 */
export function grassTuft(simple: boolean, kind: "grass" | "reed" = "grass", seed = 31): BufferGeometry {
  const b = new GeoBuilder();
  b.defaultUv = SOLID_UV; // drawn with the plants (the plant atlas's white cell)
  const { h: H, r: R } = TUFT[kind];
  b.windHeight = H;
  const rand = mulberry32(seed + (kind === "reed" ? 7 : 0));
  const blades = simple ? (kind === "reed" ? 9 : 10) : kind === "reed" ? 18 : 22;
  const rings = simple ? 2 : 4;
  const colours =
    kind === "reed"
      ? { base: rgba("#4A5A26", 1), mid: rgba("#73843A", 1), tip: rgba("#A5A55A", 1) }
      : { base: rgba("#2E5418", 1), mid: rgba("#5A8A2C", 1), tip: rgba("#9DBA55", 1) };
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + rand() * 0.9;
    const out: Vec3 = [Math.cos(a), 0, Math.sin(a)];
    // inner blades stand up, outer ones arch out further
    const spread = 0.25 + 0.75 * rand();
    const h = H * (0.55 + 0.45 * rand()) * (1 - 0.25 * spread);
    const reach = R * spread * (0.8 + 0.4 * rand());
    const root: Vec3 = [out[0] * R * 0.12 * rand(), 0, out[2] * R * 0.12 * rand()];
    const w = (kind === "reed" ? 0.016 : 0.011) * (0.8 + 0.4 * rand()) * (simple ? 1.5 : 1);
    const twist = (rand() - 0.5) * 0.8;
    const at = (t: number): Vec3 => add(root, [out[0] * reach * t * t, h * (t - 0.18 * spread * t * t * t), out[2] * reach * t * t]);
    const ring: number[][] = [];
    for (let k = 0; k <= rings; k++) {
      const t = k / (rings + 1);
      const p = at(t);
      const d = norm(sub(at(t + 0.02), p));
      const across0 = norm(cross([0, 1, 0], out));
      const across = norm(add(mul(across0, Math.cos(twist * t)), mul(cross(d, across0), Math.sin(twist * t))));
      const n = norm(cross(across, d));
      const hw = (w / 2) * (1 - 0.85 * t);
      const fold = hw * 0.55;
      const col = t < 0.4 ? mix(colours.base, colours.mid, t / 0.4) : mix(colours.mid, colours.tip, (t - 0.4) / 0.6);
      const up = norm(add(n, [0, 0.8, 0]));
      ring.push([
        b.v(add(add(p, mul(across, -hw)), mul(n, fold)), up, col),
        b.v(p, up, col),
        b.v(add(add(p, mul(across, hw)), mul(n, fold)), up, col),
      ]);
    }
    const tipP = at(1);
    const tip = b.v(tipP, [0, 1, 0], colours.tip);
    for (let k = 0; k < rings; k++) {
      const [l0, c0, r0] = ring[k]!;
      const [l1, c1, r1] = ring[k + 1]!;
      b.tri(l0!, c0!, c1!);
      b.tri(l0!, c1!, l1!);
      b.tri(c0!, r0!, r1!);
      b.tri(c0!, r1!, c1!);
    }
    const [l, c, r] = ring[rings]!;
    b.tri(l!, c!, tip);
    b.tri(c!, r!, tip);
  }
  return b.build();
}

// ─────────────────────────────────────────────── green canopy ───────────────────────────────────────────────

type LeafColour = { rib: Rgba; edge: Rgba; base: Rgba };
/** Broadleaf greens (linear, tinted per spray: alpha 1). Three shades so neighbouring leaves differ. */
const BROADLEAF: LeafColour[] = [
  { rib: rgba("#73A043", 1), edge: rgba("#447C26", 1), base: rgba("#27501A", 1) },
  { rib: rgba("#658F39", 1), edge: rgba("#386A21", 1), base: rgba("#204415", 1) },
  { rib: rgba("#82AC4C", 1), edge: rgba("#518A30", 1), base: rgba("#305A1E", 1) },
];
/** Willow leaves: narrow, a lighter yellow-green. */
const WILLOW: LeafColour[] = [
  { rib: rgba("#A9C567", 1), edge: rgba("#82A84B", 1), base: rgba("#5A7E32", 1) },
  { rib: rgba("#98BA5B", 1), edge: rgba("#739C42", 1), base: rgba("#4D722B", 1) },
];

/** Number of leaves in a broadleaf spray per level (0 full, 1 mid, 2 far). */
export const SPRAY_LEAVES = [23, 6, 3] as const;

/**
 * A broadleaf spray (instanced; its origin is the point of the twig it grows from): a short shoot along local +y
 * (0.31 m at scale 1) with twelve alternate leaves, two short side shoots of five and a terminal leaf (6.5-9.5 cm at
 * scale 1, a street tree's 8-11 cm), the blades facing local +z, folded along their midribs, drooping toward the tip
 * (level 0; `fine`: each leaf with a real leaf's outline, 16 triangles instead of 8, for the PC's near look). Level 1:
 * six folded diamonds round the same shoot, no stem (12 triangles); level 2: three larger ones (6 triangles). Wind grows
 * from 0 at the origin to the leaf tips.
 */
export function leafSpray(level: 0 | 1 | 2, seed = 21, fine = false): BufferGeometry {
  const b = new GeoBuilder();
  b.windHeight = 0.42;
  const rand = mulberry32(seed + level * 101);
  const stem = rgba("#5D6B2E", 0, 1);
  const shade = () => BROADLEAF[Math.floor(rand() * BROADLEAF.length)]!;
  const stemAt = (s: number): Vec3 => [0, s, 0.08 * s * s];
  if (level === 0) {
    // a leafy shoot as a real one is: leaves 7-10 cm (at the street trees' scale) alternating up the shoot and on two
    // short side shoots, each turned its own way round the stem (not one flat fan of big leaves)
    tube(b, [stemAt(0), stemAt(0.1), stemAt(0.21), stemAt(0.31)], [0.0045, 0.0036, 0.0028, 0.002], 3, () => stem, (t) => t * 0.5);
    const shoot = (from: Vec3, d: Vec3, length: number, n: number, start: number) => {
      for (let i = 0; i < n; i++) {
        const s0 = start + (i / n) * (length - start);
        const at = add(from, mul(d, s0));
        const side = i % 2 ? 1 : -1;
        const twist = (rand() - 0.5) * 0.9;
        const th = ((28 + rand() * 26) * Math.PI) / 180;
        const out = norm([side * Math.cos(th) * Math.cos(twist), Math.sin(th), Math.sin(twist) * 0.8 + (rand() - 0.4) * 0.3]);
        const dir = norm(add(out, mul(d, 0.35)));
        const l = 0.065 + 0.02 * Math.sin((i / Math.max(1, n - 1)) * Math.PI) + rand() * 0.012;
        const up = norm([-side * (0.15 + rand() * 0.25), 0.12, 1]);
        leaf(b, add(at, [side * 0.004, 0, 0]), dir, up, l, l * 0.5, { fold: 0.3, droop: 0.22, detail: fine ? 2 : 1, colour: shade() });
      }
    };
    shoot([0, 0, 0], [0, 1, 0.08], 0.31, 12, 0.03);
    for (const [s0, side] of [
      [0.09, -1],
      [0.17, 1],
    ] as const) {
      const from = stemAt(s0);
      const d = norm([side * 0.75, 0.65, 0.12]);
      const end = add(from, mul(d, 0.14));
      tube(b, [from, end], [0.0026, 0.0016], 3, () => stem, (t) => 0.3 + t * 0.4);
      shoot(from, d, 0.14, 5, 0.03);
    }
    leaf(b, stemAt(0.31), norm([0, 1, 0.14]), [0, 0, 1], 0.09, 0.045, { fold: 0.3, droop: 0.2, detail: fine ? 2 : 1, colour: shade() });
  } else if (level === 1) {
    for (const [s, side, l] of [
      [0.05, -1, 0.15],
      [0.1, 1, 0.16],
      [0.15, -1, 0.16],
      [0.2, 1, 0.16],
      [0.25, -1, 0.15],
    ] as const) {
      const th = ((30 + rand() * 15) * Math.PI) / 180;
      leaf(b, stemAt(s), norm([side * Math.cos(th), Math.sin(th), 0.1]), norm([-side * 0.2, 0.1, 1]), l, l * 0.56, { fold: 0.32, droop: 0.2, detail: 0, colour: shade() });
    }
    leaf(b, stemAt(0.28), norm([0, 1, 0.12]), [0, 0, 1], 0.16, 0.09, { fold: 0.3, droop: 0.18, detail: 0, colour: shade() });
  } else {
    leaf(b, stemAt(0.08), norm([-0.8, 0.6, 0.1]), [0, 0, 1], 0.25, 0.15, { fold: 0.32, droop: 0.15, detail: 0, colour: shade() });
    leaf(b, stemAt(0.14), norm([0.8, 0.6, 0.1]), [0, 0, 1], 0.25, 0.15, { fold: 0.32, droop: 0.15, detail: 0, colour: shade() });
    leaf(b, stemAt(0.24), norm([0, 1, 0.1]), [0, 0, 1], 0.26, 0.15, { fold: 0.3, droop: 0.15, detail: 0, colour: shade() });
  }
  return b.build();
}

/**
 * A stretch of a willow strand's leaves (instanced; origin on the strand, local +y along the strand, which hangs
 * down): narrow lance leaves (folded slivers) round the 0.3 m stretch, pointing on down and a little out, ten at level 0
 * (20 triangles), six at level 1 (12), three at level 2 (6). The strand itself is in the twig mesh.
 */
export function willowSpray(level: 0 | 1 | 2, seed = 23): BufferGeometry {
  const b = new GeoBuilder();
  b.windHeight = 0.32;
  const rand = mulberry32(seed + level * 131);
  const n = [10, 6, 3][level]!;
  for (let i = 0; i < n; i++) {
    const s = 0.02 + (i / n) * 0.27;
    const phi = i * 2.39996 + rand() * 0.4;
    const radial: Vec3 = [Math.cos(phi), 0, Math.sin(phi)];
    const tangent: Vec3 = [-Math.sin(phi), 0, Math.cos(phi)];
    const al = ((22 + rand() * 20) * Math.PI) / 180;
    const dir = norm(add(mul([0, 1, 0], Math.cos(al)), mul(radial, Math.sin(al))));
    const up = norm(cross(dir, tangent));
    const length = [0.12, 0.15, 0.19][level]! + rand() * 0.03;
    const width = [0.026, 0.034, 0.05][level]!;
    leaf(b, add([0, s, 0], mul(radial, 0.004)), dir, up, length, width, {
      strap: true,
      fold: 0.25,
      droop: 0.06,
      detail: 0,
      colour: WILLOW[Math.floor(rand() * WILLOW.length)]!,
    });
  }
  return b.build();
}

// ─────────────────────────────────────────────── cherry ───────────────────────────────────────────────

/** The atlas cells (vegAtlas.ts): 4 x 4 cells of the blossom atlas. */
export const ATLAS_GRID = 4;
export const ATLAS_CELL = { flowerA: 0, flowerB: 1, bud: 2, solid: 3, bunchA: 4, bunchB: 5 } as const;
/** UV of a point (u, v in 0..1) inside an atlas cell, with a margin (no bleeding at small mip levels). */
export function cellUv(cell: number, u: number, v: number, margin = 0.04): [number, number] {
  const cx = cell % ATLAS_GRID;
  const cy = Math.floor(cell / ATLAS_GRID);
  const s = 1 / ATLAS_GRID;
  return [(cx + margin + u * (1 - 2 * margin)) * s, (cy + margin + v * (1 - 2 * margin)) * s];
}

/** Open flowers in one close-up blossom bunch. */
export const BUNCH_FLOWERS = 20;

/**
 * A blossom bunch, close up (instanced, about 22-28 cm across at scale 1): 20 open flowers (5-petal flower pictures
 * on cupped quads, 3-4 cm, each facing its own way on a dome) and 3 pink buds, on short dark pedicels from one spur.
 * Local +y is the way the bunch faces. 104 triangles.
 */
export function blossomBunch(seed = 5): BufferGeometry {
  const b = new GeoBuilder();
  const rand = mulberry32(seed);
  const white = rgba("#FFFFFF", 1, 1);
  // green-brown, as the real ones (not black spikes at night), a little darker than the twigs' top: seen from a hand's
  // breadth they are fine stalks under the flowers, not yellow rods
  const pedicel = rgba("#655A3A", 0, 1);
  const solid = (u: number, v: number) => cellUv(ATLAS_CELL.solid, u, v, 0.3);
  const flower = (centre: Vec3, face: Vec3, size: number, cell: number, cup: number) => {
    const f = norm(face);
    const [t0, b0] = basis(f);
    const roll = rand() * Math.PI * 2;
    const tx = add(mul(t0, Math.cos(roll)), mul(b0, Math.sin(roll)));
    const ty = cross(f, tx);
    const h = size / 2;
    const shade = 0.88 + 0.12 * rand();
    const c: Rgba = [white[0] * shade, white[1] * shade, white[2] * shade, 1];
    const centreV = b.v(sub(centre, mul(f, size * cup)), f, mix(c, rgba("#FFFFFF", 1, 0.8), 0.5), cellUv(cell, 0.5, 0.5), 1);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) => {
      const p = add(add(centre, mul(tx, x! * h)), mul(ty, y! * h));
      return b.v(p, add(f, mul(add(mul(tx, x!), mul(ty, y!)), 0.25)), c, cellUv(cell, (x! + 1) / 2, (y! + 1) / 2), 1);
    });
    for (let k = 0; k < 4; k++) b.tri(centreV, corners[k]!, corners[(k + 1) % 4]!);
  };
  const stalk = (from: Vec3, to: Vec3) => {
    // a thin ribbon facing up-ish (two triangles), untextured (the atlas's solid cell)
    const d = norm(sub(to, from));
    const side = mul(norm(cross(d, [0.3, 1, 0.2])), 0.0006);
    const a = b.v(sub(from, side), [0, 1, 0], pedicel, solid(0, 0), 1);
    const c2 = b.v(add(from, side), [0, 1, 0], pedicel, solid(1, 0), 1);
    const e = b.v(add(to, side), [0, 1, 0], pedicel, solid(1, 1), 1);
    const f2 = b.v(sub(to, side), [0, 1, 0], pedicel, solid(0, 1), 1);
    b.tri(a, c2, e);
    b.tri(a, e, f2);
  };
  const spur: Vec3 = [0, -0.02, 0];
  for (let i = 0; i < BUNCH_FLOWERS; i++) {
    // a dome of flowers: denser toward the top, a few hanging at the sides
    const u = 1 - Math.pow(rand(), 0.8) * 1.3;
    const th = rand() * Math.PI * 2;
    const rr = Math.sqrt(Math.max(0, 1 - u * u));
    const dir: Vec3 = [rr * Math.cos(th), u, rr * Math.sin(th)];
    const dist = 0.04 + 0.065 * rand();
    const centre = add(spur, mul(dir, dist));
    const face = norm(add(dir, [(rand() - 0.5) * 0.6, 0.35, (rand() - 0.5) * 0.6]));
    // a few short pedicels, ending under their flowers (hidden by them from most angles)
    if (i < 4) stalk(spur, add(spur, mul(sub(centre, spur), 0.7)));
    flower(centre, face, 0.038 + 0.01 * rand(), rand() < 0.5 ? ATLAS_CELL.flowerA : ATLAS_CELL.flowerB, 0.22);
  }
  for (let i = 0; i < 3; i++) {
    const th = rand() * Math.PI * 2;
    const dir = norm([Math.cos(th), 0.3 + rand() * 0.5, Math.sin(th)]);
    const centre = add(spur, mul(dir, 0.075));
    stalk(spur, add(spur, mul(dir, 0.06)));
    flower(centre, dir, 0.022, ATLAS_CELL.bud, 0.05);
  }
  return b.build();
}

/** The bunch as a sprite (far): one quad (-0.5..0.5) the shader turns to the camera, showing a bunch picture. */
export function bunchSprite(scale = 1): BufferGeometry {
  const b = new GeoBuilder();
  const c = rgba("#FFFFFF", 1, 1);
  const q = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ].map(([x, y]) => b.v([x! * scale, y! * scale, 0], [0, 0, 1], c, cellUv(ATLAS_CELL.bunchA, x! + 0.5, 0.5 - y!), 1));
  b.tri(q[0]!, q[1]!, q[2]!);
  b.tri(q[0]!, q[2]!, q[3]!);
  return b.build();
}

/** How far (m) a phone's simplified twig may stray from the grown line (barkGeometry.simplifyTwig). */
export const TWIG_SIMPLIFY_TOL = 0.01;

/** Douglas-Peucker: the indices of the points of `pts` to keep so the line stays within `tol` (m) of the full one. */
export function simplifyLine(pts: readonly Vec3[], tol: number): number[] {
  const n = pts.length;
  if (n <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a]!;
    const ab = sub(pts[b]!, A);
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const ap = sub(pts[i]!, A);
      const t = l2 > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2)) : 0;
      const d = Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}
