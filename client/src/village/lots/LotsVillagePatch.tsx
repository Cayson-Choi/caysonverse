import { useLayoutEffect } from "react";
import { BufferGeometry, Uint16BufferAttribute, Uint32BufferAttribute, Vector3, type BufferAttribute, type Material, type Mesh, type Object3D } from "three";
import { VILLAGE_LAYOUT, boxAt } from "@caysonverse/shared/village/villageLayout";
import { LOT_REPLACED_HIGH, LOT_REPLACED_MODEL_BOXES, VILLAGE_LOTS, lotFootprint, type LotId } from "@caysonverse/shared/village/villageLots";
import { trimMesh } from "../street/streetTrim";
import { useLotsDrawn } from "./lotsStore";

declare global {
  interface Window {
    /** DEV: what the lots took out of the village clone (the old plot posts and signs, anything standing on a lot). */
    __cvLotsPatch?: () => { meshes: number; trianglesRemoved: number } | null;
  }
}

/** Never touched (as streetTrim.ts KEEP). */
const KEEP = /^(village_sky|village_water|village_backdrop|fountain_moon|col__|light__|seat__|inst__)/;

/** The old "곧 지어져요" sign post and board round a plot's sign post (parts_buildings.py sign_post: 1.08 m board, 1.4 m top). */
const POST_HALF = 0.75;
const POST_TOP = 1.8;
/** Round a replaced model box (m). */
const REPLACED_PAD = 1.5;

interface Foot {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
  inside: (x: number, y: number, z: number) => boolean;
}

const box = (minX: number, maxX: number, minZ: number, maxZ: number, maxY: number): Foot => ({
  minX,
  maxX,
  minZ,
  maxZ,
  maxY,
  inside: (x, y, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ && y > -0.05 && y < maxY,
});

/** What a drawn lot takes out of village.glb's clone: anything standing on its footprint and its plot's old sign post. */
export function lotTrimFootprints(ids: readonly LotId[]): Foot[] {
  const out: Foot[] = [];
  for (const l of VILLAGE_LOTS) {
    if (!ids.includes(l.id)) continue;
    const f = lotFootprint(l);
    out.push(box(f.minX, f.maxX, f.minZ, f.maxZ, 30));
    const plot = l.plot ? VILLAGE_LAYOUT.plots.find((p) => p.id === l.plot) : null;
    const sp = plot?.signPost;
    if (sp) out.push(box(sp.x - POST_HALF, sp.x + POST_HALF, sp.z - POST_HALF, sp.z + POST_HALF, POST_TOP));
  }
  // what the lot replaces on its plot (plot_w's scaffold and crane): its box, grown for the crane's foot and the scaffold's boards
  for (const r of LOT_REPLACED_MODEL_BOXES) {
    if (!ids.includes(r.lot)) continue;
    out.push(box(r.box.minX - REPLACED_PAD, r.box.maxX + REPLACED_PAD, r.box.minZ - REPLACED_PAD, r.box.maxZ + REPLACED_PAD, r.top));
  }
  for (const r of LOT_REPLACED_HIGH) {
    if (!ids.includes(r.lot)) continue;
    const b = r.box;
    out.push({ ...b, maxY: r.maxY, inside: (x, y, z) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && y > r.minY && y < r.maxY });
  }
  return out;
}

/** The plots' glowing outline strips (village.glb `M_glow_plot`, flat on the ground): a built plot has none (vrb2 drops them too). */
const GLOW_PLOT = "M_glow_plot";
/** How far past a plot's rectangle (m) its strip is looked for. */
const GLOW_MARGIN = 1.2;

const ga = new Vector3();
const gb = new Vector3();
const gc = new Vector3();

/** A copy of `mesh`'s geometry without the glow strip's triangles inside one of `rects` (any height), or null when none is. */
function trimGlow(mesh: Mesh, rects: ReadonlyArray<{ minX: number; maxX: number; minZ: number; maxZ: number }>): { geometry: BufferGeometry; removed: number } | null {
  const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
  if (!mats.some((m) => m?.name === GLOW_PLOT)) return null;
  const geo = mesh.geometry;
  const pos = geo.getAttribute("position") as BufferAttribute | undefined;
  if (!pos) return null;
  const index = geo.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const get = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const groups = geo.groups.length > 0 ? geo.groups : [{ start: 0, count: triCount * 3, materialIndex: 0 }];
  const kept: number[] = [];
  const newGroups: Array<{ start: number; count: number; materialIndex: number }> = [];
  const inRect = (v: Vector3) => rects.some((r) => v.x >= r.minX && v.x <= r.maxX && v.z >= r.minZ && v.z <= r.maxZ);
  let removed = 0;
  for (const g of groups) {
    const start = kept.length;
    const isGlow = mats[g.materialIndex ?? 0]?.name === GLOW_PLOT;
    for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) {
      const a = get(t, 0);
      const b = get(t, 1);
      const c = get(t, 2);
      if (isGlow) {
        ga.fromBufferAttribute(pos, a).applyMatrix4(mesh.matrixWorld);
        gb.fromBufferAttribute(pos, b).applyMatrix4(mesh.matrixWorld);
        gc.fromBufferAttribute(pos, c).applyMatrix4(mesh.matrixWorld);
        if (inRect(ga) && inRect(gb) && inRect(gc)) {
          removed++;
          continue;
        }
      }
      kept.push(a, b, c);
    }
    newGroups.push({ start, count: kept.length - start, materialIndex: g.materialIndex ?? 0 });
  }
  if (removed === 0) return null;
  const out = new BufferGeometry();
  for (const name of Object.keys(geo.attributes)) out.setAttribute(name, geo.getAttribute(name));
  out.setIndex(pos.count > 65535 ? new Uint32BufferAttribute(kept, 1) : new Uint16BufferAttribute(kept, 1));
  if (geo.groups.length > 0) for (const g of newGroups) out.addGroup(g.start, g.count, g.materialIndex);
  out.boundingSphere = geo.boundingSphere?.clone() ?? null;
  out.boundingBox = geo.boundingBox?.clone() ?? null;
  return { geometry: out, removed };
}

/** The built plots' rectangles, grown by GLOW_MARGIN (their outline strips). */
function builtPlotRects(ids: readonly LotId[]): Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> {
  const out: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  for (const l of VILLAGE_LOTS) {
    if (!ids.includes(l.id) || !l.plot) continue;
    const plot = VILLAGE_LAYOUT.plots.find((p) => p.id === l.plot);
    if (!plot) continue;
    const b = boxAt(plot.centre, plot.size);
    out.push({ minX: b.minX - GLOW_MARGIN, maxX: b.maxX + GLOW_MARGIN, minZ: b.minZ - GLOW_MARGIN, maxZ: b.maxZ + GLOW_MARGIN });
  }
  return out;
}

/**
 * Once the lots are drawn the village clone loses what stood on their ground (the old plot signs and posts; vrb2's rebuild drops
 * them from village.glb itself, contract 8.1); when the lots go (a failed file, the scene unmounts) the originals come back.
 */
export function LotsVillagePatch({ root }: { root: Object3D }) {
  const drawn = useLotsDrawn();
  useLayoutEffect(() => {
    if (drawn.length === 0) return;
    const feet = lotTrimFootprints(drawn);
    const rects = builtPlotRects(drawn);
    const undo: Array<() => void> = [];
    const stats = { meshes: 0, trianglesRemoved: 0 };
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || (o as { isInstancedMesh?: boolean }).isInstancedMesh || KEEP.test(mesh.name)) return;
      const original = mesh.geometry;
      const a = trimMesh(mesh, feet);
      if (a) mesh.geometry = a.geometry;
      const g = trimGlow(mesh, rects);
      const t = g ? { geometry: g.geometry, removed: g.removed + (a?.removed ?? 0) } : a;
      if (!t) return;
      mesh.geometry = t.geometry;
      stats.meshes++;
      stats.trianglesRemoved += t.removed;
      undo.push(() => {
        if (mesh.geometry !== t.geometry) return;
        mesh.geometry = original;
        t.geometry.dispose();
      });
    });
    if (import.meta.env.DEV) window.__cvLotsPatch = () => stats;
    return () => {
      for (const u of undo.reverse()) u();
      if (import.meta.env.DEV) delete window.__cvLotsPatch;
    };
  }, [drawn, root]);
  return null;
}
