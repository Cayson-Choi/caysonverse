/**
 * Ridge tiles for the houses' gable roofs (third exteriors pass, 2026-11-27; first 2026-11-18). The model's ridge is a squashed
 * half tube in the flat tile texture on a white mortar strip: from above it read as "one thin white line" (audit house_7 air),
 * and the old cap here found the chimney hood's top instead of the ridge (so it was never drawn). A real Alsace roof carries a
 * row of separate half-round ridge tiles (Firstziegel), each lapping the next with a step, bedded in mortar down to the tiles.
 * Per house:
 *
 *  - `ridgeLine` finds the main ridge in the merged world roof geometry: the highest level whose vertices run more than 3 m
 *    (the chimney hood and the dormers' little ridges are shorter or lower), and the roof's pitch from the slope just below it;
 *  - `ridgeTiles` lays 0.45 m tapered half-round tiles every ~0.39 m along it (8 sides, each wide end standing over the narrow
 *    end before it, closed ends at the gables, mortar skirts down to the slope), each tile's UVs on one tile body of the roof sheet (clay, its own
 *    kiln tone), in the roof's own material, merged with the roof (no extra draw).
 *
 * 16 triangles per ridge tile, ~30 tiles per house: ~0.5 k triangles per house, ~5 k for the ten (always-drawn shells).
 */
import { BufferAttribute, BufferGeometry } from "three";
import type { SceneryHouse } from "@caysonverse/shared/village/villageLayout";

type Frame = Pick<SceneryHouse, "id" | "centre">;
type V3 = [number, number, number];

/** The ridge tiles' numbers (m). */
export const RIDGE = {
  /** Half width of a tile's narrow end, and its height over the model ridge's bed line. */
  radius: 0.15,
  rise: 0.12,
  /** The wide end is this much bigger (the lap step). */
  lap: 0.014,
  length: 0.45,
  pitch: 0.39,
  sides: 8,
  overhang: 0.05,
  /** The roof sheet's tiles: 11 per row, 14 rows (house_textures.json LM_roof, make_house_fresh_textures.py). */
  sheetTiles: 11,
  sheetRows: 14,
} as const;

export interface RidgeLine {
  a: V3;
  b: V3;
  /** The roof's slope just below the ridge (rise per run). */
  tan: number;
}

/** The main ridge of a house in a merged world roof geometry, or null. */
export function ridgeLine(roofs: readonly BufferGeometry[], h: Frame): RidgeLine | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (const g of roofs) {
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      if (Math.abs(x - h.centre.x) < 7.5 && Math.abs(z - h.centre.z) < 7.5) {
        xs.push(x);
        ys.push(p.getY(i));
        zs.push(z);
      }
    }
  }
  if (xs.length < 8) return null;
  const order = ys.map((_, i) => i).sort((i, j) => ys[j]! - ys[i]!);
  // walk down the heights: the first level (3 cm) whose vertices run > 3 m is the ridge's top
  for (let s = 0; s < order.length; ) {
    const top = ys[order[s]!]!;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let e = s;
    for (; e < order.length && ys[order[e]!]! >= top - 0.03; e++) {
      const i = order[e]!;
      minX = Math.min(minX, xs[i]!);
      maxX = Math.max(maxX, xs[i]!);
      minZ = Math.min(minZ, zs[i]!);
      maxZ = Math.max(maxZ, zs[i]!);
    }
    if (Math.max(maxX - minX, maxZ - minZ) > 3) {
      const alongX = maxX - minX > maxZ - minZ;
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      // the slope: the upper envelope of (drop / distance) 0.5-2.5 m across the ridge
      const ratios: number[] = [];
      for (let i = 0; i < xs.length; i++) {
        const along = alongX ? xs[i]! : zs[i]!;
        if (along < (alongX ? minX : minZ) + 0.5 || along > (alongX ? maxX : maxZ) - 0.5) continue;
        const d = Math.abs(alongX ? zs[i]! - cz : xs[i]! - cx);
        if (d < 0.5 || d > 2.5) continue;
        const r = (top - ys[i]!) / d;
        if (r > 0.1) ratios.push(r); // the slope's tiles only (not a chimney or its hood standing above the ridge)
      }
      ratios.sort((p, q) => p - q);
      const tan = Math.max(0.3, Math.min(3, ratios.length ? ratios[Math.floor(ratios.length * 0.1)]! : 1.2));
      const o = RIDGE.overhang;
      return alongX ? { a: [minX - o, top, cz], b: [maxX + o, top, cz], tan } : { a: [cx, top, minZ - o], b: [cx, top, maxZ + o], tan };
    }
    s = e;
  }
  return null;
}

/** A small deterministic random (per house and tile). */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The ridge tiles along a line, with the attribute set of the roof they join (position, normal, uv, colour; others zero).
 * `seed` varies the tiles' kiln tones per house.
 */
export function ridgeTiles(line: RidgeLine, names: readonly string[], tpl: Record<string, BufferAttribute>, seed = 1): BufferGeometry {
  const [ax, ay, az] = line.a;
  const [bx, , bz] = line.b;
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len;
  const dz = (bz - az) / len;
  const lx = -dz; // across the ridge (horizontal)
  const lz = dx;
  const R = RIDGE;
  // the model's ridge tube (colmar_kit.py: r 0.12, squashed 0.8) peaks at `top`; its bed line is ~0.096 below
  const bedY = ay - 0.096;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const push = (p: V3, n: V3, u: number, v: number, c: number): void => {
    pos.push(p[0], p[1], p[2]);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    nor.push(n[0] / l, n[1] / l, n[2] / l);
    uv.push(u, v);
    col.push(c);
  };
  const tri = (p: [V3, V3, V3], n: V3, uvs: Array<[number, number]>, c: number): void => {
    for (let k = 0; k < 3; k++) push(p[k]!, n, uvs[k]![0], uvs[k]![1], c);
  };
  const at = (s: number, lat: number, y: number): V3 => [ax + dx * s + lx * lat, y, az + dz * s + lz * lat];
  const count = Math.max(1, Math.ceil((len - R.length) / R.pitch) + 1);
  const step = count > 1 ? (len - R.length) / (count - 1) : 0;
  const ring = (j: number, wide: boolean): { at: (s: number) => V3; n: V3 } => {
    const a = (j / R.sides) * Math.PI;
    const rr = R.radius + (wide ? R.lap : 0);
    const ry = R.rise + (wide ? R.lap : 0);
    const lat = Math.cos(a) * rr;
    const y = bedY + Math.sin(a) * ry;
    return { at: (s) => at(s, lat, y), n: [(lx * Math.cos(a)) / rr, Math.sin(a) / ry, (lz * Math.cos(a)) / rr] };
  };
  const back: V3 = [-dx, 0, -dz];
  const fwd: V3 = [dx, 0, dz];
  for (let i = 0; i < count; i++) {
    const s0 = i * step; // the wide end
    const s1 = s0 + R.length; // the narrow end (under the next tile's wide end)
    // one tile body of the sheet: tile k of an even row r, the body's middle (clear of the butt's shadow and the joints)
    const k = Math.floor(rand(seed * 101 + i * 7.3) * R.sheetTiles);
    const r = 2 * Math.floor(rand(seed * 37 + i * 3.1) * (R.sheetRows / 2));
    const u0 = (k + 0.18) / R.sheetTiles;
    const u1 = (k + 0.82) / R.sheetTiles;
    const v0 = (r + 0.38) / R.sheetRows;
    const v1 = (r + 0.78) / R.sheetRows;
    const tone = 0.9 + rand(seed * 13 + i * 1.7) * 0.08;
    // the tapered barrel: the wide ring at s0, the narrow at s1 (wound to face out)
    for (let j = 0; j < R.sides; j++) {
      const w0 = ring(j, true);
      const w1 = ring(j + 1, true);
      const n0 = ring(j, false);
      const n1 = ring(j + 1, false);
      const ua = u0 + ((u1 - u0) * j) / R.sides;
      const ub = u0 + ((u1 - u0) * (j + 1)) / R.sides;
      push(w0.at(s0), w0.n, ua, v0, tone);
      push(n0.at(s1), n0.n, ua, v1, tone);
      push(n1.at(s1), n1.n, ub, v1, tone);
      push(w0.at(s0), w0.n, ua, v0, tone);
      push(n1.at(s1), n1.n, ub, v1, tone);
      push(w1.at(s0), w1.n, ub, v0, tone);
    }
    // the first tile's wide end closes the gable end (a half disc); between tiles the wider barrel standing over the narrower is
    // the lap step itself (no faces needed: what shows past it is the tile below)
    const e = tone * 0.8;
    if (i === 0) for (let j = 0; j < R.sides; j++) tri([ring(j, true).at(s0), ring(j + 1, true).at(s0), at(s0, 0, bedY)], back, [[u0, v0], [u1, v0], [u0, v1]], e);
    if (i === count - 1) {
      // the far gable end: closed
      for (let j = 0; j < R.sides; j++) tri([at(s1, 0, bedY), ring(j + 1, false).at(s1), ring(j, false).at(s1)], fwd, [[u0, v1], [u1, v1], [u0, v1]], e);
    }
  }
  // the mortar skirts: from the barrels' foot down to the tiles of the slope, the whole ridge long (dark clay, in shade)
  const su = 0.5 / R.sheetTiles;
  const sv = 0.97 / R.sheetRows;
  const S: Array<[number, number]> = [[su, sv], [su, sv], [su, sv]];
  for (const side of [1, -1]) {
    const lat0 = side * (R.radius + R.lap);
    const lat1 = side * (R.radius + R.lap + 0.05);
    const y1 = ay - 0.025 - 0.03 - Math.abs(lat1) * line.tan; // the tile surface there (the ridge lip 2.5 cm), tucked 3 cm in
    const n: V3 = [lx * side, 0.6, lz * side];
    const p00 = at(0, lat0, bedY);
    const p01 = at(len, lat0, bedY);
    const p10 = at(0, lat1, y1);
    const p11 = at(len, lat1, y1);
    if (side > 0) {
      tri([p00, p11, p01], n, S, 0.7);
      tri([p00, p10, p11], n, S, 0.7);
    } else {
      tri([p00, p01, p11], n, S, 0.7);
      tri([p00, p11, p10], n, S, 0.7);
    }
  }
  const g = new BufferGeometry();
  const n = pos.length / 3;
  const make = (name: string): BufferAttribute => {
    const t = tpl[name]!;
    return new BufferAttribute(new (t.array.constructor as new (n: number) => Float32Array)(n * t.itemSize), t.itemSize, t.normalized);
  };
  for (const name of names) {
    const out = make(name);
    const src = name === "position" ? pos : name === "normal" ? nor : name === "uv" ? uv : null;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < out.itemSize; k++) {
        if (src) out.setComponent(i, k, src[i * out.itemSize + k] ?? 0);
        else if (name === "color") out.setComponent(i, k, k < 3 ? col[i]! : 1);
        else out.setComponent(i, k, 0);
      }
    g.setAttribute(name, out);
  }
  g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
}

/** The ridge lines of every house in a list of merged world roof geometries (houses without a clear ridge left out). */
export function ridgeLines(roofs: readonly BufferGeometry[], houses: readonly Frame[]): Array<{ id: string; line: RidgeLine }> {
  const out: Array<{ id: string; line: RidgeLine }> = [];
  for (const h of houses) {
    const line = ridgeLine(roofs, h);
    if (line && Math.hypot(line.b[0] - line.a[0], line.b[2] - line.a[2]) > 1) out.push({ id: h.id, line });
  }
  return out;
}

/** The ridge tiles for a set of ridge lines, in the attribute set of the first roof geometry. */
export function ridgeCaps(roofs: readonly BufferGeometry[], lines: ReadonlyArray<{ line: RidgeLine }>): BufferGeometry[] {
  const first = roofs[0];
  if (!first) return [];
  const names = Object.keys(first.attributes);
  const tpl: Record<string, BufferAttribute> = {};
  for (const n of names) tpl[n] = first.getAttribute(n) as BufferAttribute;
  return lines.map((l, i) => ridgeTiles(l.line, names, tpl, i + 1));
}

/** colmar_kit.py's ridge mortar, lin("#EEE8DC"). */
const MORTAR_WHITE: V3 = [0.855, 0.807, 0.716];

/**
 * The model's white mortar strip under its ridge (colmar_kit.py: LM_render quads beside the ridge tube) recoloured to a warm
 * clay-lime mortar (linear), so no white line shows past the new tiles. Works on the merged world LM_render geometry; returns
 * the vertices changed.
 */
export function tintRidgeMortar(render: BufferGeometry, lines: ReadonlyArray<{ line: RidgeLine }>, mortar: V3): number {
  const p = render.getAttribute("position");
  const c = render.getAttribute("color");
  if (!p || !c) return 0;
  let n = 0;
  for (const { line: l } of lines) {
    const len = Math.hypot(l.b[0] - l.a[0], l.b[2] - l.a[2]);
    const dx = (l.b[0] - l.a[0]) / len;
    const dz = (l.b[2] - l.a[2]) / len;
    for (let i = 0; i < p.count; i++) {
      const rx = p.getX(i) - l.a[0];
      const rz = p.getZ(i) - l.a[2];
      const s = rx * dx + rz * dz;
      const lat = Math.abs(-rx * dz + rz * dx);
      const y = p.getY(i);
      if (s < -0.1 || s > len + 0.1 || lat > 0.22 || y > l.a[1] + 0.01 || y < l.a[1] - 0.2) continue;
      // only the mortar's own lime white (#EEE8DC), never a gable's plaster meeting the ridge
      if (Math.abs(c.getX(i) - MORTAR_WHITE[0]) > 0.03 || Math.abs(c.getY(i) - MORTAR_WHITE[1]) > 0.03 || Math.abs(c.getZ(i) - MORTAR_WHITE[2]) > 0.03) continue;
      c.setXYZ(i, mortar[0], mortar[1], mortar[2]);
      n++;
    }
  }
  if (n) c.needsUpdate = true;
  return n;
}
