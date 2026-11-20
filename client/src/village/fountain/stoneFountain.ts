import {
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  Points,
  ShaderMaterial,
  Sphere,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
  type Material,
  type WebGLRenderer,
} from "three";
import { G, TIME_WRAP, wrapTime } from "../fountainLayout";
import { makeFountainNoise } from "../fountainWater";
import type { DayNightState } from "../dayNightBlend";

/**
 * A turned stone fountain with real water (fix/gate-fountain-park), for 케이슨랜드's gate lot and the park's star fountain.
 *
 * The owner on the old ones: "케이슨 랜드 입구에 이거 분수니 뭐니? 너무 허접하잖아" (an octagonal granite trough with hard
 * facets, a crude bowl and a spike, the "water" flat see-through glass skirts) and, of the park's, "여기도 너무 허접하다"
 * (a plain basin, a baluster, a flat yellow star, eight straight blue sticks for jets). Both are drawn here from a
 * `FountainDesign`: numbers, the way the plaza fountain is (fountainLayout.ts), so the shapes are unit-testable.
 *
 *  - Stone (`buildFountainStone`): every piece is a profile turned on the lathe with enough sides that no facet shows at
 *    eye level, sharp arrises kept where the profile turns a corner (the ring is doubled there, smooth elsewhere), carved
 *    detail as a function of the angle (gadroons under a bowl, sunk panels round a basin, a scalloped lip). UVs are metres
 *    (u round the ring, quantised so the seam tiles; v down the profile), so a library stone set lies at its real scale.
 *    The faces the water wets are a second group (`STONE_GROUP.wet`): the caller gives them a darker, glossier material.
 *  - Water (`createStoneFountainWater`): the pools (a rippling surface: two scrolling noise normals, rings running out from
 *    where the water lands, foam there, the sky's Fresnel reflection and the sun's glint, the basin's floor through it),
 *    the curtains (sheets over each lip on their parabola: a glassy film at the top with flowing grain that tears into
 *    strands and white water as it falls), the jets (ribbons along their parabola, turned to the camera, clear at the
 *    nozzle and fraying into streaks), and the drops (one point draw: splashes where every sheet and jet lands, drips off
 *    the curtains, drops peeling off the jets), all moved on the GPU from a wrapped clock. Day and night follow
 *    `DayNightState` (the sky in the water by day; the underwater lights in the water and the white water at night).
 *
 * Cost (gate, PC): stone ~16k triangles in 2 draws, water 4 draws (pools, curtains, jets, drops). The light tier halves the
 * lathe's sides and the curtains' rings and keeps about a quarter of the drops.
 */

// ───────────────────────────────────────── the design ─────────────────────────────────────────

export type ProfilePoint = readonly [number, number];

/** One turned piece: its profile (r, y), outside first, traversed so the outside of the stone is on its right. */
export interface FountainPiece {
  profile: readonly ProfilePoint[];
  /** Linear RGB tint (the vertex colour, multiplies the stone's albedo). */
  tint: readonly [number, number, number];
  /** Carving: the radius's factor at angle `a` (rad) for a profile point `(r, y)` (1: plain). */
  carve?: (a: number, r: number, y: number) => number;
  /** Sides on the PC tier (default 96; the light tier takes half). */
  sides?: number;
  /** Copies of the piece at these offsets (x, y, z) instead of one on the axis (the rim's piers). */
  copies?: ReadonlyArray<readonly [number, number, number]>;
}

export interface FountainPool {
  /** The water's height (m) and radius (the stone's inside wall there). */
  y: number;
  r: number;
}

export interface FountainCurtain {
  /** The lip it falls over (r, y) and the water it falls into (its height and which pool). */
  lipR: number;
  lipY: number;
  pool: number;
  /** Outward speed over the lip (m/s): with the fall's time it sets where the sheet lands. */
  out: number;
  /** The sheet falls as this many streams (the lip's pour points; default one every 15 cm round the lip). */
  streams?: number;
}

export interface FountainJetRing {
  count: number;
  angle0: number;
  /** The nozzle (r, y, m), the launch (out: m/s away from the axis, negative toward it; up: m/s). */
  r: number;
  y: number;
  out: number;
  up: number;
  /** The pool it lands in. */
  pool: number;
  /** Diameter at the nozzle and at the end (m). */
  width: readonly [number, number];
}

export interface FountainDesign {
  pieces: readonly FountainPiece[];
  pools: readonly FountainPool[];
  curtains: readonly FountainCurtain[];
  jets: readonly FountainJetRing[];
  /** How wet the stone is at (r, y) (0 dry .. 1 running wet): the wet faces' group. */
  wet: (r: number, y: number) => number;
  /** The lights under the water: their colour (linear) and the pools they sit in. */
  glow: readonly [number, number, number];
  /** Bounding radius and height (m) for culling. */
  radius: number;
  height: number;
  /** The stone's texture density (x the metre UVs: 2 shows a set's grain at half size, a finer-grained stone). */
  uvScale?: number;
}

/** A circular arc of profile points: centre (cx, cy), radius, from angle a0 to a1 (degrees, 0 = +r, 90 = +y), n steps. */
export function arc(cx: number, cy: number, rad: number, a0: number, a1: number, n: number): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  return out;
}

/** Concatenate profile runs, dropping a point that repeats the previous one. */
export function profile(...runs: ReadonlyArray<readonly ProfilePoint[] | ProfilePoint>): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (const run of runs) {
    const pts = (typeof run[0] === "number" ? [run] : run) as readonly ProfilePoint[];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[0] - p[0]) < 1e-5 && Math.abs(last[1] - p[1]) < 1e-5) continue;
      out.push(p);
    }
  }
  return out;
}

/** A straight run from a to b in n steps (extra rings where carving needs them). */
export function run(a: ProfilePoint, b: ProfilePoint, n: number): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  return out;
}

// ───────────────────────────────────────── the stone ─────────────────────────────────────────

/** The stone's two groups (materials): dry, and wet (darker, glossier). */
export const STONE_GROUP = { dry: 0, wet: 1 } as const;
/** A corner sharper than this (degrees between the profile's segments) keeps a hard arris (the ring is doubled). */
export const CREASE_DEG = 38;
/** The stone sets tile every metre: u round a ring is quantised to whole metres so the seam is invisible. */
const U_TILE = 1;

/** Sides of a piece on a tier. */
export function pieceSides(piece: FountainPiece, low: boolean): number {
  const s = piece.sides ?? 96;
  return low ? Math.min(s, Math.max(12, Math.round(s / 2 / 4) * 4)) : s;
}

/**
 * Turn the design's pieces into one geometry (metre UVs, a tint per piece in `color`, the wet faces in group 1).
 * Triangles: sum over pieces of 2 x sides x (profile segments).
 */
export function buildFountainStone(design: FountainDesign, low: boolean): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const dry: number[] = [];
  const wet: number[] = [];
  const seams: Array<[number, number]> = [];
  for (const piece of design.pieces) for (const off of piece.copies ?? [[0, 0, 0] as const]) {
    const sides = pieceSides(piece, low);
    const prof = piece.profile;
    // rings: one per profile point, two at a crease (each segment then has its own edge vertices)
    type Ring = { p: ProfilePoint; v: number; seg: number };
    const rings: Ring[] = [];
    let v = 0;
    for (let j = 0; j < prof.length; j++) {
      if (j > 0) v += Math.hypot(prof[j]![0] - prof[j - 1]![0], prof[j]![1] - prof[j - 1]![1]);
      const prev = j > 0 ? prof[j - 1]! : null;
      const next = j < prof.length - 1 ? prof[j + 1]! : null;
      let crease = false;
      if (prev && next) {
        const d0 = [prof[j]![0] - prev[0], prof[j]![1] - prev[1]];
        const d1 = [next[0] - prof[j]![0], next[1] - prof[j]![1]];
        const c = (d0[0]! * d1[0]! + d0[1]! * d1[1]!) / (Math.hypot(d0[0]!, d0[1]!) * Math.hypot(d1[0]!, d1[1]!) || 1);
        crease = Math.acos(Math.max(-1, Math.min(1, c))) > (CREASE_DEG * Math.PI) / 180;
      }
      if (prev) rings.push({ p: prof[j]!, v, seg: j - 1 });
      if (next && (crease || !prev)) rings.push({ p: prof[j]!, v, seg: j });
      else if (next && prev) rings[rings.length - 1]!.seg = -1; // shared by both segments
    }
    // vertex rows
    const rowStart: number[] = [];
    const us = design.uvScale ?? 1;
    for (const ring of rings) {
      const [r, y] = ring.p;
      const circ = Math.max(U_TILE, Math.round((2 * Math.PI * r * us) / U_TILE) * U_TILE);
      rowStart.push(pos.length / 3);
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const k = piece.carve ? piece.carve(a, r, y) : 1;
        const rr = r * k;
        pos.push(off[0] + rr * Math.cos(a), off[1] + y, off[2] + rr * Math.sin(a));
        uv.push((i / sides) * circ, ring.v * us);
        col.push(piece.tint[0], piece.tint[1], piece.tint[2]);
      }
      seams.push([rowStart[rowStart.length - 1]!, rowStart[rowStart.length - 1]! + sides]);
    }
    // quads between consecutive rings that belong to the same segment
    for (let k = 0; k + 1 < rings.length; k++) {
      const A = rings[k]!;
      const B = rings[k + 1]!;
      if (A.p === B.p) continue; // the two rings of one crease
      const [r0, y0] = A.p;
      const [r1, y1] = B.p;
      // the outside is on the right of the profile's direction: n = (dy, -dr)
      const nr = y1 - y0;
      const ny = -(r1 - r0);
      const midR = (r0 + r1) / 2;
      const midY = (y0 + y1) / 2;
      const target = design.wet(midR, midY) > 0.5 ? wet : dry;
      // winding: for theta increasing (a -> b) and the profile going down the list (a -> c), (a, c, b) faces
      // d(theta) x d(profile)'s opposite; pick by the sign against the expected normal at theta 0
      const dTheta = [0, 0, 1]; // d/dθ at θ = 0: +z
      const dProf = [r1 - r0, y1 - y0, 0];
      const cx = dTheta[1]! * dProf[2]! - dTheta[2]! * dProf[1]!;
      const cy = dTheta[2]! * dProf[0]! - dTheta[0]! * dProf[2]!;
      const flip = cx * nr + cy * ny < 0;
      const s0 = rowStart[k]!;
      const s1 = rowStart[k + 1]!;
      for (let i = 0; i < sides; i++) {
        const a = s0 + i;
        const b = s0 + i + 1;
        const c = s1 + i;
        const d = s1 + i + 1;
        if (flip) target.push(a, c, b, b, c, d);
        else target.push(a, b, c, b, d, c);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setIndex([...dry, ...wet]);
  g.addGroup(0, dry.length, STONE_GROUP.dry);
  g.addGroup(dry.length, wet.length, STONE_GROUP.wet);
  g.computeVertexNormals();
  // the seam's two columns are separate vertices: give both the same normal
  const n = g.getAttribute("normal") as Float32BufferAttribute;
  for (const [a, b] of seams) {
    const x = n.getX(a) + n.getX(b);
    const y = n.getY(a) + n.getY(b);
    const z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
  g.boundingSphere = new Sphere(new Vector3(0, design.height / 2, 0), Math.hypot(design.radius, design.height / 2));
  return g;
}

// ───────────────────────────────────────── the water: geometry ─────────────────────────────────────────

/** How a curtain falls: its time from the lip to the water, and where it lands. */
export function curtainFall(design: FountainDesign, c: FountainCurtain): { fall: number; landR: number; landY: number } {
  const landY = design.pools[c.pool]!.y;
  const fall = Math.sqrt((2 * Math.max(0.01, c.lipY - landY)) / G);
  return { fall, landR: c.lipR + c.out * fall, landY };
}

/** A jet's flight from its nozzle to its pool's water (s), and where it lands (r). */
export function jetFlight(design: FountainDesign, j: FountainJetRing): { flight: number; landR: number; landY: number; apexY: number } {
  const landY = design.pools[j.pool]!.y;
  const disc = j.up * j.up + 2 * G * (j.y - landY);
  const flight = (j.up + Math.sqrt(Math.max(0, disc))) / G;
  return { flight, landR: j.r + j.out * flight, landY, apexY: j.y + (j.up * j.up) / (2 * G) };
}

/** The pools as discs (a few rings each, so the vertex count carries the ripples' falloff smoothly): `aPool` which one. */
export function buildPoolGeometry(design: FountainDesign, low: boolean): BufferGeometry {
  const pos: number[] = [];
  const pool: number[] = [];
  const idx: number[] = [];
  const sides = low ? 48 : 96;
  design.pools.forEach((p, k) => {
    const rings = 4;
    const base = pos.length / 3;
    pos.push(0, p.y, 0);
    pool.push(k);
    for (let j = 1; j <= rings; j++) {
      const r = (p.r + 0.01) * Math.sqrt(j / rings);
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        pos.push(r * Math.cos(a), p.y, r * Math.sin(a));
        pool.push(k);
      }
    }
    for (let i = 0; i < sides; i++) idx.push(base, base + 1 + ((i + 1) % sides), base + 1 + i);
    for (let j = 1; j < rings; j++) {
      const r0 = base + 1 + (j - 1) * sides;
      const r1 = base + 1 + j * sides;
      for (let i = 0; i < sides; i++) {
        const i1 = (i + 1) % sides;
        idx.push(r0 + i, r0 + i1, r1 + i, r0 + i1, r1 + i1, r1 + i);
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("aPool", new Float32BufferAttribute(pool, 1));
  g.setIndex(idx);
  g.boundingSphere = new Sphere(new Vector3(0, design.height / 2, 0), Math.hypot(design.radius, design.height / 2));
  return g;
}

/** The curtains: a ring mesh per curtain, each row a moment of the fall (`aCur`: angle, time since the lip, fall time, which). */
export function buildCurtainGeometry(design: FountainDesign, low: boolean): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const cur: number[] = [];
  const idx: number[] = [];
  const down = low ? 6 : 12;
  design.curtains.forEach((c, which) => {
    const { fall } = curtainFall(design, c);
    const around = Math.max(24, Math.round(((low ? 40 : 80) * c.lipR) / 4) * 4 + (low ? 16 : 32));
    const base = pos.length / 3;
    for (let j = 0; j <= down; j++) {
      const tau = (j / down) ** 1.3 * fall;
      const r = c.lipR + c.out * tau;
      const y = c.lipY - 0.5 * G * tau * tau;
      const nr = G * tau;
      const ny = c.out;
      const nl = Math.hypot(nr, ny) || 1;
      for (let i = 0; i <= around; i++) {
        const a = (2 * Math.PI * i) / around;
        pos.push(r * Math.cos(a), y, r * Math.sin(a));
        nor.push((nr / nl) * Math.cos(a), ny / nl, (nr / nl) * Math.sin(a));
        cur.push(a, tau, fall, which);
      }
    }
    for (let j = 0; j < down; j++)
      for (let i = 0; i < around; i++) {
        const a = base + j * (around + 1) + i;
        const b = a + around + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setAttribute("aCur", new Float32BufferAttribute(cur, 4));
  g.setIndex(idx);
  g.boundingSphere = new Sphere(new Vector3(0, design.height / 2, 0), Math.hypot(design.radius, design.height / 2));
  return g;
}

/** The jets as ribbons: every vertex placed on its jet's parabola by the vertex shader (`aJet`: share, side, flight, seed). */
export function buildJetGeometry(design: FountainDesign, low: boolean): BufferGeometry {
  const origin: number[] = [];
  const vel: number[] = [];
  const jet: number[] = [];
  const shape: number[] = [];
  const idx: number[] = [];
  const segs = low ? 14 : 28;
  let seed = 0;
  for (const ring of design.jets) {
    const { flight } = jetFlight(design, ring);
    for (let k = 0; k < ring.count; k++) {
      const a = ring.angle0 + (2 * Math.PI * k) / ring.count;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const base = origin.length / 3;
      for (let i = 0; i <= segs; i++) {
        for (const side of [-1, 1]) {
          origin.push(ring.r * c, ring.y, ring.r * s);
          vel.push(ring.out * c, ring.up, ring.out * s);
          jet.push(i / segs, side, flight, seed);
          shape.push(ring.width[0], ring.width[1], 0, 0);
        }
        if (i < segs) {
          const q = base + i * 2;
          idx.push(q, q + 1, q + 2, q + 2, q + 1, q + 3);
        }
      }
      seed++;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(origin, 3)); // replaced in the shader; kept for three's bookkeeping
  g.setAttribute("aVel", new Float32BufferAttribute(vel, 3));
  g.setAttribute("aJet", new Float32BufferAttribute(jet, 4));
  g.setAttribute("aShape", new Float32BufferAttribute(shape, 4));
  g.setIndex(idx);
  g.boundingSphere = new Sphere(new Vector3(0, design.height / 2, 0), Math.hypot(design.radius, design.height / 2));
  return g;
}

/** A tiny seeded random (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a drop is (the shader's `kind`). */
export const DROP_KIND = { splash: 0, drip: 1, jet: 2 } as const;

/**
 * The drops: each a point launched from `aFrom` (r, y, angle, kind) with `aVel` (out, up, life, phase) and a size; it
 * lives `life` s (until it is back in the water), its cycle offset by `phase`. Splashes leap up where a sheet or a jet
 * lands, drips fall from a curtain's strands, jet drops peel off a jet. Counts per tier: `DROP_BUDGET`.
 */
export const DROP_BUDGET = {
  high: { splashPerM: 22, dripPerM: 9, jetDrops: 18, jetSplash: 10 },
  low: { splashPerM: 6, dripPerM: 2, jetDrops: 5, jetSplash: 3 },
} as const;

export function buildDropGeometry(design: FountainDesign, low: boolean): { geometry: BufferGeometry; count: number } {
  const from: number[] = [];
  const vel: number[] = [];
  const size: number[] = [];
  const b = DROP_BUDGET[low ? "low" : "high"];
  const rand = rng(1234);
  const flight = (vUp: number, dy: number) => (vUp + Math.sqrt(Math.max(0, vUp * vUp + 2 * G * dy))) / G;
  const push = (r: number, y: number, a: number, kind: number, out: number, up: number, life: number, s: number) => {
    from.push(r, y, a, kind);
    vel.push(out, up, life, rand() * TIME_WRAP);
    size.push(s);
  };
  design.curtains.forEach((c) => {
    const { fall, landR, landY } = curtainFall(design, c);
    const ring = 2 * Math.PI * landR;
    const nSplash = Math.round(ring * b.splashPerM);
    for (let i = 0; i < nSplash; i++) {
      const a = rand() * Math.PI * 2;
      const up = 0.5 + rand() * 0.9 * Math.min(1, fall * 2.2);
      const out = (rand() - 0.35) * 0.55;
      push(landR + (rand() - 0.5) * 0.05, landY + 0.01, a, DROP_KIND.splash, out, up, flight(up, 0), 0.012 + rand() * 0.014);
    }
    const nDrip = Math.round(2 * Math.PI * c.lipR * b.dripPerM);
    for (let i = 0; i < nDrip; i++) {
      const a = rand() * Math.PI * 2;
      // a drop leaves the sheet where it tears (a third of the way down) with the sheet's own speed
      const t0 = fall * (0.3 + rand() * 0.35);
      const r0 = c.lipR + c.out * t0 + 0.015;
      const y0 = c.lipY - 0.5 * G * t0 * t0;
      const vy = -G * t0;
      push(r0, y0, a, DROP_KIND.drip, c.out * (0.9 + rand() * 0.4), vy, flight(vy, y0 - landY), 0.01 + rand() * 0.01);
    }
  });
  design.jets.forEach((j) => {
    const f = jetFlight(design, j);
    for (let k = 0; k < j.count; k++) {
      const a = j.angle0 + (2 * Math.PI * k) / j.count;
      for (let i = 0; i < b.jetDrops; i++) {
        // a drop peeling off after the apex: the jet's own launch, a little scatter
        const up = j.up * (0.94 + rand() * 0.1);
        const out = j.out * (0.9 + rand() * 0.2) + (rand() - 0.5) * 0.25;
        push(j.r, j.y, a + (rand() - 0.5) * 0.04, DROP_KIND.jet, out, up, flight(up, j.y - f.landY), 0.012 + rand() * 0.012);
      }
      for (let i = 0; i < b.jetSplash; i++) {
        const up = 0.6 + rand() * 1.1;
        const out = (rand() - 0.5) * 0.7 + Math.sign(j.out) * 0.2;
        push(f.landR + (rand() - 0.5) * 0.1, f.landY + 0.01, a + (rand() - 0.5) * 0.06, DROP_KIND.splash, out, up, flight(up, 0), 0.014 + rand() * 0.016);
      }
    }
  });
  const g = new BufferGeometry();
  const count = from.length / 4;
  g.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute("aFrom", new Float32BufferAttribute(from, 4));
  g.setAttribute("aVel", new Float32BufferAttribute(vel, 4));
  g.setAttribute("aSize", new Float32BufferAttribute(size, 1));
  g.boundingSphere = new Sphere(new Vector3(0, design.height / 2, 0), Math.hypot(design.radius, design.height / 2));
  return { geometry: g, count };
}

// ───────────────────────────────────────── the water: shaders ─────────────────────────────────────────

const f = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

const COMMON = /* glsl */ `
uniform float uTime;
uniform sampler2D uNoise;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform vec3 uAmbient;    // the sky's light on white water
uniform vec3 uKeyDir;     // toward the sun or the moon
uniform vec3 uKeyColor;   // its light on white water
uniform vec3 uGlint;      // its glint on a clear surface
uniform vec3 uGlow;       // the underwater lights (0 by day)
uniform vec3 uDeep;       // the water's own colour seen into it
vec3 swSky( vec3 d ) {
  float h = clamp( d.y, 0.0, 1.0 );
  return mix( uSkyHor, uSkyTop, pow( h, 0.55 ) ) * ( d.y < 0.0 ? 0.55 : 1.0 );
}
float swForward( float c ) {
  float d = 1.0 + 0.36 - 1.2 * c;
  return 0.64 / ( d * sqrt( d ) );
}
vec3 swWhite( vec3 V, float forward ) {
  float hg = min( swForward( dot( -uKeyDir, V ) ), 3.0 );
  return uAmbient + uKeyColor * ( 0.4 + 0.6 * mix( 1.0, hg, forward ) );
}
`;

const POOL_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute float aPool;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vPool;
void main() {
  vLocal = position;
  vPool = aPool;
  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  vWorld = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

function poolFragment(design: FountainDesign): string {
  // per pool: where the sheets land (r), where the jets land (r), the pool's radius, the lights' share
  const land = design.pools.map((_, k) => {
    const c = design.curtains.find((x) => x.pool === k);
    const j = design.jets.find((x) => x.pool === k);
    return [c ? curtainFall(design, c).landR : -9, j ? jetFlight(design, j).landR : -9, design.pools[k]!.r, j ? 1 : 0];
  });
  const jetAngles = design.jets.map((j) => [j.count, j.angle0, j.pool]);
  const landRows = land.map((l, k) => `if ( k == ${k} ) return vec4( ${l.map(f).join(", ")} );`).join("\n  ");
  const jetRow = jetAngles.length ? `vec3( ${jetAngles[0]!.map(f).join(", ")} )` : "vec3( 0.0, 0.0, -1.0 )";
  return /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${COMMON}
varying vec3 vWorld;
varying vec3 vLocal;
varying float vPool;
vec4 poolLand( int k ) {
  ${landRows}
  return vec4( -9.0, -9.0, 1.0, 0.0 );
}
// a ring wave running out (and in) from a landing circle: height and its radial slope
vec2 ringWave( float r, float landR, float k, float speed, float amp, float reach ) {
  float d = r - landR;
  float env = exp( -abs( d ) * reach ) * amp;
  float ph = abs( d ) * k - uTime * speed;
  return vec2( sin( ph ) * env, cos( ph ) * k * env * sign( d ) );
}
void main() {
  int k = int( vPool + 0.5 );
  vec4 L = poolLand( k );
  vec2 p = vLocal.xz;
  float r = length( p );
  vec2 radial = r > 1e-4 ? p / r : vec2( 1.0, 0.0 );
  // fine ripples: two scrolling noise fields, their slopes by finite differences
  float e = 0.04;
  vec2 q1 = p * 0.9 + vec2( 0.013, 0.021 ) * uTime;
  vec2 q2 = p * 2.3 - vec2( 0.031, -0.017 ) * uTime;
  float h0 = texture2D( uNoise, q1 ).r + 0.45 * texture2D( uNoise, q2 ).g;
  float hx = texture2D( uNoise, q1 + vec2( e, 0.0 ) ).r + 0.45 * texture2D( uNoise, q2 + vec2( e * 2.55, 0.0 ) ).g;
  float hz = texture2D( uNoise, q1 + vec2( 0.0, e ) ).r + 0.45 * texture2D( uNoise, q2 + vec2( 0.0, e * 2.55 ) ).g;
  vec2 slope = vec2( hx - h0, hz - h0 ) / e * 0.022;
  // rings from where the sheet lands (busy: the whole circle is falling water) and from the jets' landing points
  vec2 w1 = ringWave( r, L.x, 38.0, 9.0, 0.010, 2.2 );
  slope += radial * w1.y;
  if ( L.y > 0.0 ) {
    float ang = atan( p.y, p.x );
    vec3 J = ${jetRow};
    float cell = 6.2831853 / max( J.x, 1.0 );
    float kk = floor( ( ang - J.y ) / cell + 0.5 );
    float aj = J.y + kk * cell;
    vec2 c = vec2( cos( aj ), sin( aj ) ) * L.y;
    vec2 dp = p - c;
    float dj = length( dp );
    float env = exp( -dj * 3.0 ) * 0.014;
    float ph = dj * 42.0 - uTime * 10.0;
    slope += ( dj > 1e-4 ? dp / dj : vec2( 0.0 ) ) * cos( ph ) * 42.0 * env;
  }
  vec3 N = normalize( vec3( -slope.x, 1.0, -slope.y ) );
  vec3 V = normalize( cameraPosition - vWorld );
  float cosT = clamp( dot( N, V ), 0.0, 1.0 );
  float F = 0.02 + 0.98 * pow( 1.0 - cosT, 5.0 );
  vec3 R = reflect( -V, N );
  vec3 refl = swSky( R ) + uGlint * pow( max( dot( R, uKeyDir ), 0.0 ), 700.0 ) * 14.0;
  // foam where the sheet lands: a lacy band (the noise's Worley walls) that churns
  float dL = abs( r - L.x );
  float band = exp( -dL * dL / 0.006 );
  float lace = texture2D( uNoise, vec2( atan( p.y, p.x ) * 4.0 + uTime * 0.05, r * 7.0 - uTime * 0.35 ) ).b;
  float lace2 = texture2D( uNoise, p * 7.3 + vec2( uTime * 0.11, -uTime * 0.07 ) ).b;
  float fine = texture2D( uNoise, p * 13.0 - vec2( uTime * 0.05, uTime * 0.09 ) ).a;
  float foam = band * smoothstep( 0.3, 0.7, lace * 0.55 + lace2 * 0.45 + fine * 0.3 - 0.1 ) * 0.9;
  float trail = exp( -dL * 7.0 ) * smoothstep( 0.55, 0.8, lace2 * 0.7 + fine * 0.5 ) * 0.3;
  if ( L.y > 0.0 ) {
    float dJ = abs( r - L.y );
    foam += exp( -dJ * dJ / 0.012 ) * smoothstep( 0.35, 0.7, lace * 0.6 + fine * 0.5 ) * 0.7;
  }
  foam = clamp( foam + trail, 0.0, 1.0 );
  // the water seen into: the basin's floor shows through near the vertical, the sky in it at a grazing view
  float body = mix( 0.42, 0.18, cosT );
  vec3 deep = uDeep;
  // the lights under the water at night: brightest round the lights, a little everywhere
  float glowAt = 0.25 + 0.75 * exp( -abs( r - L.z * 0.72 ) * 2.5 );
  deep += uGlow * glowAt * 0.9;
  float a = clamp( body + F * 0.9, 0.0, 1.0 );
  vec3 col = ( deep * body + refl * F * 0.9 ) / max( a, 1e-3 );
  vec3 white = swWhite( V, 0.2 ) + uGlow * 0.6;
  col = mix( col, white, foam * 0.85 );
  a = mix( a, 1.0, foam * 0.85 );
  // softly into the stone wall (no hard seam where the disc meets the basin)
  a *= smoothstep( L.z + 0.012, L.z - 0.03, r );
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
}

const CURTAIN_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aCur;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec4 vCur;
void main() {
  vCur = aCur;
  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  vWorld = worldPosition.xyz;
  vNormalW = normalize( mat3( modelMatrix ) * normal );
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** How many streams a curtain falls as. */
export function curtainStreams(c: FountainCurtain): number {
  return c.streams ?? Math.max(12, Math.round((2 * Math.PI * c.lipR) / 0.15));
}

function curtainFragment(design: FountainDesign): string {
  const lips = design.curtains
    .map((c, k) => `if ( k == ${k} ) return vec3( ${f(c.lipR)}, ${f(curtainFall(design, c).landY)}, ${f(curtainStreams(c))} );`)
    .join("\n  ");
  return /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${COMMON}
uniform vec3 uOrigin;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec4 vCur;
vec3 curtainLip( int k ) {
  ${lips}
  return vec3( 1.0, 0.0, 16.0 );
}
void main() {
  int which = int( vCur.w + 0.5 );
  vec3 lip = curtainLip( which );
  float along = vCur.x * lip.x;           // metres round the lip
  float launch = uTime - vCur.y;          // when this water went over the lip
  float t = vCur.y / vCur.z;              // 0 at the lip .. 1 at the water
  // the streams: the water pours over the lip at its low points, each stream necking as it falls and swaying a little
  float cell = vCur.x / 6.2831853 * lip.z;
  float id = floor( cell + 0.5 );
  float seed = fract( sin( id * 17.13 + vCur.w * 3.7 ) * 43758.55 );
  float sway = ( texture2D( uNoise, vec2( id * 0.137 + vCur.w * 0.29, launch * 0.6 ) ).r - 0.5 ) * 0.35 * t;
  float fc = cell - id + sway;
  float seed2 = fract( seed * 7.31 + 0.17 );
  float halfW = mix( 0.44, 0.15 + 0.08 * seed2, sqrt( t ) ) * ( 0.7 + 0.6 * seed );
  float across = fc / halfW;               // -1..1 across the stream
  float inStream = 1.0 - smoothstep( 0.7, 1.0, abs( across ) );
  // a thin film joins the streams just over the lip (the water spilling round it)
  float film = ( 1.0 - smoothstep( 0.0, 0.16, t ) ) * 0.85;
  float shape = max( inStream, film );
  float g1 = texture2D( uNoise, vec2( along * 11.0, launch * 2.4 ) ).a;
  float g2 = texture2D( uNoise, vec2( along * 4.1 + 0.5, launch * 1.1 ) ).g;
  float grain = g1 * 0.6 + g2 * 0.4;
  float n2 = texture2D( uNoise, vec2( across * 0.21 + id * 0.291, launch * 11.0 ) ).g;
  float n3 = texture2D( uNoise, vec2( across * 0.43 + id * 0.077, launch * 23.0 ) ).a;
  float tear = smoothstep( 0.25, 0.85, t );
  // the stream's end breaks into drops
  float drops = smoothstep( 0.25, 0.5, texture2D( uNoise, vec2( along * 7.3 + 0.21, launch * 7.0 ) ).a );
  shape *= mix( 1.0, drops, smoothstep( 0.72, 1.0, t ) );
  vec3 V = normalize( cameraPosition - vWorld );
  vec3 around = normalize( vec3( -( vWorld.z - uOrigin.z ), 0.0, vWorld.x - uOrigin.x ) );
  // each stream is a rounded rod: its normal turns sideways across it (bright Fresnel edges, a clear middle)
  float ac = clamp( across, -1.0, 1.0 ) * inStream;
  vec3 n = normalize( vNormalW * sqrt( max( 0.0, 1.0 - ac * ac ) ) + around * ac + around * ( g2 - 0.5 ) * 0.4 );
  if ( !gl_FrontFacing ) n = -n;
  float cosT = abs( dot( n, V ) );
  float F = 0.02 + 0.98 * pow( 1.0 - cosT, 5.0 );
  vec3 R = reflect( -V, n );
  vec3 refl = swSky( R ) * 0.95 + uGlint * pow( max( dot( R, uKeyDir ), 0.0 ), 300.0 ) * 6.0;
  float lipLine = 1.0 - smoothstep( 0.0, 0.08, t );
  float glassA = ( 0.16 + 0.75 * F + 0.25 * lipLine + 0.12 * grain ) * ( 1.0 - 0.45 * tear );
  // aerated white water: streaks down each stream, more as it falls
  float streak = smoothstep( 0.45 - 0.25 * tear, 0.92, n2 * 0.55 + n3 * 0.45 + 0.15 * inStream );
  float whiteA = ( 0.08 + 0.62 * tear * streak + 0.18 * tear * smoothstep( 0.45, 0.8, grain ) ) * inStream;
  vec3 white = swWhite( V, 0.45 ) + uGlow * ( 0.4 + 0.9 * t );
  refl += uGlow * 0.25;
  float a = whiteA + glassA * ( 1.0 - whiteA );
  vec3 col = ( white * whiteA + ( refl + uDeep * 0.35 ) * glassA * ( 1.0 - whiteA ) ) / max( a, 1e-3 );
  a *= shape;
  a *= smoothstep( 0.0, 0.03, vWorld.y - uOrigin.y - lip.y );
  gl_FragColor = vec4( col, clamp( a, 0.0, 1.0 ) );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
}

const JET_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
uniform vec2 uViewport;
attribute vec3 aVel;
attribute vec4 aJet;   // share of the flight, side, flight (s), seed
attribute vec4 aShape; // width at the nozzle, at the end
varying vec3 vWorld;
varying vec3 vSide;
varying vec2 vUS;
varying float vTl;
varying float vCover;
varying float vSeed;
void main() {
  float s = aJet.x;
  float t = s * aJet.z;
  float tl = uTime - t;
  // the jet sways a little with the time its water left the nozzle (each parcel keeps its own launch)
  vec3 v = aVel;
  vec3 h = vec3( v.x, 0.0, v.z );
  float hl = length( h );
  vec3 lat = hl > 1e-3 ? vec3( -h.z, 0.0, h.x ) / hl : vec3( 1.0, 0.0, 0.0 );
  v = v * ( 1.0 + 0.008 * sin( 2.9 * tl + aJet.w * 5.3 ) ) + lat * 0.025 * sin( 1.7 * tl + aJet.w * 7.1 );
  vec3 p = position + v * t;
  p.y -= 0.5 * ${f(G)} * t * t;
  vec3 tang = normalize( vec3( v.x, v.y - ${f(G)} * t, v.z ) + vec3( 0.0, 1e-4, 0.0 ) );
  vec3 world = ( modelMatrix * vec4( p, 1.0 ) ).xyz;
  vec3 toCam = cameraPosition - world;
  float dist = length( toCam );
  toCam /= max( dist, 1e-4 );
  vec3 side = cross( tang, toCam );
  float sl = length( side );
  side = sl > 1e-3 ? side / sl : vec3( 1.0, 0.0, 0.0 );
  float w = mix( aShape.x, aShape.y, s ) * ( 1.0 + 1.6 * smoothstep( 0.45, 1.0, s ) );
  float pxPerM = 0.5 * uViewport.y * projectionMatrix[ 1 ][ 1 ] / max( dist, 1e-3 );
  float wDraw = max( w, 1.5 / pxPerM );
  vCover = w / wDraw;
  world += side * ( aJet.y * 0.5 * wDraw );
  vWorld = world;
  vSide = side;
  vUS = vec2( aJet.y, s );
  vTl = tl;
  vSeed = aJet.w;
  vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const JET_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${COMMON}
varying vec3 vWorld;
varying vec3 vSide;
varying vec2 vUS;
varying float vTl;
varying float vCover;
varying float vSeed;
void main() {
  float u = vUS.x;
  float s = vUS.y;
  float b = smoothstep( 0.38, 0.95, s );
  vec3 V = normalize( cameraPosition - vWorld );
  float n1 = texture2D( uNoise, vec2( u * 0.05 + vSeed * 0.137, vTl * 3.0 ) ).r;
  float n2 = texture2D( uNoise, vec2( u * 0.21 + vSeed * 0.291, vTl * 11.0 ) ).g;
  float n3 = texture2D( uNoise, vec2( u * 0.43 + vSeed * 0.077, vTl * 23.0 ) ).a;
  float core = ( 1.0 / ( 1.0 + 1.6 * b ) ) * ( 1.0 + 0.5 * b * ( n1 * 2.0 - 1.0 ) );
  float uc = u / max( core, 0.05 );
  float inCore = 1.0 - smoothstep( 0.85, 1.0, abs( uc ) );
  float ucl = clamp( uc, -1.0, 1.0 );
  vec3 n = normalize( vSide * ucl + V * sqrt( max( 0.0, 1.0 - ucl * ucl ) ) );
  float cosT = clamp( dot( n, V ), 0.0, 1.0 );
  float F = 0.02 + 0.98 * pow( 1.0 - cosT, 5.0 );
  vec3 R = reflect( -V, n );
  vec3 refl = swSky( R ) * 0.9 + uGlint * pow( max( dot( R, uKeyDir ), 0.0 ), 600.0 ) * 8.0;
  float glassA = ( 0.22 + 0.8 * F ) * inCore * ( 1.0 - 0.7 * b );
  float veil = exp( -u * u * 2.6 ) * b;
  float streak = smoothstep( 0.42 - 0.26 * b, 0.9, n2 * 0.55 + n3 * 0.45 + 0.3 * inCore );
  float whiteA = veil * streak * ( 0.5 + 0.5 * b ) + inCore * ( 1.0 - b ) * 0.12;
  vec3 white = swWhite( V, 0.8 ) + uGlow * ( 0.5 + 1.2 * exp( -1.5 * s ) );
  refl += uGlow * 0.3;
  float a = whiteA + glassA * ( 1.0 - whiteA );
  vec3 col = ( white * whiteA + refl * glassA * ( 1.0 - whiteA ) ) / max( a, 1e-3 );
  a *= vCover * mix( 1.0, 0.4, smoothstep( 0.85, 1.0, s ) );
  gl_FragColor = vec4( col, clamp( a, 0.0, 1.0 ) );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const DROP_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
uniform vec2 uViewport;
uniform float uPxScale;
attribute vec4 aFrom; // r, y, angle, kind
attribute vec4 aVel;  // out, up, life, phase
attribute float aSize;
varying float vAlpha;
varying float vKind;
void main() {
  float life = max( aVel.z, 0.05 );
  float cyc = uTime + aVel.w;
  float t = mod( cyc, life );
  // each cycle a slightly different place round the ring (the same drop never repeats on the spot)
  float n = floor( cyc / life );
  float a = aFrom.z + ( fract( sin( n * 12.9898 + aVel.w ) * 43758.5453 ) - 0.5 ) * ( aFrom.w < 0.5 ? 0.5 : 0.02 );
  vec2 dir = vec2( cos( a ), sin( a ) );
  float r = aFrom.x + aVel.x * t;
  vec3 p = vec3( dir.x * r, aFrom.y + aVel.y * t - 0.5 * ${f(G)} * t * t, dir.y * r );
  vec4 mvPosition = modelViewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  float pxPerM = 0.5 * uViewport.y * projectionMatrix[ 1 ][ 1 ] / max( -mvPosition.z, 1e-3 );
  float px = aSize * pxPerM * uPxScale;
  gl_PointSize = clamp( px, 1.5, 24.0 );
  // fainter where a drop is drawn bigger than it is, in at birth, out as it meets the water
  vAlpha = clamp( px / gl_PointSize, 0.15, 1.0 ) * smoothstep( 0.0, 0.06, t ) * ( 1.0 - smoothstep( life - 0.05, life, t ) );
  vKind = aFrom.w;
  #include <fog_vertex>
}
`;

const DROP_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${COMMON}
varying float vAlpha;
varying float vKind;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot( c, c );
  if ( d > 1.0 ) discard;
  float body = 1.0 - smoothstep( 0.35, 1.0, d );
  vec3 col = swWhite( vec3( 0.0, 0.3, 1.0 ), 0.9 ) * 1.05 + uGlow * 1.2 + uGlint * 0.3 * ( 1.0 - d );
  gl_FragColor = vec4( col, body * vAlpha * 0.85 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ───────────────────────────────────────── the water: assembly ─────────────────────────────────────────

/** Draw order among the water's parts (after the opaque stone). */
export const WATER_ORDER = { pool: 2, curtain: 3, jets: 4, drops: 5 } as const;

/** How the white water and the glint take the day's light (as the plaza fountain's: fountainWater.ts WHITE_WATER_LIGHT). */
const LIGHT = { ambient: 0.26, key: 0.11, glint: 0.6 } as const;

export interface StoneFountainWater {
  group: Group;
  uniforms: Record<string, IUniform>;
  /** Per frame: the clock (seconds; wrapped here) and the time of day (number writes only). */
  update(seconds: number, s: DayNightState | null): void;
  /** Draws in the group (for the budget). */
  draws: number;
  own: Array<Material | BufferGeometry | DataTexture>;
}

const vp = new Vector4();

export function createStoneFountainWater(design: FountainDesign, low: boolean, noise?: DataTexture): StoneFountainWater {
  const tex = noise ?? makeFountainNoise();
  const glow = new Vector3(...design.glow);
  const uniforms: Record<string, IUniform> = {
    uTime: { value: 0 },
    uNoise: { value: tex },
    uSkyTop: { value: new Vector3(0.32, 0.52, 0.85) },
    uSkyHor: { value: new Vector3(0.75, 0.83, 0.9) },
    uAmbient: { value: new Vector3(0.5, 0.52, 0.55) },
    uKeyDir: { value: new Vector3(0.5, 0.7, -0.4).normalize() },
    uKeyColor: { value: new Vector3(0.3, 0.28, 0.24) },
    uGlint: { value: new Vector3(0.9, 0.86, 0.78) },
    uGlow: { value: new Vector3(0, 0, 0) },
    uDeep: { value: new Vector3(0.05, 0.11, 0.1) },
    uOrigin: { value: new Vector3() },
    uViewport: { value: new Vector2(1280, 720) },
    uPxScale: { value: 1 },
  };
  const material = (name: string, vertexShader: string, fragmentShader: string, extra: Partial<ConstructorParameters<typeof ShaderMaterial>[0]> = {}) => {
    const m = new ShaderMaterial({
      name,
      uniforms: { ...UniformsUtils.clone(UniformsLib.fog), ...uniforms },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: DoubleSide,
      ...extra,
    });
    m.forceSinglePass = true;
    return m;
  };
  const group = new Group();
  group.name = "stone_fountain_water";
  const own: StoneFountainWater["own"] = noise ? [] : [tex];

  const poolGeo = buildPoolGeometry(design, low);
  const poolMat = material("M_sf_pool", POOL_VERTEX, poolFragment(design), { side: DoubleSide });
  const pool = new Mesh(poolGeo, poolMat);
  pool.name = "sf_pools";
  pool.renderOrder = WATER_ORDER.pool;
  group.add(pool);
  own.push(poolGeo, poolMat);

  const viewport = (renderer: WebGLRenderer) => {
    renderer.getCurrentViewport(vp);
    (uniforms.uViewport!.value as Vector2).set(Math.max(1, vp.z), Math.max(1, vp.w));
  };
  let draws = 1;
  if (design.curtains.length) {
    const g = buildCurtainGeometry(design, low);
    const m = material("M_sf_curtain", CURTAIN_VERTEX, curtainFragment(design));
    const mesh = new Mesh(g, m);
    mesh.name = "sf_curtains";
    mesh.renderOrder = WATER_ORDER.curtain;
    group.add(mesh);
    own.push(g, m);
    draws++;
  }
  if (design.jets.length) {
    const g = buildJetGeometry(design, low);
    const m = material("M_sf_jets", JET_VERTEX, JET_FRAGMENT);
    const mesh = new Mesh(g, m);
    mesh.name = "sf_jets";
    mesh.renderOrder = WATER_ORDER.jets;
    mesh.frustumCulled = true;
    mesh.onBeforeRender = (renderer) => viewport(renderer);
    group.add(mesh);
    own.push(g, m);
    draws++;
  }
  const drops = buildDropGeometry(design, low);
  if (drops.count) {
    const m = material("M_sf_drops", DROP_VERTEX, DROP_FRAGMENT);
    const pts = new Points(drops.geometry, m);
    pts.name = "sf_drops";
    pts.renderOrder = WATER_ORDER.drops;
    pts.onBeforeRender = (renderer) => viewport(renderer);
    pts.raycast = () => {};
    group.add(pts);
    own.push(drops.geometry, m);
    draws++;
  }
  for (const c of group.children) c.raycast = () => {};
  const origin = uniforms.uOrigin!.value as Vector3;
  const update = (seconds: number, s: DayNightState | null) => {
    uniforms.uTime!.value = wrapTime(seconds);
    group.getWorldPosition(origin);
    if (!s) return;
    const a = s.hemiIntensity * LIGHT.ambient;
    (uniforms.uAmbient!.value as Vector3).set(s.hemiSky[0] * a, s.hemiSky[1] * a, s.hemiSky[2] * a);
    const k = s.keyIntensity * LIGHT.key;
    (uniforms.uKeyColor!.value as Vector3).set(s.keyColor[0] * k, s.keyColor[1] * k, s.keyColor[2] * k);
    (uniforms.uKeyDir!.value as Vector3).set(s.keyDir[0], s.keyDir[1], s.keyDir[2]).normalize();
    const lv = Math.min(1, s.keyIntensity / 2.4) * LIGHT.glint;
    (uniforms.uGlint!.value as Vector3).set(s.keyColor[0] * lv, s.keyColor[1] * lv, s.keyColor[2] * lv);
    // the sky in the water: its horizon and its zenith, dimmed with the day
    const sky = s.sky;
    const dim = 0.25 + 0.75 * s.day;
    (uniforms.uSkyHor!.value as Vector3).set(sky[0] * 0.95 * dim, sky[1] * 0.95 * dim, sky[2] * 0.95 * dim);
    const top = s.hemiSky;
    (uniforms.uSkyTop!.value as Vector3).set(top[0] * 0.62 * dim, top[1] * 0.72 * dim, top[2] * 0.95 * dim);
    (uniforms.uDeep!.value as Vector3).set(0.05 * dim + 0.01, 0.11 * dim + 0.015, 0.1 * dim + 0.02);
    const gl = s.lights;
    (uniforms.uGlow!.value as Vector3).set(glow.x * gl, glow.y * gl, glow.z * gl);
  };
  return { group, uniforms, update, draws, own };
}

/** The noise the water reads (64 px, tiling; see fountainWater.ts). */
export { makeFountainNoise };
