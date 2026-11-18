import { BufferGeometry, DoubleSide, Float32BufferAttribute, MeshStandardMaterial, Uint32BufferAttribute } from "three";
import { mulberry32 } from "./creek/creekStones";

/**
 * Plants that float or stand in still water, made from numbers at load time (no model file): lily pads (round leaves with a wedge cut
 * to the middle, a cupped rim, veins in the vertex colour), lotus leaves (bigger, raised on a thin stalk, a bowl), and flowers with
 * layered petals around a yellow heart (open, or a closed bud). Every plant of a water body is merged into ONE geometry (one draw),
 * coloured in the vertices; the material is the water body's own `plantMaterial`. Deterministic (seeded), unit-tested (waterPlants.test.ts).
 */

export interface LeafSpec {
  x: number;
  /** The water surface (m) the leaf rests on, or for a raised lotus leaf the height of its middle. */
  y: number;
  z: number;
  /** Radius (m). */
  r: number;
  yaw: number;
  seed: number;
  /** 0.8 .. 1.2: a multiplier on the green. */
  tone: number;
  /** A raised lotus leaf stands on a stalk from this height (m, the bed); a floating pad has none (NaN). */
  stalkFrom?: number;
  /** How deep the bowl is (fraction of r, 0 flat .. 0.5 a cup). */
  cup: number;
}

export interface FlowerSpec {
  x: number;
  /** The base of the bloom (m): the water surface for a lily, the top of the stalk for a lotus. */
  y: number;
  z: number;
  /** Radius of the open bloom (m). */
  r: number;
  yaw: number;
  seed: number;
  /** 0 closed bud .. 1 fully open. */
  open: number;
  /** A stalk from this height (m, the bed); NaN for a lily (it sits on the water). */
  stalkFrom?: number;
  /** 0 white .. 1 deep pink (lotus). */
  pink: number;
}

class Builder {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  vert(x: number, y: number, z: number, r: number, g: number, b: number): number {
    this.pos.push(x, y, z);
    this.col.push(r, g, b);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  geometry(): BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    g.setIndex(new Uint32BufferAttribute(this.idx, 1));
    g.computeVertexNormals();
    return g;
  }
}

const RINGS = 3;
const SEGS = 18;

/** A round leaf (a pad or a lotus leaf): a fan of three rings around the middle, a wedge cut out, the rim turned up by `cup`. */
function addLeaf(b: Builder, s: LeafSpec): void {
  const rnd = mulberry32(s.seed * 17 + 3);
  const notch = (0.28 + rnd() * 0.12) * 0.5; // half-angle of the cut (rad / pi)
  const notchAt = rnd() * Math.PI * 2;
  const raised = s.stalkFrom !== undefined && Number.isFinite(s.stalkFrom);
  const rows: number[][] = [];
  const wob = rnd() * 6.28;
  for (let k = 0; k <= RINGS; k++) {
    const t = k / RINGS;
    const row: number[] = [];
    const segs = k === 0 ? 1 : SEGS;
    for (let i = 0; i <= segs; i++) {
      const a = k === 0 ? 0 : notchAt + notch * Math.PI + (i / SEGS) * (Math.PI * 2 - notch * 2 * Math.PI);
      const rr = s.r * t * (1 + 0.05 * Math.sin(a * 3 + wob) + 0.03 * Math.sin(a * 7 + wob * 2)) * (k === 0 ? 0 : 1);
      const lx = Math.cos(a + s.yaw) * rr;
      const lz = Math.sin(a + s.yaw) * rr;
      // a bowl: the rim up, the middle low; a lotus leaf lifts into a shallow dish
      const y = s.y + s.cup * s.r * t * t * (1 + 0.15 * Math.sin(a * 2 + wob));
      // veins: the middle paler, a faint ray pattern, the rim darker
      const vein = 0.93 + 0.07 * Math.cos(a * 9 + wob) * t;
      const g = s.tone * (0.5 + 0.5 * (1 - t * 0.55)) * vein;
      row.push(b.vert(s.x + lx, y, s.z + lz, 0.1 * g, 0.3 * g, 0.07 * g));
    }
    rows.push(row);
  }
  // middle fan
  for (let i = 0; i < SEGS; i++) b.tri(rows[0]![0]!, rows[1]![i]!, rows[1]![i + 1]!);
  for (let k = 1; k < RINGS; k++) {
    for (let i = 0; i < SEGS; i++) {
      const a = rows[k]![i]!, c = rows[k]![i + 1]!, d = rows[k + 1]![i]!, e = rows[k + 1]![i + 1]!;
      b.tri(a, d, c);
      b.tri(c, d, e);
    }
  }
  if (raised) addStalk(b, s.x, s.z, s.stalkFrom!, s.y, 0.011, 0.07, 0.2, 0.05, s.seed);
}

/** A thin three-sided stalk from `y0` to `y1`, leaning a little. */
function addStalk(b: Builder, x: number, z: number, y0: number, y1: number, w: number, r: number, g: number, bl: number, seed: number): void {
  const rnd = mulberry32(seed * 13 + 5);
  const lean = (rnd() - 0.5) * 0.12;
  const la = rnd() * 6.28;
  const rings = 3;
  const base: number[][] = [];
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const cx = x + Math.cos(la) * lean * t * t;
    const cz = z + Math.sin(la) * lean * t * t;
    const row: number[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const tone = 0.7 + 0.5 * t;
      row.push(b.vert(cx + Math.cos(a) * w * (1 - 0.3 * t), y0 + (y1 - y0) * t, cz + Math.sin(a) * w * (1 - 0.3 * t), r * tone, g * tone, bl * tone));
    }
    base.push(row);
  }
  for (let k = 0; k < rings; k++) {
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const a = base[k]![i]!, c = base[k]![j]!, d = base[k + 1]![i]!, e = base[k + 1]![j]!;
      b.tri(a, d, c);
      b.tri(c, d, e);
    }
  }
}

/** A bloom: two rings of curved petals (outer wide and lying, inner narrow and upright) round a yellow heart. */
function addFlower(b: Builder, f: FlowerSpec): void {
  const rnd = mulberry32(f.seed * 29 + 11);
  const stalked = f.stalkFrom !== undefined && Number.isFinite(f.stalkFrom);
  if (stalked) addStalk(b, f.x, f.z, f.stalkFrom!, f.y, 0.012, 0.18, 0.3, 0.1, f.seed);
  const layers = [
    { n: 8, len: f.r, wid: f.r * 0.42, tilt: 0.25 + 0.95 * f.open, lift: 0.0, shade: 1.0 },
    { n: 7, len: f.r * 0.82, wid: f.r * 0.36, tilt: 0.12 + 0.55 * f.open, lift: f.r * 0.1, shade: 1.06 },
    { n: 6, len: f.r * 0.6, wid: f.r * 0.3, tilt: 0.05 + 0.3 * f.open, lift: f.r * 0.2, shade: 1.1 },
  ];
  const pinkC = [0.95, 0.5 + 0.3 * (1 - f.pink), 0.62 + 0.28 * (1 - f.pink)];
  layers.forEach((L, li) => {
    for (let p = 0; p < L.n; p++) {
      const a0 = f.yaw + (p / L.n) * Math.PI * 2 + li * 0.35 + (rnd() - 0.5) * 0.15;
      const rows = 4;
      const grid: number[][] = [];
      for (let k = 0; k <= rows; k++) {
        const t = k / rows;
        // along the petal: out and curling up, then the tip leaning back
        const outward = L.len * Math.sin(t * (0.5 + L.tilt) * 1.2) * 0.9 + L.len * 0.04;
        const up = L.lift + L.len * (1 - Math.cos(t * (L.tilt * 1.3 + 0.1))) * 0.85 + (t > 0.8 ? 0.0 : 0);
        const half = L.wid * 0.5 * Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.95)) * (1 - 0.1 * t);
        const row: number[] = [];
        for (const side of [-1, 0, 1]) {
          const ang = a0 + (side * half) / Math.max(outward, 0.02) * 0.9;
          const rad = side === 0 ? outward : Math.hypot(outward, half * 0.4);
          // the petal's middle bulges out (a cupped petal): the edges lie back
          const px = f.x + Math.cos(ang) * rad;
          const pz = f.z + Math.sin(ang) * rad;
          const py = f.y + up + (side === 0 ? 0 : -f.r * 0.05 * t);
          // white at the foot, pink at the tip (lotus); a lily is white with a yellow heart
          const tint = Math.min(1, 0.12 + t * 0.95);
          const sh = L.shade * (0.94 + 0.06 * rnd());
          row.push(b.vert(px, py, pz, (1 - tint * (1 - pinkC[0]!) * f.pink) * sh * 0.98, (1 - tint * (1 - pinkC[1]!) * f.pink) * sh * 0.96, (1 - tint * (1 - pinkC[2]!) * f.pink) * sh * 0.95));
        }
        grid.push(row);
      }
      for (let k = 0; k < rows; k++) {
        for (let s = 0; s < 2; s++) {
          const a = grid[k]![s]!, c = grid[k]![s + 1]!, d = grid[k + 1]![s]!, e = grid[k + 1]![s + 1]!;
          b.tri(a, d, c);
          b.tri(c, d, e);
        }
      }
    }
  });
  // the yellow heart: a small cone of stamens
  const hc = b.vert(f.x, f.y + f.r * 0.32, f.z, 0.95, 0.78, 0.18);
  const ring: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ring.push(b.vert(f.x + Math.cos(a) * f.r * 0.17, f.y + f.r * 0.12, f.z + Math.sin(a) * f.r * 0.17, 0.9, 0.62, 0.1));
  }
  for (let i = 0; i < 8; i++) b.tri(hc, ring[i]!, ring[(i + 1) % 8]!);
}

/** The plants' material: lit, coloured in the vertices, two-sided (leaves and petals are single sheets). */
export function plantMaterial(name: string): MeshStandardMaterial {
  return new MeshStandardMaterial({ name, vertexColors: true, side: DoubleSide, roughness: 0.55, metalness: 0 });
}

/** Every leaf and flower of a water body in one geometry (null when there are none). */
export function plantGeometry(leaves: readonly LeafSpec[], flowers: readonly FlowerSpec[]): BufferGeometry | null {
  const b = new Builder();
  for (const l of leaves) addLeaf(b, l);
  for (const f of flowers) addFlower(b, f);
  return b.geometry();
}
