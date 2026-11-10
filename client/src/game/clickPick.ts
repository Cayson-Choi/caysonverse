import { Box3, Matrix3, Matrix4, Vector3 } from "three";
import type { InstancedMesh, Intersection, Material, Mesh, Object3D, Raycaster, SkinnedMesh } from "three";
import { WALKABLE_MAX_Y, WALKABLE_MIN_NY, type SurfacePoint } from "./clickPlan";

/**
 * What a click lands on: the first VISIBLE surface along the click ray (owner 2026-11-10 — the old target was the ray's
 * hit on the plane y = 0, which lies behind or under whatever was really clicked). One raycast per click, on release,
 * never per frame. clickPlan.ts then decides whether that surface takes a walk.
 *
 * The scene is walked by hand (not `intersectObjects`) so a hidden subtree is skipped whole and each hit knows what it
 * belongs to:
 *  - `userData.clickPick = "ignore"` drops a subtree (the destination ring itself);
 *  - `userData.clickPick = "block"` marks one whose surfaces are never ground (the avatars and the NPCs: a click on
 *    a body is no walk, not a walk to the floor behind it);
 *  - what draws nothing solid is see-through: sprites, points and lines (name tags, bubbles, stars), colliders
 *    (`col__*`), shadow catchers, and materials that write no depth while blending (blob shadows, the ground decals,
 *    the plot markers, the door pads, water, light shafts) — the click goes on to what is under them; so are leaves
 *    nearer the camera than their fade (`NEAR_FADE_KEY`).
 */

/** The `userData` key of the tags above. */
export const CLICK_PICK_KEY = "clickPick";
export type ClickPickTag = "ignore" | "block";

/**
 * A material's `userData` key: the view depth (m) under which it is faded out around the camera (the village's
 * foliage). A hit on it nearer than that is skipped like a see-through one.
 */
export const NEAR_FADE_KEY = "nearFade";

/** `userData` of a body's root group (the local avatar, the remote ones, the NPCs): its surfaces are never ground. */
export const PICK_AS_BODY: Record<string, ClickPickTag> = { [CLICK_PICK_KEY]: "block" };

/** The first surface under a click: where, how upright, and whether it belongs to a body. */
export interface ScenePick extends SurfacePoint {
  /** Distance from the ray's origin (m). */
  distance: number;
  /** Part of a subtree tagged "block" (an avatar, an NPC). */
  blocker: boolean;
  /** Name of the mesh hit (dev hook / tests). */
  name: string;
}

/** A material that draws nothing a click could stand on (see the file header). */
export function isSeeThrough(material: Material | undefined | null): boolean {
  if (!material || material.visible === false || material.colorWrite === false) return true;
  if ((material as { isShadowMaterial?: boolean }).isShadowMaterial) return true;
  return material.transparent && !material.depthWrite;
}

/** A mesh the ray may hit: where the ray enters its world bounding box, and whether it belongs to a body. */
interface Candidate {
  mesh: Object3D;
  entry: number;
  blocker: boolean;
}

const box = new Box3();
const entryPoint = new Vector3();
/** A skinned body's box is its pose when first measured: grown by this much (m) for the limbs that move since. */
const SKINNED_SLACK = 0.3;

/** The mesh's box in its own space (an instanced mesh's covers every instance), measured once and cached by three. */
function localBox(mesh: Mesh): Box3 | null {
  const inst = mesh as unknown as InstancedMesh;
  if (inst.isInstancedMesh) {
    if (inst.boundingBox === null) inst.computeBoundingBox();
    return inst.boundingBox;
  }
  const skinned = mesh as unknown as SkinnedMesh;
  if (skinned.isSkinnedMesh) {
    if (skinned.boundingBox === null) skinned.computeBoundingBox();
    return skinned.boundingBox && box.copy(skinned.boundingBox).expandByScalar(SKINNED_SLACK);
  }
  const geometry = mesh.geometry;
  if (!geometry) return null;
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  return geometry.boundingBox;
}

function collect(o: Object3D, ray: Raycaster, out: Candidate[], blocker: boolean): void {
  if (!o.visible) return;
  const tag = o.userData?.[CLICK_PICK_KEY] as ClickPickTag | undefined;
  if (tag === "ignore") return;
  const block = blocker || tag === "block";
  if ((o as { isMesh?: boolean }).isMesh && o.layers.test(ray.layers) && !o.name.startsWith("col__")) {
    const local = localBox(o as Mesh);
    if (local && !local.isEmpty()) {
      if (local !== box) box.copy(local);
      box.applyMatrix4(o.matrixWorld);
      // Where the ray enters the box (0 when it starts inside); a ray that misses the box misses the mesh.
      let at = 0;
      if (!box.containsPoint(ray.ray.origin)) at = ray.ray.intersectBox(box, entryPoint) ? entryPoint.distanceTo(ray.ray.origin) : Infinity;
      if (at <= ray.far) out.push({ mesh: o, entry: at, blocker: block });
    }
  }
  for (const child of o.children) collect(child, ray, out, block);
}

const scratch: Intersection[] = [];

function materialOf(hit: Intersection): Material | undefined {
  const m = (hit.object as { material?: Material | Material[] }).material;
  if (!Array.isArray(m)) return m;
  return m[hit.face?.materialIndex ?? 0] ?? m[0];
}

const m4 = new Matrix4();
const instance = new Matrix4();
const normalMatrix = new Matrix3();
const normal = new Vector3();

/** The hit's world normal's y, turned toward the ray's origin (the side the camera sees). */
function upright(hit: Intersection, dir: Vector3): number {
  if (!hit.face) return 0;
  m4.copy(hit.object.matrixWorld);
  const inst = hit.object as { isInstancedMesh?: boolean; getMatrixAt?: (i: number, m: Matrix4) => void };
  if (inst.isInstancedMesh && hit.instanceId !== undefined && inst.getMatrixAt) {
    inst.getMatrixAt(hit.instanceId, instance);
    m4.multiply(instance);
  }
  normalMatrix.getNormalMatrix(m4);
  normal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();
  if (normal.dot(dir) > 0) normal.negate();
  return normal.y;
}

/**
 * The first visible surface along `raycaster`'s ray among `root`'s descendants (null: nothing — the sky). The caller
 * sets the ray, its near/far (the camera's near plane: what is nearer is not drawn) and `raycaster.camera`.
 */
export function pickSurface(raycaster: Raycaster, root: Object3D, skipBlockers = false): ScenePick | null {
  // Nearest box first, and no mesh whose box starts past the best hit so far: the village is a few hundred meshes,
  // its ground chunks thousands of triangles each, and a full raycast of all of them cost ~100 ms a click.
  const candidates: Candidate[] = [];
  collect(root, raycaster, candidates, false);
  candidates.sort((a, b) => a.entry - b.entry);
  let best: Intersection | null = null;
  let bestBlocker = false;
  for (const c of candidates) {
    if (best && c.entry > best.distance) break;
    if (c.blocker && skipBlockers) continue;
    scratch.length = 0;
    c.mesh.raycast(raycaster, scratch);
    for (const hit of scratch) {
      if (best && hit.distance >= best.distance) continue;
      const material = materialOf(hit);
      if (isSeeThrough(material)) continue;
      // Leaves fading out near the camera (villageModelPrep.ts FOLIAGE_NEAR_FADE) are not there to click.
      const fade = material?.userData?.[NEAR_FADE_KEY];
      if (typeof fade === "number" && hit.distance < fade) continue;
      best = hit;
      bestBlocker = c.blocker;
    }
  }
  if (!best) return null;
  return {
    x: best.point.x,
    y: best.point.y,
    z: best.point.z,
    ny: upright(best, raycaster.ray.direction),
    distance: best.distance,
    blocker: bestBlocker,
    name: best.object.name || best.object.type,
  };
}

/** A pick as clickPlan.ts reads it: a body's surface is never ground. */
export function asSurface(pick: ScenePick | null): SurfacePoint | null {
  if (!pick) return null;
  return pick.blocker ? { x: pick.x, y: pick.y, z: pick.z, ny: 0 } : pick;
}

const DOWN = new Vector3(0, -1, 0);
const origin = new Vector3();
/** Where the downward ray starts (m): above a curb and a step, below the crowns, the eaves and the benches' seats. */
const COLUMN_TOP = 0.4;

/**
 * The ground's height at (x, z) — for a destination that moved off the click (out of a collider's margin, or to where
 * the walk stops) so its ring still lies on the surface there. `fallback` when nothing walkable is under it.
 */
export function surfaceHeightAt(raycaster: Raycaster, root: Object3D, x: number, z: number, fallback: number): number {
  const { near, far } = raycaster;
  raycaster.set(origin.set(x, COLUMN_TOP, z), DOWN);
  raycaster.near = 0;
  raycaster.far = COLUMN_TOP + 2;
  const pick = pickSurface(raycaster, root, true);
  raycaster.near = near;
  raycaster.far = far;
  if (!pick || pick.ny < WALKABLE_MIN_NY || pick.y > WALKABLE_MAX_Y) return fallback;
  return pick.y;
}
