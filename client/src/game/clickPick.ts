import { Box3, BufferAttribute, BufferGeometry, Matrix3, Matrix4, Mesh, Ray, Sphere, Vector2, Vector3 } from "three";
import type { Camera, InstancedMesh, Intersection, Material, Object3D, Raycaster, SkinnedMesh, Texture } from "three";
import type { Bounds } from "@caysonverse/shared/school/geometry";
import { MAX_PUSH, RAISED_MAX_Y, WALKABLE_MAX_Y, WALKABLE_MIN_NY, type RingView, type SurfacePoint } from "./clickPlan";
import { RING_INNER, RING_OUTER, ringDepthBias } from "./clickRing";

/**
 * What a click lands on: the first VISIBLE surface along the click ray (owner 2026-11-10 — the old target was the ray's
 * hit on the plane y = 0, which lies behind or under whatever was really clicked). One raycast per click, on release,
 * never per frame. clickPlan.ts then decides whether that surface takes a walk.
 *
 * The scene is walked by hand (not `intersectObjects`) so a hidden subtree is skipped whole and each hit knows what it
 * belongs to:
 *  - `userData.clickPick = "ignore"` drops a subtree (the destination ring itself; the player's own avatar — a click on
 *    it is a click on what lies behind it, as before this pick: round 4 review, the phone's camera right behind the
 *    head in the memorial hall left the lower half of the screen dead; the ring there is drawn through the body,
 *    ClickMarker's see-through pass);
 *  - `userData.clickPick = "block"` marks one whose surfaces are never ground (the other avatars and the NPCs: a click
 *    on a body is no walk, not a walk to the floor behind it);
 *  - what draws nothing solid is see-through: sprites, points and lines (name tags, bubbles, stars), colliders
 *    (`col__*`), shadow catchers, and materials that write no depth while blending (blob shadows, the ground decals,
 *    the plot markers, the door pads, water, light shafts) — the click goes on to what is under them; so are leaves
 *    nearer the camera than their fade (`NEAR_FADE_KEY`, in view depth as the shader fades them: along the camera's
 *    axis, not along the ray — round 3 review), and every texel an alpha-tested material cuts away (the
 *    gaps between a leaf card's leaves: three's raycast ignores the texture, round 2 review — a click on the lawn seen
 *    between a crown's leaves was refused as "a leaf").
 *
 * Cost (round 2 review: 20-80 ms a click, 4x that on a mid phone): meshes are tried nearest box first and none whose
 * box starts past the best hit; a large mesh (the village's ground and leaf chunks, 10-34 thousand triangles, whose
 * boxes hold the camera) by the cells of a grid over it, nearest first, so a click tests the few hundred triangles
 * along the ray, not all of them (built once per geometry, ahead of the first click by warmPick); a body skinned as
 * drawn on flat arrays, each bone's matrix made once (three's own skinned raycast makes four matrix products a vertex:
 * 22 ms an avatar), and only when the ray enters its box before the best hit; the instances
 * of an instanced mesh one by one, each skipped by its bounding sphere; and given the player's area, the ray ends where
 * it leaves the area (nothing past it can be a destination) and what lies wholly outside the area is only looked at
 * in front of it (the backdrop's hills, the forest cards on them).
 */

/** The `userData` key of the tags above. */
export const CLICK_PICK_KEY = "clickPick";
export type ClickPickTag = "ignore" | "block";

/**
 * A material's `userData` key: the view depth (m) under which it is faded out around the camera (the village's
 * foliage). A hit on it nearer than that is skipped like a see-through one.
 */
export const NEAR_FADE_KEY = "nearFade";

/** `userData` of a body's root group (the remote avatars, the NPCs): its surfaces are never ground. */
export const PICK_AS_BODY: Record<string, ClickPickTag> = { [CLICK_PICK_KEY]: "block" };

/** `userData` of the local avatar's root group: looked through (see above). */
export const PICK_AS_SELF: Record<string, ClickPickTag> = { [CLICK_PICK_KEY]: "ignore" };

/** The first surface under a click: where, how upright, and whether it belongs to a body. */
export interface ScenePick extends SurfacePoint {
  /** The camera-facing world normal's x and z (with `ny`; 0 for a body). */
  nx: number;
  nz: number;
  /** Distance from the ray's origin (m). */
  distance: number;
  /** Part of a subtree tagged "block" (an avatar, an NPC). */
  blocker: boolean;
  /** Name of the mesh hit (dev hook / tests). */
  name: string;
}

export interface PickOptions {
  /** Pass through bodies (the column ray under a moved destination). */
  skipBlockers?: boolean;
  /**
   * The area the player is in (activeBounds): only ground inside it (or within MAX_PUSH of its edge, which a plan may
   * still push in) can be walked to, so the ray ends where it leaves that, and a mesh wholly outside it only matters in
   * front of where the ray enters it. A ray that never comes near it picks nothing.
   */
  area?: Bounds | null;
}

/** A material that draws nothing a click could stand on (see the file header). */
export function isSeeThrough(material: Material | undefined | null): boolean {
  if (!material || material.visible === false || material.colorWrite === false) return true;
  if ((material as { isShadowMaterial?: boolean }).isShadowMaterial) return true;
  return material.transparent && !material.depthWrite;
}

// ───────────────────────────── the texels an alpha test cuts away ─────────────────────────────

/** A texture's texels as read once (RGBA, row 0 = the texture's v = 0 once `transformUv` has mapped the uv). */
interface Texels {
  w: number;
  h: number;
  data: ArrayLike<number>;
  /** 255 for bytes, 1 for floats. */
  unit: number;
}

/** Texels read per texture, at most this many a side (a 1024 px leaf atlas is read at 512: 256 KB, a few ms, once). */
const MAX_TEXELS = 512;
const texelCache = new WeakMap<Texture, Texels | null>();
const uvScratch = new Vector2();

type Readable = { width?: number; height?: number; data?: ArrayLike<number> };

function readTexels(image: unknown): Texels | null {
  const img = image as Readable | null;
  if (!img || !(img.width! > 0) || !(img.height! > 0)) return null;
  const W = img.width!;
  const H = img.height!;
  if (img.data) {
    // a DataTexture: RGBA rows as given
    if (img.data.length < W * H * 4) return null;
    return { w: W, h: H, data: img.data, unit: img.data instanceof Float32Array ? 1 : 255 };
  }
  const w = Math.min(W, MAX_TEXELS);
  const h = Math.min(H, MAX_TEXELS);
  let canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  if (typeof OffscreenCanvas !== "undefined") canvas = new OffscreenCanvas(w, h);
  else if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas?.getContext("2d", { willReadFrequently: true }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null
    | undefined;
  if (!ctx) return null;
  ctx.drawImage(image as CanvasImageSource, 0, 0, w, h);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data, unit: 255 };
}

/** One channel (0-3) of `tex` at `uv`, 0..1 — null when its image cannot be read (compressed, cross-origin). */
function texelAt(tex: Texture, uv: Vector2, channel: number): number | null {
  let t = texelCache.get(tex);
  if (t === undefined) {
    try {
      t = readTexels(tex.image);
    } catch {
      t = null;
    }
    texelCache.set(tex, t);
  }
  if (!t) return null;
  uvScratch.copy(uv);
  if (tex.matrixAutoUpdate) tex.updateMatrix();
  tex.transformUv(uvScratch); // the texture's offset / repeat / wrap / flipY, as the GPU samples it
  const x = Math.min(t.w - 1, Math.max(0, Math.floor(uvScratch.x * t.w)));
  const y = Math.min(t.h - 1, Math.max(0, Math.floor(uvScratch.y * t.h)));
  return t.data[(y * t.w + x) * 4 + channel] / t.unit;
}

type Maps = { map?: Texture | null; alphaMap?: Texture | null; alphaTest?: number; opacity?: number };

/**
 * Whether the hit lands on a texel its material's alpha test discards: `opacity × map.a × alphaMap.g < alphaTest`, as
 * the fragment shader computes it. A material without an alpha test is drawn whole; a hit without the uv (or a texture
 * that cannot be read) is kept.
 */
export function isCutAway(hit: Intersection, material: Material | undefined | null): boolean {
  const m = material as (Material & Maps) | undefined | null;
  const test = m?.alphaTest ?? 0;
  if (!m || !(test > 0)) return false;
  let a = m.opacity ?? 1;
  for (const [tex, channel] of [
    [m.map, 3],
    [m.alphaMap, 1],
  ] as const) {
    if (!tex) continue;
    const uv = tex.channel === 1 ? hit.uv1 : hit.uv;
    if (!uv) return false;
    const v = texelAt(tex, uv, channel);
    if (v !== null) a *= v;
  }
  return a < test;
}

// ───────────────────────────── bodies: skinned as drawn, quickly ─────────────────────────────

/**
 * Per skinned mesh, measured once: each vertex in bind space (`bindMatrix · position`) with its four bones and
 * weights, the triangles' corners, and room for one pick's bone matrices and skinned vertices.
 */
interface BodyProxy {
  geometry: unknown;
  bindPos: Float32Array;
  skinIdx: Uint32Array;
  skinW: Float32Array;
  corners: Uint32Array;
  boneMat: Float32Array;
  skinned: Float32Array;
}
const bodyCache = new WeakMap<SkinnedMesh, BodyProxy>();
const vtx = new Vector3();

function bodyProxy(mesh: SkinnedMesh): BodyProxy {
  const cached = bodyCache.get(mesh);
  if (cached && cached.geometry === mesh.geometry) return cached;
  const pos = mesh.geometry.attributes.position;
  const skinIndex = mesh.geometry.attributes.skinIndex;
  const weight = mesh.geometry.attributes.skinWeight;
  const index = mesh.geometry.index;
  const count = pos ? pos.count : 0;
  const bindPos = new Float32Array(count * 3);
  const skinIdx = new Uint32Array(count * 4);
  const skinW = new Float32Array(count * 4);
  for (let v = 0; v < count; v++) {
    vtx.fromBufferAttribute(pos, v).applyMatrix4(mesh.bindMatrix);
    vtx.toArray(bindPos, 3 * v);
    for (let k = 0; k < 4; k++) {
      skinIdx[4 * v + k] = skinIndex ? skinIndex.getComponent(v, k) : 0;
      skinW[4 * v + k] = weight ? weight.getComponent(v, k) : k === 0 ? 1 : 0;
    }
  }
  const n = Math.floor((index ? index.count : count) / 3) * 3;
  const corners = new Uint32Array(n);
  for (let i = 0; i < n; i++) corners[i] = index ? index.getX(i) : i;
  const proxy: BodyProxy = {
    geometry: mesh.geometry,
    bindPos,
    skinIdx,
    skinW,
    corners,
    boneMat: new Float32Array(mesh.skeleton.bones.length * 16),
    skinned: new Float32Array(count * 3),
  };
  bodyCache.set(mesh, proxy);
  return proxy;
}

const base = new Matrix4();
const skinMat = new Matrix4();

/**
 * Where the ray first meets a skinned mesh as posed now (either face). Every vertex is skinned as three draws it —
 * `Σ weight · matrixWorld · bindMatrixInverse · bone.matrixWorld · boneInverse · bindMatrix · position`, each bone's
 * matrix made once — and every triangle tested on flat arrays: about a millisecond an avatar, where three's own
 * skinned raycast (four matrix products a vertex, objects a triangle) took 22 ms. Morph targets are left out (a face's
 * small expression shapes). The caller keeps only bodies whose grown box the ray enters before the best hit.
 */
function raycastBody(mesh: SkinnedMesh, raycaster: Raycaster, limit: number): { distance: number; point: Vector3 } | null {
  const proxy = bodyProxy(mesh);
  const { bones, boneInverses } = mesh.skeleton;
  base.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
  const m = proxy.boneMat;
  for (let b = 0; b < bones.length; b++) {
    if (bones[b] && boneInverses[b]) skinMat.multiplyMatrices(base, bones[b].matrixWorld).multiply(boneInverses[b]);
    else skinMat.copy(mesh.matrixWorld);
    skinMat.toArray(m, 16 * b);
  }
  const { bindPos, skinIdx, skinW, skinned, corners } = proxy;
  const count = bindPos.length / 3;
  for (let v = 0; v < count; v++) {
    const px = bindPos[3 * v];
    const py = bindPos[3 * v + 1];
    const pz = bindPos[3 * v + 2];
    let x = 0;
    let y = 0;
    let z = 0;
    for (let k = 4 * v; k < 4 * v + 4; k++) {
      const w = skinW[k];
      if (w === 0) continue;
      const o = 16 * skinIdx[k];
      x += w * (m[o] * px + m[o + 4] * py + m[o + 8] * pz + m[o + 12]);
      y += w * (m[o + 1] * px + m[o + 5] * py + m[o + 9] * pz + m[o + 13]);
      z += w * (m[o + 2] * px + m[o + 6] * py + m[o + 10] * pz + m[o + 14]);
    }
    skinned[3 * v] = x;
    skinned[3 * v + 1] = y;
    skinned[3 * v + 2] = z;
  }
  // Möller–Trumbore on every triangle (the ray's direction is a unit vector: t is the distance)
  const { x: ox, y: oy, z: oz } = raycaster.ray.origin;
  const { x: dx, y: dy, z: dz } = raycaster.ray.direction;
  let best = limit;
  for (let i = 0; i < corners.length; i += 3) {
    const a = 3 * corners[i];
    const b = 3 * corners[i + 1];
    const c = 3 * corners[i + 2];
    const ax = skinned[a];
    const ay = skinned[a + 1];
    const az = skinned[a + 2];
    const e1x = skinned[b] - ax;
    const e1y = skinned[b + 1] - ay;
    const e1z = skinned[b + 2] - az;
    const e2x = skinned[c] - ax;
    const e2y = skinned[c + 1] - ay;
    const e2z = skinned[c + 2] - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-12 && det < 1e-12) continue;
    const inv = 1 / det;
    const sx = ox - ax;
    const sy = oy - ay;
    const sz = oz - az;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const w = (dx * qx + dy * qy + dz * qz) * inv;
    if (w < 0 || u + w > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t >= raycaster.near && t < best) best = t;
  }
  if (!(best < limit)) return null;
  point.set(ox + dx * best, oy + dy * best, oz + dz * best);
  return { distance: best, point };
}
const point = new Vector3();

// ───────────────────────────── large meshes: a grid of cells ─────────────────────────────

/** A mesh with at least this many triangles is raycast cell by cell. */
const CELL_MIN_TRIANGLES = 2000;
/** About this many triangles to a cell. */
const CELL_TRIANGLES = 256;

/** One cell: its triangles as a geometry sharing the mesh's attributes (three's raycast then does the rest), and its box. */
interface Cell {
  geometry: BufferGeometry;
  box: Box3;
}

const cellCache = new WeakMap<BufferGeometry, Cell[] | null>();

/**
 * A large geometry split into a grid of cells over its box (x and z), each triangle in the cell of its centroid, each
 * cell's box the exact box of its triangles (so a triangle across two cells is still inside its own cell's box). A
 * geometry with groups (several materials) keeps them per cell. Null for a small geometry or one with morph targets.
 */
function cellsOf(geometry: BufferGeometry): Cell[] | null {
  const cached = cellCache.get(geometry);
  if (cached !== undefined) return cached;
  let cells: Cell[] | null = null;
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const tris = pos ? Math.floor((index ? index.count : pos.count) / 3) : 0;
  if (pos && tris >= CELL_MIN_TRIANGLES && Object.keys(geometry.morphAttributes).length === 0) {
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const g = Math.min(32, Math.max(2, Math.ceil(Math.sqrt(tris / CELL_TRIANGLES))));
    const sx = Math.max(bb.max.x - bb.min.x, 1e-6);
    const sz = Math.max(bb.max.z - bb.min.z, 1e-6);
    const vertex = (t: number, k: number) => (index ? index.getX(3 * t + k) : 3 * t + k);
    // each triangle's material (its group's)
    const material = new Uint16Array(tris);
    for (const group of geometry.groups) {
      const end = Math.min(tris, Math.floor((group.start + group.count) / 3));
      for (let t = Math.floor(group.start / 3); t < end; t++) material[t] = group.materialIndex ?? 0;
    }
    const members: number[][] = Array.from({ length: g * g }, () => []);
    for (let t = 0; t < tris; t++) {
      let cx = 0;
      let cz = 0;
      for (let k = 0; k < 3; k++) {
        const v = vertex(t, k);
        cx += pos.getX(v);
        cz += pos.getZ(v);
      }
      const i = Math.min(g - 1, Math.max(0, Math.floor(((cx / 3 - bb.min.x) / sx) * g)));
      const j = Math.min(g - 1, Math.max(0, Math.floor(((cz / 3 - bb.min.z) / sz) * g)));
      members[j * g + i].push(t);
    }
    cells = [];
    for (const list of members) {
      if (list.length === 0) continue;
      if (geometry.groups.length > 0) list.sort((a, b) => material[a] - material[b]);
      const idx = new Uint32Array(list.length * 3);
      const cellBox = new Box3();
      const groups: Array<{ start: number; count: number; materialIndex: number }> = [];
      list.forEach((t, n) => {
        for (let k = 0; k < 3; k++) {
          const v = vertex(t, k);
          idx[3 * n + k] = v;
          cellBox.expandByPoint(vtx.fromBufferAttribute(pos, v));
        }
        const last = groups[groups.length - 1];
        if (last && last.materialIndex === material[t]) last.count += 3;
        else groups.push({ start: 3 * n, count: 3, materialIndex: material[t] });
      });
      const cell = new BufferGeometry();
      for (const name of Object.keys(geometry.attributes)) cell.setAttribute(name, geometry.attributes[name]);
      cell.setIndex(new BufferAttribute(idx, 1));
      if (geometry.groups.length > 0) for (const gr of groups) cell.addGroup(gr.start, gr.count, gr.materialIndex);
      cell.boundingBox = cellBox;
      cell.boundingSphere = cellBox.getBoundingSphere(new Sphere());
      cells.push({ geometry: cell, box: cellBox });
    }
  }
  cellCache.set(geometry, cells);
  return cells;
}

const cellMesh = new Mesh();
const meshInverse = new Matrix4();
const cellRay = new Ray();
const cellEntry = new Vector3();
const cellBoxWorld = new Box3();
const cellOrder: Array<{ cell: Cell; at: number }> = [];

/** A large mesh, cell by cell along the ray: nearest cell first, none past the best hit, the limit or (outside the area) its entry. */
function raycastCells(mesh: Mesh, cells: Cell[], raycaster: Raycaster, limit: number, blocker: boolean, span: Span | null): void {
  meshInverse.copy(mesh.matrixWorld).invert();
  cellRay.copy(raycaster.ray).applyMatrix4(meshInverse);
  // world metres per local unit along the ray (Ray.applyMatrix4 hands the local direction back normalised)
  const e = mesh.matrixWorld.elements;
  const d = cellRay.direction;
  const perUnit = Math.hypot(e[0] * d.x + e[4] * d.y + e[8] * d.z, e[1] * d.x + e[5] * d.y + e[9] * d.z, e[2] * d.x + e[6] * d.y + e[10] * d.z);
  cellOrder.length = 0;
  for (const cell of cells) {
    if (!cellRay.intersectBox(cell.box, cellEntry)) continue;
    const at = cellEntry.distanceTo(cellRay.origin) * perUnit;
    if (at > limit || at >= best.distance) continue;
    if (span) {
      cellBoxWorld.copy(cell.box).applyMatrix4(mesh.matrixWorld);
      if (outsideSpan(cellBoxWorld, span) && at >= span.enter) continue;
    }
    cellOrder.push({ cell, at });
  }
  cellOrder.sort((a, b) => a.at - b.at);
  cellMesh.material = mesh.material;
  cellMesh.matrixWorld.copy(mesh.matrixWorld);
  for (const { cell, at } of cellOrder) {
    if (at >= best.distance) break;
    cellMesh.geometry = cell.geometry;
    hits.length = 0;
    cellMesh.raycast(raycaster, hits);
    for (const hit of hits) {
      hit.object = mesh;
      consider(hit, limit, blocker);
    }
  }
}

/**
 * Prepare the pick ahead of the first click, a little at a time (CameraRig calls it while the page is idle): the cells
 * of the scene's large meshes and the texels of its alpha-tested maps. Returns true when nothing was left to do.
 */
export function warmPick(root: Object3D, budgetMs = 6): boolean {
  const t0 = performance.now();
  let done = true;
  let worked = false; // at least one thing a call, whatever the budget
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const skinned = o as unknown as SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      // a body's bone boxes and triangle lists (an avatar that joins later is met by a later call)
      if (bodyCache.get(skinned)?.geometry === skinned.geometry) return;
      if (worked && performance.now() - t0 > budgetMs) {
        done = false;
        return;
      }
      worked = true;
      bodyProxy(skinned);
      return;
    }
    const cellsPending = !(o as unknown as InstancedMesh).isInstancedMesh && !!mesh.geometry && !cellCache.has(mesh.geometry);
    const textures: Texture[] = [];
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mm = m as (Material & Maps) | undefined;
      if (!mm || !((mm.alphaTest ?? 0) > 0)) continue;
      for (const tex of [mm.map, mm.alphaMap]) if (tex && !texelCache.has(tex)) textures.push(tex);
    }
    if (!cellsPending && textures.length === 0) return;
    if (worked && performance.now() - t0 > budgetMs) {
      done = false;
      return;
    }
    worked = true;
    if (cellsPending) cellsOf(mesh.geometry);
    for (const tex of textures) texelAt(tex, uvScratch.set(0, 0), 3);
  });
  return done;
}

// ───────────────────────────── the walk over the scene ─────────────────────────────

/** A mesh the ray may hit: where the ray enters its world box, the farthest a hit on it can matter, and whether it is a body's. */
interface Candidate {
  mesh: Mesh;
  entry: number;
  far: number;
  blocker: boolean;
  /** An instanced mesh's instances that can matter (ringView's, near its sight lines); all of them when absent. */
  instances?: readonly number[];
}

const box = new Box3();
const entryPoint = new Vector3();

/** The mesh's box in its own space (an instanced mesh's covers every instance), measured once and cached by three. */
function localBox(mesh: Mesh): Box3 | null {
  const inst = mesh as unknown as InstancedMesh;
  if (inst.isInstancedMesh) {
    if (inst.boundingBox === null) inst.computeBoundingBox();
    return inst.boundingBox;
  }
  const geometry = mesh.geometry;
  if (!geometry) return null;
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  return geometry.boundingBox;
}

/** The part of the ray inside the area grown by MAX_PUSH: [enter, leave] (m along the ray), or null if it never is. */
interface Span {
  enter: number;
  leave: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function areaSpan(ray: Ray, area: Bounds): Span | null {
  const minX = area.minX - MAX_PUSH;
  const maxX = area.maxX + MAX_PUSH;
  const minZ = area.minZ - MAX_PUSH;
  const maxZ = area.maxZ + MAX_PUSH;
  let enter = 0;
  let leave = Infinity;
  const axes: Array<[number, number, number, number]> = [
    [ray.origin.x, ray.direction.x, minX, maxX],
    [ray.origin.z, ray.direction.z, minZ, maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    enter = Math.max(enter, a);
    leave = Math.min(leave, b);
    if (enter > leave) return null;
  }
  return { enter, leave, minX, maxX, minZ, maxZ };
}

function outsideSpan(b: Box3, s: Span): boolean {
  return b.max.x < s.minX || b.min.x > s.maxX || b.max.z < s.minZ || b.min.z > s.maxZ;
}

function collect(o: Object3D, ray: Raycaster, span: Span | null, out: Candidate[], blocker: boolean): void {
  if (!o.visible) return;
  const tag = o.userData?.[CLICK_PICK_KEY] as ClickPickTag | undefined;
  if (tag === "ignore") return;
  const block = blocker || tag === "block";
  if ((o as { isMesh?: boolean }).isMesh && o.layers.test(ray.layers) && !o.name.startsWith("col__") && !drawsNothing(o as Mesh)) {
    const local = localBox(o as Mesh);
    if (local && !local.isEmpty()) {
      box.copy(local).applyMatrix4(o.matrixWorld);
      if ((o as unknown as SkinnedMesh).isSkinnedMesh) box.expandByScalar(SKINNED_SLACK);
      // Where the ray enters the box (0 when it starts inside); a ray that misses the box misses the mesh.
      let at = 0;
      if (!box.containsPoint(ray.ray.origin)) at = ray.ray.intersectBox(box, entryPoint) ? entryPoint.distanceTo(ray.ray.origin) : Infinity;
      // A mesh wholly outside the area is met only before the ray enters it or after it has left (nothing walkable there).
      const far = span ? (outsideSpan(box, span) ? span.enter : span.leave) : ray.far;
      if (at <= Math.min(far, ray.far)) out.push({ mesh: o as Mesh, entry: at, far: Math.min(far, ray.far), blocker: block });
    }
  }
  for (const child of o.children) collect(child, ray, span, out, block);
}
/** Every material of the mesh is see-through (water, a decal, a shadow catcher): no hit on it can count — not raycast. */
function drawsNothing(mesh: Mesh): boolean {
  const m = mesh.material;
  return Array.isArray(m) ? m.every(isSeeThrough) : isSeeThrough(m);
}

/** A skinned mesh's geometry box is its bind pose: grown by this much (m) for the limbs that move since. */
const SKINNED_SLACK = 0.6;

function materialOf(hit: Intersection): Material | undefined {
  const m = (hit.object as { material?: Material | Material[] }).material;
  if (!Array.isArray(m)) return m;
  return m[hit.face?.materialIndex ?? 0] ?? m[0];
}

const m4 = new Matrix4();
const instance = new Matrix4();
const normalMatrix = new Matrix3();
const normal = new Vector3();

/** The hit's world normal, turned toward the ray's origin (the side the camera sees): module scratch, read at once. */
function upright(hit: Intersection, dir: Vector3): Vector3 {
  if (!hit.face) return normal.set(0, 0, 0);
  m4.copy(hit.object.matrixWorld);
  const inst = hit.object as { isInstancedMesh?: boolean; getMatrixAt?: (i: number, m: Matrix4) => void };
  if (inst.isInstancedMesh && hit.instanceId !== undefined && inst.getMatrixAt) {
    inst.getMatrixAt(hit.instanceId, instance);
    m4.multiply(instance);
  }
  normalMatrix.getNormalMatrix(m4);
  normal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();
  if (normal.dot(dir) > 0) normal.negate();
  return normal;
}

/**
 * The camera a search is made for (`raycaster.camera`): where it is and which way it looks, so a faded leaf is judged
 * by its view depth — `1 / gl_FragCoord.w` in the shader (villageModelPrep.ts), the distance along the camera's axis.
 * Toward the screen's edges a ray is longer than that depth (round 3 review: a leaf 1.4 m deep, 83 % dithered away,
 * lay 1.82 m along the ray and was taken as solid). Without a camera, the ray's length stands in for it.
 */
const view = { on: false, px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: -1 };
function setView(camera: Camera | null | undefined): void {
  if (!camera?.matrixWorld) {
    view.on = false;
    return;
  }
  const e = camera.matrixWorld.elements;
  const len = Math.hypot(e[8], e[9], e[10]) || 1;
  view.on = true;
  view.px = e[12];
  view.py = e[13];
  view.pz = e[14];
  view.fx = -e[8] / len;
  view.fy = -e[9] / len;
  view.fz = -e[10] / len;
}
function viewDepth(hit: Intersection): number {
  if (!view.on) return hit.distance;
  const p = hit.point;
  return (p.x - view.px) * view.fx + (p.y - view.py) * view.fy + (p.z - view.pz) * view.fz;
}

/** The best hit of one pickSurface call (module scratch: a click is one call at a time, never re-entered). */
const best = { hit: null as Intersection | null, distance: Infinity, blocker: false };
const hits: Intersection[] = [];

/** Keep `hit` if it is nearer than the best so far and drawn there (not see-through, not cut away, not faded out). */
function consider(hit: Intersection, limit: number, blocker: boolean): void {
  if (hit.distance >= best.distance || hit.distance > limit) return;
  const material = materialOf(hit);
  if (isSeeThrough(material)) return;
  // Leaves fading out near the camera (villageModelPrep.ts FOLIAGE_NEAR_FADE) are not there to click.
  const fade = material?.userData?.[NEAR_FADE_KEY];
  if (typeof fade === "number" && viewDepth(hit) < fade) return;
  if (isCutAway(hit, material)) return;
  best.hit = hit;
  best.distance = hit.distance;
  best.blocker = blocker;
}

const instanceMesh = new Mesh();
const sphere = new Sphere();
const toCentre = new Vector3();

/** An instanced mesh, instance by instance: each one's bounding sphere first, none that starts past `limit` or the best hit. */
function raycastInstances(inst: InstancedMesh, raycaster: Raycaster, limit: number, blocker: boolean, only?: readonly number[]): void {
  const geometry = inst.geometry;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  instanceMesh.geometry = geometry;
  instanceMesh.material = inst.material;
  const ray = raycaster.ray;
  const n = only ? only.length : inst.count;
  for (let k = 0; k < n; k++) {
    const i = only ? only[k] : k;
    inst.getMatrixAt(i, instance);
    instanceMesh.matrixWorld.multiplyMatrices(inst.matrixWorld, instance);
    sphere.copy(geometry.boundingSphere!).applyMatrix4(instanceMesh.matrixWorld);
    // where the ray enters the sphere (0 from inside); past the best hit or the limit, it cannot matter
    const along = toCentre.subVectors(sphere.center, ray.origin).dot(ray.direction);
    const off2 = toCentre.lengthSq() - along * along;
    const r2 = sphere.radius * sphere.radius;
    if (off2 > r2) continue;
    const enter = Math.max(0, along - Math.sqrt(r2 - off2));
    if (enter > limit || enter >= best.distance || along + sphere.radius < raycaster.near) continue;
    hits.length = 0;
    instanceMesh.raycast(raycaster, hits);
    for (const hit of hits) {
      hit.instanceId = i;
      hit.object = inst;
      consider(hit, limit, blocker);
    }
  }
}

/**
 * The first visible surface along `raycaster`'s ray among `root`'s descendants (null: nothing — the sky, or past the
 * area). The caller sets the ray, its near/far (the camera's near plane: what is nearer is not drawn) and
 * `raycaster.camera`.
 */
export function pickSurface(raycaster: Raycaster, root: Object3D, options: PickOptions = {}): ScenePick | null {
  const span = options.area ? areaSpan(raycaster.ray, options.area) : null;
  if (options.area && !span) return null;
  const candidates: Candidate[] = [];
  collect(root, raycaster, span, candidates, false);
  return search(raycaster, candidates, span, options);
}

/** The nearest drawn surface among `candidates` (meshes whose box the ray enters, with where it enters them). */
function search(raycaster: Raycaster, candidates: Candidate[], span: Span | null, options: PickOptions): ScenePick | null {
  candidates.sort((a, b) => a.entry - b.entry);
  setView(raycaster.camera);
  best.hit = null;
  best.distance = Infinity;
  best.blocker = false;
  let body: { distance: number; point: Vector3; name: string } | null = null;
  for (const c of candidates) {
    if (c.entry > best.distance || (body && c.entry > body.distance)) break;
    if (c.blocker && options.skipBlockers) continue;
    const skinned = c.mesh as unknown as SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      if (isSeeThrough(materialOf({ object: c.mesh } as unknown as Intersection))) continue;
      const hit = raycastBody(skinned, raycaster, Math.min(c.far, best.distance, body?.distance ?? Infinity));
      if (hit) body = { distance: hit.distance, point: point.clone(), name: c.mesh.name || c.mesh.type };
      continue;
    }
    if ((c.mesh as unknown as InstancedMesh).isInstancedMesh) {
      raycastInstances(c.mesh as unknown as InstancedMesh, raycaster, c.far, c.blocker, c.instances);
      continue;
    }
    const cells = c.mesh.geometry ? cellsOf(c.mesh.geometry) : null;
    if (cells) {
      raycastCells(c.mesh, cells, raycaster, c.far, c.blocker, span);
      continue;
    }
    hits.length = 0;
    c.mesh.raycast(raycaster, hits);
    for (const hit of hits) consider(hit, c.far, c.blocker);
  }
  if (body && body.distance < best.distance) {
    return { x: body.point.x, y: body.point.y, z: body.point.z, nx: 0, ny: 0, nz: 0, distance: body.distance, blocker: true, name: body.name };
  }
  const hit = best.hit as Intersection | null; // set by consider() (TS narrows the reset above to null)
  if (!hit) return null;
  const n = upright(hit, raycaster.ray.direction);
  return {
    x: hit.point.x,
    y: hit.point.y,
    z: hit.point.z,
    nx: n.x,
    ny: n.y,
    nz: n.z,
    distance: hit.distance,
    blocker: best.blocker,
    name: hit.object.name || hit.object.type,
  };
}

/** A pick as clickPlan.ts reads it: a body is nothing to walk to (no walk, no ring), like the sky. */
export function asSurface(pick: ScenePick | null): SurfacePoint | null {
  if (!pick || pick.blocker) return null;
  return pick;
}

const DOWN = new Vector3(0, -1, 0);
const origin = new Vector3();
/** Where the downward ray starts (m): above the memorial's top step (0.45), below the crowns and the eaves. */
const COLUMN_TOP = 0.5;

/**
 * The ground's height at (x, z) — for a destination that moved off the click (out of a collider's margin, or to where
 * the walk stops) so its ring still lies on the surface there: the first surface down from COLUMN_TOP that faces up
 * and is no higher than a step (a bench seat's edge over it is passed). `fallback` when there is none.
 */
export function surfaceHeightAt(raycaster: Raycaster, root: Object3D, x: number, z: number, fallback: number): number {
  const { near, far } = raycaster;
  let top = COLUMN_TOP;
  let found = fallback;
  for (let k = 0; k < 4; k++) {
    raycaster.set(origin.set(x, top, z), DOWN);
    raycaster.near = 0;
    raycaster.far = top + 2;
    const pick = pickSurface(raycaster, root, { skipBlockers: true });
    if (!pick) break;
    if (pick.ny >= WALKABLE_MIN_NY && pick.y <= RAISED_MAX_Y) {
      found = pick.y;
      break;
    }
    top = pick.y - 0.001; // under what was met (a seat's edge, a leaf): look on below it
  }
  raycaster.near = near;
  raycaster.far = far;
  return found;
}

// ───────────────────────────── a face's height, a ring's view ─────────────────────────────

/** Where the level probe of faceIsTall starts in front of the face, and how far past it it looks (m). */
const FACE_PROBE_BACK = 0.1;
const FACE_PROBE_IN = 0.1;
const probeDir = new Vector3();

/** The caller's ray, saved while a helper casts its own (and given back after). */
const keep = { origin: new Vector3(), direction: new Vector3(), near: 0, far: Infinity, camera: null as Camera | null };
function saveRay(r: Raycaster): void {
  keep.origin.copy(r.ray.origin);
  keep.direction.copy(r.ray.direction);
  keep.near = r.near;
  keep.far = r.far;
  keep.camera = r.camera ?? null;
}
function restoreRay(r: Raycaster): void {
  r.ray.origin.copy(keep.origin);
  r.ray.direction.copy(keep.direction);
  r.near = keep.near;
  r.far = keep.far;
  (r as { camera: Camera | null }).camera = keep.camera;
}

/**
 * Whether an upright face clicked low goes on up past `above` (WALKABLE_MAX_Y): a level ray just above that height,
 * from FACE_PROBE_BACK in front of the face into it, meets something within FACE_PROBE_IN past it. A curb's side (11 cm)
 * does not — the probe passes over its top; a step's riser (30 cm), a planter's or a wall's side does (round 3 review:
 * the ring put on the memorial step's riser had its far half inside the step).
 */
export function faceIsTall(raycaster: Raycaster, root: Object3D, pick: ScenePick, above = WALKABLE_MAX_Y): boolean {
  const len = Math.hypot(pick.nx, pick.nz);
  if (len < 1e-6) return false;
  probeDir.set(-pick.nx / len, 0, -pick.nz / len); // into the face
  saveRay(raycaster);
  raycaster.ray.origin.set(pick.x - probeDir.x * FACE_PROBE_BACK, above + 0.01, pick.z - probeDir.z * FACE_PROBE_BACK);
  raycaster.ray.direction.copy(probeDir);
  raycaster.near = 0;
  raycaster.far = FACE_PROBE_BACK + FACE_PROBE_IN;
  const hit = pickSurface(raycaster, root, { skipBlockers: true });
  restoreRay(raycaster);
  return hit !== null;
}

/** A mesh near a ring's sight lines, its world box measured once for all of them (and an instanced one's instances there). */
interface Near {
  mesh: Mesh;
  box: Box3;
  instances?: number[];
}

/**
 * The meshes (bodies left out) whose world box meets `within` — one walk over the scene for all of a ring's rays — and
 * of an instanced mesh only the instances whose sphere does (the backdrop's 7,000 forest cards ring the whole village:
 * every ray went through all of them).
 */
function gather(o: Object3D, raycaster: Raycaster, within: Box3, out: Near[]): void {
  if (!o.visible) return;
  const tag = o.userData?.[CLICK_PICK_KEY] as ClickPickTag | undefined;
  if (tag === "ignore" || tag === "block") return; // a body moves off a ring; the ring itself is no cover
  const mesh = o as Mesh;
  if (mesh.isMesh && o.layers.test(raycaster.layers) && !o.name.startsWith("col__") && !(o as unknown as SkinnedMesh).isSkinnedMesh && !drawsNothing(mesh)) {
    const local = localBox(mesh);
    if (local && !local.isEmpty()) {
      const b = local.clone().applyMatrix4(o.matrixWorld);
      if (b.intersectsBox(within)) {
        const inst = o as unknown as InstancedMesh;
        if (!inst.isInstancedMesh) out.push({ mesh, box: b });
        else {
          const geometry = inst.geometry;
          if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
          const instances: number[] = [];
          for (let i = 0; i < inst.count; i++) {
            inst.getMatrixAt(i, instance);
            instanceMesh.matrixWorld.multiplyMatrices(inst.matrixWorld, instance);
            sphere.copy(geometry.boundingSphere!).applyMatrix4(instanceMesh.matrixWorld);
            if (within.intersectsSphere(sphere)) instances.push(i);
          }
          if (instances.length > 0) out.push({ mesh, box: b, instances });
        }
      }
    }
  }
  for (const child of o.children) gather(child, raycaster, within, out);
}

/** A ring's sample points: the middle of each of RING_SECTORS sectors of its band, and its dot. */
const RING_SECTORS = 12;
const camPos = new Vector3();
const sample = new Vector3();
const ndc = new Vector3();
const corner = new Vector3();
const sightBox = new Box3();
const quad: Array<[number, number]> = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];

/** The screen area (NDC units) of the quad of world points `pts` on the plane y; null when a corner is behind the camera. */
function screenArea(camera: Camera, pts: ReadonlyArray<readonly [number, number]>, y: number): number | null {
  for (let i = 0; i < 4; i++) {
    corner.set(pts[i][0], y, pts[i][1]).project(camera);
    if (corner.z > 1 || corner.z < -1) return null;
    quad[i][0] = corner.x;
    quad[i][1] = corner.y;
  }
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = quad[i];
    const [x2, y2] = quad[(i + 1) % 4];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/**
 * How a destination ring centred at (x, y, z) — `y` its plane: the surface plus the lift — drawn at `scale` would look
 * from `camera` (rule 4 of clickPlan.ts; round 3 review: walks whose ring nobody saw — under a cherry's crown, off the
 * screen along the creek bank, through a pinhole in a crown). Whether its centre is on the screen, and the share of its
 * on-screen area seen past what stands in front: a ray from the camera to the middle of each sector of its band and to
 * its dot, each weighted by its area on the screen (a far ring is a thin ellipse whose ends hold most of it), each
 * ending where the ring's own depth test does (clickRing.ts ringDepthBias: ground or a curb lower than RING_SEE_OVER in
 * front never covers it). What the pick sees through, the ring is seen through (faded leaves, the gaps of a leaf card,
 * glass, shadows); bodies do not count — they move off it. One walk over the scene for all the rays; the caller's ray
 * is given back as it was.
 *
 * `need` (the share a plan needs): the rays are cast largest sector first and stop once the share is known to be at
 * least `need` or below it — the share returned is then exact only that far. Most clicks are decided in a few rays.
 */
export function ringView(
  raycaster: Raycaster,
  root: Object3D,
  camera: Camera,
  x: number,
  y: number,
  z: number,
  scale: number,
  need?: number,
): RingView {
  ndc.set(x, y, z).project(camera);
  if (!(ndc.z < 1 && ndc.z > -1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1)) return { onScreen: false, seen: 0 };
  // Nothing more is asked (the app's plan, rule 4): no samples, no walk over the scene (round 5 review: the scene walk
  // ran on every click for an answer no one read).
  if (need !== undefined && need <= 0) return { onScreen: true, seen: 0 };
  const near = (camera as { near?: number }).near ?? 0.1;
  camPos.setFromMatrixPosition(camera.matrixWorld);
  const ri = RING_INNER * scale;
  const ro = RING_OUTER * scale;
  const rm = (ri + ro) / 2;
  // the samples: the sectors' middles and the dot, each with its area on the screen (off the screen: not part of it)
  const samples: Array<{ x: number; z: number; w: number }> = [];
  const add = (sx: number, sz: number, area: number | null) => {
    if (area === null) return;
    ndc.set(sx, y, sz).project(camera);
    if (ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) samples.push({ x: sx, z: sz, w: Math.max(area, 1e-9) });
  };
  for (let k = 0; k < RING_SECTORS; k++) {
    const a0 = (k / RING_SECTORS) * Math.PI * 2;
    const a1 = ((k + 1) / RING_SECTORS) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const area = screenArea(
      camera,
      [
        [x + c0 * ri, z + s0 * ri],
        [x + c0 * ro, z + s0 * ro],
        [x + c1 * ro, z + s1 * ro],
        [x + c1 * ri, z + s1 * ri],
      ],
      y,
    );
    add(x + Math.cos(am) * rm, z + Math.sin(am) * rm, area);
  }
  const d = 0.07 * scale;
  add(
    x,
    z,
    screenArea(
      camera,
      [
        [x - d, z - d],
        [x + d, z - d],
        [x + d, z + d],
        [x - d, z + d],
      ],
      y,
    ),
  );
  let total = 0;
  for (const smp of samples) total += smp.w;
  if (!(total > 0)) return { onScreen: true, seen: 0 };
  samples.sort((a, b) => b.w - a.w);

  sightBox.makeEmpty().expandByPoint(camPos);
  sightBox.expandByPoint(sample.set(x - ro, y, z - ro)).expandByPoint(sample.set(x + ro, y, z + ro));
  const nearby: Near[] = [];
  gather(root, raycaster, sightBox, nearby);
  saveRay(raycaster);
  (raycaster as { camera: Camera | null }).camera = camera;
  let seen = 0;
  let left = total;
  for (const smp of samples) {
    if (need !== undefined && (seen >= need * total || seen + left < need * total)) break; // decided
    left -= smp.w;
    sample.set(smp.x, y, smp.z);
    const dist = sample.distanceTo(camPos);
    const far = dist - ringDepthBias(dist, (camPos.y - y) / Math.max(dist, 1e-6), scale, near) - 0.01;
    if (far <= near) {
      seen += smp.w;
      continue;
    }
    raycaster.ray.origin.copy(camPos);
    raycaster.ray.direction.copy(sample).sub(camPos).normalize();
    raycaster.near = near;
    raycaster.far = far;
    const candidates: Candidate[] = [];
    for (const n of nearby) {
      let at = 0;
      if (!n.box.containsPoint(camPos)) at = raycaster.ray.intersectBox(n.box, entryPoint) ? entryPoint.distanceTo(camPos) : Infinity;
      if (at <= far) candidates.push({ mesh: n.mesh, entry: at, far, blocker: false, instances: n.instances });
    }
    if (!search(raycaster, candidates, null, { skipBlockers: true })) seen += smp.w;
  }
  restoreRay(raycaster);
  return { onScreen: true, seen: seen / total };
}
