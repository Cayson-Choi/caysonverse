// The lake trail's worn edge (2026-11-18, the owner's "sticker" of sandy dirt on the grass).
//
// lake.glb's dirt (LM_dirt: the 2.5 m trail from the bus lane to the pier and the fishing office's yard) is one flat mesh whose
// outline is cut hard against the lawn, in one uniform colour. A real footpath is worn from the middle: packed and light in the
// centre, darker and mixed with grass roots toward the edge, and its edge is ragged where the grass thins out. This copy of the
// geometry (the loader's cache owns the original) gets exactly that, with no new draw call and no new texture: the boundary
// vertices are moved a little along the outline's normal (noise, never at the sidewalk's end), and the vertex colour (which the
// light-mapped material multiplies into the albedo) goes from the packed centre to a grass-tinted rim over the outer two rings.

import { BufferAttribute, BufferGeometry } from "three";

/** The rim's colour factor (× the albedo, linear): dirt mixed with grass roots, darker and greener. */
export const RIM_TINT: readonly [number, number, number] = [0.5, 0.64, 0.3];
/** The packed centre's factor (a little lighter than the baked colour). */
export const CENTRE_TINT: readonly [number, number, number] = [1.08, 1.06, 1.0];
/** How far (m) the rim wanders along its normal: noise in [-0.1, +0.32] (mostly out over the grass, a little in). */
export const RIM_WANDER: readonly [number, number] = [-0.1, 0.32];
/** The trail's mouth at the sidewalk: vertices nearer than this x (m) keep their place (the paving's curb cuts the dirt there). */
export const MOUTH_X = 40.5;

const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** Smooth value noise in [0, 1]. */
export function noise2(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** A copy of an LM_dirt geometry with the worn edge; `null` when it is not a mesh this can read (no index / no colour). */
export function wornEdges(geo: BufferGeometry): BufferGeometry | null {
  const idx = geo.getIndex();
  const pos = geo.getAttribute("position") as BufferAttribute | undefined;
  const col = geo.getAttribute("color") as BufferAttribute | undefined;
  if (!idx || !pos || !col || col.itemSize < 3) return null;
  const n = pos.count;
  // vertices at one spot (the mesh may split them for its light-map charts) are one point of the outline
  const keyOf = (i: number): string => `${Math.round(pos.getX(i) * 50)},${Math.round(pos.getZ(i) * 50)}`;
  const idOf = new Map<string, number>();
  const rep = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = keyOf(i);
    let r = idOf.get(k);
    if (r === undefined) idOf.set(k, (r = i));
    rep[i] = r;
  }
  const edgeCount = new Map<string, number>();
  const nbr = new Map<number, Set<number>>();
  const link = (a: number, b: number): void => {
    (nbr.get(a) ?? nbr.set(a, new Set()).get(a)!).add(b);
    (nbr.get(b) ?? nbr.set(b, new Set()).get(b)!).add(a);
  };
  for (let t = 0; t < idx.count; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = rep[idx.getX(t + k)];
      const b = rep[idx.getX(t + ((k + 1) % 3))];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      link(a, b);
    }
  }
  // the outline: edges seen once; each boundary vertex's outward normal from its outline edges
  const nx = new Map<number, number>();
  const nz = new Map<number, number>();
  for (const [key, c] of edgeCount) {
    if (c !== 1) continue;
    const [a, b] = key.split("_").map(Number);
    const dx = pos.getX(b) - pos.getX(a);
    const dz = pos.getZ(b) - pos.getZ(a);
    const len = Math.hypot(dx, dz) || 1;
    for (const v of [a, b]) {
      nx.set(v, (nx.get(v) ?? 0) + dz / len);
      nz.set(v, (nz.get(v) ?? 0) - dx / len);
    }
  }
  // orient each normal away from the mesh's inside: toward the side with no triangle (a neighbour average sits inside)
  const outward = new Map<number, [number, number]>();
  for (const v of nx.keys()) {
    let mx = 0;
    let mz = 0;
    const ns = nbr.get(v)!;
    for (const w of ns) {
      mx += pos.getX(w) / ns.size;
      mz += pos.getZ(w) / ns.size;
    }
    let ox = nx.get(v)!;
    let oz = nz.get(v)!;
    const l = Math.hypot(ox, oz) || 1;
    ox /= l;
    oz /= l;
    if ((pos.getX(v) - mx) * ox + (pos.getZ(v) - mz) * oz < 0) {
      ox = -ox;
      oz = -oz;
    }
    outward.set(v, [ox, oz]);
  }
  // rings: 0 on the outline, 1 next to it, ... (breadth first over the mesh's edges)
  const ring = new Map<number, number>();
  let frontier = [...outward.keys()];
  frontier.forEach((v) => ring.set(v, 0));
  for (let h = 1; h <= 3 && frontier.length; h++) {
    const next: number[] = [];
    for (const v of frontier) for (const w of nbr.get(v) ?? []) if (!ring.has(w)) (ring.set(w, h), next.push(w));
    frontier = next;
  }
  const outPos = new Float32Array(pos.array.length);
  outPos.set(pos.array as ArrayLike<number>);
  const outCol = new Float32Array(col.array.length);
  outCol.set(col.array as ArrayLike<number>);
  const P = new BufferAttribute(outPos, pos.itemSize);
  const C = new BufferAttribute(outCol, col.itemSize);
  for (let i = 0; i < n; i++) {
    const r = ring.get(rep[i]) ?? 4;
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // the rim wanders (the representative's normal and noise, so split copies move together)
    const o = outward.get(rep[i]);
    if (o && x > MOUTH_X) {
      const w = RIM_WANDER[0] + (RIM_WANDER[1] - RIM_WANDER[0]) * noise2(pos.getX(rep[i]) * 0.9, pos.getZ(rep[i]) * 0.9);
      P.setXYZ(i, x + o[0] * w, pos.getY(i), z + o[1] * w);
    }
    // worn from the middle: the rim tinted toward grass, the next ring half, the centre light, with a little patchiness
    const t = r >= 3 ? 0 : r === 2 ? 0.2 : r === 1 ? 0.55 : 1; // 1 = rim
    const patch = 0.94 + 0.12 * noise2(x * 0.6 + 11, z * 0.6 - 7);
    for (let c = 0; c < 3; c++) {
      const base = col.getComponent(i, c);
      const centre = CENTRE_TINT[c];
      const rim = RIM_TINT[c];
      C.setComponent(i, c, base * (centre + (rim - centre) * t) * patch);
    }
    if (col.itemSize > 3) C.setComponent(i, 3, col.getComponent(i, 3));
  }
  const out = new BufferGeometry();
  for (const name of Object.keys(geo.attributes)) out.setAttribute(name, geo.getAttribute(name));
  out.setAttribute("position", P);
  out.setAttribute("color", C);
  out.setIndex(idx);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
