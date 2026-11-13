import type { BufferAttribute, BufferGeometry } from "three";
import { distToPolyline } from "./crownGrowth";
import type { Branch, TreeSkeleton } from "./treeSkeleton";
import type { Vec3 } from "./vegLod";

/**
 * The light-mapped bark of the trees the runtime draws itself (barkGeometry.ts), to be cut out of the village clone:
 * every `LM_bark` triangle whose centre lies within a skeleton part's radius (+ 8 cm) of the replayed trunk, limbs and
 * side branches of one of `trees`. The rest of the light-mapped bark (stumps, logs, the backdrop) stays.
 * Returns the kept index of `geo` (null: nothing near any tree) and how many triangles were dropped.
 */
export function bakedBarkIndex(geo: BufferGeometry, trees: readonly TreeSkeleton[]): { index: Uint32Array; dropped: number } | null {
  const cell = 8;
  const grid = new Map<string, Array<{ parts: Array<{ b: Branch; r: number }>; base: Vec3; reach: number }>>();
  for (const sk of trees) {
    const parts = [sk.trunk, ...sk.limbs, ...sk.sides].map((b) => ({ b, r: Math.max(...b.radii) + 0.08 }));
    const reach = sk.R * 2 + 1;
    const entry = { parts, base: sk.base, reach };
    const i0 = Math.floor((sk.base[0] - reach) / cell);
    const i1 = Math.floor((sk.base[0] + reach) / cell);
    const k0 = Math.floor((sk.base[2] - reach) / cell);
    const k1 = Math.floor((sk.base[2] + reach) / cell);
    for (let i = i0; i <= i1; i++)
      for (let k = k0; k <= k1; k++) {
        const key = `${i},${k}`;
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push(entry);
      }
  }
  const pos = geo.getAttribute("position") as BufferAttribute;
  const src = geo.index ? (geo.index.array as ArrayLike<number>) : null;
  const n = src ? src.length / 3 : pos.count / 3;
  const keep: number[] = [];
  let dropped = 0;
  for (let t = 0; t < n; t++) {
    const a = src ? src[t * 3]! : t * 3;
    const b = src ? src[t * 3 + 1]! : t * 3 + 1;
    const c = src ? src[t * 3 + 2]! : t * 3 + 2;
    const p: Vec3 = [(pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3];
    const near = (grid.get(`${Math.floor(p[0] / cell)},${Math.floor(p[2] / cell)}`) ?? []).some(
      (e) => Math.hypot(p[0] - e.base[0], p[2] - e.base[2]) < e.reach && e.parts.some(({ b: br, r }) => distToPolyline(p, br) <= r),
    );
    if (near) dropped++;
    else keep.push(a, b, c);
  }
  return dropped ? { index: new Uint32Array(keep), dropped } : null;
}
