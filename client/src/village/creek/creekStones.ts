import { BufferGeometry, Float32BufferAttribute, IcosahedronGeometry, Matrix4, Quaternion, Vector3, Euler } from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Real-looking creek stones, made from noise at load time (no model file): a rounded, uneven lump of river rock, flattened
 * on top for a stepping stone, with its own random tone. Every stone of the creek is merged into ONE geometry (one draw).
 * Deterministic (seeded), so every client builds the same creek, and tested (creek.test.ts).
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 3D value noise in 0..1. */
export function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const c = (i: number, j: number, k: number) => hash3(xi + i, yi + j, zi + k, seed);
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * u;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * u;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * u;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

export interface StoneSpec {
  x: number;
  /** The stone's top (m): its flat or rounded crown. */
  top: number;
  z: number;
  rx: number;
  rz: number;
  /** How deep it goes below the top (m, buried in the bed). */
  depth: number;
  yaw: number;
  /** 0 round lump .. 1 flat-topped slab. */
  flat: number;
  seed: number;
  /** A multiplier on the stone's colour (variation between stones). */
  tone: number;
  /** Mesh detail (icosahedron subdivisions). */
  detail: number;
}

/** The unit rock's top sits at this height (before scaling) once the crown is flattened. */
const TOP = 0.62;

/** One stone as a geometry in world space: position, normal, colour (tone x a bottom-dark gradient). */
export function stoneGeometry(s: StoneSpec): BufferGeometry {
  let g: BufferGeometry = new IcosahedronGeometry(1, s.detail);
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  g = mergeVertices(g, 1e-4);
  const pos = g.getAttribute("position");
  const v = new Vector3();
  const s1 = s.seed * 7 + 1;
  const sy = (s.depth + 0) / (1 + TOP); // the unit rock spans about -1 .. TOP
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n1 = valueNoise(v.x * 1.4 + 3.1, v.y * 1.4 + 1.7, v.z * 1.4 + 9.3, s1);
    const n2 = valueNoise(v.x * 3.6 + 7.7, v.y * 3.6 + 2.3, v.z * 3.6 + 4.1, s1 + 11);
    const n3 = valueNoise(v.x * 9.5, v.y * 9.5 + 5, v.z * 9.5, s1 + 23);
    // a rounded lump with a few broad flats (the min of two noises' bulges) and fine grain
    const d = 0.78 + 0.4 * n1 + 0.14 * n2 + 0.05 * n3;
    v.multiplyScalar(d);
    // flatten the crown: above the plane the stone is squashed to a nearly flat, slightly domed top
    const top = TOP * (1 - 0.15 * s.flat);
    if (v.y > top) v.y = top + (v.y - top) * (1 - 0.88 * s.flat);
    // the underside is flat (it is buried)
    if (v.y < -0.7) v.y = -0.7 + (v.y + 0.7) * 0.2;
    pos.setXYZ(i, v.x * s.rx, v.y * sy + (s.top - TOP * sy * (1 - 0.15 * s.flat)), v.z * s.rz);
  }
  g.computeVertexNormals();
  // colour: tone x a darker underside, so a stone's foot reads in shadow even before the wet band
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const nz = valueNoise(pos.getX(i) * 4 + s.seed, pos.getY(i) * 4, pos.getZ(i) * 4, s1 + 5);
    const t = s.tone * (0.86 + 0.28 * nz);
    col[i * 3] = t * 0.93;
    col[i * 3 + 1] = t * 0.97;
    col[i * 3 + 2] = t * 1.0;
  }
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  const m = new Matrix4().compose(new Vector3(s.x, 0, s.z), new Quaternion().setFromEuler(new Euler(0, s.yaw, 0)), new Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

/** Every stone merged into one geometry (position, normal, colour). */
export function mergeStones(specs: readonly StoneSpec[]): BufferGeometry | null {
  if (!specs.length) return null;
  const geos = specs.map(stoneGeometry);
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return merged;
}
