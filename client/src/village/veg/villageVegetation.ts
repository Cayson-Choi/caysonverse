import {
  Box3,
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
import { BACKDROP_FOREST_PREFIX, CHERRY_MATERIAL, MATERIAL, type VillageTier } from "../villageModelPrep";
import { CHERRY_GROW, cherryConnection, crownEnvelope, growCherry, type Bunch, type CherryCrown } from "./cherryTree";
import type { Connection, Envelope, KeepOut } from "./crownGrowth";
import { BUILDING_BOX, buildingSpace, crownKeepOut, type Box, buildingKeepOut, trimSkeleton } from "./crownSpace";
import { GREEN_GROW, YOUNG_GROW, broadleafEnvelope, growBroadleaf, growWillow, leafConnection, willowEnvelope, type Leaf, type LeafCrown } from "./treeCrown";
import {
  PLAZA_CHERRY_SPECS,
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
import { removePlazaZelkova, zelkovaSkeleton } from "./zelkova";
import { TriangleGrid, faceNormal, openEdges, type DrawnGap, type V3 } from "./drawnGap";
import { placeFlowers, SPECIES_COUNT, type Plant } from "./flowerPlacement";
import { keepTriangles, readCards, type AttributeLike, type Card } from "./vegCards";
import { makeBlossomAtlas } from "./vegAtlas";
import { GeoBuilder, blossomBunch, bunchSprite, bushGeometry, leafSpray, speciesMeshes, willowSpray } from "./vegGeometry";
import { BARK_STYLE, barkLight, barkTexture, simplifyTwig, skeletonBark, skeletonBarkInto, twigBark, type BarkPattern } from "./barkGeometry";
import { bakedBarkIndex } from "./bakedBark";
import { chooseLod, groupIntoCells, sphereDistance, VEG_TIERS, type Cell, type LodBands, type Vec3, type VegTierConfig } from "./vegLod";
import { vegMaterial, vegTimeUniform, setVegLamps } from "./vegMaterial";
import { DAY_SUN_DIRECTION } from "../dayNightBlend";
import type { VegMode } from "./vegMode";
import { createVegPark } from "./vegPark";

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
 *    twigs are drawn within `twigFar`. The blossoms' middle-level sprites are sized to cover a crown as the near
 *    level's 3D bunches do (no jump at the boundary).
 *  - Crowns make room (crownSpace.ts): a crown does not grow into a house beside it, and two crowns that meet share
 *    the air between them (an instanced tree that meets something grows its own crown).
 *  - The build is cut into steps; the old foliage and the plaza zelkova are hidden on arrival, and each tree shows
 *    as soon as it is grown, the nearest the camera first.
 *  - Bushes: every bush (the instanced ones and those merged into the leaf meshes, found from their cards: shrubs.ts)
 *    is a round 3D bush on the ground, three levels.
 *  - The old cards of all of these are hidden by a copy of their mesh's index without them (the file and the loader's
 *    geometry are not touched); the cherries' fallen petals stay. The plaza zelkova is taken out whole on arrival
 *    (zelkova.ts; the owner, 2026-11-12: "아예 저 나무는 몸통을 만들지 말고 없애버려"). The backdrop forest on the
 *    hills (outside the walk bounds, 11 m or more from where a player can stand) keeps its crossed cards.
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
  /** Plants per species (flowerPlacement.SPECIES: the four flowers, the grass tufts, the reeds). */
  species: number[];
  petalInstanced: string[];
  /** The crowns that make room for a house or a neighbouring crown (crownSpace.ts). */
  makingRoom: string[];
  /** The zelkova's bark triangles taken out. */
  zelkovaBarkTris: number;
  /** The runtime bark (trunks, limbs, side branches): meshes, triangles drawn (instances counted), vertices; the file's light-mapped bark triangles cut out. */
  bark: { meshes: number; tris: number; vertices: number; bakedTris: number };
  /** Instances drawn this frame per level: flowers [full, simple, thinned], trees per class [near, mid, far]. */
  levels: { flowers: [number, number, number]; cherry: [number, number, number]; green: [number, number, number]; willow: [number, number, number]; bush: [number, number, number] };
  /** Triangles and draw calls the vegetation draws this frame (in view). */
  tris: number;
  calls: number;
  /** Twig meshes drawn this frame and their vertex total (memory). */
  twigMeshes: number;
  twigVertices: number;
  /** Times this vegetation dressed a new village clone at once (back out of the hall or a house: no rebuild). */
  attaches: number;
  /** The trees whose limbs were cut back short of a house beside them (crownSpace.trimSkeleton). */
  trimmed: string[];
  /** The street lamps lighting the vegetation at night (vegMaterial.ts `vegLampsUniform`). */
  lamps: number;
  /** The lamps found in the village file (only the `VEG_LAMPS` nearest the plaza light the vegetation). */
  lampsFound: number;
  /**
   * The changes this vegetation makes to the village clone (its old cards and the baked bark cut out, the instanced
   * bark hidden) and how many of them are in effect on the clone it dresses now: equal after every `attach` (e2e).
   */
  cloneEdits: { total: number; inEffect: number };
  /** Milliseconds of main-thread work the build took (in steps, the main thread handed back between them). */
  genMs: number;
  /** Milliseconds from the build's start to its end (the work, and the frames drawn in between). */
  wallMs: number;
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

/** A geometry's vertex positions moved by `xf` (an instance's world matrix), as an AttributeLike. */
function transformedPositions(g: BufferGeometry, xf: Matrix4): AttributeLike {
  const attr = g.getAttribute("position") as BufferAttribute;
  const out = new Float32Array(attr.count * 3);
  const v = new Vector3();
  for (let i = 0; i < attr.count; i++) {
    v.fromBufferAttribute(attr, i).applyMatrix4(xf);
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

/** The zelkova's bark triangles the arrival took out, per village clone (the stats read it). */
const zelkovaTris = new WeakMap<Object3D, number>();

/**
 * Hide the old flat foliage at once, before the 3D vegetation is ready (no flash of the old cards on arrival), and take
 * the plaza zelkova out (zelkova.ts). The backdrop forest on the hills keeps its cards (outside the walk bounds; never
 * seen up close). The returned restore gives it all back; it does so once (later calls do nothing).
 */
export function hideLegacyVegetationSources(root: Object3D): () => void {
  const hidden: Array<{ object: Object3D; visible: boolean }> = [];
  const names = new Set([FLORA, CHERRY_MATERIAL, GREEN]);
  root.traverse((object) => {
    if (!isMesh(object) || object.name.startsWith(BACKDROP_FOREST_PREFIX) || !materialsOf(object).some((material) => names.has(material.name))) return;
    hidden.push({ object, visible: object.visible });
    object.visible = false;
  });
  const zelkova = removePlazaZelkova(root);
  zelkovaTris.set(root, zelkova.tris);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const entry of hidden) entry.object.visible = entry.visible;
    zelkova.restore();
    zelkovaTris.delete(root);
  };
}

/** A change to the village clone (VillageVegetation.edits): the mesh's key in the clone, its new index or visibility. */
interface CloneEdit {
  key: string;
  index?: Uint32Array;
  visible?: boolean;
}

/**
 * Every object of a clone by a key that names the same object in every clone of the file: its name and its turn among
 * those named so (made once per clone, before the vegetation adds anything to it).
 */
const keysByRoot = new WeakMap<Object3D, Map<Object3D, string>>();
function cloneKeys(root: Object3D): Map<Object3D, string> {
  let keys = keysByRoot.get(root);
  if (keys) return keys;
  const made = new Map<Object3D, string>();
  const seen = new Map<string, number>();
  root.traverse((o) => {
    const n = seen.get(o.name) ?? 0;
    seen.set(o.name, n + 1);
    made.set(o, `${o.name}#${n}`);
  });
  keysByRoot.set(root, made);
  keys = made;
  return keys;
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
  readonly capacity: number;
  n = 0;

  constructor(
    readonly geometry: BufferGeometry,
    readonly material: Material,
    capacity: number,
    name: string,
  ) {
    const cap = Math.max(1, capacity);
    this.capacity = cap;
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
const SPRITE_K = 0.62;
/**
 * Every bunch is drawn this much bigger than its measured size (round its spur, so it stays on its twig). With the
 * sprite's size above, the near level's 3D bunches and the middle level's sprites cover a crown alike (measured from
 * one camera with `?vegLod=near|mid`: the crown no longer jumps from a dense puff to a thin one at the boundary).
 */
const BUNCH_K = 1.3;
/** The bunch mesh's spur (where it meets the twig), its local height at scale 1 (blossomBunch). */
const BUNCH_SPUR_Y = -0.02;
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

export interface BuildOptions {
  /** Where the player looks from (the trees nearest it are grown first). */
  focus?: () => Vec3 | null;
  /**
   * Called once the vegetation can be drawn (the flowers made, the trees about to grow): from then on each tree shows
   * as soon as it is grown, nearest the focus first, instead of all of them at the build's end.
   */
  onShow?: (v: VillageVegetation) => void;
  /** How long (ms) a slice of work may run before the main thread is handed back (default STEP_SLICE_MS). */
  sliceMs?: () => number;
}

/** A slice of the build's work (ms) before the main thread is handed back. */
const STEP_SLICE_MS = 12;

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

/**
 * The street lamps' (and lanterns') places in the village clone: the centres of their glowing glass (`M_lamp`), one
 * per lamp (the glass's points gathered within 1.2 m of each other). The vegetation near them is lit warm at night.
 */
export function lampPlaces(root: Object3D): Array<[number, number, number]> {
  const groups: Array<{ x: number; y: number; z: number; n: number }> = [];
  const p = new Vector3();
  root.traverse((o) => {
    if (!isMesh(o) || !materialsOf(o).some((m) => m.name === MATERIAL.lamp)) return;
    o.updateWorldMatrix(true, false);
    const pos = o.geometry.getAttribute("position") as BufferAttribute;
    const xfs = (o as InstancedMesh).isInstancedMesh ? instanceMatrices(o as InstancedMesh) : [o.matrixWorld];
    const every = Math.max(1, Math.floor(pos.count / 400));
    for (const xf of xfs)
      for (let i = 0; i < pos.count; i += every) {
        p.fromBufferAttribute(pos, i).applyMatrix4(xf);
        const g = groups.find((q) => Math.hypot(q.x / q.n - p.x, q.z / q.n - p.z) < 1.2 && Math.abs(q.y / q.n - p.y) < 2);
        if (g) {
          g.x += p.x;
          g.y += p.y;
          g.z += p.z;
          g.n++;
        } else groups.push({ x: p.x, y: p.y, z: p.z, n: 1 });
      }
  });
  return groups.map((g) => [g.x / g.n, g.y / g.n, g.z / g.n]);
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

/** The bark's light of a tree (barkGeometry.barkLight): the same for its trunk, limbs and twigs. */
const barkLightOf = (sk: TreeSkeleton) => barkLight(sk.crownC, sk.R, sk.base[1], DAY_SUN_DIRECTION as Vec3, { p: sk.trunk.pts[3]!, r: sk.trunk.radii[3]! });

/** The ten bushes' tints: a little hue variety (the leaves are tinted, the heart too). */
const tintOf = (seed: number): number[] => {
  const f = (k: number) => (Math.sin(seed * 9301 + k * 49297) * 0.5 + 0.5) % 1;
  return [0.92 + 0.12 * f(1), 0.95 + 0.08 * f(2), 0.88 + 0.12 * f(3)];
};

/**
 * DEV only: `?vegLod=near|mid` draws every tree at that level wherever it stands (comparing the two levels from one
 * camera: they must look alike at the boundary). Production builds always use the tier's bands.
 */
function forcedLevels(cfg: VegTierConfig): VegTierConfig {
  if (!import.meta.env.DEV || typeof location === "undefined") return cfg;
  const force = new URLSearchParams(location.search).get("vegLod");
  if (force !== "near" && force !== "mid") return cfg;
  const far = force === "near" ? [5000, 5001, 5002] : [-1, 5000, 5001];
  return { ...cfg, cherry: { ...cfg.cherry, far }, green: { ...cfg.green, far } };
}

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
  /**
   * What the vegetation changed in the village clone (a mesh's index swapped for one without the old cards or bark, a
   * mesh hidden or shown), by the mesh's place in the clone: made again on another clone of the same file (`attach`).
   */
  private readonly edits: CloneEdit[] = [];
  /** How to undo each change on the clone it is attached to (`detach`). */
  private readonly undo: Array<() => void> = [];
  private readonly twigFar: number;
  /** The village clone the vegetation dresses (its bark, for measuring the connection on what is drawn). */
  private root: Object3D | null = null;

  private constructor(tier: VillageTier, mode: Exclude<VegMode, "old">) {
    this.cfg = forcedLevels(VEG_TIERS[tier]);
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
      species: [],
      petalInstanced: [],
      makingRoom: [],
      zelkovaBarkTris: 0,
      bark: { meshes: 0, tris: 0, vertices: 0, bakedTris: 0 },
      levels: { flowers: [0, 0, 0], cherry: [0, 0, 0], green: [0, 0, 0], willow: [0, 0, 0], bush: [0, 0, 0] },
      tris: 0,
      calls: 0,
      twigMeshes: 0,
      twigVertices: 0,
      attaches: 0,
      trimmed: [],
      lamps: 0,
      lampsFound: 0,
      cloneEdits: { total: 0, inEffect: 0 },
      genMs: 0,
      wallMs: 0,
      steps: {},
    };
  }

  /**
   * Build the vegetation for a dressed village clone in steps (the main thread is handed back between slices of
   * them, so the arrival is never frozen for the whole build). VillageModel hides the old foliage meshes on arrival;
   * the old cards are cut out at the end. `options.onShow` gets the vegetation as soon as it can be drawn (each tree
   * then shows as it is grown). `cancelled()` true: stop and free what was made (resolves null).
   */
  static async build(root: Object3D, tier: VillageTier, mode: Exclude<VegMode, "old">, cancelled: () => boolean = () => false, options: BuildOptions = {}): Promise<VillageVegetation | null> {
    const { focus, onShow, sliceMs } = options;
    const v = new VillageVegetation(tier, mode);
    v.root = root;
    const steps = v.statsData.steps;
    let work = 0;
    const start = performance.now();
    let t = start;
    let slice = start;
    const step = async (name: string) => {
      const now = performance.now();
      steps[name] = Math.round(now - t);
      work += now - t;
      // the main thread is handed back once a slice of work is done (not after every small step: each hand-back
      // costs a frame of the village's drawing before the build goes on)
      if (now - slice >= (sliceMs?.() ?? STEP_SLICE_MS)) {
        await yieldToMain();
        slice = performance.now();
      }
      t = performance.now();
      return cancelled();
    };
    const cfg = v.cfg;
    const hide = mode === "new";
    const low = tier === "low";
    const stats = v.statsData;

    // ── flowers and grass: the beds, the meadow's wild patches and tufts, the reeds, read from the old cards ──
    const floraMeshes = meshesWithMaterial(root, FLORA);
    const cardMesh = new Map<Card, number>();
    const allCards: Card[] = [];
    const readFlora = (g: BufferGeometry, position: AttributeLike) =>
      readCards(position, g.index ? (g.index.array as ArrayLike<number>) : null, (g.getAttribute("uv") as BufferAttribute) ?? null, (g.getAttribute("color") as BufferAttribute) ?? null);
    floraMeshes.forEach((mesh, mi) => {
      for (const c of readFlora(mesh.geometry, worldPositions(mesh))) {
        cardMesh.set(c, mi);
        allCards.push(c);
      }
    });
    // the meadow's patches are instanced (inst__meadow_*): each instance's cards, where it stands
    root.traverse((o) => {
      if (!(o as InstancedMesh).isInstancedMesh || !materialsOf(o as Mesh).some((m) => m.name === FLORA)) return;
      const mesh = o as InstancedMesh;
      for (const xf of instanceMatrices(mesh)) allCards.push(...readFlora(mesh.geometry, transformedPositions(mesh.geometry, xf)));
      stats.hiddenInstanced.push(mesh.name);
    });
    if (await step("cards")) return v.abandon();
    const placed = placeFlowers(allCards);
    if (await step("placement")) return v.abandon();
    const flowerMat = vegMaterial({ name: "M_veg_flowers", wind: 0.022, windFar: cfg.windFar ? 30 : 10, ambient: 0.5, sky: 0.12, sun: 0.5, back: 0.45 });
    v.own.push(flowerMat);
    const meshes = speciesMeshes();
    const counts = new Array<number>(SPECIES_COUNT).fill(0);
    for (const p of placed.plants) counts[p.species]!++;
    stats.species = counts;
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

    // ── the trees' skeletons, replayed from the art script (the very limbs and cards of the file) ──
    const zelkova = zelkovaSkeleton();
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
      barkStreetGreen: findInstanced(root, "inst__street_green_0"),
      barkStreetCherry: findInstanced(root, "inst__street_cherry_0"),
      barkOrchard: findInstanced(root, "inst__orchard_0"),
    };
    const xfs = {
      street_green: inst.street_green ? instanceMatrices(inst.street_green) : [],
      street_cherry: inst.street_cherry ? instanceMatrices(inst.street_cherry) : [],
      orchard: inst.orchard ? instanceMatrices(inst.orchard) : [],
      shrub: inst.shrub ? instanceMatrices(inst.shrub) : [],
    };
    if (await step("skeletons")) return v.abandon();

    // ── materials and the clusters' meshes ──
    const atlas: Texture | null = makeBlossomAtlas();
    if (atlas) v.own.push(atlas);
    const bunchMat = vegMaterial({ name: "M_veg_blossom", map: atlas, alphaTest: 0.5, cherry: true, wind: 0.012, windFar: 25, ambient: 0.62, sky: 0.12, sun: 0.38, back: 0.6 });
    const spriteMat = vegMaterial({ name: "M_veg_blossom_far", map: atlas, alphaTest: 0.5, cherry: true, sprite: true, wind: 0.01, windFar: 25, ambient: 1, sky: 0, sun: 0, back: 0 });
    // the bark (trunk, limbs, side branches and twigs alike): one material per kind of bark, its texture drawn in code
    const barkMats = {} as Record<BarkPattern, Material>;
    for (const pattern of ["cherry", "plates", "willow", "smooth", "plum"] as const) {
      const map = barkTexture(pattern);
      const mat = vegMaterial({ name: `M_veg_bark_${pattern}`, map, wind: 0, windFar: 1, ambient: 0.55, sky: 0.2, sun: 0.45, back: 0.2 });
      barkMats[pattern] = mat;
      v.own.push(map, mat);
    }
    const barkMatOf = (sk: TreeSkeleton) => barkMats[BARK_STYLE[sk.kind].pattern];
    const leafMat = vegMaterial({ name: "M_veg_leaves", wind: 0.024, windFar: cfg.windFar ? 30 : 12, ambient: 0.44, sky: 0.2, sun: 0.42, back: 0.42 });
    const leafFarMat = vegMaterial({ name: "M_veg_leaves_far", wind: 0.01, windFar: 40, ambient: 0.54, sky: 0.18, sun: 0.38, back: 0.4 });
    const willowMat = vegMaterial({ name: "M_veg_willow", wind: 0.03, windFar: cfg.windFar ? 30 : 12, ambient: 0.54, sky: 0.2, sun: 0.4, back: 0.5 });
    const bushMat = vegMaterial({ name: "M_veg_bush", wind: 0.01, windFar: 20, ambient: 0.5, sky: 0.22, sun: 0.4, back: 0.35 });
    v.own.push(bunchMat, spriteMat, leafMat, leafFarMat, willowMat, bushMat);
    const bunchGeo = blossomBunch();
    // the sprite takes the bunch's own matrix (scale size / 0.24): its quad is the bunch's size x SPRITE_K at scale 1
    const spriteGeo = bunchSprite(BUNCH_MESH_SIZE * SPRITE_K);
    const spriteFarGeo = bunchSprite(BUNCH_MESH_SIZE * SPRITE_K);
    // the PC's near leaves have a real leaf's outline (a young tree's are seen from half a metre); the phone's keep 8 triangles
    const sprayGeos = [leafSpray(0, 21, !low), leafSpray(1), leafSpray(2)] as const;
    const willowGeos = [willowSpray(0), willowSpray(1), willowSpray(2)] as const;
    v.own.push(bunchGeo, spriteGeo, spriteFarGeo, ...sprayGeos, ...willowGeos);
    const ch = cfg.cherry;
    const gr = cfg.green;
    const triCount = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;
    // a class's far layer holds every tree's thinned clusters at most (made once its trees are in)
    // (the far layer grows as the trees come in: refillFar)
    const mkClass = (cls: DrawClass, geos: [BufferGeometry, BufferGeometry], mats: [Material, Material], farGeo: BufferGeometry, farMat: Material, bands: ClassDraw["bands"]) => {
      const far = new Layer(farGeo, farMat, 1024, `veg_${cls}_far`);
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
      const s = (b.size / BUNCH_MESH_SIZE) * BUNCH_K;
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
    const twigObject = (geo: BufferGeometry, xf: Matrix4 | null, name: string, mat: Material): Mesh => {
      const m = new Mesh(geo, mat);
      m.name = name;
      m.matrixAutoUpdate = false;
      if (xf) m.matrix.copy(xf);
      m.visible = false;
      m.userData[CLICK_PICK_KEY] = "ignore";
      v.group.add(m);
      return m;
    };
    const twigGeo = (twigs: readonly Branch[], sk: TreeSkeleton) => {
      // the orchard's small trees: their finest twigs a little thicker (4.5 mm, a plum's real twig), so they read as
      // lines between the blossoms, not as dots
      // the young trees' twigs come within arm's reach: rounder, pointed at the tip (twigBark `near`)
      const geo = twigBark(twigs, BARK_STYLE[sk.kind], low, barkLightOf(sk), low ? simplifyTwig : undefined, sk.kind === "orchard" ? 0.0045 : 0, sk.kind === "young");
      v.own.push(geo);
      stats.twigVertices += geo.getAttribute("position").count;
      return geo;
    };

    const leafTint = (l: Leaf) => tintOf(l.seed);
    mkClass("blossom", [bunchGeo, spriteGeo], [bunchMat, spriteMat], spriteFarGeo, spriteMat, ch);
    mkClass("leaf", [sprayGeos[0], sprayGeos[1]], [leafMat, leafMat], sprayGeos[2], leafFarMat, gr);
    mkClass("willow", [willowGeos[0], willowGeos[1]], [willowMat, willowMat], willowGeos[2], leafFarMat, gr);

    // ── grow the crowns, nearest the camera first, and show each tree as soon as it is grown ──
    // each crown's connection is measured as it is grown (the e2e and the dev hook read it)
    const conn: Connection = { clusters: 0, twigs: 0, maxGap: 0, unattached: 0, bareTips: 0 };
    const addConn = (c: Connection) => {
      conn.clusters += c.clusters;
      conn.twigs += c.twigs;
      conn.maxGap = Math.max(conn.maxGap, c.maxGap);
      conn.unattached += c.unattached;
      conn.bareTips += c.bareTips;
    };
    /** Where a crown is drawn: the instance matrix (null: as grown) and its number (the draw's name). */
    type Place = { xf: Matrix4 | null; i: number };
    const ONCE: Place[] = [{ xf: null, i: 0 }];
    const drawBlossom = (crown: CherryCrown, kind: TreeKindStat, places: readonly Place[]) => {
      addConn(cherryConnection(crown));
      stats.bunches += crown.bunches.length * places.length;
      const geo = twigGeo(crown.twigs, crown.skeleton);
      stats.trees[kind].twigs += crown.twigs.length * places.length;
      for (const { xf, i } of places) {
        const d = addTree(`${kind}_${crown.skeleton.index}_${i}`, "blossom", kind, crown.bunches, bunchMatrix, bunchTint, crown.bounds, xf, ch);
        d.twig = twigObject(geo, xf, `veg_twigs_${d.name}`, barkMatOf(crown.skeleton));
      }
    };
    const drawLeafy = (crown: LeafCrown, kind: TreeKindStat, places: readonly Place[]) => {
      addConn(leafConnection(crown));
      const cls: DrawClass = crown.kind === "willow" ? "willow" : "leaf";
      const geo = twigGeo(crown.twigs, crown.skeleton);
      stats.trees[kind].twigs += crown.twigs.length * places.length;
      for (const { xf, i } of places) {
        const d = addTree(`${kind}_${crown.skeleton.index}_${i}`, cls, kind, crown.leaves, leafMatrix, leafTint, crown.bounds, xf, gr);
        d.twig = twigObject(geo, xf, `veg_twigs_${d.name}`, barkMatOf(crown.skeleton));
      }
    };
    const f = focus?.() ?? [0, 0, 0];
    const away = (x: number, z: number) => Math.hypot(x - f[0], z - f[2]);
    const nearestOf = (list: readonly Place[]) => Math.min(Infinity, ...list.map((p) => away(p.xf!.elements[12]!, p.xf!.elements[14]!)));

    // ── room for each crown: the houses beside it and the crowns it meets (crownSpace.ts) ──
    const boxes: Box[] = [];
    root.traverse((o) => {
      if (!isMesh(o) || !BUILDING_BOX.test(o.name)) return;
      o.updateWorldMatrix(true, false);
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld);
      boxes.push(buildingSpace(o.name, [bb.min.x, bb.min.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z]));
    });
    /** An envelope moved by an instance matrix (the trees stand upright: a turn about y and a uniform scale). */
    const placedEnv = (e: Envelope, xf: Matrix4): Envelope => {
      const k = new Vector3().setFromMatrixScale(xf).x;
      const c = new Vector3(e.c[0], e.c[1], e.c[2]).applyMatrix4(xf);
      return { c: [c.x, c.y, c.z], rx: e.rx * k, up: e.up * k, down: e.down * k };
    };
    // the street lamps: what grows near them is lit warm at night (vegMaterial.ts)
    const lamps = lampPlaces(root);
    stats.lampsFound = lamps.length;
    stats.lamps = setVegLamps(lamps, [0, 0, 0]);
    const envOf = new Map<TreeSkeleton, Envelope>();
    for (const sk of plaza) envOf.set(sk, crownEnvelope(sk));
    for (const sk of village) envOf.set(sk, sk.kind === "cherry" ? crownEnvelope(sk) : broadleafEnvelope(sk, GREEN_GROW));
    for (const sk of young) envOf.set(sk, broadleafEnvelope(sk, YOUNG_GROW));
    for (const sk of willows) envOf.set(sk, willowEnvelope(sk));
    const variantEnv = {
      street_cherry: crownEnvelope(variant.street_cherry),
      orchard: crownEnvelope(variant.orchard),
      street_green: broadleafEnvelope(variant.street_green, GREEN_GROW),
    };
    type VariantKey = keyof typeof variantEnv;
    const instEnv = Object.fromEntries((Object.keys(variantEnv) as VariantKey[]).map((k) => [k, xfs[k].map((xf) => placedEnv(variantEnv[k], xf))])) as Record<VariantKey, Envelope[]>;
    const allEnvs = [...envOf.values(), ...Object.values(instEnv).flat()];
    // the limbs that would run on into a house's room are cut back short of it (crownSpace.trimSkeleton): the crown is
    // grown on the cut skeleton and its bark drawn from it. A single tree's: `drawnSk`; an instance's: `ownBark`
    const drawnSk = new Map<TreeSkeleton, TreeSkeleton>();
    for (const sk of [...plaza, ...village, ...young]) {
      const walls = buildingKeepOut(envOf.get(sk)!, boxes);
      const t = walls ? trimSkeleton(sk, walls) : null;
      drawnSk.set(sk, t && t.cut ? t.sk : sk);
      if (t && t.cut) stats.trimmed.push(`${sk.kind}${sk.index}`);
    }
    const ownBark: Record<VariantKey, Array<{ i: number; sk: TreeSkeleton; xf: Matrix4 }>> = { street_cherry: [], orchard: [], street_green: [] };
    const keepOutOf = (sk: TreeSkeleton) => {
      const k = crownKeepOut(envOf.get(sk)!, allEnvs, boxes);
      if (k) stats.makingRoom.push(`${sk.kind}${sk.index}`);
      return k;
    };
    const job = (name: string, d: number, run: () => void) => ({ name, d, run });
    /**
     * A variant's instances: those that meet nothing share one crown (grown once at the origin); each of the others
     * grows its own, its keep-out carried to the origin through the instance matrix.
     */
    const instanceJobs = (key: VariantKey, kind: TreeKindStat, grow: (keepOut?: KeepOut, sk?: TreeSkeleton) => CherryCrown | LeafCrown) => {
      const shared: Place[] = [];
      const out: Array<ReturnType<typeof job>> = [];
      const draw = (crown: CherryCrown | LeafCrown, places: readonly Place[]) => ("bunches" in crown ? drawBlossom(crown, kind, places) : drawLeafy(crown, kind, places));
      xfs[key].forEach((xf, i) => {
        const world = crownKeepOut(instEnv[key][i]!, allEnvs, boxes);
        if (!world) {
          shared.push({ xf, i });
          return;
        }
        stats.makingRoom.push(`${key}${i}`);
        const w = new Vector3();
        const local: KeepOut = (p) => {
          w.set(p[0], p[1], p[2]).applyMatrix4(xf);
          return world([w.x, w.y, w.z]);
        };
        // its limbs cut back short of a house beside it (drawn with a bark of its own, not the shared instanced one)
        const walls = buildingKeepOut(instEnv[key][i]!, boxes);
        const wl = new Vector3();
        const t = walls
          ? trimSkeleton(variant[key], (p) => {
              wl.set(p[0], p[1], p[2]).applyMatrix4(xf);
              return walls([wl.x, wl.y, wl.z]);
            })
          : null;
        const own = t && t.cut ? t.sk : undefined;
        if (own) {
          ownBark[key].push({ i, sk: own, xf });
          stats.trimmed.push(`${key}${i}`);
        }
        out.push(job(`${key}${i}`, away(xf.elements[12]!, xf.elements[14]!), () => draw(grow(local, own), [{ xf, i }])));
      });
      if (shared.length) out.push(job(key, nearestOf(shared), () => draw(grow(), shared)));
      return out;
    };
    const STREET_CHERRY = { attractors: 400, bunchStep: 0.08, dressBranches: true };
    // the orchard's small trees (3.8 m): smaller flowers, closer together (about the same blossom), and head room at
    // the trunk (someone under one looks up into it, not into flowers 20 cm from their eyes)
    const ORCHARD = { attractors: 240, bunchStep: 0.045, bunchScale: 0.7, headroom: { r: 1.0, y: 2.0 }, dressBranches: true };
    const jobs = [
      ...plaza.map((sk) => job(`cherry${sk.index}`, away(sk.base[0], sk.base[2]), () => drawBlossom(growCherry(drawnSk.get(sk)!, { ...CHERRY_GROW, keepOut: keepOutOf(sk) }), "plaza_cherry", ONCE))),
      ...village.map((sk) =>
        job(`${sk.kind}${sk.index}`, away(sk.base[0], sk.base[2]), () =>
          sk.kind === "cherry"
            ? drawBlossom(growCherry(drawnSk.get(sk)!, { ...CHERRY_GROW, keepOut: keepOutOf(sk) }), "village_cherry", ONCE)
            : drawLeafy(growBroadleaf(drawnSk.get(sk)!, GREEN_GROW, "green", keepOutOf(sk)), "village_green", ONCE),
        ),
      ),
      ...instanceJobs("street_cherry", "street_cherry", (keepOut, sk) => growCherry(sk ?? variant.street_cherry, { ...STREET_CHERRY, keepOut })),
      ...instanceJobs("orchard", "orchard", (keepOut, sk) => growCherry(sk ?? variant.orchard, { ...ORCHARD, keepOut })),
      ...instanceJobs("street_green", "street_green", (keepOut, sk) => growBroadleaf(sk ?? variant.street_green, GREEN_GROW, "green", keepOut)),
      ...young.map((sk) => job(`young${sk.index}`, away(sk.base[0], sk.base[2]), () => drawLeafy(growBroadleaf(drawnSk.get(sk)!, YOUNG_GROW, "young", keepOutOf(sk)), "young", ONCE))),
      ...willows.map((sk) => job(`willow${sk.index}`, away(sk.base[0], sk.base[2]), () => drawLeafy(growWillow(sk), "willow", ONCE))),
    ];
    jobs.sort((p, q) => p.d - q.d);
    // the vegetation is shown now (the flowers, and each tree as it comes)
    onShow?.(v);
    for (const job of jobs) {
      job.run();
      if (await step(job.name)) return v.abandon();
    }
    stats.connection = conn;
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

    // ── the bark: every tree's trunk, limbs and side branches drawn here, in its twigs' bark (barkGeometry.ts) ──
    // the trees placed one by one, merged per 40 m cell and kind of bark (culled by cell); the instanced variants as
    // instanced meshes on the file's own instance matrices
    const single = [...plaza, ...village, ...willows, ...young];
    const cells = new Map<string, { builder: GeoBuilder; pattern: BarkPattern }>();
    for (const sk of single) {
      const pattern = BARK_STYLE[sk.kind].pattern;
      const key = `${pattern}_${Math.floor(sk.base[0] / 40)}_${Math.floor(sk.base[2] / 40)}`;
      let cell = cells.get(key);
      if (!cell) cells.set(key, (cell = { builder: new GeoBuilder(), pattern }));
      skeletonBarkInto(cell.builder, drawnSk.get(sk) ?? sk, low, barkLightOf(sk));
    }
    const barkMeshes: Mesh[] = [];
    for (const [key, { builder, pattern }] of cells) {
      const geo = builder.build();
      const mesh = new Mesh(geo, barkMats[pattern]);
      mesh.name = `veg_bark_${key}`;
      barkMeshes.push(mesh);
      v.own.push(geo);
    }
    for (const key of ["street_green", "street_cherry", "orchard"] as const) {
      // an instance with limbs cut back (beside a house) has a bark of its own, placed by its matrix
      for (const o of ownBark[key]) {
        const geo = skeletonBark(o.sk, low, barkLightOf(o.sk));
        const mesh = new Mesh(geo, barkMatOf(o.sk));
        mesh.matrix.copy(o.xf);
        mesh.matrixWorldNeedsUpdate = true;
        mesh.name = `veg_bark_${key}${o.i}`;
        barkMeshes.push(mesh);
        v.own.push(geo);
      }
      const owned = new Set(ownBark[key].map((o) => o.i));
      const list = xfs[key].filter((_, i) => !owned.has(i));
      if (!list.length) continue;
      const sk = variant[key];
      const geo = skeletonBark(sk, low, barkLightOf(sk));
      const mesh = new InstancedMesh(geo, barkMatOf(sk), list.length);
      list.forEach((xf, i) => mesh.setMatrixAt(i, xf));
      mesh.instanceMatrix.needsUpdate = true;
      // culled by a sphere round every instance's whole tree (its origin and the geometry's reach from it)
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const reach = geo.boundingSphere!.center.length() + geo.boundingSphere!.radius;
      const box = new Box3();
      for (const xf of list) {
        const c = new Vector3().setFromMatrixPosition(xf);
        const r = reach * new Vector3().setFromMatrixScale(xf).x;
        box.expandByPoint(c.clone().addScalar(r)).expandByPoint(c.clone().addScalar(-r));
      }
      const sphere = box.getBoundingSphere(new Sphere());
      for (const xf of list) {
        const d = new Vector3().setFromMatrixPosition(xf).distanceTo(sphere.center) + reach * new Vector3().setFromMatrixScale(xf).x;
        sphere.radius = Math.max(sphere.radius, d + 0.01);
      }
      mesh.boundingSphere = sphere;
      mesh.name = `veg_bark_${key}`;
      barkMeshes.push(mesh);
      v.own.push(geo, { dispose: () => mesh.dispose() });
    }
    for (const mesh of barkMeshes) {
      mesh.matrixAutoUpdate = false;
      mesh.userData[CLICK_PICK_KEY] = "ignore";
      v.group.add(mesh);
      const n = (mesh.geometry.index?.count ?? 0) / 3;
      stats.bark.tris += n * ((mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh).count : 1);
      stats.bark.vertices += mesh.geometry.getAttribute("position").count;
    }
    stats.bark.meshes = barkMeshes.length;
    if (await step("bark")) return v.abandon();

    // ── last: hide the old cards, all at once, now that the new vegetation is ready ──
    if (hide) {
      // the file's own bark of the same trees goes (drawn twice it would fight): the light-mapped bark of the trees
      // placed one by one, cut out triangle by triangle, and the instanced variants' bark meshes, hidden whole
      const barkMeshesOfFile: Mesh[] = [];
      root.traverse((o) => {
        if (!isMesh(o) || (o as InstancedMesh).isInstancedMesh || !materialsOf(o).some((m) => m.name === "LM_bark")) return;
        o.updateWorldMatrix(true, false);
        if (o.matrixWorld.equals(new Matrix4())) barkMeshesOfFile.push(o);
      });
      for (const mesh of barkMeshesOfFile) {
        const cut = bakedBarkIndex(mesh.geometry, single);
        if (!cut) continue;
        v.swapIndex(mesh, cut.index);
        stats.bark.bakedTris += cut.dropped;
      }
      for (const mesh of [inst.barkStreetGreen, inst.barkStreetCherry, inst.barkOrchard]) {
        if (!mesh) continue;
        v.setVisible(mesh, false);
        stats.hiddenInstanced.push(mesh.name);
      }
      floraMeshes.forEach((mesh, mi) => {
        const drop = placed.replaced.filter((c) => cardMesh.get(c) === mi);
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
        if ((mesh.geometry.index?.count ?? 0) > 0) v.setVisible(mesh, true);
      }
      // the instanced trees: the street greens' and the bushes' cards go; the cherries and orchards keep their petals
      for (const mesh of [inst.street_green, inst.shrub]) {
        if (!mesh) continue;
        v.setVisible(mesh, false);
        stats.hiddenInstanced.push(mesh.name);
      }
      for (const mesh of [inst.street_cherry, inst.orchard]) {
        if (!mesh) continue;
        const g = mesh.geometry;
        const canopy = readCards(g.getAttribute("position") as BufferAttribute, g.index ? (g.index.array as ArrayLike<number>) : null, null, null).filter((c) => c.h > 0.05);
        v.hideCards(mesh, canopy);
        v.setVisible(mesh, true);
        stats.petalInstanced.push(mesh.name);
        stats.hiddenCards.cherry += canopy.length;
      }
      stats.zelkovaBarkTris = zelkovaTris.get(root) ?? 0;
    }
    stats.plants = placed.plants.length;
    stats.twigs = Object.values(stats.trees).reduce((a, k) => a + k.twigs, 0);
    stats.hiddenCards.flora = hide ? placed.replaced.length : 0;
    steps.hide = Math.round(performance.now() - t);
    work += performance.now() - t;
    stats.genMs = Math.round(work);
    stats.wallMs = Math.round(performance.now() - start);
    return v;
  }

  /**
   * DEV/E2E: every cluster's gap to what is drawn (drawnGap.ts): the tree's twig mesh as built for this tier, and the
   * village's bark (trunks and limbs, the instanced trees' too). Slow (seconds): for checks only, never per frame.
   */
  measureDrawn(): DrawnGap {
    const bark = new TriangleGrid(0.25);
    const m = new Matrix4();
    const pa = new Vector3();
    const pb = new Vector3();
    const pc = new Vector3();
    // the open edges (rims) of a geometry, found once (an instanced mesh's instances share them)
    const rims = new Map<BufferGeometry, number[]>();
    const rimsOf = (geo: BufferGeometry) => {
      let r = rims.get(geo);
      if (r) return r;
      const pos = geo.getAttribute("position") as BufferAttribute;
      const index = geo.index;
      const n = index ? index.count : pos.count;
      const tris: Array<[V3, V3, V3]> = [];
      for (let t = 0; t < n; t += 3) {
        const v = [0, 1, 2].map((k): V3 => {
          const i = index ? index.getX(t + k) : t + k;
          return [pos.getX(i), pos.getY(i), pos.getZ(i)];
        });
        tris.push([v[0]!, v[1]!, v[2]!]);
      }
      r = openEdges(tris);
      rims.set(geo, r);
      return r;
    };
    const addMesh = (grid: TriangleGrid, geo: BufferGeometry, world: Matrix4, normals: boolean) => {
      const pos = geo.getAttribute("position") as BufferAttribute;
      const nrm = normals ? (geo.getAttribute("normal") as BufferAttribute | undefined) : undefined;
      const index = geo.index;
      const n = index ? index.count : pos.count;
      const rot = new Matrix4().extractRotation(world);
      const nv = new Vector3();
      const open = rimsOf(geo);
      for (let t = 0; t < n; t += 3) {
        const ids = [0, 1, 2].map((k) => (index ? index.getX(t + k) : t + k));
        pa.fromBufferAttribute(pos, ids[0]!).applyMatrix4(world);
        pb.fromBufferAttribute(pos, ids[1]!).applyMatrix4(world);
        pc.fromBufferAttribute(pos, ids[2]!).applyMatrix4(world);
        const a: V3 = [pa.x, pa.y, pa.z];
        const b: V3 = [pb.x, pb.y, pb.z];
        const c: V3 = [pc.x, pc.y, pc.z];
        let normal: V3;
        if (nrm) {
          nv.set(0, 0, 0);
          for (const i of ids) nv.add(pa.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)));
          nv.applyMatrix4(rot).normalize();
          normal = [nv.x, nv.y, nv.z];
        } else normal = faceNormal(a, b, c);
        grid.add(a, b, c, normal, open[t / 3]!);
      }
    };
    this.root?.traverse((o) => {
      if (!isMesh(o) || o.name.startsWith(BACKDROP_FOREST_PREFIX) || !materialsOf(o).some((mat) => /bark/i.test(mat.name))) return;
      o.updateWorldMatrix(true, false);
      if ((o as InstancedMesh).isInstancedMesh) {
        for (const xf of instanceMatrices(o as InstancedMesh)) addMesh(bark, o.geometry, xf, false);
      } else addMesh(bark, o.geometry, o.matrixWorld, false);
    });
    // the runtime bark (trunks, limbs, side branches) too
    this.group.traverse((o) => {
      if (!isMesh(o) || !o.name.startsWith("veg_bark_")) return;
      o.updateWorldMatrix(true, false);
      if ((o as InstancedMesh).isInstancedMesh) {
        for (const xf of instanceMatrices(o as InstancedMesh)) addMesh(bark, o.geometry, xf, true);
      } else addMesh(bark, o.geometry, o.matrixWorld, true);
    });
    const out: DrawnGap = { clusters: 0, maxGap: 0, over2cm: 0, over5cm: 0, byKind: {}, worst: null };
    const twigGrids = new Map<string, TriangleGrid>();
    for (const t of this.trees) {
      let twigs: TriangleGrid | null = null;
      if (t.twig) {
        const key = `${t.twig.geometry.uuid}:${t.twig.matrix.elements.join(",")}`;
        twigs = twigGrids.get(key) ?? null;
        if (!twigs) {
          twigs = new TriangleGrid(0.1);
          addMesh(twigs, t.twig.geometry, t.twig.matrix, true);
          twigGrids.clear();
          twigGrids.set(key, twigs);
        }
      }
      const k = (out.byKind[t.kind] ??= { clusters: 0, maxGap: 0, over5cm: 0 });
      const arr = t.matrix.array as Float32Array;
      for (let i = 0; i < t.n; i++) {
        m.fromArray(arr, i * 16);
        // where the cluster meets its twig: a bunch's spur (blossomBunch), a spray's stem foot (its origin)
        pa.set(0, t.cls === "blossom" ? BUNCH_SPUR_Y : 0, 0).applyMatrix4(m);
        const p: V3 = [pa.x, pa.y, pa.z];
        const gap = Math.min(twigs ? twigs.gap(p, 0.6) : Infinity, bark.gap(p, 0.6));
        const g = Number.isFinite(gap) ? gap : 0.6;
        out.clusters++;
        k.clusters++;
        if (g > 0.02) out.over2cm++;
        if (g > 0.05) {
          out.over5cm++;
          k.over5cm++;
        }
        k.maxGap = Math.max(k.maxGap, g);
        if (g > out.maxGap) {
          out.maxGap = g;
          out.worst = { tree: t.name, at: p, gap: g };
        }
      }
    }
    return out;
  }

  /** A build that was cancelled: free what it made. */
  private abandon(): null {
    this.dispose();
    return null;
  }

  /** Give `mesh` (a mesh of the village clone) a copy of its geometry without the cards' triangles. */
  private hideCards(mesh: Mesh, drop: readonly Card[]): void {
    const src = mesh.geometry;
    this.swapIndex(mesh, keepTriangles(src.index ? (src.index.array as ArrayLike<number>) : null, src.getAttribute("position").count, drop));
  }

  /** Give `mesh` (of the clone) a copy of its geometry with `index` (recorded: made again by `attach`). */
  private swapIndex(mesh: Mesh, index: Uint32Array, record = true): void {
    const original = mesh.geometry;
    const copy = original.clone();
    copy.setIndex(new BufferAttribute(index, 1));
    mesh.geometry = copy;
    this.undo.push(() => {
      mesh.geometry = original;
      copy.dispose();
    });
    if (record && this.root) this.edits.push({ key: cloneKeys(this.root).get(mesh)!, index });
  }

  /** Show or hide a mesh of the clone (recorded: made again by `attach`). */
  private setVisible(mesh: Object3D, visible: boolean, record = true): void {
    const was = mesh.visible;
    mesh.visible = visible;
    this.undo.push(() => {
      mesh.visible = was;
    });
    if (record && this.root) this.edits.push({ key: cloneKeys(this.root).get(mesh)!, visible });
  }

  /**
   * Give the village clone back everything the vegetation changed in it (its old cards and bark show again) and let go
   * of it. The vegetation itself is kept: `attach` dresses another clone of the same file with it, at once (the
   * player back out of the memorial hall or a house: no rebuild, no cover).
   */
  detach(): void {
    for (let i = this.undo.length - 1; i >= 0; i--) this.undo[i]!();
    this.undo.length = 0;
    this.root = null;
  }

  /** Dress `root` (a fresh clone of the same village file) as the clone this was built on: the same cards and bark out. */
  attach(root: Object3D): void {
    if (this.root) this.detach();
    this.root = root;
    this.statsData.attaches++;
    const byKey = new Map<string, Object3D>();
    for (const [o, key] of cloneKeys(root)) byKey.set(key, o);
    for (const e of this.edits) {
      const o = byKey.get(e.key);
      if (!o) continue;
      if (e.index) this.swapIndex(o as Mesh, e.index, false);
      if (e.visible !== undefined) this.setVisible(o, e.visible, false);
    }
  }

  /**
   * Free the vegetation's GPU buffers (its geometries and instance buffers), keeping their data: drawn again, they are
   * uploaded again. For the phone tier while the vegetation waits indoors (the village's own files go too).
   */
  releaseGpu(): void {
    this.group.traverse((o) => {
      if (!isMesh(o)) return;
      o.geometry.dispose();
      if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose();
    });
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
    let need = 0;
    for (const t of this.trees) if (t.level === 2 && this.classes.get(t.cls) === c) need += t.far.n;
    if (need > c.far.capacity) {
      // more trees came in than the layer holds: a bigger one in its place
      const old = c.far;
      c.far = new Layer(old.geometry, old.material, Math.ceil(need * 1.3), old.mesh.name);
      c.far.mesh.userData[CLICK_PICK_KEY] = "ignore";
      this.group.remove(old.mesh);
      old.mesh.dispose();
      this.group.add(c.far.mesh);
      this.own.push(c.far.mesh);
    }
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
    const out = structuredClone(this.statsData);
    let inEffect = 0;
    if (this.root) {
      const byKey = new Map<string, Object3D>();
      for (const [o, key] of cloneKeys(this.root)) byKey.set(key, o);
      for (const e of this.edits) {
        const o = byKey.get(e.key);
        if (!o) continue;
        const indexOk = !e.index || (o as Mesh).geometry?.index?.array === e.index;
        const visibleOk = e.visible === undefined || o.visible === e.visible;
        if (indexOk && visibleOk) inEffect++;
      }
    }
    out.cloneEdits = { total: this.edits.length, inEffect };
    return out;
  }

  dispose(): void {
    // the village clone gets its own geometry back (its old cards show again)
    this.detach();
    this.edits.length = 0;
    for (const r of this.own) r.dispose();
    this.own.length = 0;
  }
}

/** Build the vegetation for a dressed village clone (in steps), or null in the `old` mode or when cancelled. */
export function createVegetation(root: Object3D, tier: VillageTier, mode: VegMode, cancelled?: () => boolean, options?: BuildOptions): Promise<VillageVegetation | null> {
  if (mode === "old") return Promise.resolve(null);
  return VillageVegetation.build(root, tier, mode, cancelled, options);
}

/** The vegetation kept while the player is indoors (vegPark.ts): VillageModel parks and takes it, VillageScene holds it. */
export const vegetationPark = createVegPark<VillageVegetation>();
