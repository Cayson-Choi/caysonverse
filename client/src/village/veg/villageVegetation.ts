import {
  BufferAttribute,
  Box3,
  Euler,
  Frustum,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Sphere,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { isMesh, materialsOf } from "../../game/hub/hubModelPrep";
import { CHERRY_MATERIAL, type VillageTier } from "../villageModelPrep";
import { growCherry, outdoorCherrySkeletons, plazaCherrySkeletons, type Branch, type Bunch, type CherryCrown } from "./cherryTree";
import { growGreen, PLAZA_ZELKOVA, type GreenCluster, type GreenCrown } from "./greenTree";
import { placeFlowers, SPECIES_COUNT, type Plant } from "./flowerPlacement";
import { keepTriangles, readCards, type AttributeLike, type Card } from "./vegCards";
import { makeBlossomAtlas } from "./vegAtlas";
import { blossomBunch, bunchSprite, greenCluster, greenClusterFar, speciesMeshes, twigMesh } from "./vegGeometry";
import { chooseLod, groupIntoCells, sphereDistance, VEG_TIERS, type Cell, type Vec3, type VegTierConfig } from "./vegLod";
import { vegMaterial, vegTimeUniform } from "./vegMaterial";
import { DAY_SUN_DIRECTION } from "../dayNightBlend";
import type { VegMode } from "./vegMode";

/**
 * 케이슨 마을's 3D vegetation (veg3d prototype): real 3D flowers in the flower beds and volumetric crowns on the
 * plaza's six cherries, in place of the flat cards baked into `village.glb` (the owner, 2026-11-10: "평면을 같다
 * 붙여놓았잖아. 전혀 입체적인게 없어").
 *
 *  - Flowers: the beds are read from the old flower cards themselves (vegCards.ts, flowerPlacement.ts); each bed
 *    gets petunias, pansies, grape hyacinths and tulips as instanced 3D plants (vegGeometry.ts), cut into 8 m cells
 *    with three distance levels (full plants, simple plants, simple plants thinned and enlarged), refilled only when
 *    a cell changes level or comes into view (vegLod.ts).
 *  - Cherries: the file's light-mapped trunks and limbs stay; twigs grow out of them and blossom bunches hang on the
 *    twigs (cherryTree.ts): close to a tree real 3D flowers (16 per bunch), further away bunch sprites, thinned far off.
 *  - The old cards are hidden by a copy of their mesh's index without them (the file and the loader's geometry are
 *    not touched). `?veg=old` (DEV) keeps the old village as it was; `?veg=both` shows both.
 *  - The phone tier (low) never draws the full blossom bunches, has fewer and simpler plants and less wind.
 */

export { vegModeFrom, type VegMode } from "./vegMode";

const FLORA = "M_leaf_flora";
/** The plaza zelkova currently has no reliable trunk-to-ground connection, so keep the whole asset out of the scene. */
export const REMOVE_PLAZA_ZELKOVA = true;

function isNearPlazaZelkova(x: number, z: number): boolean {
  return Math.hypot(x - PLAZA_ZELKOVA.base[0], z - PLAZA_ZELKOVA.base[2]) < PLAZA_ZELKOVA.R + 1.2;
}

export interface VegStats {
  mode: VegMode;
  tier: VillageTier;
  plants: number;
  bunches: number;
  twigs: number;
  hiddenCards: { flora: number; cherry: number; green: number };
  keptFlowerCards: number;
  /** Instances drawn this frame per level: flowers [full, simple, thinned], cherry [flowers, sprites, thinned]. */
  levels: { flowers: [number, number, number]; cherry: [number, number, number]; green: [number, number, number] };
  /** Triangles and draw calls the vegetation draws this frame (instances x mesh triangles). */
  tris: number;
  calls: number;
  /** Milliseconds of main-thread work the build took (in steps, the main thread handed back between them). */
  genMs: number;
  /** Each step's milliseconds. */
  steps: Record<string, number>;
}

/** World-space positions of a mesh's vertices, as an AttributeLike (the meshes of the file sit at the origin). */
function worldPositions(mesh: Mesh): AttributeLike {
  const attr = mesh.geometry.getAttribute("position") as BufferAttribute;
  mesh.updateWorldMatrix(true, false);
  if (mesh.matrixWorld.equals(new Matrix4())) return attr;
  const out = new Float32Array(attr.count * 3);
  const v = new Vector3();
  for (let i = 0; i < attr.count; i++) {
    v.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return { count: attr.count, getX: (i) => out[i * 3]!, getY: (i) => out[i * 3 + 1]!, getZ: (i) => out[i * 3 + 2]! };
}

/** The non-instanced meshes using the material `name`. */
function meshesWithMaterial(root: Object3D, name: string): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (!isMesh(o) || (o as InstancedMesh).isInstancedMesh) return;
    if (materialsOf(o).some((m) => m.name === name)) out.push(o);
  });
  return out;
}

/** Hide legacy flat foliage synchronously while volumetric replacements are built. */
export function hideLegacyVegetationSources(root: Object3D): () => void {
  const hidden: Array<{ object: Object3D; visible: boolean }> = [];
  const names = new Set([FLORA, CHERRY_MATERIAL, "M_leaf_green"]);
  root.traverse((object) => {
    if (!isMesh(object) || !materialsOf(object).some((material) => names.has(material.name))) return;
    hidden.push({ object, visible: object.visible });
    object.visible = false;
  });
  return () => {
    for (const entry of hidden) entry.object.visible = entry.visible;
  };
}

interface Batch {
  n: number;
  matrices: Float32Array;
  tints: Float32Array;
  lights: Float32Array;
}

function makeBatch(items: ReadonlyArray<{ m: Matrix4; tint: readonly number[]; light: number }>): Batch {
  const n = items.length;
  const b: Batch = { n, matrices: new Float32Array(n * 16), tints: new Float32Array(n * 3), lights: new Float32Array(n) };
  items.forEach((it, i) => {
    it.m.toArray(b.matrices, i * 16);
    b.tints[i * 3] = it.tint[0]!;
    b.tints[i * 3 + 1] = it.tint[1]!;
    b.tints[i * 3 + 2] = it.tint[2]!;
    b.lights[i] = it.light;
  });
  return b;
}

/** Read GPU-instanced card transforms and turn each card into a compact volumetric replacement. */
function instancedCardItems(root: Object3D, materialName: string): { items: Array<{ m: Matrix4; tint: number[]; light: number }>; meshes: InstancedMesh[] } {
  const items: Array<{ m: Matrix4; tint: number[]; light: number }> = [];
  const meshes: InstancedMesh[] = [];
  root.traverse((o) => {
    const mesh = o as InstancedMesh;
    if (!mesh.isInstancedMesh || !materialsOf(mesh).some((m) => m.name === materialName)) return;
    mesh.updateWorldMatrix(true, false);
    const local = new Matrix4();
    const world = new Matrix4();
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, local);
      world.multiplyMatrices(mesh.matrixWorld, local);
      world.decompose(p, q, s);
      const size = Math.max(0.45, Math.min(2.2, (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3));
      items.push({ m: new Matrix4().compose(p, q, new Vector3(size, size, size)), tint: [1, 1, 1], light: 0.86 });
    }
    meshes.push(mesh);
  });
  return { items, meshes };
}

/** Read non-instanced foliage cards and turn each card into a compact volumetric cluster. */
function meshCardItems(root: Object3D, materialName: string): Array<{ m: Matrix4; tint: number[]; light: number }> {
  const items: Array<{ m: Matrix4; tint: number[]; light: number }> = [];
  for (const mesh of meshesWithMaterial(root, materialName)) {
    const g = mesh.geometry;
    const cards = readCards(worldPositions(mesh), g.index ? (g.index.array as ArrayLike<number>) : null, null, null);
    for (const card of cards) {
      if (card.h <= 0.05) continue;
      const size = Math.max(0.55, Math.min(2.2, card.h / 1.7));
      const yaw = Math.atan2(card.bz - card.az, card.bx - card.ax) + Math.PI / 2;
      items.push({ m: new Matrix4().compose(new Vector3(card.x, card.y, card.z), new Quaternion().setFromAxisAngle(UP, yaw), new Vector3(size, size, size)), tint: [1, 1, 1], light: card.light });
    }
  }
  return items;
}

/** Build branch connectors for baked green trees so volumetric replacement leaves remain attached to their trunks. */
function greenStreetBranchGeometry(root: Object3D, coarse: boolean): BufferGeometry {
  const branches: Array<{ branch: Branch; light: (p: Vec3, n: Vec3) => number }> = [];
  const box = new Box3();
  root.traverse((object) => {
    if (!isMesh(object) || !/var_(street_green|orchard)_trunks/.test(object.name)) return;
    box.setFromObject(object);
    const cx = (box.min.x + box.max.x) * 0.5;
    const cz = (box.min.z + box.max.z) * 0.5;
    const baseY = box.min.y;
    const topY = box.max.y;
    const height = Math.max(2.5, topY - baseY);
    const spread = Math.max(1.2, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.72);
    const forkY = baseY + height * 0.56;
    const crownY = baseY + height * 0.9;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + (cx + cz) * 0.07;
      const end: Vec3 = [cx + Math.cos(a) * spread, crownY + (i % 2 ? 0.3 : -0.15), cz + Math.sin(a) * spread];
      const mid: Vec3 = [cx + Math.cos(a) * spread * 0.42, forkY + height * 0.12, cz + Math.sin(a) * spread * 0.42];
      branches.push({ branch: { pts: [[cx, forkY, cz], mid, end], radii: [0.12, 0.065, 0.018] }, light: (_p, n) => 0.42 + 0.35 * Math.max(0, n[1]) });
      const side = a + (i % 2 ? 0.72 : -0.72);
      const sideEnd: Vec3 = [cx + Math.cos(side) * spread * 0.72, forkY + height * 0.27, cz + Math.sin(side) * spread * 0.72];
      branches.push({ branch: { pts: [mid, [cx + Math.cos(side) * spread * 0.53, forkY + height * 0.2, cz + Math.sin(side) * spread * 0.53], sideEnd], radii: [0.055, 0.032, 0.012] }, light: (_p, n) => 0.4 + 0.32 * Math.max(0, n[1]) });
    }
  });
  return twigMesh(branches, coarse);
}

/** An instanced mesh that is refilled from batches. */
class Layer {
  readonly mesh: InstancedMesh;
  readonly light: InstancedBufferAttribute;
  readonly tris: number;
  n = 0;

  constructor(geometry: BufferGeometry, material: Material, capacity: number, name: string) {
    const cap = Math.max(1, capacity);
    this.light = new InstancedBufferAttribute(new Float32Array(cap), 1);
    geometry.setAttribute("aLight", this.light);
    this.mesh = new InstancedMesh(geometry, material, cap);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.name = name;
    this.mesh.frustumCulled = false; // culled per cell here
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    this.tris = (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
  }

  begin(): void {
    this.n = 0;
  }

  push(b: Batch): void {
    if (b.n === 0) return;
    (this.mesh.instanceMatrix.array as Float32Array).set(b.matrices, this.n * 16);
    (this.mesh.instanceColor!.array as Float32Array).set(b.tints, this.n * 3);
    (this.light.array as Float32Array).set(b.lights, this.n);
    this.n += b.n;
  }

  end(): void {
    const n = this.n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    for (const [attr, size] of [
      [this.mesh.instanceMatrix, 16],
      [this.mesh.instanceColor!, 3],
      [this.light, 1],
    ] as const) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(1, n * size));
      attr.needsUpdate = true;
    }
  }
}

const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();
const tmpE = new Euler();
const tmpP = new Vector3();
const tmpS = new Vector3();
const UP = new Vector3(0, 1, 0);

function plantMatrix(p: Plant, scaleK: number): Matrix4 {
  tmpQ.setFromEuler(tmpE.set(p.leanX, 0, p.leanZ));
  tmpQ2.setFromAxisAngle(UP, p.yaw);
  tmpQ.multiply(tmpQ2);
  const s = p.scale * scaleK;
  return new Matrix4().compose(tmpP.set(p.x, p.y, p.z), tmpQ, tmpS.set(s, s, s));
}

interface FlowerCell {
  cell: Cell<Plant>;
  /** per species: full (level 0), mid (level 1), thin (level 2) */
  batches: Array<{ full: Batch; mid: Batch; thin: Batch }>;
  level: number;
  visible: boolean;
}

interface CherryTree {
  crown: CherryCrown;
  full: Batch;
  sprite: Batch;
  thin: Batch;
  level: number;
  visible: boolean;
}

interface GreenTree {
  crown: GreenCrown;
  full: Batch;
  far: Batch;
  thin: Batch;
  level: number;
  visible: boolean;
}

/** The bunch sprite is this much bigger than the bunch's measured size (its picture has a ragged edge). */
const SPRITE_K = 1.3;
/** The close-up bunch mesh is ~0.24 m across at scale 1. */
const BUNCH_MESH_SIZE = 0.24;

/** Hand the main thread back between the build's steps (a frame can be drawn, input handled). */
const yieldToMain = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export class VillageVegetation {
  readonly group = new Group();
  private readonly own: Array<{ dispose(): void }> = [];
  private readonly cfg: VegTierConfig;
  private readonly flowerLayers: Array<{ lod0: Layer; lod1: Layer }> = [];
  private readonly flowerCells: FlowerCell[] = [];
  private readonly cherry: CherryTree[] = [];
  private readonly green: GreenTree[] = [];
  private bunchLayer: Layer | null = null;
  private spriteLayer: Layer | null = null;
  private twigTris = 0;
  private greenLayer: Layer | null = null;
  private greenFarLayer: Layer | null = null;
  /** 3D replacements for instanced street/orchard foliage cards. */
  private greenCardLayer: Layer | null = null;
  private greenGrassLayer: Layer | null = null;
  /** 3D replacements for instanced street cherry cards. */
  private cherryCardLayer: Layer | null = null;
  private greenTwigTris = 0;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly statsData: VegStats;
  private dirtyFlowers = true;
  private dirtyCherry = true;
  private dirtyGreen = true;
  /** Meshes of the village clone whose geometry was swapped for a copy without the old cards, and what they had. */
  private readonly swapped: Array<{ mesh: Mesh; original: BufferGeometry }> = [];
  private readonly hiddenInstanced: Array<{ mesh: InstancedMesh; visible: boolean }> = [];

  private constructor(tier: VillageTier, mode: Exclude<VegMode, "old">) {
    this.cfg = VEG_TIERS[tier];
    this.group.name = "village_vegetation";
    this.group.matrixAutoUpdate = false;
    this.statsData = {
      mode,
      tier,
      plants: 0,
      bunches: 0,
      twigs: 0,
      hiddenCards: { flora: 0, cherry: 0, green: 0 },
      keptFlowerCards: 0,
      levels: { flowers: [0, 0, 0], cherry: [0, 0, 0], green: [0, 0, 0] },
      tris: 0,
      calls: 0,
      genMs: 0,
      steps: {},
    };
  }

  /**
   * Build the vegetation for a dressed village clone in steps (the main thread is handed back between them, so the
   * arrival is never frozen for the whole build). The old cards stay as they are until everything is ready, then
   * are hidden at once. `cancelled()` true: stop and free what was made (resolves null).
   */
  static async build(root: Object3D, tier: VillageTier, mode: Exclude<VegMode, "old">, cancelled: () => boolean = () => false): Promise<VillageVegetation | null> {
    const v = new VillageVegetation(tier, mode);
    if (REMOVE_PLAZA_ZELKOVA) {
      root.traverse((object) => {
        if (!isMesh(object) || object.name !== "village_lm_11") return;
        const materials = materialsOf(object).map((material) => {
          if (material.name !== "LM_bark") return material;
          const hidden = material.clone();
          hidden.transparent = true;
          hidden.opacity = 0;
          hidden.depthWrite = false;
          hidden.needsUpdate = true;
          v.own.push(hidden);
          return hidden;
        });
        object.material = Array.isArray(object.material) ? materials : materials[0]!;
      });
    }
    const steps = v.statsData.steps;
    let work = 0;
    let t = performance.now();
    const step = async (name: string) => {
      const now = performance.now();
      steps[name] = Math.round(now - t);
      work += now - t;
      await yieldToMain();
      t = performance.now();
      return cancelled();
    };
    const cfg = v.cfg;
    const hide = mode === "new";

    // ── flowers: the beds, read from the old cards ──
    const floraMeshes = meshesWithMaterial(root, FLORA);
    const cardMesh = new Map<Card, number>();
    const allCards: Card[] = [];
    floraMeshes.forEach((mesh, mi) => {
      const g = mesh.geometry;
      const cards = readCards(worldPositions(mesh), g.index ? (g.index.array as ArrayLike<number>) : null, (g.getAttribute("uv") as BufferAttribute) ?? null, (g.getAttribute("color") as BufferAttribute) ?? null);
      for (const c of cards) {
        cardMesh.set(c, mi);
        allCards.push(c);
      }
    });
    if (await step("cards")) return v.abandon();
    const placed = placeFlowers(allCards);
    if (await step("placement")) return v.abandon();
    const flowerMat = vegMaterial({ name: "M_veg_flowers", wind: 0.022, windFar: cfg.windFar ? 30 : 10, ambient: 0.5, sky: 0.12, sun: 0.5, back: 0.45 });
    v.own.push(flowerMat);
    const meshes = speciesMeshes();
    const counts = new Array<number>(SPECIES_COUNT).fill(0);
    for (const p of placed.plants) counts[p.species]!++;
    meshes.forEach((sm, s) => {
      const lod0 = new Layer(sm.lod0, flowerMat, counts[s]!, `veg_flowers_${s}_full`);
      const lod1 = new Layer(sm.lod1, flowerMat, counts[s]!, `veg_flowers_${s}_simple`);
      v.flowerLayers.push({ lod0, lod1 });
      v.group.add(lod0.mesh, lod1.mesh);
      v.own.push(sm.lod0, sm.lod1, lod0.mesh, lod1.mesh);
    });
    const fl = cfg.flowers;
    const midK = fl.mid < 1 ? fl.mid ** -0.25 : 1;
    for (const cell of groupIntoCells(placed.plants, 8, 0.6)) {
      const batches = [];
      for (let s = 0; s < SPECIES_COUNT; s++) {
        const list = cell.items.filter((p) => p.species === s);
        batches.push({
          full: makeBatch(list.map((p) => ({ m: plantMatrix(p, 1), tint: p.tint, light: p.light }))),
          mid: makeBatch(list.filter((p) => p.seed < fl.mid).map((p) => ({ m: plantMatrix(p, midK), tint: p.tint, light: p.light }))),
          thin: makeBatch(list.filter((p) => p.seed < fl.thin).map((p) => ({ m: plantMatrix(p, fl.thinScale), tint: p.tint, light: p.light }))),
        });
      }
      v.flowerCells.push({ cell, batches, level: -1, visible: false });
    }
    if (await step("flowerMeshes")) return v.abandon();

    // ── plaza and static outdoor cherries: one tree per step ──
    const crowns: CherryCrown[] = [];
    for (const sk of [...plazaCherrySkeletons(), ...outdoorCherrySkeletons()]) {
      crowns.push(growCherry(sk));
      if (await step(`cherry${sk.index}`)) return v.abandon();
    }
    const atlas: Texture | null = makeBlossomAtlas();
    if (atlas) v.own.push(atlas);
    const bunchMat = vegMaterial({ name: "M_veg_blossom", map: atlas, alphaTest: 0.5, cherry: true, wind: 0.012, windFar: 25, ambient: 0.62, sky: 0.12, sun: 0.38, back: 0.6 });
    const spriteMat = vegMaterial({ name: "M_veg_blossom_far", map: atlas, alphaTest: 0.5, cherry: true, sprite: true, wind: 0.01, windFar: 25, ambient: 1, sky: 0, sun: 0, back: 0 });
    const twigMat = vegMaterial({ name: "M_veg_twigs", wind: 0, windFar: 1, ambient: 0.55, sky: 0.2, sun: 0.45, back: 0.2 });
    v.own.push(bunchMat, spriteMat, twigMat);
    const total = crowns.reduce((a, c) => a + c.bunches.length, 0);
    const bunchGeo = blossomBunch();
    const spriteGeo = bunchSprite();
    v.own.push(bunchGeo, spriteGeo);
    v.bunchLayer = new Layer(bunchGeo, bunchMat, total, "veg_cherry_bunches");
    v.spriteLayer = new Layer(spriteGeo, spriteMat, total, "veg_cherry_sprites");
    v.own.push(v.bunchLayer.mesh, v.spriteLayer.mesh);
    v.group.add(v.bunchLayer.mesh, v.spriteLayer.mesh);
    const ch = cfg.cherry;
    for (const crown of crowns) {
      const tint = (b: Bunch) => {
        // white to the palest pink, the inner ones a little greyer
        const k = 0.9 + 0.1 * b.depth;
        const pink = 0.06 * b.seed;
        return [k, k * (0.97 - pink), k * (0.98 - pink * 0.6)];
      };
      const full = makeBatch(
        crown.bunches.map((b) => {
          tmpQ.setFromUnitVectors(UP, tmpP.set(b.nx, b.ny, b.nz));
          tmpQ2.setFromAxisAngle(UP, b.seed * Math.PI * 2);
          tmpQ.multiply(tmpQ2);
          const s = b.size / BUNCH_MESH_SIZE;
          return { m: new Matrix4().compose(new Vector3(b.x, b.y, b.z), tmpQ, new Vector3(s, s, s)), tint: tint(b), light: b.light };
        }),
      );
      const sprite = (k: number, keep: (b: Bunch) => boolean) =>
        makeBatch(
          crown.bunches.filter(keep).map((b) => {
            const s = b.size * SPRITE_K * k;
            return { m: new Matrix4().compose(new Vector3(b.x, b.y, b.z), new Quaternion(), new Vector3(s, s, s)), tint: tint(b), light: b.light };
          }),
        );
      v.cherry.push({ crown, full, sprite: sprite(1, () => true), thin: sprite(ch.thinScale, (b) => b.seed < ch.thin), level: -1, visible: false });
    }
    const sun = DAY_SUN_DIRECTION;
    const twigs = crowns.flatMap((c) => {
      const C = c.skeleton.crownC;
      const R = c.skeleton.R;
      return c.twigs.map((branch) => ({
        branch,
        light: (p: Vec3, n: Vec3) => {
          const rho = Math.min(1, Math.hypot(p[0] - C[0], (p[1] - C[1]) * 1.4, p[2] - C[2]) / R);
          return (0.35 + 0.45 * rho) * (0.85 + 0.15 * Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]));
        },
      }));
    });
    const twigGeo = twigMesh(twigs, tier === "low");
    const twigObj = new Mesh(twigGeo, twigMat);
    twigObj.name = "veg_cherry_twigs";
    twigObj.matrixAutoUpdate = false;
    v.group.add(twigObj);
    v.own.push(twigGeo);
    v.twigTris = (twigGeo.index?.count ?? 0) / 3;
    if (await step("cherryMeshes")) return v.abandon();

    // ── the plaza zelkova: keep the baked trunk, replace its large green cards with folded leaf clusters ──
    const greenCrown = growGreen(PLAZA_ZELKOVA);
    const greenMat = vegMaterial({ name: "M_veg_green", wind: 0.018, windFar: cfg.windFar ? 28 : 10, ambient: 0.48, sky: 0.18, sun: 0.46, back: 0.42 });
    const greenFarMat = vegMaterial({ name: "M_veg_green_far", wind: 0.008, windFar: 30, ambient: 0.54, sky: 0.16, sun: 0.34, back: 0.35 });
    const greenGeo = greenCluster(false);
    const greenFarGeo = greenClusterFar();
    v.own.push(greenMat, greenFarMat, greenGeo, greenFarGeo);
    // Instanced street/orchard foliage used to remain as flat cards. Read their transforms and replace each one
    // with a small volumetric leaf cluster; the original instanced meshes are hidden together with the other cards.
    const greenCardItems = instancedCardItems(root, "M_leaf_green");
    const cherryCardItems = instancedCardItems(root, CHERRY_MATERIAL);
    const greenMeshItems = meshCardItems(root, "M_leaf_green");
    const cherryMeshItems = meshCardItems(root, CHERRY_MATERIAL);
    const grassItems = placed.kept.map((c) => ({
      m: new Matrix4().compose(new Vector3(c.x, c.floor, c.z), new Quaternion().setFromAxisAngle(UP, c.x * 0.7 + c.z * 0.37), new Vector3(0.65, 0.65, 0.65)),
      tint: [0.88, 1, 0.82],
      light: c.light,
    }));
    const greenReplacementItems = [
      ...greenCardItems.items,
      ...greenMeshItems.filter((item) => !REMOVE_PLAZA_ZELKOVA || !isNearPlazaZelkova(item.m.elements[12]!, item.m.elements[14]!)),
    ];
    const cherryReplacementItems = [...cherryCardItems.items, ...cherryMeshItems];
    if (greenReplacementItems.length) {
      v.greenCardLayer = new Layer(greenFarGeo, greenFarMat, greenReplacementItems.length, "veg_green_volumetric_cards");
      v.greenCardLayer.begin();
      v.greenCardLayer.push(makeBatch(greenReplacementItems));
      v.greenCardLayer.end();
      v.group.add(v.greenCardLayer.mesh);
      v.own.push(v.greenCardLayer.mesh);
    }
    if (grassItems.length) {
      v.greenGrassLayer = new Layer(greenFarGeo, greenFarMat, grassItems.length, "veg_grass_tufts_3d");
      v.greenGrassLayer.begin();
      v.greenGrassLayer.push(makeBatch(grassItems));
      v.greenGrassLayer.end();
      v.group.add(v.greenGrassLayer.mesh);
      v.own.push(v.greenGrassLayer.mesh);
    }
    if (cherryReplacementItems.length) {
      v.cherryCardLayer = new Layer(bunchGeo, bunchMat, cherryReplacementItems.length, "veg_cherry_volumetric_cards");
      v.cherryCardLayer.begin();
      v.cherryCardLayer.push(makeBatch(cherryReplacementItems));
      v.cherryCardLayer.end();
      v.group.add(v.cherryCardLayer.mesh);
      v.own.push(v.cherryCardLayer.mesh);
    }
    v.hiddenInstanced.push(...greenCardItems.meshes.map((mesh) => ({ mesh, visible: mesh.visible })));
    v.hiddenInstanced.push(...cherryCardItems.meshes.map((mesh) => ({ mesh, visible: mesh.visible })));
    v.greenLayer = new Layer(greenGeo, greenMat, greenCrown.clusters.length, "veg_zelkova_leaf_clusters");
    v.greenFarLayer = new Layer(greenFarGeo, greenFarMat, greenCrown.clusters.length, "veg_zelkova_leaf_puffs");
    v.own.push(v.greenLayer.mesh, v.greenFarLayer.mesh);
    v.group.add(v.greenLayer.mesh, v.greenFarLayer.mesh);
    const greenFull = makeBatch(
      greenCrown.clusters.map((c: GreenCluster) => {
        tmpQ.setFromUnitVectors(UP, tmpP.set(c.nx, c.ny, c.nz));
        tmpQ2.setFromAxisAngle(UP, c.seed * Math.PI * 2);
        tmpQ.multiply(tmpQ2);
        const s = c.size / 0.5;
        return { m: new Matrix4().compose(new Vector3(c.x, c.y, c.z), tmpQ, new Vector3(s, s, s)), tint: [1, 1, 1], light: c.light };
      }),
    );
    const greenCfg = cfg.green;
    const greenThin = makeBatch(
      greenCrown.clusters.filter((c) => c.seed < greenCfg.thin).map((c: GreenCluster) => {
        tmpQ.setFromUnitVectors(UP, tmpP.set(c.nx, c.ny, c.nz));
        tmpQ2.setFromAxisAngle(UP, c.seed * Math.PI * 2);
        tmpQ.multiply(tmpQ2);
        const s = (c.size * greenCfg.thinScale) / 0.5;
        return { m: new Matrix4().compose(new Vector3(c.x, c.y, c.z), tmpQ, new Vector3(s, s, s)), tint: [1, 1, 1], light: c.light };
      }),
    );
    const greenFar = makeBatch(
      greenCrown.clusters.map((c: GreenCluster) => {
        const s = c.size * 1.1;
        return { m: new Matrix4().compose(new Vector3(c.x, c.y, c.z), new Quaternion(), new Vector3(s, s, s)), tint: [1, 1, 1], light: c.light };
      }),
    );
    v.green.push({ crown: greenCrown, full: greenFull, far: greenFar, thin: greenThin, level: -1, visible: false });
    const greenTwigGeo = twigMesh(
      greenCrown.twigs.map((branch) => ({
        branch,
        light: (_p: Vec3, n: Vec3) => 0.48 + 0.32 * Math.max(0, n[1]) + 0.12 * Math.max(0, n[0] * DAY_SUN_DIRECTION[0] + n[1] * DAY_SUN_DIRECTION[1] + n[2] * DAY_SUN_DIRECTION[2]),
      })),
      tier === "low",
    );
    const greenTwigObj = new Mesh(greenTwigGeo, twigMat);
    greenTwigObj.name = "veg_zelkova_twigs";
    greenTwigObj.matrixAutoUpdate = false;
    v.group.add(greenTwigObj);
    v.own.push(greenTwigGeo);
    v.greenTwigTris = (greenTwigGeo.index?.count ?? 0) / 3;
    if (REMOVE_PLAZA_ZELKOVA) {
      v.green.length = 0;
      v.greenLayer.mesh.visible = false;
      v.greenFarLayer.mesh.visible = false;
      greenTwigObj.visible = false;
      v.greenTwigTris = 0;
    }
    const streetGreenBranchGeo = greenStreetBranchGeometry(root, tier === "low");
    const streetGreenBranchObj = new Mesh(streetGreenBranchGeo, twigMat);
    streetGreenBranchObj.name = "veg_street_green_branches";
    streetGreenBranchObj.matrixAutoUpdate = false;
    v.group.add(streetGreenBranchObj);
    v.own.push(streetGreenBranchGeo);
    if (await step("greenMeshes")) return v.abandon();

    // ── last: hide the old cards, all at once, now that the new vegetation is ready ──
    let hiddenCherry = 0;
    let hiddenGreen = 0;
    if (hide) {
      floraMeshes.forEach((mesh, mi) => {
        const drop = [...placed.replaced, ...placed.kept].filter((c) => cardMesh.get(c) === mi);
        if (drop.length) v.hideCards(mesh, drop);
      });
      for (const mesh of meshesWithMaterial(root, CHERRY_MATERIAL)) {
        const g = mesh.geometry;
        const cards = readCards(worldPositions(mesh), g.index ? (g.index.array as ArrayLike<number>) : null, null, null);
        // the canopy cards round each plaza cherry (not the fallen petals lying flat on the soil)
        const drop = cards.filter((c) => c.h > 0.05 && crowns.some((cr) => Math.hypot(c.x - cr.skeleton.base[0], c.z - cr.skeleton.base[2]) < 4.6 && c.y > cr.skeleton.base[1] + 1));
        if (drop.length) {
          v.hideCards(mesh, drop);
          hiddenCherry += drop.length;
        }
      }
      for (const mesh of meshesWithMaterial(root, "M_leaf_green")) {
        const g = mesh.geometry;
        const cards = readCards(worldPositions(mesh), g.index ? (g.index.array as ArrayLike<number>) : null, null, null);
        const drop = cards.filter(
          (c) => c.h > 0.05 && Math.hypot(c.x - PLAZA_ZELKOVA.base[0], c.z - PLAZA_ZELKOVA.base[2]) < PLAZA_ZELKOVA.R + 1.0 && c.y > PLAZA_ZELKOVA.base[1] + 1.0,
        );
        if (drop.length) {
          v.hideCards(mesh, drop);
          hiddenGreen += drop.length;
        }
      }
      for (const { mesh } of v.hiddenInstanced) mesh.visible = false;
    }
    steps.hide = Math.round(performance.now() - t);
    work += performance.now() - t;
    Object.assign(v.statsData, {
      plants: placed.plants.length,
      bunches: total,
      twigs: twigs.length,
      hiddenCards: { flora: hide ? placed.replaced.length + placed.kept.length : 0, cherry: hiddenCherry, green: hiddenGreen },
      keptFlowerCards: hide ? 0 : placed.kept.length,
      genMs: Math.round(work),
    });
    return v;
  }

  /** A build that was cancelled: free what it made. */
  private abandon(): null {
    this.dispose();
    return null;
  }

  /** Give `mesh` (a mesh of the village clone) a copy of its geometry without the cards' triangles. */
  private hideCards(mesh: Mesh, drop: readonly Card[]): void {
    const src = mesh.geometry;
    const g = src.clone();
    const index = keepTriangles(src.index ? (src.index.array as ArrayLike<number>) : null, src.getAttribute("position").count, drop);
    g.setIndex(new BufferAttribute(index, 1));
    mesh.geometry = g;
    this.own.push(g);
    this.swapped.push({ mesh, original: src });
  }

  /** Per frame: the wind's clock, each cell's and tree's level and visibility, and a refill when they changed. */
  update(camera: Camera, seconds: number): void {
    vegTimeUniform.value = seconds;
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cx = camera.matrixWorld.elements[12]!;
    const cy = camera.matrixWorld.elements[13]!;
    const cz = camera.matrixWorld.elements[14]!;
    const fl = this.cfg.flowers;
    for (const c of this.flowerCells) {
      const b = c.cell.bounds;
      const level = chooseLod(c.level, sphereDistance(cx, cy, cz, b), fl);
      this.sphere.center.set(b.x, b.y, b.z);
      this.sphere.radius = b.r;
      const visible = level < fl.far.length && this.frustum.intersectsSphere(this.sphere);
      if (level !== c.level || visible !== c.visible) {
        c.level = level;
        c.visible = visible;
        this.dirtyFlowers = true;
      }
    }
    const ch = this.cfg.cherry;
    for (const t of this.cherry) {
      const b = t.crown.bounds;
      const level = chooseLod(t.level, sphereDistance(cx, cy, cz, b), ch);
      this.sphere.center.set(b.x, b.y, b.z);
      this.sphere.radius = b.r;
      const visible = level < ch.far.length && this.frustum.intersectsSphere(this.sphere);
      if (level !== t.level || visible !== t.visible) {
        t.level = level;
        t.visible = visible;
        this.dirtyCherry = true;
      }
    }
    const gr = this.cfg.green;
    for (const t of this.green) {
      const b = t.crown.bounds;
      const level = chooseLod(t.level, sphereDistance(cx, cy, cz, b), gr);
      this.sphere.center.set(b.x, b.y, b.z);
      this.sphere.radius = b.r;
      const visible = level < gr.far.length && this.frustum.intersectsSphere(this.sphere);
      if (level !== t.level || visible !== t.visible) {
        t.level = level;
        t.visible = visible;
        this.dirtyGreen = true;
      }
    }
    if (this.dirtyFlowers) this.refillFlowers();
    if (this.dirtyCherry) this.refillCherry();
    if (this.dirtyGreen) this.refillGreen();
  }

  private refillFlowers(): void {
    this.dirtyFlowers = false;
    const lv: [number, number, number] = [0, 0, 0];
    this.flowerLayers.forEach((layers, s) => {
      layers.lod0.begin();
      layers.lod1.begin();
      for (const c of this.flowerCells) {
        if (!c.visible) continue;
        const b = c.batches[s]!;
        if (c.level === 0) layers.lod0.push(b.full);
        else if (c.level === 1) layers.lod1.push(b.mid);
        else if (c.level === 2) layers.lod1.push(b.thin);
        if (c.level <= 2) lv[c.level] += [b.full.n, b.mid.n, b.thin.n][c.level]!;
      }
      layers.lod0.end();
      layers.lod1.end();
    });
    this.statsData.levels.flowers = lv;
    this.recount();
  }

  private refillCherry(): void {
    this.dirtyCherry = false;
    const bl = this.bunchLayer;
    const sl = this.spriteLayer;
    if (!bl || !sl) return;
    const lv: [number, number, number] = [0, 0, 0];
    bl.begin();
    sl.begin();
    for (const t of this.cherry) {
      if (!t.visible) continue;
      if (t.level === 0) {
        bl.push(t.full);
        lv[0] += t.full.n;
      } else if (t.level === 1) {
        sl.push(t.sprite);
        lv[1] += t.sprite.n;
      } else if (t.level === 2) {
        sl.push(t.thin);
        lv[2] += t.thin.n;
      }
    }
    bl.end();
    sl.end();
    this.statsData.levels.cherry = lv;
    this.recount();
  }

  private refillGreen(): void {
    this.dirtyGreen = false;
    const full = this.greenLayer;
    const far = this.greenFarLayer;
    if (!full || !far) return;
    const lv: [number, number, number] = [0, 0, 0];
    full.begin();
    far.begin();
    for (const t of this.green) {
      if (!t.visible) continue;
      if (t.level === 0) {
        full.push(t.full);
        lv[0] += t.full.n;
      } else if (t.level === 1) {
        far.push(t.far);
        lv[1] += t.far.n;
      } else if (t.level === 2) {
        far.push(t.thin);
        lv[2] += t.thin.n;
      }
    }
    full.end();
    far.end();
    this.statsData.levels.green = lv;
    this.recount();
  }

  private recount(): void {
    let tris = this.twigTris + this.greenTwigTris;
    let calls = 1;
    const layers = [...this.flowerLayers.flatMap((l) => [l.lod0, l.lod1]), this.bunchLayer, this.spriteLayer, this.cherryCardLayer, this.greenLayer, this.greenFarLayer, this.greenCardLayer, this.greenGrassLayer];
    for (const l of layers) {
      if (!l || l.n === 0) continue;
      tris += l.n * l.tris;
      calls++;
    }
    this.statsData.tris = Math.round(tris);
    this.statsData.calls = calls;
  }

  stats(): VegStats {
    return structuredClone(this.statsData);
  }

  dispose(): void {
    // the village clone gets its own geometry back (its old cards show again)
    for (const { mesh, visible } of this.hiddenInstanced) mesh.visible = visible;
    this.hiddenInstanced.length = 0;
    for (const { mesh, original } of this.swapped) mesh.geometry = original;
    this.swapped.length = 0;
    for (const r of this.own) r.dispose();
    this.own.length = 0;
  }
}

/** Build the vegetation for a dressed village clone (in steps), or null in the `old` mode or when cancelled. */
export function createVegetation(root: Object3D, tier: VillageTier, mode: VegMode, cancelled?: () => boolean): Promise<VillageVegetation | null> {
  if (mode === "old") return Promise.resolve(null);
  return VillageVegetation.build(root, tier, mode, cancelled);
}
