import type { BufferGeometry } from "three";
import { PLANT_CELL, SOLID_UV, plantUv } from "./plantCells";
import { GeoBuilder, basis, grassTuft, rgba, type Rgba } from "./vegGeometry";
import { mulberry32, valueNoise3 } from "./vegRandom";
import type { Vec3 } from "./vegLod";

/**
 * The bushes and bedding plants (veg3d), rebuilt 2026-11-16 (the owner, on a plaza planter: "이런 식물도 뭔가 실제랑
 * 비슷한 느낌으로 만들어줘 꽃이나 둥근식물 같은 것도 벚꽃이나 나무와 비슷한 수준으로"). The old ones were flat-coloured
 * geometry: 10-15 cm leaves on a solid green ball, flowers like paper cut-outs. Now, as the cherries' blossoms are,
 * they are small pieces of geometry carrying pictures (the plant atlas, vegPlantAtlas.ts):
 *
 *  - Bushes: a clipped boxwood ball (회양목) or an azalea mound (철쭉, some in flower) is a lumpy shell of a thousand-odd
 *    sprig cards (each a twig with 20-40 real-size leaves, 1.5-2 cm for the boxwood) tilted out of the surface like
 *    scales, a second, darker layer of older twigs inside it, and a small dark core that only shows as shade in the
 *    gaps. Darker underneath and inside (ambient occlusion in the vertex colour), so the ball has depth and a ragged
 *    outline instead of a smooth green skin.
 *  - Bedding plants, at real size: petunia mounds (trumpets with net veins on funnels), pansies (faces with blotches
 *    and whiskers on cupped discs, held up on stalks), grape hyacinths (spikes of urn bells round a stalk), tulips
 *    (streaked cups), French marigolds (ruffled pompom heads over pinnate fronds), each with its own textured leaves,
 *    (the beds' soil they stand on: vegSoil.ts).
 *
 * The vertex attributes are vegGeometry's (rgb x the atlas texel is the albedo, a the share of the instance's colour);
 * every vertex here has a uv in the plant atlas (the white cell where untextured).
 */

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
/** A grey albedo multiplier (the AO and brightness) with a tint weight. */
const grey = (k: number, tint: number): Rgba => [k, k, k, tint];

function builder(windHeight: number): GeoBuilder {
  const b = new GeoBuilder();
  b.windHeight = windHeight;
  b.defaultUv = SOLID_UV;
  return b;
}

/**
 * A picture card standing on `base`, growing along `up` (h long), `w` wide, its face toward `face` (made
 * perpendicular to `up`); folded along its middle by `fold` (x w: the middle line set back, a V seen from above, so
 * a card seen edge-on still has some width). `shadeN`: the vertex normal for the light (null: the card's own).
 * u runs left to right, v top (0) to bottom (1), as the atlas draws (the base at the cell's bottom).
 */
function card(b: GeoBuilder, base: Vec3, up: Vec3, face: Vec3, w: number, h: number, cell: number, col: Rgba, opts: { fold?: number; shadeN?: Vec3 | null; wind?: [number, number]; colTop?: Rgba } = {}): void {
  const u = norm(up);
  const f = norm(sub(face, mul(u, dot(face, u))));
  const r = norm(cross(u, f));
  const n = opts.shadeN ?? f;
  const fold = (opts.fold ?? 0) * w;
  const top = add(base, mul(u, h));
  const cTop = opts.colTop ?? col;
  const wb = opts.wind;
  if (fold === 0) {
    const a = b.v(add(base, mul(r, -w / 2)), n, col, plantUv(cell, 0, 1), wb?.[0]);
    const c = b.v(add(base, mul(r, w / 2)), n, col, plantUv(cell, 1, 1), wb?.[0]);
    const d = b.v(add(top, mul(r, w / 2)), n, cTop, plantUv(cell, 1, 0), wb?.[1]);
    const e = b.v(add(top, mul(r, -w / 2)), n, cTop, plantUv(cell, 0, 0), wb?.[1]);
    b.tri(a, c, d);
    b.tri(a, d, e);
    return;
  }
  const L0 = b.v(add(base, mul(r, -w / 2)), n, col, plantUv(cell, 0, 1), wb?.[0]);
  const M0 = b.v(sub(base, mul(f, fold)), n, col, plantUv(cell, 0.5, 1), wb?.[0]);
  const R0 = b.v(add(base, mul(r, w / 2)), n, col, plantUv(cell, 1, 1), wb?.[0]);
  const L1 = b.v(add(top, mul(r, -w / 2)), n, cTop, plantUv(cell, 0, 0), wb?.[1]);
  const M1 = b.v(sub(top, mul(f, fold)), n, cTop, plantUv(cell, 0.5, 0), wb?.[1]);
  const R1 = b.v(add(top, mul(r, w / 2)), n, cTop, plantUv(cell, 1, 0), wb?.[1]);
  b.tri(L0, M0, M1);
  b.tri(L0, M1, L1);
  b.tri(M0, R0, R1);
  b.tri(M0, R1, M1);
}

/**
 * A textured leaf (its picture fills the cell: base at the bottom middle, tip at the top): a blade `length` long and
 * `width` across at its widest (the picture's leaf is `fill` of the cell's width), folded along the midrib and drooping
 * toward the tip. 8 triangles (3 rows), or 4 (`simple`: 2 rows).
 */
function texLeaf(b: GeoBuilder, base: Vec3, dir: Vec3, up: Vec3, length: number, width: number, cell: number, col: Rgba, opts: { fill?: number; fold?: number; droop?: number; simple?: boolean } = {}): void {
  const d = norm(dir);
  const side = norm(cross(d, up));
  const n = norm(cross(side, d));
  const W = width / (opts.fill ?? 0.72);
  const fold = opts.fold ?? 0.25;
  const droop = opts.droop ?? 0.25;
  const rows = opts.simple ? [0, 1] : [0, 0.5, 1];
  const ids: number[][] = [];
  for (const t of rows) {
    const centre = add(add(base, mul(d, length * t)), mul(n, -droop * length * t * t));
    const row: number[] = [];
    for (const s of [-1, 0, 1]) {
      const p = add(add(centre, mul(side, (W / 2) * s)), mul(n, fold * (W / 2) * Math.abs(s)));
      const k = 0.78 + 0.22 * t;
      row.push(b.v(p, norm(add(n, mul(side, -0.35 * s * fold * 2))), [col[0] * k, col[1] * k, col[2] * k, col[3]], plantUv(cell, 0.5 + 0.5 * s, 1 - t, 0.02)));
    }
    ids.push(row);
  }
  for (let i = 0; i + 1 < ids.length; i++) {
    const [a0, b0, c0] = ids[i]!;
    const [a1, b1, c1] = ids[i + 1]!;
    b.tri(a0!, b0!, b1!);
    b.tri(a0!, b1!, a1!);
    b.tri(b0!, c0!, c1!);
    b.tri(b0!, c1!, b1!);
  }
}

/** A tube with uvs (u round, v along: `v0` at the first point, `v1` at the last) in `cell`. */
function uvTube(b: GeoBuilder, pts: Vec3[], radii: number[], sides: number, cell: number, col: (t: number) => Rgba, v0 = 1, v1 = 0): void {
  const rings: number[][] = [];
  let [tx] = basis(norm(sub(pts[1]!, pts[0]!)));
  for (let i = 0; i < pts.length; i++) {
    const d = norm(i === 0 ? sub(pts[1]!, pts[0]!) : i === pts.length - 1 ? sub(pts[i]!, pts[i - 1]!) : sub(pts[i + 1]!, pts[i - 1]!));
    tx = norm(sub(tx, mul(d, dot(tx, d))));
    const ty = cross(d, tx);
    const t = i / (pts.length - 1);
    const ring: number[] = [];
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const nr = add(mul(tx, Math.cos(a)), mul(ty, Math.sin(a)));
      ring.push(b.v(add(pts[i]!, mul(nr, radii[i]!)), nr, col(t), cell === PLANT_CELL.solid ? SOLID_UV : plantUv(cell, s / sides, v0 + (v1 - v0) * t, 0.0)));
    }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < rings.length; i++)
    for (let s = 0; s < sides; s++) {
      b.tri(rings[i]![s]!, rings[i + 1]![s]!, rings[i + 1]![s + 1]!);
      b.tri(rings[i]![s]!, rings[i + 1]![s + 1]!, rings[i]![s + 1]!);
    }
}

/** A thin stalk (3 sides, the white cell). */
function stalk(b: GeoBuilder, pts: Vec3[], r0: number, r1: number, col: Rgba): void {
  const radii = pts.map((_, i) => r0 + (r1 - r0) * (i / (pts.length - 1)));
  uvTube(b, pts, radii, 3, PLANT_CELL.solid, () => col);
}

// ─────────────────────────────────────────────── bushes ───────────────────────────────────────────────

export type BushSpecies = "boxwood" | "azalea";
export const BUSH_SPECIES: readonly BushSpecies[] = ["boxwood", "azalea"];

/** Cards per level: [outer sprigs, inner twigs, card size (unit), azalea trusses]. */
const BUSH_LEVELS = [
  { outer: 1150, inner: 380, size: 0.19, core: [12, 7] as const, flowers: 150 },
  { outer: 330, inner: 70, size: 0.33, core: [10, 6] as const, flowers: 50 },
  { outer: 70, inner: 0, size: 0.6, core: [8, 5] as const, flowers: 12 },
] as const;

/**
 * A round bush (instanced, scaled to each bush: unit radius 1 across, 1 high, its base at y 0, as bushGeometry was).
 * Boxwood: a clipped ball, its surface in small bumps (the clipping's lumps over the sprig clusters). Azalea: a
 * looser, flatter mound with 4 cm leaves, and flower trusses on its upper side (white: the bush's tint, its flower
 * colour, colours them; the leaves take none of it). Level 0 6,288 triangles (folded cards: 4 each; the old bush had
 * 7,480), level 1 920 (flat cards), level 2 220.
 */
export function bushPlant(species: BushSpecies, level: 0 | 1 | 2, seed = 29): BufferGeometry {
  const b = builder(1.4);
  const rand = mulberry32(seed + level * 17 + (species === "azalea" ? 1000 : 0));
  const L = BUSH_LEVELS[level];
  const az = species === "azalea";
  const leafTint = az ? 0 : 1;
  const noiseSeed = seed * 3 + (az ? 7 : 0);
  // the surface: an ellipsoid round (0, 0.5, 0), radii 1 / 0.5, in lumps (the azalea's mound lower and looser)
  const lumpAt = (d: Vec3) => {
    const big = valueNoise3(d[0] * 1.6 + 3, d[1] * 1.6, d[2] * 1.6, noiseSeed) - 0.5;
    const small = valueNoise3(d[0] * 4.2, d[1] * 4.2 + 5, d[2] * 4.2, noiseSeed + 1) - 0.5;
    return 1 + (az ? 0.16 : 0.09) * big + (az ? 0.08 : 0.05) * small;
  };
  const yScale = az ? 0.46 : 0.5;
  const surface = (d: Vec3, k: number): Vec3 => {
    const l = lumpAt(d) * k;
    return [d[0] * l, Math.max(0.02, 0.5 + (az ? -0.04 : 0) + d[1] * yScale * l), d[2] * l];
  };
  const normalAt = (d: Vec3): Vec3 => norm([d[0], d[1] / (yScale * 2) * 1.0, d[2]]);
  const ao = (d: Vec3, depth: number) => (0.5 + 0.5 * smooth(-0.85, 0.55, d[1])) * depth;
  // the core: a dark lumpy ellipsoid well inside (only shade in the gaps, never a green skin)
  {
    const [segs, rings] = L.core;
    const rows: number[][] = [];
    for (let j = 0; j <= rings; j++) {
      const v = -0.9 + (j / rings) * 1.9;
      const lat = Math.asin(Math.max(-1, Math.min(1, v)));
      const row: number[] = [];
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const d: Vec3 = [Math.cos(a) * Math.cos(lat), Math.sin(lat), Math.sin(a) * Math.cos(lat)];
        row.push(b.v(surface(d, 0.74), normalAt(d), grey(0.16 + 0.1 * smooth(-0.6, 0.8, d[1]), az ? 0 : 1), plantUv(PLANT_CELL.boxIn, 0.3 + 0.4 * (i / segs), 0.3 + 0.4 * (j / rings)), 0));
      }
      rows.push(row);
    }
    for (let j = 0; j < rings; j++)
      for (let i = 0; i < segs; i++) {
        const i1 = (i + 1) % segs;
        b.tri(rows[j]![i]!, rows[j + 1]![i]!, rows[j + 1]![i1]!);
        b.tri(rows[j]![i]!, rows[j + 1]![i1]!, rows[j]![i1]!);
      }
  }
  // the sprigs: Fibonacci points over the sphere of directions (the lowest band left out: it sits on the ground)
  const layer = (count: number, depth: number, sizeK: number, cells: readonly number[], bright: number, flowers: number) => {
    for (let k = 0; k < count; k++) {
      const yN = 1 - ((k + 0.5) / count) * 1.82; // 1 .. -0.82
      const rr = Math.sqrt(Math.max(0, 1 - yN * yN));
      const a = k * 2.39996 + rand() * 0.3;
      const d: Vec3 = [Math.cos(a) * rr, yN, Math.sin(a) * rr];
      const n = normalAt(d);
      const at = surface(d, depth * (0.97 + rand() * 0.05));
      // a sprig leaves the surface at 15-55 degrees (scales overlapping, some standing out: the ragged outline)
      const t = norm(cross(n, norm(cross([Math.cos(rand() * 6.28), 0.3, Math.sin(rand() * 6.28)], n))));
      const el = (((az ? 18 : 10) + rand() * (az ? 40 : 30)) * Math.PI) / 180;
      const up = norm(add(mul(t, Math.cos(el)), mul(n, Math.sin(el))));
      const size = L.size * sizeK * (0.82 + rand() * 0.36);
      const base = sub(at, mul(up, size * 0.35));
      const occl = ao(d, bright) * (0.9 + rand() * 0.2);
      const isFlower = flowers > 0 && d[1] > -0.25 && rand() < flowers;
      const cell = isFlower ? PLANT_CELL.azFlower : cells[Math.floor(rand() * cells.length)]!;
      const col = isFlower ? grey(Math.min(1, occl * 1.1 + 0.08), 1) : grey(occl, leafTint);
      const tipCol = isFlower ? col : grey(Math.min(1.15, occl * 1.12), leafTint);
      card(b, isFlower ? add(base, mul(n, size * 0.12)) : base, up, n, size * (isFlower ? 0.72 : 1), size * (isFlower ? 0.72 : 1), cell, col, {
        fold: level === 0 ? 0.18 : 0,
        shadeN: norm(add(mul(n, 0.75), mul(norm(cross(up, cross(n, up))), 0.25))),
        wind: [0.05, 0.35],
        colTop: tipCol,
      });
    }
  };
  const outerCells = az ? [PLANT_CELL.azSprig] : [PLANT_CELL.boxA, PLANT_CELL.boxB];
  const innerCells = az ? [PLANT_CELL.azSprig] : [PLANT_CELL.boxIn];
  if (L.inner) layer(L.inner, 0.86, 1.1, innerCells, 0.5, 0);
  layer(L.outer, 1.0, az ? 1.15 : 1, outerCells, 1, az ? L.flowers / L.outer : 0);
  return b.build();
}

// ─────────────────────────────────────────────── flowers ───────────────────────────────────────────────

/** A face on a stalk: its plane's basis, the texture's up kept to the world's up as far as the face allows. */
function faceBasis(face: Vec3): { f: Vec3; right: Vec3; up: Vec3 } {
  const f = norm(face);
  let up = sub([0, 1, 0], mul(f, f[1]));
  if (Math.hypot(...up) < 1e-3) up = sub([0, 0, -1], mul(f, -f[2]));
  up = norm(up);
  return { f, right: norm(cross(up, f)), up };
}

/**
 * A petunia trumpet (r 3-3.6 cm): a throat, a funnel and a flared, slightly reflexed rim, the trumpet picture mapped
 * radially onto it (`segs` round: 8 = 40 triangles; 5 for the simple one, a shallow cup of 15).
 */
function petuniaFlower(b: GeoBuilder, at: Vec3, face: Vec3, r: number, roll: number, simple: boolean): void {
  const { f, right, up } = faceBasis(face);
  const segs = simple ? 5 : 8;
  // radius (x r), depth back along the face (x r), texture radius (0..1 of the half cell)
  const rings: Array<[number, number, number]> = simple
    ? [
        [0, 0.45, 0],
        [1.06, -0.04, 0.99],
      ]
    : [
        [0, 0.9, 0],
        [0.32, 0.42, 0.26],
        [0.72, 0.1, 0.66],
        [1.08, -0.07, 0.99],
      ];
  const ids: number[][] = [];
  for (const [rr, depth, q] of rings) {
    const row: number[] = [];
    const n = rr === 0 ? 1 : segs;
    for (let s = 0; s < n; s++) {
      const a = roll + (s / segs) * Math.PI * 2;
      const dir = add(mul(right, Math.cos(a)), mul(up, Math.sin(a)));
      const p = add(add(at, mul(dir, rr * r)), mul(f, -depth * r));
      const nrm = norm(add(f, mul(dir, rr === 0 ? 0 : 0.35 - depth * 0.6)));
      const ta = a - roll;
      row.push(b.v(p, nrm, grey(0.95 + 0.05 * q, 1), plantUv(PLANT_CELL.petunia, 0.5 + 0.5 * q * Math.cos(ta), 0.5 - 0.5 * q * Math.sin(ta), 0.01)));
    }
    ids.push(row);
  }
  for (let i = 0; i + 1 < ids.length; i++) {
    const r0 = ids[i]!;
    const r1 = ids[i + 1]!;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      if (r0.length === 1) b.tri(r0[0]!, r1[s]!, r1[s1]!);
      else {
        b.tri(r0[s]!, r1[s]!, r1[s1]!);
        b.tri(r0[s]!, r1[s1]!, r0[s1]!);
      }
    }
  }
}

/** A pansy face (r 2.8-3.4 cm): a cupped disc carrying the face picture, upper petals up. 16 triangles (simple: 6). */
function pansyFace(b: GeoBuilder, at: Vec3, face: Vec3, r: number, roll: number, simple: boolean): void {
  const { f, right, up } = faceBasis(face);
  const segs = simple ? 6 : 8;
  const c = b.v(add(at, mul(f, -r * 0.08)), f, grey(1, 1), plantUv(PLANT_CELL.pansy, 0.5, 0.5, 0.01));
  const ring = (rr: number, fwd: number) => {
    const out: number[] = [];
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const ca = Math.cos(a + roll);
      const sa = Math.sin(a + roll);
      const p = add(add(at, add(mul(right, ca * rr * r), mul(up, sa * rr * r))), mul(f, fwd * r));
      out.push(b.v(p, norm(add(f, add(mul(right, -ca * 0.3), mul(up, -sa * 0.3)))), grey(1, 1), plantUv(PLANT_CELL.pansy, 0.5 + 0.5 * rr * 0.92 * Math.cos(a), 0.5 - 0.5 * rr * 0.92 * Math.sin(a), 0.01)));
    }
    return out;
  };
  if (simple) {
    const rim = ring(1.08, 0.08);
    for (let s = 0; s < segs; s++) b.tri(c, rim[s]!, rim[(s + 1) % segs]!);
    return;
  }
  const mid = ring(0.5, 0.0);
  const rim = ring(1.08, 0.13);
  for (let s = 0; s < segs; s++) {
    const s1 = (s + 1) % segs;
    b.tri(c, mid[s]!, mid[s1]!);
    b.tri(mid[s]!, rim[s]!, rim[s1]!);
  }
  // fill the 8 remaining quads' other halves
  for (let s = 0; s < segs; s++) {
    const s1 = (s + 1) % segs;
    b.tri(mid[s]!, rim[s1]!, mid[s1]!);
  }
}

/** A French marigold head (r 2.2-2.8 cm): a domed pompom carrying the head picture over a green calyx cup. */
function marigoldHead(b: GeoBuilder, at: Vec3, face: Vec3, r: number, roll: number, simple: boolean): void {
  const { f, right, up } = faceBasis(face);
  const segs = simple ? 6 : 9;
  const top = b.v(add(at, mul(f, r * 0.62)), f, grey(1, 1), plantUv(PLANT_CELL.marigold, 0.5, 0.5, 0.01));
  const ringAt = (rr: number, h: number, q: number, k: number) => {
    const out: number[] = [];
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const ca = Math.cos(a + roll);
      const sa = Math.sin(a + roll);
      const dir = add(mul(right, ca), mul(up, sa));
      out.push(b.v(add(add(at, mul(dir, rr * r)), mul(f, h * r)), norm(add(f, mul(dir, 0.9 - h))), grey(k, 1), plantUv(PLANT_CELL.marigold, 0.5 + 0.5 * q * Math.cos(a), 0.5 - 0.5 * q * Math.sin(a), 0.01)));
    }
    return out;
  };
  const mid = simple ? null : ringAt(0.7, 0.42, 0.62, 1);
  const rim = ringAt(1.05, 0.0, 0.98, 0.9);
  const first = mid ?? rim;
  for (let s = 0; s < segs; s++) b.tri(top, first[s]!, first[(s + 1) % segs]!);
  if (mid)
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      b.tri(mid[s]!, rim[s]!, rim[s1]!);
      b.tri(mid[s]!, rim[s1]!, mid[s1]!);
    }
  // the calyx: a green cup under the rim
  const calyx = rgba("#4E7A2E");
  const bottom = b.v(add(at, mul(f, -r * 0.5)), mul(f, -1), calyx);
  const cring: number[] = [];
  for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2 + roll;
    const dir = add(mul(right, Math.cos(a)), mul(up, Math.sin(a)));
    cring.push(b.v(add(add(at, mul(dir, r * 0.8)), mul(f, -r * 0.05)), dir, calyx));
  }
  for (let s = 0; s < segs; s++) b.tri(bottom, cring[(s + 1) % segs]!, cring[s]!);
}

/** A grape-hyacinth spike (4.5-6 cm, r 1 cm): bells round a column, tapering to the pale tip. */
function muscariSpike(b: GeoBuilder, base: Vec3, dir: Vec3, length: number, r: number, simple: boolean): void {
  const d = norm(dir);
  const n = simple ? 2 : 5;
  const pts: Vec3[] = [];
  const radii: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(add(base, mul(d, length * t)));
    radii.push(i === n ? r * 0.3 : r * (1 - 0.45 * t * t) * (simple ? 1 : 1 + 0.06 * Math.cos(t * Math.PI * 3)));
  }
  uvTube(b, pts, radii, simple ? 4 : 6, PLANT_CELL.muscari, () => grey(1, 1), 1, 0.02);
}

/** A tulip cup of six streaked petals (3 + 3), on its stem. */
function tulipCup(b: GeoBuilder, base: Vec3, height: number, lean: Vec3, r: number, roll: number, simple: boolean): void {
  const top = add(add(base, [0, height, 0]), mul(lean, height));
  stalk(b, [base, add(add(base, [0, height * 0.55, 0]), mul(lean, height * 0.4)), top], 0.0045, 0.0038, rgba("#6E9A3E"));
  const upv = norm(add([0, 1, 0], mul(lean, 0.8)));
  const [t0, b0] = basis(upv);
  const n = simple ? 3 : 6;
  for (let k = 0; k < n; k++) {
    const a = roll + (k / n) * Math.PI * 2 + (k % 2 ? 0.15 : 0);
    const dir = add(mul(t0, Math.cos(a)), mul(b0, Math.sin(a)));
    const side = norm(cross(upv, dir));
    const inner = k % 2 === 1;
    const rr = r * (inner ? 0.88 : 1);
    const h = r * 2.3 * (inner ? 0.95 : 1);
    const mid = add(add(top, mul(upv, h * 0.45)), mul(dir, rr * 1.05));
    const tip = add(add(top, mul(upv, h)), mul(dir, rr * 0.72));
    const w1 = rr * (simple ? 1.1 : 0.85);
    const w2 = rr * 0.55;
    const c = grey(1, 1);
    const P = PLANT_CELL.tulip;
    const v0 = b.v(top, dir, grey(0.8, 1), plantUv(P, 0.5, 1));
    const ml = b.v(add(mid, mul(side, -w1)), add(dir, mul(side, -0.5)), c, plantUv(P, 0, 0.55));
    const mr = b.v(add(mid, mul(side, w1)), add(dir, mul(side, 0.5)), c, plantUv(P, 1, 0.55));
    const mm = b.v(add(mid, mul(dir, rr * 0.12)), dir, c, plantUv(P, 0.5, 0.55));
    const tl = b.v(add(tip, mul(side, -w2)), dir, c, plantUv(P, 0.2, 0.08));
    const tr = b.v(add(tip, mul(side, w2)), dir, c, plantUv(P, 0.8, 0.08));
    const tt = b.v(add(add(tip, mul(upv, rr * 0.25)), mul(dir, -rr * 0.05)), dir, c, plantUv(P, 0.5, 0));
    b.tri(v0, ml, mm);
    b.tri(v0, mm, mr);
    b.tri(ml, tl, mm);
    b.tri(mm, tl, tt);
    b.tri(mm, tt, tr);
    b.tri(mm, tr, mr);
  }
}

/** A strap leaf (muscari, tulip): a long tapering blade with parallel veins, arching over. */
function strapLeaf(b: GeoBuilder, base: Vec3, dir: Vec3, length: number, width: number, col: Rgba, droop: number, simple: boolean): void {
  const d = norm(dir);
  const side = norm(cross(d, [0, 1, 0]));
  const n = norm(cross(side, d));
  const rows = simple ? 2 : 4;
  const ids: number[][] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const c = add(add(base, mul(d, length * t)), mul(n, -droop * length * t * t));
    const w = (width / 2) * (i === rows ? 0.05 : 1 - 0.55 * t * t);
    const k = 0.7 + 0.3 * t;
    ids.push([
      b.v(add(c, mul(side, -w)), n, [col[0] * k, col[1] * k, col[2] * k, col[3]], plantUv(PLANT_CELL.strap, 0, 1 - t)),
      b.v(add(c, mul(side, w)), n, [col[0] * k, col[1] * k, col[2] * k, col[3]], plantUv(PLANT_CELL.strap, 1, 1 - t)),
    ]);
  }
  for (let i = 0; i < rows; i++) {
    const [a0, b0] = ids[i]!;
    const [a1, b1] = ids[i + 1]!;
    b.tri(a0!, b0!, b1!);
    b.tri(a0!, b1!, a1!);
  }
}

const LEAF_COL = {
  petunia: grey(0.95, 0),
  pansy: grey(0.95, 0),
  marigold: grey(0.95, 0),
};

/** A petunia mound, 28-34 cm across and 16-20 cm high: 16 soft leaves, 8 trumpets on the mound's surface. */
export function petuniaPlant2(simple: boolean, seed = 1): BufferGeometry {
  const b = builder(0.2);
  const rand = mulberry32(seed);
  const leaves = simple ? 7 : 18;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rand() * 0.5;
    const el = (i % 3 === 0 ? 0.7 : 0.15) + rand() * 0.45;
    const dir: Vec3 = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
    const base: Vec3 = [Math.cos(a) * 0.03, 0.02 + rand() * (i % 3 === 0 ? 0.08 : 0.04), Math.sin(a) * 0.03];
    const k = 0.65 + 0.35 * Math.min(1, base[1] / 0.08);
    texLeaf(b, base, dir, [0, 1, 0], (simple ? 0.12 : 0.075) + rand() * 0.03, simple ? 0.075 : 0.045, PLANT_CELL.leafPetunia, grey(LEAF_COL.petunia[0] * k, 0), { fill: 0.6, droop: 0.3, simple });
  }
  const flowers = simple ? 6 : 8;
  for (let i = 0; i < flowers; i++) {
    const a = (i / flowers) * Math.PI * 2 + rand() * 0.7;
    const el = i === 0 ? 1.35 : 0.3 + rand() * 0.8;
    const out: Vec3 = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
    const at: Vec3 = [out[0] * 0.13, 0.06 + out[1] * 0.1, out[2] * 0.13];
    petuniaFlower(b, at, norm(add(out, [0, 0.6, 0])), simple ? 0.042 : 0.031 + rand() * 0.006, rand() * 6.28, simple);
  }
  return b.build();
}

/** A pansy rosette (15-18 cm): 10 scalloped leaves, 6 faces held up 8-15 cm on stalks toward the light. */
export function pansyPlant2(simple: boolean, seed = 2): BufferGeometry {
  const b = builder(0.16);
  const rand = mulberry32(seed);
  const leaves = simple ? 5 : 11;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rand() * 0.4;
    const el = 0.2 + rand() * 0.55;
    texLeaf(b, [0, 0.01 + rand() * 0.02, 0], [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)], [0, 1, 0], (simple ? 0.1 : 0.065) + rand() * 0.02, simple ? 0.06 : 0.042, PLANT_CELL.leafPansy, grey(0.85 + 0.15 * rand(), 0), {
      droop: 0.35,
      simple,
    });
  }
  const faces = simple ? 4 : 7;
  for (let i = 0; i < faces; i++) {
    const a = (i / faces) * Math.PI * 2 + rand() * 0.8;
    const rr = 0.02 + rand() * 0.06;
    const h = 0.09 + rand() * 0.07;
    const at: Vec3 = [Math.cos(a) * rr, h, Math.sin(a) * rr];
    if (!simple) stalk(b, [[Math.cos(a) * 0.01, 0, Math.sin(a) * 0.01], [Math.cos(a) * rr * 0.7, h * 0.6, Math.sin(a) * rr * 0.7], sub(at, [0, 0.01, 0])], 0.0024, 0.0017, rgba("#5B8A33"));
    const face = norm([Math.cos(a) * 0.5 + 0.12, 0.85, Math.sin(a) * 0.5 - 0.08]);
    pansyFace(b, at, face, simple ? 0.036 : 0.028 + rand() * 0.007, (rand() - 0.5) * 0.35, simple);
  }
  return b.build();
}

/** A clump of grape hyacinths: 8 arching strap leaves, 5 spikes of bells on 10-15 cm stalks. */
export function muscariPlant2(simple: boolean, seed = 3): BufferGeometry {
  const b = builder(0.18);
  const rand = mulberry32(seed);
  const leaves = simple ? 4 : 8;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rand() * 0.6;
    const el = 0.7 + rand() * 0.4;
    strapLeaf(b, [0, 0, 0], [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)], 0.16 + rand() * 0.06, 0.009, rgba("#5F8A3A"), 0.5, simple);
  }
  const spikes = simple ? 3 : 5;
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 + rand() * 0.9;
    const rr = 0.01 + rand() * 0.035;
    const h = 0.075 + rand() * 0.06;
    const lean: Vec3 = [Math.cos(a) * 0.12, 1, Math.sin(a) * 0.12];
    const sbase: Vec3 = [Math.cos(a) * rr, h, Math.sin(a) * rr];
    stalk(b, [[Math.cos(a) * 0.006, 0, Math.sin(a) * 0.006], sbase], 0.0024, 0.002, rgba("#6E8A52"));
    muscariSpike(b, sub(sbase, [0, 0.005, 0]), lean, simple ? 0.055 : 0.042 + rand() * 0.016, simple ? 0.012 : 0.0105, simple);
  }
  return b.build();
}

/** Two or three tulips (stems 25-35 cm), each with two broad strap leaves. */
export function tulipPlant2(simple: boolean, seed = 4, stems = simple ? 2 : 3): BufferGeometry {
  const b = builder(0.35);
  const rand = mulberry32(seed);
  const n = stems;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.8;
    const at: Vec3 = [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05];
    const lean: Vec3 = [Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08];
    for (let k = 0; k < (simple ? 1 : 2); k++) {
      const la = a + (k ? 2.4 : -0.7) + rand() * 0.5;
      const el = 0.95 + rand() * 0.3;
      strapLeaf(b, at, [Math.cos(la) * Math.cos(el), Math.sin(el), Math.sin(la) * Math.cos(el)], 0.17 + rand() * 0.05, 0.045, rgba("#7A9E62"), 0.45, simple);
    }
    tulipCup(b, at, 0.26 + rand() * 0.1, lean, simple ? 0.026 : 0.021, rand() * 6.28, simple);
  }
  return b.build();
}

/** A rooted bedding sprig for shallow sill boxes and entrance borders, with each bloom
 * and leaf growing from the same crown. Keep the pedicels even on the phone mesh. */
export function planterSprig(species: "pansy" | "petunia", simple: boolean, seed = 7): BufferGeometry {
  const b = builder(0.16);
  const rand = mulberry32(seed);
  const leaves = simple ? 4 : 7;
  const tips = simple ? 2 : 3;
  const pansy = species === "pansy";
  for (let i = 0; i < leaves; i++) {
    const a = i * 2.4 + rand() * 0.5;
    texLeaf(b, [0, 0.012, 0], [Math.cos(a), 0.28 + rand() * 0.55, Math.sin(a)], [0, 1, 0],
      0.08 + rand() * 0.045, 0.047 + rand() * 0.015, pansy ? PLANT_CELL.leafPansy : PLANT_CELL.leafPetunia,
      grey(0.77 + rand() * 0.21, 0), { simple, fold: 0.27, droop: 0.38 });
  }
  for (let i = 0; i < tips; i++) {
    const a = (i + rand() * 0.4) * 2 * Math.PI / tips;
    const radius = 0.045 + rand() * 0.035;
    const x = radius * Math.cos(a), z = radius * Math.sin(a), h = 0.12 + rand() * 0.055;
    const tip: Vec3 = [x, h, z];
    const stem: Vec3[] = simple ? [[0, 0, 0], tip] : [[0, 0, 0], [x * 0.75, h * 0.57, z * 0.75], tip];
    stalk(b, stem, 0.0037, 0.0021, rgba("#58823b"));
    const face = norm([Math.cos(a), 0.6 + rand() * 0.6, Math.sin(a)]);
    if (pansy) pansyFace(b, tip, face, 0.033, a, simple);
    else petuniaFlower(b, add(tip, mul(face, 0.025)), face, 0.038, a, simple);
  }
  return b.build();
}

/** A French marigold (18-24 cm): 13 arching pinnate fronds, 6 domed pompom heads 5.4-6.8 cm just above them. */
export function marigoldPlant(simple: boolean, seed = 6): BufferGeometry {
  const b = builder(0.24);
  const rand = mulberry32(seed);
  const fronds = simple ? 6 : 13;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rand() * 0.5;
    const el = (i % 2 ? 0.35 : 0.75) + rand() * 0.35;
    const base: Vec3 = [Math.cos(a) * 0.02, 0.02 + (i % 2 ? 0 : 0.06) + rand() * 0.03, Math.sin(a) * 0.02];
    texLeaf(b, base, [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)], [0, 1, 0], (simple ? 0.13 : 0.1) + rand() * 0.03, simple ? 0.085 : 0.065, PLANT_CELL.leafMarigold, grey(0.75 + 0.25 * Math.min(1, base[1] / 0.08), 0), {
      fill: 0.75,
      droop: 0.3,
      fold: 0.15,
      simple,
    });
  }
  const heads = simple ? 4 : 6;
  for (let i = 0; i < heads; i++) {
    const a = (i / heads) * Math.PI * 2 + rand() * 0.8;
    const rr = i === 0 ? 0.005 : 0.04 + rand() * 0.05;
    const h = 0.12 + rand() * 0.06 - rr * 0.5;
    const at: Vec3 = [Math.cos(a) * rr, h, Math.sin(a) * rr];
    if (!simple) stalk(b, [[Math.cos(a) * 0.01, 0, Math.sin(a) * 0.01], [Math.cos(a) * rr * 0.6, h * 0.6, Math.sin(a) * rr * 0.6], sub(at, [0, 0.01, 0])], 0.0035, 0.0025, rgba("#5E8A36"));
    marigoldHead(b, at, norm([Math.cos(a) * rr * 4, 1, Math.sin(a) * rr * 4]), simple ? 0.034 : 0.027 + rand() * 0.007, rand() * 6.28, simple);
  }
  return b.build();
}

/** The species' meshes in flowerPlacement.SPECIES order: petunia, pansy, muscari, tulip, grass, reed, marigold. */
export function plantMeshes(): Array<{ lod0: BufferGeometry; lod1: BufferGeometry }> {
  return [
    { lod0: petuniaPlant2(false), lod1: petuniaPlant2(true) },
    { lod0: pansyPlant2(false), lod1: pansyPlant2(true) },
    { lod0: muscariPlant2(false), lod1: muscariPlant2(true) },
    { lod0: tulipPlant2(false), lod1: tulipPlant2(true) },
    { lod0: grassTuft(false, "grass"), lod1: grassTuft(true, "grass") },
    { lod0: grassTuft(false, "reed"), lod1: grassTuft(true, "reed") },
    { lod0: marigoldPlant(false), lod1: marigoldPlant(true) },
  ];
}

