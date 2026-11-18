import {
  Box3,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Sphere,
  Vector3,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from "three";
import { BARK_SURFACE, barkPhotos, barkTexture, flatNormal, type BarkPattern } from "../village/veg/barkGeometry";
import { makeCrownAtlas, makeTallAtlas } from "../village/veg/leafAtlas";
import { BUNCHES, TREE_DEFS, bunchGeo, treeGeo, willowGeo, type TreeSpecies } from "../village/veg/treeKit";
import { vegMaterial } from "../village/veg/vegMaterial";
import { floraOld } from "../village/veg/vegMode";
import { hashUnit } from "../village/veg/vegRandom";
import type { VillageTier } from "../village/villageModelPrep";

/**
 * The lake's trees, reeds and grass (owner audit 2026-11-18: "stick trunks with the crowns floating on top", "white/grey stick cards").
 * lake.glb's `inst__lake*_forest|willow|reed|cattail|grass|grasstall_*` are hidden and drawn again from the SAME instance matrices
 * (the same places, sizes and turns) as:
 *  - forest: birch, oak and beech chosen per tree, each a real branching tree (village/veg/treeKit.ts: leader, branches, side
 *    branches, a leaf spray card on every branch tip, the village's bark photos), two shapes per species;
 *  - willows: a thick trunk, drooping arches and dozens of hanging strand cards;
 *  - reeds, cattails and grass: green-brown alpha-card bunches (leafAtlas.ts).
 * Trees have two levels: near (all the branches) and far (the leader and main branches, a third of the cards, bigger), chosen per
 * tree by its distance to the camera every time the camera has moved 1.5 m (no allocation: plain arrays and typed arrays).
 * `?flora=old` (DEV) keeps the file's own meshes for side-by-side shots.
 */

const TREE = /^inst__lake(hi)?_forest_(\d+)_(\d+)$/;
const WILLOW = /^inst__lake(hi)?_willow_(\d+)_(\d+)$/;
const PLANT = /^inst__lake(hi)?_(reed|cattail|grass|grasstall)_(\d+)_\d+$/;
/** Distance (m) within which a tree is drawn whole, per tier; the far level beyond. */
const NEAR: Record<VillageTier, number> = { high: 46, low: 30 };
const HYST = 4;
/** Shapes (seeds) per species and per level. */
const SHAPES = 2;
const PLANT_VARIANTS = 2;

type Species = Exclude<TreeSpecies, "willow">;

export interface LakeFloraStats {
  trees: number;
  willows: number;
  plants: number;
  hidden: number;
  /** Triangles of one full copy of each tree geometry, near and far, and their total instances. */
  nearTris: number;
  farTris: number;
}

export interface LakeFlora {
  group: Group;
  /** Choose each tree's level for the camera's place (cheap; moves only when the camera has moved). */
  update(camera: Vector3): void;
  stats: LakeFloraStats;
  dispose(): void;
}

export { floraOld };

interface Group3 {
  /** The instances: world matrices (16 floats each) and their centres (x, y, z) for the distance test. */
  mats: Float32Array;
  centres: Float32Array;
  n: number;
  /** 0 near / 1 far, per instance. */
  level: Uint8Array;
  near: { bark: InstancedMesh; leaves: InstancedMesh } | null;
  far: { bark: InstancedMesh; leaves: InstancedMesh } | null;
}

function instanceMatrices(mesh: InstancedMesh): Matrix4[] {
  mesh.updateWorldMatrix(true, false);
  const out: Matrix4[] = [];
  for (let i = 0; i < mesh.count; i++) {
    const m = new Matrix4();
    mesh.getMatrixAt(i, m);
    out.push(m.premultiply(mesh.matrixWorld));
  }
  return out;
}

/** An instanced mesh with room for `cap`, matrices written later, culled by `sphere` (null: by the matrices). */
function makeInstanced(g: BufferGeometry, m: Material, cap: number, name: string, sphere: Sphere | null): InstancedMesh {
  const mesh = new InstancedMesh(g, m, Math.max(1, cap));
  mesh.name = name;
  mesh.count = 0;
  mesh.matrixAutoUpdate = false;
  if (sphere) mesh.boundingSphere = sphere;
  return mesh;
}

export function installLakeFlora(root: Object3D, tier: VillageTier): LakeFlora | null {
  if (typeof document === "undefined") return null;
  const low = tier !== "high";
  const crown = makeCrownAtlas();
  const tall = makeTallAtlas();
  if (!crown || !tall) return null;
  const owned: Array<{ dispose(): void }> = [crown, tall];
  const group = new Group();
  group.name = "lake_flora";

  // ── what the file has ──
  const trees: Array<{ mesh: InstancedMesh; leaves: Mesh | null }> = [];
  const willows: InstancedMesh[] = [];
  const plants: Array<{ mesh: InstancedMesh; kind: keyof typeof BUNCHES }> = [];
  const leafOf = new Map<string, InstancedMesh>();
  root.traverse((o) => {
    if (!(o as InstancedMesh).isInstancedMesh) return;
    const im = o as InstancedMesh;
    const t = TREE.exec(im.name);
    if (t) {
      if (t[3] === "1") leafOf.set(`${t[1] ?? ""}_${t[2]}`, im);
      return;
    }
  });
  let hidden = 0;
  root.traverse((o) => {
    if (!(o as InstancedMesh).isInstancedMesh) return;
    const im = o as InstancedMesh;
    const t = TREE.exec(im.name);
    if (t) {
      if (t[3] === "0") trees.push({ mesh: im, leaves: leafOf.get(`${t[1] ?? ""}_${t[2]}`) ?? null });
      im.visible = false;
      hidden++;
      return;
    }
    if (WILLOW.test(im.name)) {
      if (im.name.endsWith("_0")) willows.push(im);
      im.visible = false;
      hidden++;
      return;
    }
    const p = PLANT.exec(im.name);
    if (p) {
      const kind = p[2] === "reed" ? "reed" : p[2] === "cattail" ? "cattail" : p[2] === "grass" ? "grass" : "grassTall";
      plants.push({ mesh: im, kind });
      im.visible = false;
      hidden++;
    }
  });
  if (!trees.length && !willows.length && !plants.length) {
    owned.forEach((t) => t.dispose());
    return null;
  }

  // ── materials ──
  const mats: Material[] = [];
  const barkMats = new Map<BarkPattern, Material>();
  const barkMat = (pattern: BarkPattern): Material => {
    let m = barkMats.get(pattern);
    if (m) return m;
    const map = barkTexture(pattern);
    const normal = flatNormal();
    const surf = BARK_SURFACE[pattern];
    const mat = vegMaterial({ name: `M_lake_bark_${pattern}`, map, normalMap: normal, normalScale: surf.normal, gloss: surf.gloss, moss: false, wind: 0, windFar: 1, ambient: 0.55, sky: 0.2, sun: 0.45, back: 0.2 });
    barkPhotos(pattern, low, (photo, photoNormal) => {
      mat.map = photo;
      (mat.userData.vegUniforms as { uVegNormal: { value: unknown } }).uVegNormal.value = photoNormal;
      mat.needsUpdate = true;
      owned.push(photo, photoNormal);
    });
    owned.push(map, normal, mat);
    barkMats.set(pattern, mat);
    mats.push(mat);
    m = mat;
    return m;
  };
  const leafMat = vegMaterial({ name: "M_lake_leaves", map: crown as Texture, alphaTest: 0.5, push: true, wind: 0.05, windFar: low ? 12 : 30, ambient: 0.5, sky: 0.2, sun: 0.4, back: 0.45 });
  const leafFarMat = vegMaterial({ name: "M_lake_leaves_far", map: crown as Texture, alphaTest: 0.5, wind: 0.02, windFar: 40, ambient: 0.52, sky: 0.2, sun: 0.4, back: 0.45 });
  const tallMat = vegMaterial({ name: "M_lake_tall", map: tall as Texture, alphaTest: 0.5, push: true, wind: 0.07, windFar: low ? 14 : 34, ambient: 0.52, sky: 0.2, sun: 0.4, back: 0.5 });
  mats.push(leafMat, leafFarMat, tallMat);
  owned.push(leafMat, leafFarMat, tallMat);

  const geos: BufferGeometry[] = [];
  const keep = <T extends BufferGeometry>(g: T): T => (geos.push(g), g);

  // ── trees: species and shape per instance, from where it stands ──
  const bound = (list: Matrix4[], r: number): Sphere => {
    const box = new Box3();
    const v = new Vector3();
    for (const m of list) box.expandByPoint(v.setFromMatrixPosition(m));
    const s = box.getBoundingSphere(new Sphere());
    s.radius += r;
    return s;
  };
  const p = new Vector3();
  const q = new Quaternion();
  const sc = new Vector3();
  interface Plan {
    key: string;
    species: Species | "willow";
    shape: number;
    m: Matrix4;
  }
  const plans: Plan[] = [];
  for (const t of trees) {
    // the baked crown's height and reach give the tree its size (the file's own measure of how big this one was meant to be)
    const g = (t.leaves ?? t.mesh).geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox!;
    const H = Math.max(5, bb.max.y);
    const Rr = Math.max(2, Math.max(Math.abs(bb.min.x), bb.max.x, Math.abs(bb.min.z), bb.max.z));
    for (const m of instanceMatrices(t.mesh)) {
      m.decompose(p, q, sc);
      const u = hashUnit(Math.round(p.x * 3.7), Math.round(p.z * 3.7), 41);
      const species: Species = u < 0.42 ? "birch" : u < 0.76 ? "beech" : "oak";
      const shape = Math.floor(hashUnit(Math.round(p.x * 1.3), Math.round(p.z * 1.9), 7) * SHAPES);
      const def = TREE_DEFS[species];
      const sy = Math.max(0.7, Math.min(1.5, H / def.H));
      const sxz = Math.max(0.75, Math.min(1.45, Rr / def.R));
      sc.set(sc.x * sxz, sc.y * sy, sc.z * sxz);
      plans.push({ key: `${species}${shape}`, species, shape, m: new Matrix4().compose(p, q, sc) });
    }
  }
  for (const w of willows) {
    for (const m of instanceMatrices(w)) {
      m.decompose(p, q, sc);
      const shape = Math.floor(hashUnit(Math.round(p.x * 1.3), Math.round(p.z * 1.9), 9) * SHAPES);
      plans.push({ key: `willow${shape}`, species: "willow", shape, m: new Matrix4().compose(p, q, sc.multiplyScalar(1.1)) });
    }
  }
  const byKey = new Map<string, Plan[]>();
  for (const pl of plans) (byKey.get(pl.key) ?? byKey.set(pl.key, []).get(pl.key)!).push(pl);

  const groups: Group3[] = [];
  let nearTris = 0;
  let farTris = 0;
  for (const [key, list] of byKey) {
    const first = list[0]!;
    const sp = first.species;
    const seed = first.shape * 17 + (sp === "birch" ? 1 : sp === "beech" ? 2 : sp === "oak" ? 3 : 4);
    const build = (lod: 0 | 1) => (sp === "willow" ? willowGeo(seed, { lod, low }) : treeGeo(sp, seed, { lod, low }));
    const near = build(0);
    const far = build(1);
    keep(near.bark);
    keep(near.leaves);
    keep(far.bark);
    keep(far.leaves);
    nearTris += near.tris;
    farTris += far.tris;
    const pattern: BarkPattern = sp === "oak" ? "plates" : sp === "willow" ? "willow" : "smooth";
    const bm = barkMat(pattern);
    const sphere = bound(list.map((l) => l.m), 14);
    const lm = sp === "willow" ? tallMat : leafMat;
    const lf = sp === "willow" ? tallMat : leafFarMat;
    const n = list.length;
    const g3: Group3 = {
      mats: new Float32Array(n * 16),
      centres: new Float32Array(n * 3),
      n,
      level: new Uint8Array(n).fill(2),
      near: { bark: makeInstanced(near.bark, bm, n, `lake_${key}_bark`, sphere), leaves: makeInstanced(near.leaves, lm, n, `lake_${key}_leaves`, sphere) },
      far: { bark: makeInstanced(far.bark, bm, n, `lake_${key}_bark_far`, sphere), leaves: makeInstanced(far.leaves, lf, n, `lake_${key}_leaves_far`, sphere) },
    };
    list.forEach((l, i) => {
      l.m.toArray(g3.mats, i * 16);
      l.m.decompose(p, q, sc);
      g3.centres[i * 3] = p.x;
      g3.centres[i * 3 + 1] = p.y;
      g3.centres[i * 3 + 2] = p.z;
    });
    for (const part of [g3.near!, g3.far!]) {
      group.add(part.bark, part.leaves);
      part.bark.visible = part.leaves.visible = false;
    }
    groups.push(g3);
  }

  // ── reeds, cattails, grass: bunches of cards on the file's own places ──
  let plantCount = 0;
  const plantList = new Map<string, Matrix4[]>();
  for (const pl of plants) {
    const list = instanceMatrices(pl.mesh);
    const variant = Number(/_(\d+)_\d+$/.exec(pl.mesh.name)![1]) % PLANT_VARIANTS;
    const key = `${pl.kind}${variant}`;
    (plantList.get(key) ?? plantList.set(key, []).get(key)!).push(...list);
  }
  for (const [key, list] of plantList) {
    const kind = key.slice(0, -1) as keyof typeof BUNCHES;
    const variant = Number(key.slice(-1));
    const g = keep(bunchGeo(kind, variant * 5 + 1));
    const mesh = new InstancedMesh(g, tallMat, list.length);
    mesh.name = `lake_${key}`;
    mesh.matrixAutoUpdate = false;
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    plantCount += list.length;
  }

  const last = new Vector3(1e9, 0, 0);
  const update = (cam: Vector3): void => {
    if (Math.abs(cam.x - last.x) + Math.abs(cam.z - last.z) + Math.abs(cam.y - last.y) < 1.5) return;
    last.copy(cam);
    const near = NEAR[tier];
    for (const g of groups) {
      let nn = 0;
      let nf = 0;
      const A = g.near!;
      const B = g.far!;
      const am = A.bark.instanceMatrix.array as Float32Array;
      const bm = B.bark.instanceMatrix.array as Float32Array;
      const al = A.leaves.instanceMatrix.array as Float32Array;
      const bl = B.leaves.instanceMatrix.array as Float32Array;
      for (let i = 0; i < g.n; i++) {
        const dx = g.centres[i * 3]! - cam.x;
        const dz = g.centres[i * 3 + 2]! - cam.z;
        const d = Math.hypot(dx, dz);
        const was = g.level[i]!;
        const lv = was === 0 ? (d > near + HYST ? 1 : 0) : was === 1 ? (d < near - HYST ? 0 : 1) : d > near ? 1 : 0;
        g.level[i] = lv;
        // (copied by hand: no typed-array views made per tree)
        const from = i * 16;
        if (lv === 0) {
          const to = nn * 16;
          for (let k = 0; k < 16; k++) am[to + k] = al[to + k] = g.mats[from + k]!;
          nn++;
        } else {
          const to = nf * 16;
          for (let k = 0; k < 16; k++) bm[to + k] = bl[to + k] = g.mats[from + k]!;
          nf++;
        }
      }
      for (const [part, c] of [
        [A, nn],
        [B, nf],
      ] as const) {
        part.bark.count = part.leaves.count = c;
        part.bark.visible = part.leaves.visible = c > 0;
        part.bark.instanceMatrix.clearUpdateRanges();
        part.leaves.instanceMatrix.clearUpdateRanges();
        part.bark.instanceMatrix.addUpdateRange(0, Math.max(1, c * 16));
        part.leaves.instanceMatrix.addUpdateRange(0, Math.max(1, c * 16));
        part.bark.instanceMatrix.needsUpdate = true;
        part.leaves.instanceMatrix.needsUpdate = true;
      }
    }
  };

  return {
    group,
    update,
    stats: { trees: plans.filter((x) => x.species !== "willow").length, willows: plans.filter((x) => x.species === "willow").length, plants: plantCount, hidden, nearTris, farTris },
    dispose() {
      for (const g of geos) g.dispose();
      for (const t of owned) t.dispose();
      for (const m of mats) m.dispose();
      group.removeFromParent();
    },
  };
}
