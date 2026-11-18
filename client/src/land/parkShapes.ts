import { BufferGeometry, Float32BufferAttribute } from "three";
import type { GeoBuilder, V3 } from "./geoBuilder";

/**
 * Shapes beyond boxes for Caysonland's buildings and planting (no DOM: unit-tested in node): a clipped boxwood hedge, a bell-shaped
 * tower roof, a round moulded basin. They write into a GeoBuilder through `rawVertex` and `idx`.
 */

/** A deterministic 0..1 hash of two integers (no Math.random: a rebuild is identical). */
function hash2(i: number, j: number, seed: number): number {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(seed | 0, 1103515245)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 100000) / 100000;
}

/** Smooth value noise on a 2D lattice (cells `cell` units wide), 0..1. */
export function valueNoise(a: number, b: number, cell: number, seed: number): number {
  const x = a / cell;
  const y = b / cell;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(i, j, seed);
  const n10 = hash2(i + 1, j, seed);
  const n01 = hash2(i, j + 1, seed);
  const n11 = hash2(i + 1, j + 1, seed);
  return n00 + (n10 - n00) * sx + (n01 - n00) * sy + (n00 - n10 - n01 + n11) * sx * sy;
}

export interface HedgeOptions {
  /** Width at the foot (m). */
  width: number;
  /** Height (m). */
  height: number;
  /** How far the leaf-mass bumps swell the skin (m). */
  bump?: number;
  /** Metres of the leaf texture per repeat (UVs run in metres / tile). */
  tile?: number;
  seed?: number;
}

/**
 * A clipped boxwood hedge along the ground line (x0, z0) -> (x1, z1): a trimmed profile (straight sides, a rounded shoulder, a
 * gently domed top) whose skin swells and dips in fine leaf-mass bumps and a slow billow, rounded off at both ends.
 * `colorAt(t, crown, lf)`: t along the hedge 0..1, crown 0 at the foot .. 1 at the top, lf the bump (-0.5..0.5).
 */
export function addHedge(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, o: HedgeOptions, colorAt: (t: number, crown: number, lf: number) => V3): void {
  const w = o.width / 2;
  const h = o.height;
  const bump = o.bump ?? 0.05;
  const tile = o.tile ?? 1.2;
  const seed = o.seed ?? 7;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const dx = (x1 - x0) / len;
  const dz = (z1 - z0) / len;
  // the cross-section, left foot -> over the top -> right foot (x across, y up)
  const shoulder = h - w * 0.9;
  const prof: Array<[number, number]> = [[-w, 0], [-w, shoulder * 0.5], [-w, shoulder]];
  const arc = 10;
  for (let k = 1; k < arc; k++) {
    const a = Math.PI - (k / arc) * Math.PI;
    prof.push([Math.cos(a) * w, shoulder + Math.sin(a) * (h - shoulder)]);
  }
  prof.push([w, shoulder], [w, shoulder * 0.5], [w, 0]);
  const np = prof.length;
  const acc: number[] = [0];
  for (let k = 1; k < np; k++) acc.push(acc[k - 1]! + Math.hypot(prof[k]![0] - prof[k - 1]![0], prof[k]![1] - prof[k - 1]![1]));
  const rings = Math.max(2, Math.round(len / 0.2));
  const base = b.vertices;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const s = t * len;
    const endIn = Math.min(s, len - s);
    // rounded ends: the section closes up as a dome over the last 0.4 m
    const cap = endIn < 0.4 ? Math.sqrt(Math.max(0, 1 - Math.pow(1 - endIn / 0.4, 2))) : 1;
    const billow = 1 + (valueNoise(s, 0.5, 2.6, seed) - 0.5) * 0.06;
    for (let k = 0; k < np; k++) {
      const [px, py] = prof[k]!;
      const lf = (valueNoise(s, acc[k]!, 0.55, seed + 3) - 0.5) + (valueNoise(s, acc[k]!, 0.17, seed + 9) - 0.5) * 0.7;
      const swell = bump * lf * Math.min(1, py / 0.3);
      const tx = prof[Math.min(np - 1, k + 1)]![0] - prof[Math.max(0, k - 1)]![0];
      const ty = prof[Math.min(np - 1, k + 1)]![1] - prof[Math.max(0, k - 1)]![1];
      const tl = Math.hypot(tx, ty) || 1;
      // the profile's outward normal (the left side goes up, so out is -x; the right side goes down, so out is +x)
      const ox = (-ty / tl) * swell;
      const oy = (tx / tl) * swell;
      const across = (px + ox) * cap;
      const up = (py * billow + oy) * (0.5 + 0.5 * cap);
      b.rawVertex([x0 + dx * s - dz * across, up, z0 + dz * s + dx * across], [0, 1, 0], s / tile, acc[k]! / tile, colorAt(t, py / h, lf));
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let k = 0; k < np - 1; k++) {
      const a = base + r * np + k;
      const c = a + np;
      b.idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  b.smoothNormals(base);
}

/**
 * A tower roof: a bell-shaped hip (concave swept sides, a small eave kick) over a rectangle (half sizes hx, hz) from height y0, rising
 * `h` to a point. The plan goes from a squared-off superellipse at the eave to an ellipse at the top, so the corners round into a cone.
 * UVs are metres / tile (u round the plan, v up the slope), so tiles keep their size at every height.
 */
export function addBellRoof(b: GeoBuilder, cx: number, y0: number, cz: number, hx: number, hz: number, h: number, color: V3, tile = 1.2, sides = 44): void {
  const base = b.vertices;
  const rings: Array<{ y: number; s: number; e: number }> = [{ y: -0.2, s: 1.06, e: 5 }, { y: 0, s: 1.0, e: 5 }];
  const n = 16;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    rings.push({ y: h * t, s: Math.max(0.012, Math.pow(1 - t, 1.22)), e: 5 - 3 * Math.min(1, t * 1.6) });
  }
  let slant = 0;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r]!;
    if (r > 0) {
      const p = rings[r - 1]!;
      slant += Math.hypot(ring.y - p.y, (ring.s - p.s) * Math.max(hx, hz));
    }
    const e = 2 / ring.e;
    let per = 0;
    let px = 0;
    let pz = 0;
    for (let k = 0; k <= sides; k++) {
      const th = (k / sides) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const x = hx * ring.s * Math.sign(c) * Math.pow(Math.abs(c), e);
      const z = hz * ring.s * Math.sign(sn) * Math.pow(Math.abs(sn), e);
      if (k > 0) per += Math.hypot(x - px, z - pz);
      px = x;
      pz = z;
      b.rawVertex([cx + x, y0 + ring.y, cz + z], [0, 1, 0], per / tile, slant / tile, color);
    }
  }
  const ring = sides + 1;
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < sides; k++) {
      const a = base + r * ring + k;
      const c = a + ring;
      b.idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  b.smoothNormals(base);
}

/**
 * A solid of revolution about the vertical axis through (cx, cz): `profile` is [radius, height] points from the bottom up (a closed
 * moulded silhouette: a basin's lip, a baluster, a bowl). UVs: u round (metres), v up the profile (metres).
 */
export function addLathe(b: GeoBuilder, cx: number, cz: number, profile: ReadonlyArray<readonly [number, number]>, color: V3, tile = 1, sides = 48, y0 = 0): void {
  const base = b.vertices;
  let v = 0;
  for (let r = 0; r < profile.length; r++) {
    const [rad, y] = profile[r]!;
    if (r > 0) v += Math.hypot(rad - profile[r - 1]![0], y - profile[r - 1]![1]);
    for (let k = 0; k <= sides; k++) {
      const th = (k / sides) * Math.PI * 2;
      b.rawVertex([cx + Math.cos(th) * rad, y0 + y, cz + Math.sin(th) * rad], [0, 1, 0], (th * Math.max(rad, 0.05)) / tile, v / tile, color);
    }
  }
  const ring = sides + 1;
  for (let r = 0; r < profile.length - 1; r++) {
    for (let k = 0; k < sides; k++) {
      const a = base + r * ring + k;
      const c = a + ring;
      b.idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  b.smoothNormals(base);
}

/**
 * A hip roof over a rectangle (half sizes hx, hz at the eaves, centred cx, cz at height y0) rising `rise` to a ridge along x (length
 * 2 * max(0, hx - hz) at the top; a point on a square plan). Four sloping faces with metre UVs (u along the eave, v up the slope).
 */
export function addHipRoof(b: GeoBuilder, cx: number, y0: number, cz: number, hx: number, hz: number, rise: number, color: V3, tile = 1.2): void {
  const rl = Math.max(0, hx - hz);
  const slopeZ = Math.hypot(hz, rise);
  const slopeX = Math.hypot(hx - rl, rise);
  const quad = (p: [V3, V3, V3, V3], uvs: Array<[number, number]>) => {
    const base = b.vertices;
    const e1: V3 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2: V3 = [p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]];
    const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const nn: V3 = [n[0] / l, n[1] / l, n[2] / l];
    const flip = nn[1] < 0 ? -1 : 1;
    p.forEach((v, i) => b.rawVertex(v, [nn[0] * flip, nn[1] * flip, nn[2] * flip], uvs[i]![0] / tile, uvs[i]![1] / tile, color));
    if (flip > 0) b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else b.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  const Y = y0 + rise;
  // front (+z) and back (-z): trapezoids from the eave to the ridge
  quad([[cx - hx, y0, cz + hz], [cx + hx, y0, cz + hz], [cx + rl, Y, cz], [cx - rl, Y, cz]], [[0, 0], [2 * hx, 0], [2 * hx - (hx - rl), slopeZ], [hx - rl, slopeZ]]);
  quad([[cx + hx, y0, cz - hz], [cx - hx, y0, cz - hz], [cx - rl, Y, cz], [cx + rl, Y, cz]], [[0, 0], [2 * hx, 0], [2 * hx - (hx - rl), slopeZ], [hx - rl, slopeZ]]);
  // the hips (-x and +x): triangles, or quads when the ridge has length
  const tri = (a: V3, c: V3, d: V3, uvs: Array<[number, number]>) => {
    const base = b.vertices;
    const e1: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const e2: V3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const flip = n[1] < 0 ? -1 : 1;
    [a, c, d].forEach((v, i) => b.rawVertex(v, [(n[0] / l) * flip, (n[1] / l) * flip, (n[2] / l) * flip], uvs[i]![0] / tile, uvs[i]![1] / tile, color));
    if (flip > 0) b.idx.push(base, base + 1, base + 2);
    else b.idx.push(base, base + 2, base + 1);
  };
  tri([cx + hx, y0, cz + hz], [cx + hx, y0, cz - hz], [cx + rl, Y, cz], [[0, 0], [2 * hz, 0], [hz, slopeX]]);
  tri([cx - hx, y0, cz - hz], [cx - hx, y0, cz + hz], [cx - rl, Y, cz], [[0, 0], [2 * hz, 0], [hz, slopeX]]);
}

/**
 * A copy of `geometry` with UVs in metres / `tile` projected from each vertex's dominant normal axis (top faces from above, the long
 * sides from the side). For a GLB that ships no UVs; needs split (flat-shaded) faces to keep each face on one plane.
 */
export function projectMetreUV(geometry: BufferGeometry, tile: number): BufferGeometry {
  const g = geometry.clone();
  const pos = g.getAttribute("position");
  let nor = g.getAttribute("normal");
  if (!nor) {
    g.computeVertexNormals();
    nor = g.getAttribute("normal");
  }
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = x;
      v = z;
    } else if (nx >= nz) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv[2 * i] = u / tile;
    uv[2 * i + 1] = v / tile;
  }
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return g;
}
