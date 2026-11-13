import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, Vector3, type Object3D } from "three";
import { isMesh, materialsOf } from "../../game/hub/hubModelPrep";
import { distToPolyline } from "./crownGrowth";
import { PLAZA_ZELKOVA_SPEC, treeSkeleton, type Branch, type TreeSkeleton } from "./treeSkeleton";
import type { Vec3 } from "./vegLod";

/**
 * The plaza zelkova taken out of the village clone (the owner, 2026-11-12: "아예 저 나무는 몸통을 만들지 말고
 * 없애버려"): its bark triangles (the trunk, the seven limbs and their side branches: whatever lies within its tubes'
 * radius of the replayed skeleton) are cut out of the light-mapped bark, and the round deck's middle, where the trunk
 * went through, gets a plug of the deck's own boards (its material, its plank UVs and light-map UVs carried in from
 * the deck's inner edge, so the boards run on without a seam). Its leaf cards go with the other green cards.
 *
 * Done at once on arrival (VillageModel, with the old foliage), never after the vegetation's build: the tree must not
 * stand there for the seconds the build takes.
 */
export interface ZelkovaRemoval {
  /** Bark triangles taken out. */
  tris: number;
  /** The plug's mesh (null when the deck was not found). */
  plug: Mesh | null;
  /** Give the clone its bark back and take the plug away. */
  restore(): void;
}

let skeleton: TreeSkeleton | null = null;
/** The zelkova's replayed skeleton (made once: the replay is deterministic). */
export function zelkovaSkeleton(): TreeSkeleton {
  return (skeleton ??= treeSkeleton(PLAZA_ZELKOVA_SPEC));
}

function triCentre(pos: BufferAttribute, a: number, b: number, c: number): Vec3 {
  return [(pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3];
}

/** Whether `mesh` sits at the world origin unmoved (the village file's merged meshes do). */
const atOrigin = (mesh: Mesh) => {
  mesh.updateWorldMatrix(true, false);
  return mesh.matrixWorld.equals(new Matrix4());
};

export function removePlazaZelkova(root: Object3D): ZelkovaRemoval {
  const sk = zelkovaSkeleton();
  const parts: Array<{ b: Branch; r: number }> = [sk.trunk, ...sk.limbs, ...sk.sides].map((b) => ({ b, r: Math.max(...b.radii) + 0.08 }));
  const swapped: Array<{ mesh: Mesh; original: BufferGeometry; copy: BufferGeometry }> = [];
  let removed = 0;
  const bark: Mesh[] = [];
  const wood: Mesh[] = [];
  root.traverse((o) => {
    if (!isMesh(o) || !atOrigin(o)) return;
    const names = materialsOf(o).map((m) => m.name);
    if (names.includes("LM_bark")) bark.push(o);
    if (names.includes("LM_wood")) wood.push(o);
  });
  for (const mesh of bark) {
    const src = mesh.geometry;
    const pos = src.getAttribute("position") as BufferAttribute;
    const index = src.index ? (src.index.array as ArrayLike<number>) : null;
    const triCount = index ? index.length / 3 : pos.count / 3;
    const keep: number[] = [];
    for (let t = 0; t < triCount; t++) {
      const a = index ? index[t * 3]! : t * 3;
      const b = index ? index[t * 3 + 1]! : t * 3 + 1;
      const c = index ? index[t * 3 + 2]! : t * 3 + 2;
      const p = triCentre(pos, a, b, c);
      const near = Math.hypot(p[0] - sk.base[0], p[2] - sk.base[2]) < sk.R * 2 && parts.some(({ b: br, r }) => distToPolyline(p, br) <= r);
      if (near) removed++;
      else keep.push(a, b, c);
    }
    if (keep.length === triCount * 3) continue;
    const g = src.clone();
    g.setIndex(new BufferAttribute(new Uint32Array(keep), 1));
    mesh.geometry = g;
    swapped.push({ mesh, original: src, copy: g });
  }
  const plug = removed ? deckPlug(wood, sk.base) : null;
  if (plug) root.add(plug);
  return {
    tris: removed,
    plug,
    restore() {
      for (const { mesh, original, copy } of swapped) {
        if (mesh.geometry === copy) mesh.geometry = original;
        copy.dispose();
      }
      swapped.length = 0;
      if (plug) {
        plug.removeFromParent();
        plug.geometry.dispose();
      }
    },
  };
}

/**
 * The deck's plug: a fan over the hole the trunk went through, its rim the deck's own inner-edge vertices (their
 * plank UVs, light-map UVs and colours), its centre their mean, in the deck's own material.
 */
function deckPlug(wood: readonly Mesh[], base: Vec3): Mesh | null {
  for (const mesh of wood) {
    const g = mesh.geometry;
    const pos = g.getAttribute("position") as BufferAttribute;
    const index = g.index ? (g.index.array as ArrayLike<number>) : null;
    const triCount = index ? index.length / 3 : pos.count / 3;
    // the deck's top: up-facing triangles round the base at the deck's height
    const rim = new Map<string, { i: number; a: number; y: number }>();
    const ab = new Vector3();
    const ac = new Vector3();
    for (let t = 0; t < triCount; t++) {
      const ids = [0, 1, 2].map((k) => (index ? index[t * 3 + k]! : t * 3 + k));
      const c = triCentre(pos, ids[0]!, ids[1]!, ids[2]!);
      if (c[1] < 0.35 || c[1] > 0.6 || Math.hypot(c[0] - base[0], c[2] - base[2]) > 3) continue;
      ab.set(pos.getX(ids[1]!) - pos.getX(ids[0]!), pos.getY(ids[1]!) - pos.getY(ids[0]!), pos.getZ(ids[1]!) - pos.getZ(ids[0]!));
      ac.set(pos.getX(ids[2]!) - pos.getX(ids[0]!), pos.getY(ids[2]!) - pos.getY(ids[0]!), pos.getZ(ids[2]!) - pos.getZ(ids[0]!));
      const n = ab.cross(ac).normalize();
      if (Math.abs(n.y) < 0.95) continue;
      for (const i of ids) {
        const dx = pos.getX(i) - base[0];
        const dz = pos.getZ(i) - base[2];
        const r = Math.hypot(dx, dz);
        if (r < 0.9 || r > 1.12) continue;
        const a = Math.atan2(dz, dx);
        const key = Math.round(((a + Math.PI) / (Math.PI * 2)) * 64) % 64;
        const have = rim.get(String(key));
        // the highest of the vertices at that angle: the boards' top (not the collar's ledge below it, whose light-map
        // texels are the trunk's dark hole)
        if (!have || pos.getY(i) > have.y) rim.set(String(key), { i, a, y: pos.getY(i) });
      }
    }
    if (rim.size < 6) continue;
    const ring = [...rim.values()].sort((p, q) => p.a - q.a);
    const attrs = ["position", "uv", "uv1", "color"].filter((n) => g.getAttribute(n));
    const out: Record<string, number[]> = Object.fromEntries(attrs.map((n) => [n, []]));
    const centre: Record<string, number[]> = {};
    for (const n of attrs) {
      const at = g.getAttribute(n) as BufferAttribute;
      const k = at.itemSize;
      const sum = new Array<number>(k).fill(0);
      for (const v of ring) for (let j = 0; j < k; j++) sum[j]! += at.getComponent(v.i, j);
      centre[n] = sum.map((s) => s / ring.length);
      for (const v of ring) for (let j = 0; j < k; j++) out[n]!.push(at.getComponent(v.i, j));
    }
    // the light map: one texel of the deck's lit boards for the whole plug (the rim's light-map UVs lie on separate
    // islands of the atlas, so a fan between them would read the texels in between: a dark patch)
    if (out.uv1) {
      const at = g.getAttribute("uv1") as BufferAttribute;
      const u = at.getX(ring[0]!.i);
      const w = at.getY(ring[0]!.i);
      centre.uv1 = [u, w];
      for (let k = 0; k < ring.length; k++) {
        out.uv1[k * 2] = u;
        out.uv1[k * 2 + 1] = w;
      }
    }
    // the centre exactly over the trunk's place, level with the boards' top
    const y = Math.max(...ring.map((v) => v.y));
    centre.position = [base[0], y, base[2]];
    for (const v of ring) out.position![ring.indexOf(v) * 3 + 1] = y;
    const geo = new BufferGeometry();
    for (const n of attrs) {
      const k = (g.getAttribute(n) as BufferAttribute).itemSize;
      geo.setAttribute(n, new Float32BufferAttribute([...centre[n]!, ...out[n]!], k));
    }
    const idx: number[] = [];
    const m = ring.length;
    // wound to face up
    for (let i = 0; i < m; i++) idx.push(0, 1 + ((i + 1) % m), 1 + i);
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const plug = new Mesh(geo, mesh.material);
    plug.name = "zelkova_deck_top";
    plug.matrixAutoUpdate = false;
    return plug;
  }
  return null;
}
