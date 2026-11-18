/**
 * Ridge tiles for the houses' gable roofs (second exteriors pass, 2026-11-18). The model's roofs end in a sharp edge at the top; a real
 * tile roof carries a row of half-round ridge tiles there. For each house the roof's highest vertices give the ridge line; a half-round
 * cap (a 10-sided half tube with closed ends, 26 cm across) is laid along it in the roof's own material, merged with the roof
 * (no extra draw).
 */
import { BufferAttribute, BufferGeometry } from "three";
import type { SceneryHouse } from "@caysonverse/shared/village/villageLayout";

type Frame = Pick<SceneryHouse, "id" | "centre">;

const RADIUS = 0.13;
const SIDES = 10;
const OVERHANG = 0.06;

/** The ridge line of a house in a merged world roof geometry: its two end points (x, y, z), or null. */
export function ridgeLine(roofs: readonly BufferGeometry[], h: Frame): { a: [number, number, number]; b: [number, number, number] } | null {
  let top = -Infinity;
  const near = (x: number, z: number): boolean => Math.abs(x - h.centre.x) < 7 && Math.abs(z - h.centre.z) < 7;
  for (const g of roofs) {
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) if (near(p.getX(i), p.getZ(i)) && p.getY(i) > top) top = p.getY(i);
  }
  if (!Number.isFinite(top)) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let n = 0;
  for (const g of roofs) {
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      if (!near(p.getX(i), p.getZ(i)) || p.getY(i) < top - 0.03) continue;
      minX = Math.min(minX, p.getX(i));
      maxX = Math.max(maxX, p.getX(i));
      minZ = Math.min(minZ, p.getZ(i));
      maxZ = Math.max(maxZ, p.getZ(i));
      n++;
    }
  }
  if (n < 2) return null;
  const alongX = maxX - minX > maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  return alongX ? { a: [minX - OVERHANG, top, cz], b: [maxX + OVERHANG, top, cz] } : { a: [cx, top, minZ - OVERHANG], b: [cx, top, maxZ + OVERHANG] };
}

/** A half-round cap along a ridge line, with the attribute set of the roof it joins (position, normal, uv, colour). */
export function ridgeCap(line: { a: [number, number, number]; b: [number, number, number] }, names: readonly string[], tpl: Record<string, BufferAttribute>): BufferGeometry {
  const [ax, ay, az] = line.a;
  const [bx, , bz] = line.b;
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len;
  const dz = (bz - az) / len;
  // the lateral axis (horizontal, across the ridge)
  const lx = -dz;
  const lz = dx;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const ring = (k: number): { p: [number, number]; n: [number, number] } => {
    const a = (k / SIDES) * Math.PI;
    return { p: [Math.cos(a) * RADIUS, Math.sin(a) * RADIUS], n: [Math.cos(a), Math.sin(a)] };
  };
  const vert = (t: number, k: number, pushUvU: number): void => {
    const r = ring(k);
    pos.push(ax + dx * len * t + lx * r.p[0], ay - 0.03 + r.p[1], az + dz * len * t + lz * r.p[0]);
    nor.push(lx * r.n[0], r.n[1], lz * r.n[0]);
    uv.push(pushUvU, k / SIDES);
  };
  for (let k = 0; k < SIDES; k++) {
    // two triangles per side, wound to face out
    vert(0, k, 0);
    vert(1, k, len / 0.34);
    vert(1, k + 1, len / 0.34);
    vert(0, k, 0);
    vert(1, k + 1, len / 0.34);
    vert(0, k + 1, 0);
  }
  // the two ends (a half disc fan), facing along the ridge
  for (const [t, sgn] of [[0, -1], [1, 1]] as const) {
    for (let k = 0; k < SIDES; k++) {
      const r0 = ring(k);
      const r1 = ring(k + 1);
      const at = (r: [number, number]): number[] => [ax + dx * len * t + lx * r[0], ay - 0.03 + r[1], az + dz * len * t + lz * r[0]];
      const c = [ax + dx * len * t, ay - 0.03, az + dz * len * t];
      const tri = sgn > 0 ? [c, at(r0.p), at(r1.p)] : [c, at(r1.p), at(r0.p)];
      for (const v of tri) {
        pos.push(v[0]!, v[1]!, v[2]!);
        nor.push(dx * sgn, 0, dz * sgn);
        uv.push(0.2, 0.2);
      }
    }
  }
  const g = new BufferGeometry();
  const count = pos.length / 3;
  const typed = (name: string, data: number[] | null, fill: number): BufferAttribute => {
    const t = tpl[name]!;
    const out = new BufferAttribute(new (t.array.constructor as new (n: number) => Float32Array)(count * t.itemSize), t.itemSize, t.normalized);
    for (let i = 0; i < count; i++) for (let k = 0; k < t.itemSize; k++) out.setComponent(i, k, data ? (data[i * t.itemSize + k] ?? 0) : fill);
    return out;
  };
  for (const name of names) {
    if (name === "position") g.setAttribute(name, typed(name, pos, 0));
    else if (name === "normal") g.setAttribute(name, typed(name, nor, 0));
    else if (name === "uv") g.setAttribute(name, typed(name, uv, 0));
    else if (name === "color") g.setAttribute(name, typed(name, null, 0.85));
    else g.setAttribute(name, typed(name, null, 0));
  }
  g.setIndex(Array.from({ length: count }, (_, i) => i));
  return g;
}

/** The ridge caps for every house in a list of merged world roof geometries (empty when a roof has no clear ridge). */
export function ridgeCaps(roofs: readonly BufferGeometry[], houses: readonly Frame[]): BufferGeometry[] {
  const first = roofs[0];
  if (!first) return [];
  const names = Object.keys(first.attributes);
  const tpl: Record<string, BufferAttribute> = {};
  for (const n of names) tpl[n] = first.getAttribute(n) as BufferAttribute;
  const out: BufferGeometry[] = [];
  for (const h of houses) {
    const line = ridgeLine(roofs, h);
    if (line && Math.hypot(line.b[0] - line.a[0], line.b[2] - line.a[2]) > 1) out.push(ridgeCap(line, names, tpl));
  }
  return out;
}
