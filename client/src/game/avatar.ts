/**
 * Remote-avatar instantiation helper. Clones a cached GLTF scene into an
 * independent, tinted, cull-safe skinned hierarchy — and hands back exactly the
 * resources the caller must dispose on unmount (the CLONED materials), never the
 * shared cached geometry/textures.
 *
 * Royals (v2 Task 13) take a FIXED-palette path instead of the tint: the cloned
 * materials keep their authored color and swap their atlas map for the royal
 * palette texture (royalPalette.ts, one cached CanvasTexture per royal), then
 * gain procedural accessories (royalAttachments.ts). The base-four path is
 * byte-identical to before — no palette code runs for them.
 */

import { SkeletonUtils } from "three-stdlib";
import { Box3, Color, Material, Mesh, Object3D, Sphere, Vector3, type Texture } from "three";
import { TINT_COLORS } from "@caysonverse/shared/constants";
import {
  CROWN_BASE_SCALE,
  CROWN_RIM_Y,
  HEAD_BONE_NAME,
  crownLocalScale,
  type CrownConfig,
  type RoyalId,
} from "./constants";
import { getRoyalTexture } from "./royalPalette";
import { attachRoyalAccessories } from "./royalAttachments";

/**
 * Optional decoration applied on top of the tinted body clone (v2 Task 2 royals).
 * Non-royals pass nothing, so their assembly is byte-identical to before.
 */
export interface AvatarDecor {
  /** Accessory node names to hide (`visible = false` — geometry stays shared). */
  hideNodes?: readonly string[];
  /** Crown transform config; requires `crownScene` to actually attach. */
  crown?: CrownConfig;
  /** The cached crown GLTF scene (shared geometry/material) to clone per avatar. */
  crownScene?: Object3D;
}

export interface TintedAvatar {
  /** The cloned root to add to the scene graph. */
  root: Object3D;
  /**
   * The materials this clone owns (each a fresh `.clone()`), to be disposed on
   * unmount. Geometry and textures stay shared with the cached GLTF and MUST NOT
   * be disposed here.
   */
  materials: Material[];
}

/**
 * A generous per-object bounding sphere for skinned meshes. Skinned bounds are
 * computed from the rest pose and don't track the animated pose, so stock
 * frustum culling pops the avatar out at screen edges mid-animation. We give
 * each SkinnedMesh clone its OWN large sphere (three checks `object.boundingSphere`
 * before the shared `geometry.boundingSphere`), so no shared state is mutated.
 */
const BOUNDS_CENTER = new Vector3(0, 1, 0);
const BOUNDS_RADIUS = 3;

/** Clone a single material and record the clone for later disposal. */
function tintOne(material: Material, color: Color, out: Material[]): Material {
  const cloned = material.clone();
  const withColor = cloned as Material & { color?: Color };
  if (withColor.color) withColor.color.copy(color);
  out.push(cloned);
  return cloned;
}

/** Clone a material WITHOUT tinting it (crown keeps its own gold/red), tracked. */
function cloneUntinted(material: Material, out: Material[]): Material {
  const cloned = material.clone();
  out.push(cloned);
  return cloned;
}

/**
 * Royal body material: cloned UNTINTED (fixed palette — a pastel tint multiply
 * would corrupt the royal gold) with its atlas map swapped for the royal
 * palette texture. The palette texture is module-cached and shared, so it is
 * NOT the clone's to dispose — only the cloned material is tracked.
 */
function royalOne(material: Material, royal: RoyalId, out: Material[]): Material {
  const cloned = cloneUntinted(material, out);
  const withMap = cloned as Material & { map?: Texture | null };
  if (withMap.map) withMap.map = getRoyalTexture(royal, withMap.map);
  return cloned;
}

/**
 * Clone an accessory scene, give it its own (untinted) materials so opacity and
 * disposal are per-avatar, apply `scale`, then position it so its BOTTOM RIM
 * sits at `rimY` in the parent bone's local frame.
 *
 * Rim-anchoring (not a fixed pivot offset) is what makes the flattened tiara and
 * circlet sit ON TOP of the head/hair instead of collapsing into it: `flatten`
 * shrinks the crown toward its own origin, so a fixed-pivot placement would bury a
 * thin crown below the ~0.95 m-tall chibi head. Anchoring the scaled rim keeps
 * every variant resting at the same height on the head, regardless of flatten.
 *
 * The crown is a static (non-skinned) mesh, so a plain deep clone is enough — the
 * GLB already bakes the +Z→+Y stand-up rotation and the head bone is axis-aligned
 * with world, so no extra rotation is needed. Shared geometry is NEVER disposed;
 * the clone's cloned materials are pushed into `out` for the caller to dispose.
 * (Generalized from the v2 Task 2 attachCrown — same anchor math, so the crown's
 * placement is regression-free; v2 Task 13 reuses it for any GLB accessory.)
 */
function attachAccessory(
  source: Object3D,
  scale: [number, number, number],
  rimY: number,
  out: Material[],
): Object3D {
  const accessory = source.clone(true);
  accessory.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    // Bone-attached: its rest-pose bounds don't track the animated head, so stock
    // frustum culling would pop it off-screen mid-animation. Disable culling (the
    // same rationale as the skinned-mesh bounding sphere above).
    mesh.frustumCulled = false;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => cloneUntinted(m, out))
      : cloneUntinted(mesh.material, out);
  });
  const [sx, sy, sz] = scale;
  accessory.scale.set(sx, sy, sz);
  // Measure the scaled rim (lowest point) at the origin, then lift it to rimY.
  accessory.updateMatrixWorld(true);
  const minY = new Box3().setFromObject(accessory).min.y;
  accessory.position.set(0, rimY - minY, 0);
  return accessory;
}

/**
 * Clone `scene` (a cached GLTF root) into an independent skeleton, clone+tint its
 * materials once, and give skinned meshes a cull-safe bounding sphere. With
 * `decor`, additionally hide accessory nodes and attach a crown to the `head`
 * bone AFTER tinting (so the crown keeps its own gold/red). The crown, being a
 * child of the head bone, animates with the head for free (walk/sit included).
 * A royal decor (decor.crown.royal) swaps the tint for the fixed royal palette
 * and adds the procedural accessories — the non-royal path is untouched.
 */
export function cloneTinted(scene: Object3D, tint: number, decor?: AvatarDecor): TintedAvatar {
  const root = SkeletonUtils.clone(scene);
  const royal = decor?.crown?.royal;
  const color = new Color(TINT_COLORS[tint]);
  const materials: Material[] = [];

  root.traverse((obj) => {
    const mesh = obj as Mesh & { isSkinnedMesh?: boolean; boundingSphere?: Sphere | null };
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    // Per-object bounding sphere for skinned meshes (see BOUNDS_* note above).
    if (mesh.isSkinnedMesh) {
      mesh.boundingSphere = new Sphere(BOUNDS_CENTER.clone(), BOUNDS_RADIUS);
    }
    const dress = (m: Material): Material =>
      royal ? royalOne(m, royal, materials) : tintOne(m, color, materials);
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(dress)
      : dress(mesh.material);
  });

  if (decor?.hideNodes) {
    for (const name of decor.hideNodes) {
      const node = root.getObjectByName(name);
      if (node) node.visible = false;
    }
  }

  if (decor?.crown && decor.crownScene) {
    const head = root.getObjectByName(HEAD_BONE_NAME);
    if (head) {
      head.add(
        attachAccessory(
          decor.crownScene,
          crownLocalScale(decor.crown, CROWN_BASE_SCALE),
          CROWN_RIM_Y,
          materials,
        ),
      );
    }
  }

  // Procedural royal accessories (epaulettes/medallion/peplum) — bone-attached,
  // untinted material clones tracked in `materials` like the crown's.
  if (royal) attachRoyalAccessories(root, royal, materials);

  return { root, materials };
}
