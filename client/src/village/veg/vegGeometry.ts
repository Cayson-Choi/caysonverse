import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from "three";
import { linearHex } from "./flowerPlacement";
import { mulberry32 } from "./vegRandom";
import type { Vec3 } from "./vegLod";
import type { Branch } from "./cherryTree";

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
 *  - `uv`: only the cherry's blossom pieces use a texture (the procedural atlas, vegAtlas.ts).
 * Sizes are real: metres, a petunia mound 25-30 cm across, its flowers 5-6 cm.
 */

type Rgba = [number, number, number, number];

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
function basis(n: Vec3): [Vec3, Vec3] {
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
const mix = (a: Rgba, b: Rgba, t: number): Rgba => [
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

  get vertexCount(): number {
    return this.pos.length / 3;
  }
  get triangleCount(): number {
    return this.idx.length / 3;
  }

  v(p: Vec3, n: Vec3, c: Rgba, uv: [number, number] = [0.5, 0.5], wind?: number, light = 1): number {
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
 */
export function leaf(
  b: GeoBuilder,
  base: Vec3,
  dir: Vec3,
  up: Vec3,
  length: number,
  width: number,
  opts: { fold?: number; droop?: number; detail?: 0 | 1; strap?: boolean; colour?: { rib: Rgba; edge: Rgba; base: Rgba } } = {},
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
      ring.push(b.v(p, nrm, colour(t, nrm[1]), [0.5, 0.5], wind ? wind(t) : undefined, light ? light(p, nrm) : 1));
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

/** A low dome (the shaded heart of a mound, so no soil shows through it): `segs` around, one ring. */
function dome(b: GeoBuilder, centre: Vec3, r: number, h: number, segs: number, colour: Rgba, top: Rgba): void {
  const apex = b.v(add(centre, [0, h, 0]), [0, 1, 0], top, [0.5, 0.5], 0.3);
  const ring: number[] = [];
  const mid: number[] = [];
  for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    ring.push(b.v(add(centre, [dx * r, 0, dz * r]), [dx, 0.3, dz], colour, [0.5, 0.5], 0));
    mid.push(b.v(add(centre, [dx * r * 0.75, h * 0.7, dz * r * 0.75]), [dx, 0.8, dz], mix(colour, top, 0.5), [0.5, 0.5], 0.2));
  }
  for (let s = 0; s < segs; s++) {
    const s1 = (s + 1) % segs;
    b.tri(ring[s]!, mid[s]!, mid[s1]!);
    b.tri(ring[s]!, mid[s1]!, ring[s1]!);
    b.tri(mid[s]!, apex, mid[s1]!);
  }
}

/**
 * A petunia flower: a funnel (the throat 0.9 r deep) opening into five fused, wavy lobes; the throat darker, the veins
 * between the lobes darker (the star), the lobes' rims the flower's colour. 20 triangles; `simple`: a 5-triangle cup.
 */
function petunia(b: GeoBuilder, at: Vec3, face: Vec3, r: number, roll: number, simple = false): void {
  const f = norm(face);
  const [t0, b0] = basis(f);
  const throat = rgba("#E8D873", 0.35, 0.55); // a pale yellow throat, half tinted, darker
  const vein = rgba("#FFFFFF", 1, 0.62);
  const lobe = rgba("#FFFFFF", 1, 1);
  const T = b.v(sub(at, mul(f, r * (simple ? 0.35 : 0.9))), f, throat);
  if (simple) {
    const rim: number[] = [];
    for (let k = 0; k < 5; k++) {
      const a = roll + (k / 5) * Math.PI * 2;
      const dir = add(mul(t0, Math.cos(a)), mul(b0, Math.sin(a)));
      rim.push(b.v(add(at, mul(dir, r)), add(f, mul(dir, 0.4)), lobe));
    }
    for (let k = 0; k < 5; k++) b.tri(T, rim[k]!, rim[(k + 1) % 5]!);
    return;
  }
  const mid: number[] = [];
  const rim: number[] = [];
  for (let k = 0; k < 5; k++) {
    const a = roll + (k / 5) * Math.PI * 2;
    const dir = add(mul(t0, Math.cos(a)), mul(b0, Math.sin(a)));
    mid.push(b.v(add(sub(at, mul(f, r * 0.42)), mul(dir, r * 0.38)), add(f, mul(dir, -0.3)), mix(throat, vein, 0.55)));
  }
  for (let k = 0; k < 10; k++) {
    const a = roll + (k / 10) * Math.PI * 2;
    const dir = add(mul(t0, Math.cos(a)), mul(b0, Math.sin(a)));
    const isLobe = k % 2 === 0;
    const rr = r * (isLobe ? 1 : 0.84);
    // the rim turns back a little, and the lobes wave
    const lift = r * (isLobe ? 0.12 : 0.02) * (k % 4 === 0 ? 1 : 0.6);
    rim.push(b.v(add(add(at, mul(dir, rr)), mul(f, lift)), add(f, mul(dir, 0.25)), isLobe ? lobe : vein));
  }
  for (let k = 0; k < 5; k++) {
    const k1 = (k + 1) % 5;
    b.tri(T, mid[k]!, mid[k1]!);
    b.tri(mid[k]!, rim[2 * k]!, rim[2 * k + 1]!);
    b.tri(mid[k]!, rim[2 * k + 1]!, mid[k1]!);
    b.tri(mid[k1]!, rim[2 * k + 1]!, rim[(2 * k + 2) % 10]!);
  }
}

/**
 * A pansy / viola face: five rounded, slightly cupped petals (two upper, two side, the broad lower one) round a
 * yellow eye, the lower three with a dark blotch at the base. 25 triangles; `simple`: one 6-triangle disc.
 */
function pansy(b: GeoBuilder, at: Vec3, face: Vec3, r: number, roll: number, simple = false): void {
  const f = norm(face);
  const [t0, b0] = basis(f);
  const eye = rgba("#F2C21B", 0, 1);
  const blotch = rgba("#2A1530", 0.15, 1);
  const petal = rgba("#FFFFFF", 1, 1);
  const petalBase = rgba("#FFFFFF", 1, 0.8);
  const C = b.v(add(at, mul(f, -r * 0.08)), f, eye);
  const dirAt = (a: number) => add(mul(t0, Math.cos(a + roll)), mul(b0, Math.sin(a + roll)));
  if (simple) {
    const rim: number[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      rim.push(b.v(add(at, mul(dirAt(a), r * (k === 4 ? 1.1 : 0.9))), f, petal));
    }
    for (let k = 0; k < 6; k++) b.tri(C, rim[k]!, rim[(k + 1) % 6]!);
    return;
  }
  // petals: [centre angle, half width (rad), length x r, blotch]; up is +pi/2 in the face's plane
  const petals: Array<[number, number, number, boolean]> = [
    [Math.PI / 2 + 0.55, 0.62, 1.0, false],
    [Math.PI / 2 - 0.55, 0.62, 1.0, false],
    [Math.PI + 0.25, 0.6, 0.9, true],
    [-0.25, 0.6, 0.9, true],
    [-Math.PI / 2, 0.85, 1.05, true],
  ];
  for (const [ca, hw, L, hasBlotch] of petals) {
    // the inner part as wide as the rim: neighbouring petals overlap round the eye, as real ones do (no gaps)
    const mids = [ca - hw * 1.05, ca + hw * 1.05].map((a) =>
      b.v(add(at, mul(dirAt(a), r * 0.42 * L)), f, hasBlotch ? blotch : petalBase),
    );
    const rims = [-1, -0.35, 0.35, 1].map((s) => {
      const a = ca + hw * s;
      const rr = r * L * (1 - 0.12 * s * s);
      // cupped: the rim comes forward
      return b.v(add(add(at, mul(dirAt(a), rr)), mul(f, r * 0.14)), add(f, mul(dirAt(a), -0.2)), petal);
    });
    b.tri(C, mids[0]!, mids[1]!);
    b.tri(mids[0]!, rims[0]!, rims[1]!);
    b.tri(mids[0]!, rims[1]!, mids[1]!);
    b.tri(mids[1]!, rims[1]!, rims[2]!);
    b.tri(mids[1]!, rims[2]!, rims[3]!);
  }
}

/**
 * A grape hyacinth (muscari) spike: a tapered column of small bells (radius bumps), dark blue at the base to lighter at
 * the tip, the topmost bells pale. `sides` 6 x `rings` 6 (60 triangles) or 4 x 3 (simple).
 */
function spike(b: GeoBuilder, base: Vec3, dir: Vec3, length: number, r: number, simple = false): void {
  const d = norm(dir);
  const sides = simple ? 3 : 5;
  const rings = simple ? 1 : 4;
  const pts: Vec3[] = [];
  const radii: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    pts.push(add(base, mul(d, length * t)));
    const bump = simple ? 1 : 1 + 0.22 * Math.cos(t * Math.PI * rings);
    radii.push(i === rings ? r * 0.25 : r * (1 - 0.45 * t) * bump);
  }
  tube(b, pts, radii, sides, (t) => (t > 0.85 ? rgba("#E7EAF8", 0.35, 1) : mix(rgba("#FFFFFF", 1, 0.55), rgba("#FFFFFF", 1, 1.05), t)));
}

/**
 * A tulip: a stem, a cup of six petals (three outer, three inner, curving in at the top), two broad leaves.
 * 52 triangles + stem and leaves; `simple`: a 3-petal cup.
 */
function tulip(b: GeoBuilder, base: Vec3, height: number, lean: Vec3, r: number, roll: number, simple = false): void {
  const top = add(add(base, [0, height, 0]), mul(lean, height));
  const stem = rgba("#6E9A3E");
  tube(b, [base, add(add(base, [0, height * 0.55, 0]), mul(lean, height * 0.4)), top], [0.004, 0.0035, 0.004], 3, () => stem);
  const up = norm(add([0, 1, 0], mul(lean, 0.8)));
  const [t0, b0] = basis(up);
  const petalBase = rgba("#C8C25A", 0.4, 0.75);
  const petal = rgba("#FFFFFF", 1, 1);
  const n = simple ? 3 : 6;
  for (let k = 0; k < n; k++) {
    const a = roll + (k / n) * Math.PI * 2 + (k % 2 ? 0.15 : 0);
    const dir = add(mul(t0, Math.cos(a)), mul(b0, Math.sin(a)));
    const side = norm(cross(up, dir));
    const inner = k % 2 === 1;
    const rr = r * (inner ? 0.88 : 1);
    const h = r * 2.3 * (inner ? 0.95 : 1);
    const p0 = top;
    // the petal: narrow base, broad belly, a rounded tip curving back in
    const mid = add(add(top, mul(up, h * 0.45)), mul(dir, rr * 1.05));
    const tip = add(add(top, mul(up, h)), mul(dir, rr * 0.72));
    const w1 = rr * (simple ? 1.1 : 0.85);
    const w2 = rr * 0.55;
    const nOut = dir;
    const v0 = b.v(p0, nOut, petalBase);
    const ml = b.v(add(mid, mul(side, -w1)), add(nOut, mul(side, -0.5)), mix(petalBase, petal, 0.6));
    const mr = b.v(add(mid, mul(side, w1)), add(nOut, mul(side, 0.5)), mix(petalBase, petal, 0.6));
    const mm = b.v(add(mid, mul(dir, rr * 0.12)), nOut, petal);
    const tl = b.v(add(tip, mul(side, -w2)), nOut, petal);
    const tr = b.v(add(tip, mul(side, w2)), nOut, petal);
    const tt = b.v(add(add(tip, mul(up, rr * 0.25)), mul(dir, -rr * 0.05)), nOut, petal);
    b.tri(v0, ml, mm);
    b.tri(v0, mm, mr);
    b.tri(ml, tl, mm);
    b.tri(mm, tl, tt);
    b.tri(mm, tt, tr);
    b.tri(mm, tr, mr);
  }
}

// ─────────────────────────────────────────────── plants ───────────────────────────────────────────────

/** A species' two meshes: the full plant (near) and the simple one (mid and far). */
export interface SpeciesMeshes {
  lod0: BufferGeometry;
  lod1: BufferGeometry;
}

/** A petunia mound, 25-30 cm across and 15-20 cm high: a dark core, 10 leaves, 7 trumpet flowers on its surface. */
export function petuniaPlant(simple: boolean, seed = 1): BufferGeometry {
  const b = new GeoBuilder();
  b.windHeight = 0.2;
  const rand = mulberry32(seed);
  dome(b, [0, 0, 0], simple ? 0.14 : 0.13, simple ? 0.14 : 0.11, simple ? 6 : 8, LEAF.dark, LEAF.mid);
  const leaves = simple ? 5 : 14;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rand() * 0.5;
    const el = 0.25 + rand() * 0.6;
    const dir: Vec3 = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
    const base: Vec3 = [Math.cos(a) * 0.05, 0.03 + rand() * 0.07, Math.sin(a) * 0.05];
    leaf(b, base, dir, [0, 1, 0], simple ? 0.14 : 0.095 + rand() * 0.035, simple ? 0.09 : 0.055, { detail: simple ? 0 : 1, droop: 0.3 });
  }
  const flowers = simple ? 7 : 10;
  for (let i = 0; i < flowers; i++) {
    const a = (i / flowers) * Math.PI * 2 + rand() * 0.7;
    const el = i === 0 ? 1.3 : 0.35 + rand() * 0.75;
    const out: Vec3 = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
    const at: Vec3 = [out[0] * 0.15, 0.05 + out[1] * 0.12, out[2] * 0.15];
    const face = norm(add(out, [0, 0.55, 0]));
    petunia(b, at, face, simple ? 0.042 : 0.03 + rand() * 0.007, rand() * 6.28, simple);
  }
  return b.build();
}

/** A pansy rosette (15-18 cm): 8 spreading leaves, 5 faces held up on short stalks toward the light. */
export function pansyPlant(simple: boolean, seed = 2): BufferGeometry {
  const b = new GeoBuilder();
  b.windHeight = 0.16;
  const rand = mulberry32(seed);
  const leaves = simple ? 5 : 11;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rand() * 0.4;
    const el = 0.2 + rand() * 0.5;
    leaf(b, [0, 0.01 + rand() * 0.03, 0], [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)], [0, 1, 0], simple ? 0.12 : 0.08 + rand() * 0.03, simple ? 0.07 : 0.048, {
      detail: simple ? 0 : 1,
      droop: 0.35,
      colour: { rib: rgba("#6C9A3C"), edge: rgba("#3F6E25"), base: rgba("#2E5419") },
    });
  }
  const flowers = simple ? 5 : 8;
  const stem = rgba("#5B8A33");
  for (let i = 0; i < flowers; i++) {
    const a = (i / flowers) * Math.PI * 2 + rand() * 0.8;
    const rr = 0.02 + rand() * 0.07;
    const h = 0.08 + rand() * 0.08;
    const at: Vec3 = [Math.cos(a) * rr, h, Math.sin(a) * rr];
    if (!simple) tube(b, [[Math.cos(a) * 0.01, 0, Math.sin(a) * 0.01], sub(at, [0, 0.008, 0])], [0.0022, 0.0018], 3, () => stem);
    // faces look up and out (toward the sun's side a little)
    const face = norm([Math.cos(a) * 0.55 + 0.15, 0.85, Math.sin(a) * 0.55 - 0.1]);
    pansy(b, at, face, simple ? 0.034 : 0.026 + rand() * 0.007, (rand() - 0.5) * 0.4, simple);
  }
  return b.build();
}

/** A clump of grape hyacinths: 6 arching strap leaves, 3-4 spikes on stalks 10-16 cm. */
export function muscariPlant(simple: boolean, seed = 3): BufferGeometry {
  const b = new GeoBuilder();
  b.windHeight = 0.18;
  const rand = mulberry32(seed);
  const leaves = simple ? 4 : 8;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rand() * 0.6;
    const el = 0.65 + rand() * 0.4;
    leaf(b, [0, 0, 0], [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)], [0, 1, 0], 0.15 + rand() * 0.05, 0.012, {
      strap: true,
      detail: 0, // 1.2 cm wide straps: the fold does not show
      droop: 0.5,
      fold: 0.6,
      colour: { rib: rgba("#7FA84B"), edge: rgba("#557F2E"), base: rgba("#3B6020") },
    });
  }
  const spikes = simple ? 4 : 6;
  const stalk = rgba("#6E9A42");
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 + rand() * 0.9;
    const rr = 0.01 + rand() * 0.04;
    const h = 0.08 + rand() * 0.07;
    const lean: Vec3 = [Math.cos(a) * 0.15, 1, Math.sin(a) * 0.15];
    const sbase: Vec3 = [Math.cos(a) * rr, h, Math.sin(a) * rr];
    if (!simple) tube(b, [[Math.cos(a) * 0.006, 0, Math.sin(a) * 0.006], sbase], [0.0022, 0.002], 3, () => stalk);
    spike(b, sbase, lean, simple ? 0.06 : 0.045 + rand() * 0.015, simple ? 0.014 : 0.011, simple);
  }
  return b.build();
}

/** Two or three tulips (stems 25-35 cm), each with two broad leaves. */
export function tulipPlant(simple: boolean, seed = 4): BufferGeometry {
  const b = new GeoBuilder();
  b.windHeight = 0.35;
  const rand = mulberry32(seed);
  const n = simple ? 2 : 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.8;
    const at: Vec3 = [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05];
    const lean: Vec3 = [Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08];
    for (let k = 0; k < (simple ? 1 : 2); k++) {
      const la = a + (k ? 2.4 : -0.7) + rand() * 0.5;
      const el = 0.9 + rand() * 0.35;
      leaf(b, at, [Math.cos(la) * Math.cos(el), Math.sin(el), Math.sin(la) * Math.cos(el)], [0, 1, 0], 0.17 + rand() * 0.05, 0.045, {
        strap: true,
        detail: simple ? 0 : 1,
        droop: 0.45,
        fold: 0.5,
        colour: { rib: rgba("#8AAE62"), edge: rgba("#5E8A4A"), base: rgba("#46703A") },
      });
    }
    tulip(b, at, 0.26 + rand() * 0.1, lean, simple ? 0.026 : 0.021, rand() * 6.28, simple);
  }
  return b.build();
}

/** Every species' meshes, in `SPECIES` order. */
export function speciesMeshes(): SpeciesMeshes[] {
  return [
    { lod0: petuniaPlant(false), lod1: petuniaPlant(true) },
    { lod0: pansyPlant(false), lod1: pansyPlant(true) },
    { lod0: muscariPlant(false), lod1: muscariPlant(true) },
    { lod0: tulipPlant(false), lod1: tulipPlant(true) },
  ];
}

// ─────────────────────────────────────────────── green canopy ───────────────────────────────────────────────

/** A folded, volumetric leaf cluster for broadleaf canopies. The core keeps the crown solid while the leaves provide
 * the close-up silhouette and visible depth that the old green foliage cards lacked. */
export function greenCluster(simple = false, seed = 17): BufferGeometry {
  const b = new GeoBuilder();
  b.windHeight = 0.55;
  const rand = mulberry32(seed);
  const dark = rgba("#244D1A");
  const mid = rgba("#477D29");
  const light = rgba("#82A94C");
  dome(b, [0, 0.12, 0], simple ? 0.22 : 0.25, simple ? 0.18 : 0.25, simple ? 6 : 8, dark, mid);
  const leaves = simple ? 7 : 14;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rand() * 0.7;
    const el = 0.15 + rand() * 0.85;
    const dir: Vec3 = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
    const base: Vec3 = [Math.cos(a) * 0.08, 0.08 + rand() * 0.12, Math.sin(a) * 0.08];
    leaf(b, base, dir, [0, 1, 0], simple ? 0.18 : 0.12 + rand() * 0.055, simple ? 0.08 : 0.052 + rand() * 0.018, {
      detail: simple ? 0 : 1,
      fold: 0.42,
      droop: 0.22,
      colour: { rib: light, edge: mid, base: dark },
    });
  }
  return b.build();
}

/** A cheap closed puff used beyond the near green-canopy LOD. */
export function greenClusterFar(): BufferGeometry {
  const b = new GeoBuilder();
  b.windHeight = 0.5;
  dome(b, [0, 0.12, 0], 0.25, 0.22, 6, rgba("#315F20"), rgba("#6C9639"));
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
  const pedicel = rgba("#7C6A44", 0, 1); // green-brown, as the real ones (not black spikes at night)
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
    const side = mul(norm(cross(d, [0.3, 1, 0.2])), 0.001);
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
export function bunchSprite(): BufferGeometry {
  const b = new GeoBuilder();
  const c = rgba("#FFFFFF", 1, 1);
  const q = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ].map(([x, y]) => b.v([x!, y!, 0], [0, 0, 1], c, cellUv(ATLAS_CELL.bunchA, x! + 0.5, 0.5 - y!), 1));
  b.tri(q[0]!, q[1]!, q[2]!);
  b.tri(q[0]!, q[2]!, q[3]!);
  return b.build();
}

/** All the twigs of the plaza cherries as one mesh: 3-4 sided tubes, dark grey-brown bark, each vertex its light. */
export function twigMesh(twigs: ReadonlyArray<{ branch: Branch; light: (p: Vec3, n: Vec3) => number }>, coarse = false): BufferGeometry {
  const b = new GeoBuilder();
  const bark = rgba("#4B3A33", 0, 1);
  const barkTop = rgba("#6A574D", 0, 1);
  for (const { branch, light } of twigs) {
    const sides = !coarse && branch.radii[0]! > 0.007 ? 4 : 3;
    let { pts, radii } = branch;
    if (coarse && pts.length > 3) {
      // phones: base, middle and tip only (a twig is a pixel or two wide there)
      const m = Math.floor(pts.length / 2);
      pts = [pts[0]!, pts[m]!, pts[pts.length - 1]!];
      radii = [radii[0]!, radii[m]!, radii[radii.length - 1]!];
    }
    tube(b, pts, radii, sides, (_t, ny) => mix(bark, barkTop, Math.max(0, ny)), () => 0, light);
  }
  return b.build();
}
