import {
  BufferAttribute,
  BufferGeometry,
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
  type Camera,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { isMesh, materialsOf } from "../../game/hub/hubModelPrep";
import { CLICK_PICK_KEY } from "../../game/clickPick";
import { BACKDROP_FOREST_PREFIX, CHERRY_MATERIAL, type VillageTier } from "../villageModelPrep";
import { cherryConnection, growCherry, type Bunch, type CherryCrown } from "./cherryTree";
import { distToPolyline, type Connection } from "./crownGrowth";
import { GREEN_GROW, YOUNG_GROW, growBroadleaf, growWillow, leafConnection, type Leaf, type LeafCrown } from "./treeCrown";
import {
  PLAZA_CHERRY_SPECS,
  PLAZA_ZELKOVA_SPEC,
  SHRUB_VARIANT,
  VARIANT_SPECS,
  VILLAGE_TREE_SPECS,
  WILLOW_SPECS,
  YOUNG_SPECS,
  treeSkeleton,
  type BakedCard,
  type Branch,
  type TreeSkeleton,
} from "./treeSkeleton";
import { bushSize, findBushes, type Bush } from "./shrubs";
import { placeFlowers, SPECIES_COUNT, type Plant } from "./flowerPlacement";
import { keepTriangles, readCards, type AttributeLike, type Card } from "./vegCards";
import { makeBlossomAtlas } from "./vegAtlas";
import { GeoBuilder, TWIG_BARK, blossomBunch, bunchSprite, bushGeometry, greenClusterFar, leafSpray, rgba, speciesMeshes, twigMesh, willowSpray } from "./vegGeometry";
import { chooseLod, groupIntoCells, sphereDistance, VEG_TIERS, type Cell, type LodBands, type Vec3, type VegTierConfig } from "./vegLod";
import { vegMaterial, vegTimeUniform } from "./vegMaterial";
import { DAY_SUN_DIRECTION } from "../dayNightBlend";
import type { VegMode } from "./vegMode";

/**
 * 케이슨 마을's 3D vegetation (veg3d): real 3D flowers in the beds, and every tree and bush a player can come near
 * grown in 3D out of the limbs the village file already has (the owner, 2026-11-10: "평면을 같다 붙여놓았잖아", and
 * later: "나뭇잎이 가지도 없는데 혼자 하늘에 떠 있잖아 ... 가지도 사실적으로 나뭇잎과 연결되도록 수정해").
 *
 *  - Flowers: the beds are read from the old flower cards themselves (vegCards.ts, flowerPlacement.ts); each bed
 *    gets petunias, pansies, grape hyacinths and tulips as instanced 3D plants (vegGeometry.ts), cut into 8 m cells
 *    with three distance levels (full plants, simple plants, simple plants thinned and enlarged), refilled only when
 *    a cell changes level or comes into view (vegLod.ts).
 *  - Trees: every tree's trunk, limbs and side branches are replayed exactly from the art script (treeSkeleton.ts) and
 *    stay as the file baked them. Twigs grow out of them (crownGrowth.ts) and the foliage hangs on the twigs: blossom
 *    bunches on the cherries, street cherries and orchard trees (cherryTree.ts), leaf sprays on the broadleaf trees
 *    (the village's greens, the street greens, the memorial's young trees) and narrow-leaf strands on the willows
 *    (treeCrown.ts). The instanced street and orchard trees are grown once at the origin and placed by the file's own
 *    instance matrices. Each tree has its own instanced meshes for the near and middle levels (three culls them by
 *    the crown's sphere), the far level is one shared layer per kind (the clusters thinned and enlarged), and its
 *    twigs are drawn within `twigFar`.
 *  - Bushes: every bush (the instanced ones and those merged into the leaf meshes, found from their cards: shrubs.ts)
 *    is a round 3D bush on the ground, three levels.
 *  - The old cards of all of these are hidden by a copy of their mesh's index without them (the file and the loader's
 *    geometry are not touched); the cherries' fallen petals stay. The plaza zelkova is taken out whole (the owner,
 *    2026-11-12: "아예 저 나무는 몸통을 만들지 말고 없애버려"): its bark and cards are hidden and its round deck gets a
 *    plank top where the trunk stood. The backdrop forest on the hills (outside the walk bounds) keeps its crossed
 *    cards.
 *  - `?veg=old` (DEV) keeps the old village as it was; `?veg=both` shows both.
 *  - The phone tier (low) never draws the full levels, has fewer and simpler plants and less wind.
 */

export { vegModeFrom, type VegMode } from "./vegMode";

const FLORA = "M_leaf_flora";
const GREEN = "M_leaf_green";

/** Tree classes as drawn: blossom bunches, broadleaf sprays, willow strands. */
type DrawClass = "blossom" | "leaf" | "willow";
/** Tree kinds as counted (stats). */
export type TreeKindStat = "plaza_cherry" | "village_cherry" | "street_cherry" | "orchard" | "village_green" | "street_green" | "young" | "willow";

export interface VegStats {
  mode: VegMode;
  tier: VillageTier;
  plants: number;
  bunches: number;
  twigs: number;
  /** Per kind: trees, foliage clusters (bunches or sprays) and twigs. */
  trees: Record<TreeKindStat, { trees: number; clusters: number; twigs: number }>;
  bushes: number;
  /** Every crown's connection: the largest cluster-to-branch gap (m), twigs ending bare, clusters on no branch. */
  connection: Connection;
  /** Foliage clusters drawn within 0.6 m (across) and 1.2 m (up) of an instanced tree's foot: the old blobs (0). */
  originBlobs: number;
  hiddenCards: { flora: number; cherry: number; green: number };
  /** Instanced leaf meshes hidden whole, and those cut down to their fallen petals. */
  hiddenInstanced: string[];
  petalInstanced: string[];
  /** The zelkova's bark triangles taken out. */
  zelkovaBarkTris: number;
  keptFlowerCards: number;
  /** Instances drawn this frame per level: flowers [full, simple, thinned], trees per class [near, mid, far]. */
  levels: { flowers: [number, number, number]; cherry: [number, number, number]; green: [number, number, number]; willow: [number, number, number]; bush: [number, number, number] };
  /** Triangles and draw calls the vegetation draws this frame (in view). */
  tris: number;
  calls: number;
  /** Twig meshes drawn this frame and their vertex total (memory). */
  twigMeshes: number;
  twigVertices: number;
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

const cardsOf = (mesh: Mesh): Card[] => {
  const g = mesh.geometry;
  return readCards(worldPositions(mesh), g.index ? (g.index.array as ArrayLike<number>) : null, null, null);
};

/**
 * Hide the old flat foliage at once, before the 3D vegetation is ready (no flash of the old cards on arrival). The
 * backdrop forest on the hills keeps its cards (outside the walk bounds; never seen up close).
 */
export function hideLegacyVegetationSources(root: Object3D): () => void {
  const hidden: Array<{ object: Object3D; visible: boolean }> = [];
  const names = new Set([FLORA, CHERRY_MATERIAL, GREEN]);
  root.traverse((object) => {
    if (!isMesh(object) || object.name.startsWith(BACKDROP_FOREST_PREFIX) || !materialsOf(object).some((material) => names.has(material.name))) return;
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
    this.mesh.frustumCulled = false; // culled per cell here, or always drawn (the far tree layers)
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    this.tris = (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
  }

  begin(): void {
    this.n = 0;
  }

  push(b: Batch, count = b.n): void {
    if (count === 0) return;
    (this.mesh.instanceMatrix.array as Float32Array).set(b.matrices.subarray(0, count * 16), this.n * 16);
    (this.mesh.instanceColor!.array as Float32Array).set(b.tints.subarray(0, count * 3), this.n * 3);
    (this.light.array as Float32Array).set(b.lights.subarray(0, count), this.n);
    this.n += count;
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
const tmpP = new Vector3();
const tmpS = new Vector3();
const tmpX = new Vector3();
const tmpY = new Vector3();
const tmpZ = new Vector3();
const UP = new Vector3(0, 1, 0);

const tmpE = new Euler();

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

/** The bunch sprite is this much bigger than the bunch's measured size (its picture has a ragged edge). */
const SPRITE_K = 1.3;
/** The close-up bunch mesh is ~0.24 m across at scale 1. */
const BUNCH_MESH_SIZE = 0.24;

/** One tree as drawn: its clusters (sorted by seed: the far level's thinned set is a prefix) and its meshes. */
interface TreeDraw {
  name: string;
  cls: DrawClass;
  kind: TreeKindStat;
  sphere: Sphere;
  n: number;
  matrix: InstancedBufferAttribute;
  light: InstancedBufferAttribute;
  tint: InstancedBufferAttribute;
  /** The far level: the first `far.n` clusters, enlarged. */
  far: Batch;
  meshes: [InstancedMesh | null, InstancedMesh | null];
  twig: Mesh | null;
  level: number;
  /** In view this frame (stats only). */
  seen: boolean;
}

interface ClassDraw {
  geos: [BufferGeometry, BufferGeometry];
  mats: [Material, Material];
  tris: [number, number];
  far: Layer;
  bands: LodBands & { thin: number; thinScale: number };
  dirty: boolean;
}

interface BushDraw {
  bush: Bush;
  sphere: Sphere;
  batch: Batch;
  level: number;
}

/** Hand the main thread back between the build's steps (a frame can be drawn, input handled). */
const yieldToMain = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Which old cards the replayed trees drew: the cards whose centre is within `tol` of one of `refs`. */
function claimCards(cards: readonly Card[], refs: readonly BakedCard[], tol = 0.03): Set<Card> {
  const cell = 1;
  const grid = new Map<string, Vec3[]>();
  for (const r of refs) {
    const k = `${Math.floor(r.c[0] / cell)},${Math.floor(r.c[1] / cell)},${Math.floor(r.c[2] / cell)}`;
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(r.c);
  }
  const out = new Set<Card>();
  for (const c of cards) {
    const i0 = Math.floor(c.x / cell);
    const j0 = Math.floor(c.y / cell);
    const k0 = Math.floor(c.z / cell);
    search: for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++)
          for (const p of grid.get(`${i0 + i},${j0 + j},${k0 + k}`) ?? []) {
            if (Math.hypot(p[0] - c.x, p[1] - c.y, p[2] - c.z) <= tol) {
              out.add(c);
              break search;
            }
          }
  }
  return out;
}

/** The world matrices of an instanced mesh's instances. */
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

function findInstanced(root: Object3D, name: string): InstancedMesh | null {
  let found: InstancedMesh | null = null;
  root.traverse((o) => {
    if (!found && (o as InstancedMesh).isInstancedMesh && o.name === name) found = o as InstancedMesh;
  });
  return found;
}

/** A crown's sphere moved by an instance matrix (null: as it is), padded for the wind. */
function sphereOf(b: { x: number; y: number; z: number; r: number }, xf: Matrix4 | null, pad = 0.3): Sphere {
  const s = new Sphere(new Vector3(b.x, b.y, b.z), b.r + pad);
  if (xf) s.applyMatrix4(xf);
  return s;
}

/** Light along a twig: darker inside the crown and underneath, a little brighter toward the sun. */
function twigLight(c: Vec3, R: number, base = 0.35, span = 0.45) {
  const sun = DAY_SUN_DIRECTION;
  return (p: Vec3, n: Vec3) => {
    const rho = Math.min(1, Math.hypot(p[0] - c[0], (p[1] - c[1]) * 1.4, p[2] - c[2]) / R);
    return (base + span * rho) * (0.85 + 0.15 * Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]));
  };
}

/** The ten bushes' tints: a little hue variety (the leaves are tinted, the heart too). */
const tintOf = (seed: number): number[] => {
  const f = (k: number) => (Math.sin(seed * 9301 + k * 49297) * 0.5 + 0.5) % 1;
  return [0.92 + 0.12 * f(1), 0.95 + 0.08 * f(2), 0.88 + 0.12 * f(3)];
};

export class VillageVegetation {
  readonly group = new Group();
  private readonly own: Array<{ dispose(): void }> = [];
  private readonly cfg: VegTierConfig;
  private readonly flowerLayers: Array<{ lod0: Layer; lod1: Layer }> = [];
  private readonly flowerCells: FlowerCell[] = [];
  private readonly trees: TreeDraw[] = [];
  private readonly classes = new Map<DrawClass, ClassDraw>();
  private readonly bushes: BushDraw[] = [];
  private bushLayers: [Layer, Layer, Layer] | null = null;
  private bushDirty = true;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly statsData: VegStats;
  private dirtyFlowers = true;
  /** Meshes of the village clone whose geometry was swapped for a copy without the old cards, and what they had. */
  private readonly swapped: Array<{ mesh: Mesh; original: BufferGeometry }> = [];
  private readonly hiddenInstanced: Array<{ mesh: InstancedMesh; visible: boolean }> = [];
  private readonly reshown: Array<{ mesh: Mesh; visible: boolean }> = [];
  private readonly twigFar: number;

  private constructor(tier: VillageTier, mode: Exclude<VegMode, "old">) {
    this.cfg = VEG_TIERS[tier];
    this.twigFar = tier === "low" ? 24 : 45;
    this.group.name = "village_vegetation";
    this.group.matrixAutoUpdate = false;
    const zero = () => ({ trees: 0, clusters: 0, twigs: 0 });
    this.statsData = {
      mode,
      tier,
      plants: 0,
      bunches: 0,
      twigs: 0,
      trees: { plaza_cherry: zero(), village_cherry: zero(), street_cherry: zero(), orchard: zero(), village_green: zero(), street_green: zero(), young: zero(), willow: zero() },
      bushes: 0,
      connection: { clusters: 0, twigs: 0, maxGap: 0, unattached: 0, bareTips: 0 },
      originBlobs: 0,
      hiddenCards: { flora: 0, cherry: 0, green: 0 },
      hiddenInstanced: [],
      petalInstanced: [],
      zelkovaBarkTris: 0,
      keptFlowerCards: 0,
      levels: { flowers: [0, 0, 0], cherry: [0, 0, 0], green: [0, 0, 0], willow: [0, 0, 0], bush: [0, 0, 0] },
      tris: 0,
      calls: 0,
      twigMeshes: 0,
      twigVertices: 0,
      genMs: 0,
      steps: {},
    };
  }

  /**
   * Build the vegetation for a dressed village clone in steps (the main thread is handed back between them, so the
   * arrival is never frozen for the whole build). The old cards are hidden at the end, at once (VillageModel hides the
   * old foliage meshes on arrival already). `cancelled()` true: stop and free what was made (resolves null).
   */
  static async build(root: Object3D, tier: VillageTier, mode: Exclude<VegMode, "old">, cancelled: () => boolean = () => false): Promise<VillageVegetation | null> {
    const v = new VillageVegetation(tier, mode);
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
    const low = tier === "low";
    const stats = v.statsData;

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
    const greenFarGeo = greenClusterFar();
    const greenFarMat = vegMaterial({ name: "M_veg_green_far", wind: 0.008, windFar: 30, ambient: 0.54, sky: 0.16, sun: 0.34, back: 0.35 });
    v.own.push(greenFarGeo, greenFarMat);
    const grassItems = placed.kept.map((c) => ({
      m: new Matrix4().compose(new Vector3(c.x, c.floor, c.z), new Quaternion().setFromAxisAngle(UP, c.x * 0.7 + c.z * 0.37), new Vector3(0.65, 0.65, 0.65)),
      tint: [0.88, 1, 0.82],
      light: c.light,
    }));
    if (grassItems.length) {
      const grass = new Layer(greenFarGeo, greenFarMat, grassItems.length, "veg_grass_tufts_3d");
      grass.begin();
      grass.push(makeBatch(grassItems));
      grass.end();
      v.group.add(grass.mesh);
      v.own.push(grass.mesh);
    }
    if (await step("flowerMeshes")) return v.abandon();

    // ── the trees' skeletons, replayed from the art script (the very limbs and cards of the file) ──
    const zelkova = treeSkeleton(PLAZA_ZELKOVA_SPEC);
    const plaza = PLAZA_CHERRY_SPECS.map(treeSkeleton);
    const village = VILLAGE_TREE_SPECS.map(treeSkeleton);
    const willows = WILLOW_SPECS.map(treeSkeleton);
    const young = YOUNG_SPECS.map(treeSkeleton);
    const variant = {
      street_green: treeSkeleton(VARIANT_SPECS.street_green),
      street_cherry: treeSkeleton(VARIANT_SPECS.street_cherry),
      orchard: treeSkeleton(VARIANT_SPECS.orchard),
    };
    const inst = {
      street_green: findInstanced(root, "inst__street_green_1"),
      street_cherry: findInstanced(root, "inst__street_cherry_1"),
      orchard: findInstanced(root, "inst__orchard_1"),
      shrub: findInstanced(root, "inst__shrub_0"),
    };
    const xfs = {
      street_green: inst.street_green ? instanceMatrices(inst.street_green) : [],
      street_cherry: inst.street_cherry ? instanceMatrices(inst.street_cherry) : [],
      orchard: inst.orchard ? instanceMatrices(inst.orchard) : [],
      shrub: inst.shrub ? instanceMatrices(inst.shrub) : [],
    };
    if (await step("skeletons")) return v.abandon();

    // ── grow the crowns, one tree per step ──
    // each crown's connection is measured as it is grown (the e2e and the dev hook read it)
    const blossoms: Array<{ crown: CherryCrown; kind: TreeKindStat; xfs: Matrix4[] | null }> = [];
    const leafy: Array<{ crown: LeafCrown; kind: TreeKindStat; xfs: Matrix4[] | null }> = [];
    const conn: Connection = { clusters: 0, twigs: 0, maxGap: 0, unattached: 0, bareTips: 0 };
    const addConn = (c: Connection) => {
      conn.clusters += c.clusters;
      conn.twigs += c.twigs;
      conn.maxGap = Math.max(conn.maxGap, c.maxGap);
      conn.unattached += c.unattached;
      conn.bareTips += c.bareTips;
    };
    const blossom = (crown: CherryCrown, kind: TreeKindStat, list: Matrix4[] | null) => {
      blossoms.push({ crown, kind, xfs: list });
      addConn(cherryConnection(crown));
    };
    const leafyCrown = (crown: LeafCrown, kind: TreeKindStat, list: Matrix4[] | null) => {
      leafy.push({ crown, kind, xfs: list });
      addConn(leafConnection(crown));
    };
    for (const sk of plaza) {
      blossom(growCherry(sk), "plaza_cherry", null);
      if (await step(`cherry${sk.index}`)) return v.abandon();
    }
    for (const sk of village) {
      if (sk.kind === "cherry") blossom(growCherry(sk), "village_cherry", null);
      else leafyCrown(growBroadleaf(sk, GREEN_GROW, "green"), "village_green", null);
      if (await step(`${sk.kind}${sk.index}`)) return v.abandon();
    }
    blossom(growCherry(variant.street_cherry, { attractors: 400, bunchStep: 0.08 }), "street_cherry", xfs.street_cherry);
    if (await step("street_cherry")) return v.abandon();
    blossom(growCherry(variant.orchard, { attractors: 170, bunchStep: 0.08 }), "orchard", xfs.orchard);
    if (await step("orchard")) return v.abandon();
    leafyCrown(growBroadleaf(variant.street_green, GREEN_GROW, "green"), "street_green", xfs.street_green);
    if (await step("street_green")) return v.abandon();
    for (let i = 0; i < young.length; i++) {
      leafyCrown(growBroadleaf(young[i]!, YOUNG_GROW, "young"), "young", null);
      if (i % 5 === 4 && (await step(`young${i}`))) return v.abandon();
    }
    for (const sk of willows) {
      leafyCrown(growWillow(sk), "willow", null);
      if (await step(`willow${sk.index}`)) return v.abandon();
    }
    stats.connection = conn;

    // ── materials and the clusters' meshes ──
    const atlas: Texture | null = makeBlossomAtlas();
    if (atlas) v.own.push(atlas);
    const bunchMat = vegMaterial({ name: "M_veg_blossom", map: atlas, alphaTest: 0.5, cherry: true, wind: 0.012, windFar: 25, ambient: 0.62, sky: 0.12, sun: 0.38, back: 0.6 });
    const spriteMat = vegMaterial({ name: "M_veg_blossom_far", map: atlas, alphaTest: 0.5, cherry: true, sprite: true, wind: 0.01, windFar: 25, ambient: 1, sky: 0, sun: 0, back: 0 });
    const twigMat = vegMaterial({ name: "M_veg_twigs", wind: 0, windFar: 1, ambient: 0.55, sky: 0.2, sun: 0.45, back: 0.2 });
    const leafMat = vegMaterial({ name: "M_veg_leaves", wind: 0.024, windFar: cfg.windFar ? 30 : 12, ambient: 0.44, sky: 0.2, sun: 0.42, back: 0.42 });
    const leafFarMat = vegMaterial({ name: "M_veg_leaves_far", wind: 0.01, windFar: 40, ambient: 0.54, sky: 0.18, sun: 0.38, back: 0.4 });
    const willowMat = vegMaterial({ name: "M_veg_willow", wind: 0.03, windFar: cfg.windFar ? 30 : 12, ambient: 0.54, sky: 0.2, sun: 0.4, back: 0.5 });
    const bushMat = vegMaterial({ name: "M_veg_bush", wind: 0.01, windFar: 20, ambient: 0.5, sky: 0.22, sun: 0.4, back: 0.35 });
    v.own.push(bunchMat, spriteMat, twigMat, leafMat, leafFarMat, willowMat, bushMat);
    const bunchGeo = blossomBunch();
    // the sprite takes the bunch's own matrix (scale size / 0.24): its quad is the bunch's size x SPRITE_K at scale 1
    const spriteGeo = bunchSprite(BUNCH_MESH_SIZE * SPRITE_K);
    const spriteFarGeo = bunchSprite(BUNCH_MESH_SIZE * SPRITE_K);
    const sprayGeos = [leafSpray(0), leafSpray(1), leafSpray(2)] as const;
    const willowGeos = [willowSpray(0), willowSpray(1), willowSpray(2)] as const;
    v.own.push(bunchGeo, spriteGeo, spriteFarGeo, ...sprayGeos, ...willowGeos);
    const ch = cfg.cherry;
    const gr = cfg.green;
    const triCount = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;
    // a class's far layer holds every tree's thinned clusters at most (made once its trees are in)
    const mkClass = (cls: DrawClass, geos: [BufferGeometry, BufferGeometry], mats: [Material, Material], farGeo: BufferGeometry, farMat: Material, bands: ClassDraw["bands"]) => {
      const cap = v.trees.filter((t) => t.cls === cls).reduce((a, t) => a + t.far.n, 0);
      const far = new Layer(farGeo, farMat, cap, `veg_${cls}_far`);
      far.mesh.userData[CLICK_PICK_KEY] = "ignore";
      v.group.add(far.mesh);
      v.own.push(far.mesh);
      v.classes.set(cls, { geos, mats, tris: [triCount(geos[0]), triCount(geos[1])], far, bands, dirty: true });
    };

    // per tree (or per instance): matrices sorted by seed
    const bunchTint = (b: Bunch) => {
      const k = 0.9 + 0.1 * b.depth;
      const pink = 0.06 * b.seed;
      return [k, k * (0.97 - pink), k * (0.98 - pink * 0.6)];
    };
    const bunchMatrix = (b: Bunch, out: Matrix4) => {
      tmpQ.setFromUnitVectors(UP, tmpP.set(b.nx, b.ny, b.nz));
      tmpQ2.setFromAxisAngle(UP, b.seed * Math.PI * 2);
      tmpQ.multiply(tmpQ2);
      const s = b.size / BUNCH_MESH_SIZE;
      return out.compose(tmpP.set(b.x, b.y, b.z), tmpQ, tmpS.set(s, s, s));
    };
    const leafMatrix = (l: Leaf, out: Matrix4) => {
      tmpY.set(l.ax, l.ay, l.az);
      tmpZ.set(l.fx, l.fy, l.fz);
      tmpX.crossVectors(tmpY, tmpZ).normalize();
      tmpZ.crossVectors(tmpX, tmpY).normalize();
      const s = l.size;
      out.makeBasis(tmpX.multiplyScalar(s), tmpY.multiplyScalar(s), tmpZ.multiplyScalar(s));
      return out.setPosition(l.x, l.y, l.z);
    };
    let blobs = 0;
    const addTree = <T extends { seed: number; light: number }>(
      name: string,
      cls: DrawClass,
      kind: TreeKindStat,
      items: readonly T[],
      matrixOf: (it: T, out: Matrix4) => Matrix4,
      tintOfItem: (it: T) => number[],
      bounds: { x: number; y: number; z: number; r: number },
      xf: Matrix4 | null,
      bands: { thin: number; thinScale: number },
    ) => {
      const order = items.map((_, i) => i).sort((a, b) => items[a]!.seed - items[b]!.seed);
      const n = order.length;
      const matrices = new Float32Array(n * 16);
      const lights = new Float32Array(n);
      const tints = new Float32Array(n * 3);
      const m = new Matrix4();
      let farN = 0;
      order.forEach((idx, i) => {
        const it = items[idx]!;
        matrixOf(it, m);
        if (xf) m.premultiply(xf);
        m.toArray(matrices, i * 16);
        lights[i] = it.light;
        const tn = tintOfItem(it);
        tints[i * 3] = tn[0]!;
        tints[i * 3 + 1] = tn[1]!;
        tints[i * 3 + 2] = tn[2]!;
        if (it.seed < bands.thin) farN = i + 1;
        if (xf) {
          // the old blobs stood at each instance's foot: no foliage there now
          const dx = m.elements[12]! - xf.elements[12]!;
          const dz = m.elements[14]! - xf.elements[14]!;
          if (Math.hypot(dx, dz) < 0.6 && m.elements[13]! - xf.elements[13]! < 1.2) blobs++;
        }
      });
      const far: Batch = { n: farN, matrices: matrices.slice(0, farN * 16), lights: lights.slice(0, farN), tints: tints.slice(0, farN * 3) };
      for (let i = 0; i < farN; i++) for (const e of [0, 1, 2, 4, 5, 6, 8, 9, 10]) far.matrices[i * 16 + e]! *= bands.thinScale;
      const draw: TreeDraw = {
        name,
        cls,
        kind,
        sphere: sphereOf(bounds, xf),
        n,
        matrix: new InstancedBufferAttribute(matrices, 16),
        light: new InstancedBufferAttribute(lights, 1),
        tint: new InstancedBufferAttribute(tints, 3),
        far,
        meshes: [null, null],
        twig: null,
        level: -1,
        seen: false,
      };
      v.trees.push(draw);
      stats.trees[kind].trees++;
      stats.trees[kind].clusters += n;
      return draw;
    };
    const twigObject = (geo: BufferGeometry, xf: Matrix4 | null, name: string): Mesh => {
      const m = new Mesh(geo, twigMat);
      m.name = name;
      m.matrixAutoUpdate = false;
      if (xf) m.matrix.copy(xf);
      m.visible = false;
      m.userData[CLICK_PICK_KEY] = "ignore";
      v.group.add(m);
      return m;
    };
    const twigGeo = (twigs: readonly Branch[], c: Vec3, R: number, colours: readonly [string, string]) => {
      const geo = twigMesh(
        twigs.map((branch) => ({ branch, light: twigLight(c, R) })),
        low,
        colours,
      );
      v.own.push(geo);
      stats.twigVertices += geo.getAttribute("position").count;
      return geo;
    };

    for (const b of blossoms) {
      const crown = b.crown;
      const geo = twigGeo(crown.twigs, crown.skeleton.crownC, crown.skeleton.R, TWIG_BARK.cherry);
      stats.trees[b.kind].twigs += crown.twigs.length * (b.xfs ? b.xfs.length : 1);
      const list = b.xfs ?? [null];
      for (let i = 0; i < list.length; i++) {
        const xf = list[i]!;
        const d = addTree(`${b.kind}_${crown.skeleton.index}_${i}`, "blossom", b.kind, crown.bunches, bunchMatrix, bunchTint, crown.bounds, xf, ch);
        d.twig = twigObject(geo, xf, `veg_twigs_${d.name}`);
        if (i % 12 === 11 && (await step(`blossomDraw${crown.skeleton.index}_${i}`))) return v.abandon();
      }
      if (await step(`blossomDraw${crown.skeleton.index}`)) return v.abandon();
    }
    mkClass("blossom", [bunchGeo, spriteGeo], [bunchMat, spriteMat], spriteFarGeo, spriteMat, ch);
    const leafTint = (l: Leaf) => tintOf(l.seed);
    for (const l of leafy) {
      const crown = l.crown;
      const cls: DrawClass = crown.kind === "willow" ? "willow" : "leaf";
      const geo = twigGeo(crown.twigs, crown.env.c, crown.env.rx, crown.kind === "willow" ? TWIG_BARK.willow : TWIG_BARK.green);
      stats.trees[l.kind].twigs += crown.twigs.length * (l.xfs ? l.xfs.length : 1);
      const list = l.xfs ?? [null];
      for (let i = 0; i < list.length; i++) {
        const xf = list[i]!;
        const d = addTree(`${l.kind}_${crown.skeleton.index}_${i}`, cls, l.kind, crown.leaves, leafMatrix, leafTint, crown.bounds, xf, gr);
        d.twig = twigObject(geo, xf, `veg_twigs_${d.name}`);
        if (i % 8 === 7 && (await step(`leafDraw${crown.skeleton.index}_${i}`))) return v.abandon();
      }
      if (await step(`leafDraw${crown.skeleton.index}`)) return v.abandon();
    }
    mkClass("leaf", [sprayGeos[0], sprayGeos[1]], [leafMat, leafMat], sprayGeos[2], leafFarMat, gr);
    mkClass("willow", [willowGeos[0], willowGeos[1]], [willowMat, willowMat], willowGeos[2], leafFarMat, gr);
    stats.originBlobs = blobs;

    // ── the cards: which the replayed trees drew, and the bushes in what is left ──
    const greenMeshes = meshesWithMaterial(root, GREEN);
    const greenCards = greenMeshes.map(cardsOf);
    const greenRefs = [...village.filter((s) => s.kind === "green"), ...willows, ...young, zelkova].flatMap((s) => s.cards);
    const claimedGreen = greenCards.map((cards) => claimCards(cards, greenRefs));
    const rest: Array<{ card: Card; mesh: number }> = [];
    greenCards.forEach((cards, mi) => cards.forEach((c) => !claimedGreen[mi]!.has(c) && rest.push({ card: c, mesh: mi })));
    const found = findBushes(rest.map(({ card }) => ({ x: card.x, y: card.y, z: card.z, s: Math.hypot(card.bx - card.ax, card.bz - card.az) })));
    for (const b of found) for (const i of b.cards) claimedGreen[rest[i]!.mesh]!.add(rest[i]!.card);
    const variantBush = bushSize(SHRUB_VARIANT.H, SHRUB_VARIANT.R);
    const bushes: Bush[] = [
      ...found,
      ...xfs.shrub.map((m) => {
        const s = new Vector3().setFromMatrixScale(m).x;
        return { x: m.elements[12]!, y: m.elements[13]!, z: m.elements[14]!, h: variantBush.h * s, r: variantBush.r * s, seed: (Math.abs(Math.sin(m.elements[12]! * 3.1 + m.elements[14]! * 1.7)) * 1e4) % 1, cards: [] };
      }),
    ];
    const bushGeos = [bushGeometry(0), bushGeometry(1), bushGeometry(2)] as const;
    v.own.push(...bushGeos);
    v.bushLayers = [0, 1, 2].map((k) => {
      const layer = new Layer(bushGeos[k]!, bushMat, bushes.length, `veg_bushes_${k}`);
      layer.mesh.userData[CLICK_PICK_KEY] = "ignore";
      v.group.add(layer.mesh);
      v.own.push(layer.mesh);
      return layer;
    }) as [Layer, Layer, Layer];
    for (const b of bushes) {
      const m = new Matrix4().compose(new Vector3(b.x, b.y, b.z), new Quaternion().setFromAxisAngle(UP, b.seed * Math.PI * 2), new Vector3(b.r, b.h, b.r));
      v.bushes.push({ bush: b, sphere: new Sphere(new Vector3(b.x, b.y + b.h * 0.5, b.z), Math.max(b.r, b.h) * 1.25), batch: makeBatch([{ m, tint: tintOf(b.seed), light: 0.9 }]), level: -1 });
    }
    stats.bushes = bushes.length;
    if (await step("bushes")) return v.abandon();

    // ── last: hide the old cards, all at once, now that the new vegetation is ready ──
    if (hide) {
      floraMeshes.forEach((mesh, mi) => {
        const drop = [...placed.replaced, ...placed.kept].filter((c) => cardMesh.get(c) === mi);
        if (drop.length) v.hideCards(mesh, drop);
      });
      greenMeshes.forEach((mesh, mi) => {
        const drop = [...claimedGreen[mi]!];
        if (drop.length) v.hideCards(mesh, drop);
        stats.hiddenCards.green += drop.length;
      });
      // the canopy cards, and the plaza cherries' petal cards (drawn at their planters' soil height, 0.38 m: beyond
      // the planter's rim they would float over the paving)
      const cherryRefs = [...plaza, ...village.filter((s) => s.kind === "cherry")].flatMap((s) => s.cards).concat(plaza.flatMap((s) => s.petals));
      for (const mesh of meshesWithMaterial(root, CHERRY_MATERIAL)) {
        const drop = [...claimCards(cardsOf(mesh), cherryRefs)];
        if (drop.length) v.hideCards(mesh, drop);
        stats.hiddenCards.cherry += drop.length;
        // the fallen petals on the ground stay
        if ((mesh.geometry.index?.count ?? 0) > 0) v.show(mesh);
      }
      // the instanced trees: the street greens' and the bushes' cards go; the cherries and orchards keep their petals
      for (const mesh of [inst.street_green, inst.shrub]) {
        if (!mesh) continue;
        v.hiddenInstanced.push({ mesh, visible: mesh.visible });
        mesh.visible = false;
        stats.hiddenInstanced.push(mesh.name);
      }
      for (const mesh of [inst.street_cherry, inst.orchard]) {
        if (!mesh) continue;
        const g = mesh.geometry;
        const canopy = readCards(g.getAttribute("position") as BufferAttribute, g.index ? (g.index.array as ArrayLike<number>) : null, null, null).filter((c) => c.h > 0.05);
        v.hideCards(mesh, canopy);
        v.show(mesh);
        stats.petalInstanced.push(mesh.name);
        stats.hiddenCards.cherry += canopy.length;
      }
      stats.zelkovaBarkTris = v.removeZelkova(root, zelkova);
    }
    stats.plants = placed.plants.length;
    stats.bunches = blossoms.reduce((a, b) => a + b.crown.bunches.length * (b.xfs ? b.xfs.length : 1), 0);
    stats.twigs = Object.values(stats.trees).reduce((a, k) => a + k.twigs, 0);
    stats.hiddenCards.flora = hide ? placed.replaced.length + placed.kept.length : 0;
    stats.keptFlowerCards = hide ? 0 : placed.kept.length;
    steps.hide = Math.round(performance.now() - t);
    work += performance.now() - t;
    stats.genMs = Math.round(work);
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

  /** Show a mesh the arrival hid (VillageModel's hideLegacyVegetationSources), its old cards now cut out. */
  private show(mesh: Mesh): void {
    this.reshown.push({ mesh, visible: mesh.visible });
    mesh.visible = true;
  }

  /**
   * Take the plaza zelkova out: its bark triangles (the trunk, the seven limbs and their side branches: whatever lies
   * within its tubes' radius of the replayed skeleton) from the light-mapped bark, and a plank top on its round deck
   * where the trunk went through. Returns the triangles taken out.
   */
  private removeZelkova(root: Object3D, sk: TreeSkeleton): number {
    const parts: Array<{ b: Branch; r: number }> = [sk.trunk, ...sk.limbs, ...sk.sides].map((b) => ({ b, r: Math.max(...b.radii) + 0.08 }));
    let removed = 0;
    for (const mesh of meshesWithMaterial(root, "LM_bark")) {
      const pos = worldPositions(mesh);
      const src = mesh.geometry;
      const index = src.index ? (src.index.array as ArrayLike<number>) : null;
      const triCount = index ? index.length / 3 : pos.count / 3;
      const keep: number[] = [];
      for (let t = 0; t < triCount; t++) {
        const a = index ? index[t * 3]! : t * 3;
        const b = index ? index[t * 3 + 1]! : t * 3 + 1;
        const c = index ? index[t * 3 + 2]! : t * 3 + 2;
        const p: Vec3 = [(pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3];
        const near = Math.hypot(p[0] - sk.base[0], p[2] - sk.base[2]) < sk.R * 2 && parts.some(({ b: br, r }) => distToPolyline(p, br) <= r);
        if (near) removed++;
        else keep.push(a, b, c);
      }
      if (keep.length === triCount * 3) continue;
      const g = src.clone();
      g.setIndex(new BufferAttribute(new Uint32Array(keep), 1));
      mesh.geometry = g;
      this.own.push(g);
      this.swapped.push({ mesh, original: src });
    }
    if (removed) this.deckTop(sk.base);
    return removed;
  }

  /** The round deck's middle, where the zelkova's trunk went through: a plank top level with the deck. */
  private deckTop(base: Vec3): void {
    const b = new GeoBuilder();
    const segs = 24;
    const r = 1.04;
    const y = 0.462;
    const centre = b.v([0, y, 0], [0, 1, 0], rgba("#673808"), [0.5, 0.5], 0, 0.86);
    const ring: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      // plank bands: a little lighter and darker by turns, as the deck's boards
      const k = Math.floor(((Math.cos(a) * r + r) / (2 * r)) * 7) % 2 ? 0.94 : 1.04;
      ring.push(b.v([Math.cos(a) * r, y, Math.sin(a) * r], [0, 1, 0], rgba("#6B3A09", 0, k), [0.5, 0.5], 0, 0.86));
    }
    for (let i = 0; i < segs; i++) b.tri(centre, ring[(i + 1) % segs]!, ring[i]!);
    const geo = b.build();
    const mat = vegMaterial({ name: "M_veg_deck_top", wind: 0, windFar: 1, ambient: 0.62, sky: 0.12, sun: 0.4, back: 0 });
    const mesh = new Mesh(geo, mat);
    mesh.name = "zelkova_deck_top";
    mesh.position.set(base[0], 0, base[2]);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.own.push(geo, mat);
  }

  /** A tree's instanced mesh for level 0 or 1, made the first time it is needed. */
  private treeMesh(t: TreeDraw, level: 0 | 1): InstancedMesh {
    const have = t.meshes[level];
    if (have) return have;
    const c = this.classes.get(t.cls)!;
    const base = c.geos[level];
    const g = new BufferGeometry();
    for (const [name, attr] of Object.entries(base.attributes)) if (name !== "aLight") g.setAttribute(name, attr);
    g.setIndex(base.index);
    g.setAttribute("aLight", t.light);
    const mesh = new InstancedMesh(g, c.mats[level], 0);
    mesh.instanceMatrix = t.matrix;
    mesh.instanceColor = t.tint;
    mesh.count = t.n;
    mesh.boundingSphere = t.sphere.clone();
    mesh.name = `veg_${t.name}_${level ? "mid" : "near"}`;
    mesh.matrixAutoUpdate = false;
    mesh.userData[CLICK_PICK_KEY] = "ignore";
    this.group.add(mesh);
    // the per-tree geometry shares the base's buffers (freed with the base at the end)
    this.own.push(g, { dispose: () => mesh.dispose() });
    t.meshes[level] = mesh;
    return mesh;
  }

  /** Per frame: the wind's clock, each cell's, tree's and bush's level, and a refill when they changed. */
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
    if (this.dirtyFlowers) this.refillFlowers();
    let changed = false;
    for (const t of this.trees) {
      const c = this.classes.get(t.cls)!;
      const s = t.sphere;
      const d = Math.max(0, Math.hypot(cx - s.center.x, cy - s.center.y, cz - s.center.z) - s.radius);
      const level = chooseLod(t.level, d, c.bands);
      if (level !== t.level) {
        const old = t.level;
        t.level = level;
        if (old === 0 || old === 1) t.meshes[old]!.visible = false;
        if (level === 0 || level === 1) this.treeMesh(t, level).visible = true;
        if (old === 2 || level === 2) c.dirty = true;
        changed = true;
      }
      const twigOn = level <= 1 && d <= this.twigFar;
      if (t.twig && t.twig.visible !== twigOn) {
        t.twig.visible = twigOn;
        changed = true;
      }
      t.seen = this.frustum.intersectsSphere(s);
    }
    for (const c of this.classes.values()) if (c.dirty) this.refillFar(c);
    const bandsBush = this.cfg.bush;
    for (const b of this.bushes) {
      const level = chooseLod(b.level, sphereDistance(cx, cy, cz, { x: b.sphere.center.x, y: b.sphere.center.y, z: b.sphere.center.z, r: b.sphere.radius }), bandsBush);
      if (level !== b.level) {
        b.level = level;
        this.bushDirty = true;
      }
    }
    if (this.bushDirty) this.refillBushes();
    this.recount(changed);
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
  }

  /** The far layer of a class: the thinned, enlarged clusters of every tree at level 2. */
  private refillFar(c: ClassDraw): void {
    c.dirty = false;
    c.far.begin();
    for (const t of this.trees) if (t.level === 2 && this.classes.get(t.cls) === c) c.far.push(t.far);
    c.far.end();
  }

  private refillBushes(): void {
    this.bushDirty = false;
    const layers = this.bushLayers;
    if (!layers) return;
    for (const l of layers) l.begin();
    for (const b of this.bushes) if (b.level <= 2) layers[b.level]!.push(b.batch);
    for (const l of layers) l.end();
  }

  private recount(_changed: boolean): void {
    const lv = this.statsData.levels;
    const cherry: [number, number, number] = [0, 0, 0];
    const green: [number, number, number] = [0, 0, 0];
    const willow: [number, number, number] = [0, 0, 0];
    let tris = 0;
    let calls = 0;
    let twigMeshes = 0;
    for (const t of this.trees) {
      const into = t.cls === "blossom" ? cherry : t.cls === "leaf" ? green : willow;
      const c = this.classes.get(t.cls)!;
      if ((t.level === 0 || t.level === 1) && t.seen) {
        into[t.level] += t.n;
        tris += t.n * c.tris[t.level];
        calls++;
      }
      if (t.twig?.visible && t.seen) {
        twigMeshes++;
        calls++;
        tris += (t.twig.geometry.index?.count ?? 0) / 3;
      }
    }
    for (const [cls, c] of this.classes) {
      if (c.far.n) {
        (cls === "blossom" ? cherry : cls === "leaf" ? green : willow)[2] += c.far.n;
        tris += c.far.n * c.far.tris;
        calls++;
      }
    }
    const bush: [number, number, number] = [0, 0, 0];
    this.bushLayers?.forEach((l, k) => {
      bush[k] = l.n;
      if (l.n) {
        tris += l.n * l.tris;
        calls++;
      }
    });
    for (const l of this.flowerLayers.flatMap((f) => [f.lod0, f.lod1])) {
      if (!l.n) continue;
      tris += l.n * l.tris;
      calls++;
    }
    lv.cherry = cherry;
    lv.green = green;
    lv.willow = willow;
    lv.bush = bush;
    this.statsData.tris = Math.round(tris);
    this.statsData.calls = calls;
    this.statsData.twigMeshes = twigMeshes;
  }

  stats(): VegStats {
    return structuredClone(this.statsData);
  }

  dispose(): void {
    // the village clone gets its own geometry back (its old cards show again)
    for (const { mesh, visible } of this.hiddenInstanced) mesh.visible = visible;
    this.hiddenInstanced.length = 0;
    for (const { mesh, visible } of this.reshown) mesh.visible = visible;
    this.reshown.length = 0;
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
