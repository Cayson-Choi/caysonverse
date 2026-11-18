import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from "three";
import { fbm } from "./parkSkyTexture";

/**
 * 케이슨랜드's ground beyond the flat fairground: one tensor-grid mesh (a single draw call, built once) that is dead flat (y 0) over the
 * whole area the park uses (the walk bounds, the circuit, the woods) and rolls into low grassy hills outside it, easing back to y 0 where
 * the distant ridges' feet are (parkMountains: centre (105, -63), foot radius ~360). Nothing ends in a cliff or a void: the grid
 * reaches 750 m past the flat area, further than anyone can see over the haze.
 */
export const PARK_FLAT = { minX: -200, maxX: 420, minZ: -240, maxZ: 175 } as const;
export const PARK_RIDGE_CENTRE = { x: 105, z: -63 } as const;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The ground's height (m) at a park-local point. */
export function parkGroundHeight(x: number, z: number): number {
  const dx = Math.max(PARK_FLAT.minX - x, 0, x - PARK_FLAT.maxX);
  const dz = Math.max(PARK_FLAT.minZ - z, 0, z - PARK_FLAT.maxZ);
  const d = Math.hypot(dx, dz);
  if (d <= 0) return 0;
  const r = Math.hypot(x - PARK_RIDGE_CENTRE.x, z - PARK_RIDGE_CENTRE.z);
  const rise = smooth(0, 55, d) * (1 - smooth(300, 352, r));
  const n = fbm(x * 0.011 + 5, z * 0.011 - 3, 4);
  const knolls = 0.25 + 1.5 * n; // 0.25 .. ~1.4
  return rise * knolls * 13;
}

/** The tensor grid's axis: `inner` m cells over [a, b], growing by `grow` per cell outward to `lo` and `hi`. */
export function gridAxis(lo: number, a: number, b: number, hi: number, inner: number, grow: number, start: number): number[] {
  const left: number[] = [];
  let step = inner;
  for (let x = a - inner; x > lo; ) {
    if (a - x > start) step *= grow;
    left.push(x);
    x -= step;
  }
  left.push(lo);
  left.reverse();
  const mid: number[] = [];
  for (let x = a; x < b; x += inner) mid.push(x);
  const right: number[] = [];
  step = inner;
  for (let x = b; x < hi; ) {
    right.push(x);
    if (x - b > start) step *= grow;
    x += step;
  }
  right.push(hi);
  return [...left, ...mid, ...right];
}

/** Build the ground mesh; uv = world (x, z) in metres (the grass material's repeat turns that into tiles). */
export function buildParkTerrain(): BufferGeometry {
  const xs = gridAxis(-760, PARK_FLAT.minX, PARK_FLAT.maxX, 970, 10, 1.12, 20);
  const zs = gridAxis(-760, PARK_FLAT.minZ, PARK_FLAT.maxZ, 760, 10, 1.12, 20);
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const nor = new Float32Array(nx * nz * 3);
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      h[k] = parkGroundHeight(xs[i]!, zs[j]!);
      pos.set([xs[i]!, h[k]!, zs[j]!], k * 3);
      uv.set([xs[i]!, zs[j]!], k * 2);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const i0 = Math.max(i - 1, 0);
      const i1 = Math.min(i + 1, nx - 1);
      const j0 = Math.max(j - 1, 0);
      const j1 = Math.min(j + 1, nz - 1);
      const dhx = (h[j * nx + i1]! - h[j * nx + i0]!) / (xs[i1]! - xs[i0]!);
      const dhz = (h[j1 * nx + i]! - h[j0 * nx + i]!) / (zs[j1]! - zs[j0]!);
      const l = Math.hypot(dhx, 1, dhz);
      nor.set([-dhx / l, 1 / l, -dhz / l], (j * nx + i) * 3);
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // counter-clockwise seen from above (+y)
      idx[q++] = a;
      idx[q++] = c;
      idx[q++] = b;
      idx[q++] = b;
      idx[q++] = c;
      idx[q++] = d;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}
