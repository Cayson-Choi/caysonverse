// Takes the baked lamp posts and banner poles out of a clone of village.glb (they are merged into the per-cell meshes,
// village_lm_* and village_fx_*, so they are found by place, not name): a triangle goes when ALL three of its vertices lie
// inside one post's footprint (a thin upright cylinder around the post, or the old banner card's slab), and it stands up
// (its top above 0.1 m: the paving under a post is never taken). Like lake/lakeVillagePatch.ts the geometry is never
// edited in place (the loader's cache owns it): a trimmed mesh gets a copy that shares the attributes with a new index;
// `restore()` puts the originals back.

import { BufferGeometry, Uint16BufferAttribute, Uint32BufferAttribute, Vector3, type BufferAttribute, type Mesh, type Object3D } from "three";
import { LAMP_POSTS, OLD_BANNER, OLD_BANNER_POLES, OLD_LAMP_TOP_ABOVE_LIGHT, OLD_PLAZA_LAMPS } from "./streetLayout";

/** Meshes never touched (sky, moon, the invisible boxes and markers, the water). */
const KEEP = /^(village_sky|village_water|village_backdrop|fountain_moon|col__|light__|seat__|inst__)/;

/** The old lamp post's widest part (the lantern's cap, r 0.26) plus a margin. */
const OLD_LAMP_RADIUS = 0.3;

export interface StreetTrimStats {
  meshes: number;
  trianglesRemoved: number;
}

/** A footprint: does the point belong to one old post? (world x, y, z) */
type Inside = (x: number, y: number, z: number) => boolean;

export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
  /** A triangle goes only when its top is above this (m; default 0.1: the paving under a post is never taken). */
  minTop?: number;
  inside: Inside;
}

/** The old posts' and poles' footprints (parts_props.py lamp / banners, parts_fill.py lane lamps). */
export function oldFootprints(): Footprint[] {
  const out: Footprint[] = [];
  for (const p of [...LAMP_POSTS, ...OLD_PLAZA_LAMPS]) {
    const top = p.lightY + OLD_LAMP_TOP_ABOVE_LIGHT;
    const r2 = OLD_LAMP_RADIUS * OLD_LAMP_RADIUS;
    out.push({
      minX: p.x - OLD_LAMP_RADIUS,
      maxX: p.x + OLD_LAMP_RADIUS,
      minZ: p.z - OLD_LAMP_RADIUS,
      maxZ: p.z + OLD_LAMP_RADIUS,
      maxY: top,
      inside: (x, y, z) => (x - p.x) ** 2 + (z - p.z) ** 2 < r2 && y > -0.05 && y < top,
    });
  }
  for (const b of OLD_BANNER_POLES) {
    const c = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    const pr = OLD_BANNER.poleRadius + 0.04;
    const reach = OLD_BANNER.armReach + 0.06;
    out.push({
      minX: b.x - reach,
      maxX: b.x + reach,
      minZ: b.z - reach,
      maxZ: b.z + reach,
      maxY: OLD_BANNER.top + 0.05,
      inside: (x, y, z) => {
        const dx = x - b.x;
        const dz = z - b.z;
        if (dx * dx + dz * dz < pr * pr) return y > -0.05 && y < OLD_BANNER.top + 0.05;
        // the arms and the card: along local x (vlib.loc: x = cx + lx c + lz s, z = cz - lx s + lz c)
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        return lx > -0.03 && lx < reach && Math.abs(lz) < 0.06 && y > OLD_BANNER.cardBottom - 0.08 && y < OLD_BANNER.cardTop + 0.08;
      },
    });
  }
  return out;
}

const va = new Vector3();
const vb = new Vector3();
const vc = new Vector3();

/**
 * A copy of `mesh`'s geometry without the triangles inside one footprint, or null when none is. Positions are taken to
 * world space with the mesh's matrixWorld (the clone's cells carry their own offsets).
 */
export function trimMesh(mesh: Mesh, feet: readonly Footprint[]): { geometry: BufferGeometry; removed: number } | null {
  const geo = mesh.geometry;
  const pos = geo.getAttribute("position") as BufferAttribute | undefined;
  if (!pos) return null;
  // quick reject: a mesh whose box meets no footprint
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
  const near = feet.filter((f) => f.maxX >= bb.min.x && f.minX <= bb.max.x && f.maxZ >= bb.min.z && f.minZ <= bb.max.z && bb.min.y <= f.maxY);
  if (near.length === 0) return null;
  const index = geo.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const get = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const m = mesh.matrixWorld;
  const groups = geo.groups.length > 0 ? geo.groups : [{ start: 0, count: triCount * 3, materialIndex: 0 }];
  const kept: number[] = [];
  const newGroups: Array<{ start: number; count: number; materialIndex: number }> = [];
  let removed = 0;
  for (const g of groups) {
    const start = kept.length;
    for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) {
      const a = get(t, 0);
      const b = get(t, 1);
      const c = get(t, 2);
      va.fromBufferAttribute(pos, a).applyMatrix4(m);
      vb.fromBufferAttribute(pos, b).applyMatrix4(m);
      vc.fromBufferAttribute(pos, c).applyMatrix4(m);
      const top = Math.max(va.y, vb.y, vc.y);
      let drop = false;
      if (top > 0.01) {
        for (const f of near) {
          if (top <= (f.minTop ?? 0.1)) continue;
          if (f.inside(va.x, va.y, va.z) && f.inside(vb.x, vb.y, vb.z) && f.inside(vc.x, vc.y, vc.z)) {
            drop = true;
            break;
          }
        }
      }
      if (drop) removed++;
      else kept.push(a, b, c);
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

/** Take the old posts and poles out of a village clone. Safe to call twice (the second finds nothing). */
export function trimOldStreetFurniture(root: Object3D): { stats: StreetTrimStats; restore(): void } {
  const feet = oldFootprints();
  const stats: StreetTrimStats = { meshes: 0, trianglesRemoved: 0 };
  const undo: Array<() => void> = [];
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || (o as { isInstancedMesh?: boolean }).isInstancedMesh || KEEP.test(mesh.name)) return;
    const t = trimMesh(mesh, feet);
    if (!t) return;
    const original = mesh.geometry;
    mesh.geometry = t.geometry;
    stats.meshes++;
    stats.trianglesRemoved += t.removed;
    undo.push(() => {
      // another patch (the lake's) may have layered its own copy over ours since: leave it to put ours back itself
      if (mesh.geometry !== t.geometry) return;
      mesh.geometry = original;
      t.geometry.dispose();
    });
  });
  return {
    stats,
    restore() {
      for (const u of undo.reverse()) u();
      undo.length = 0;
    },
  };
}
