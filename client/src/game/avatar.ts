/**
 * Remote-avatar instantiation helper. Clones a cached GLTF scene into an
 * independent, tinted, cull-safe skinned hierarchy — and hands back exactly the
 * resources the caller must dispose on unmount (the CLONED materials), never the
 * shared cached geometry/textures.
 */

import { SkeletonUtils } from "three-stdlib";
import { Color, Material, Mesh, Object3D, Sphere, Vector3 } from "three";
import { TINT_COLORS } from "@caysonverse/shared/constants";
import {
  CROWN_BASE_SCALE,
  CROWN_Y_OFFSET,
  HEAD_BONE_NAME,
  crownLocalScale,
  type CrownConfig,
} from "./constants";

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
 * Clone the cached crown scene, give it its own (untinted) materials so opacity
 * and disposal are per-avatar, and apply the fit-scale + flatten + head offset.
 * The crown is a static (non-skinned) mesh, so a plain deep clone is enough — the
 * GLB already bakes the +Z→+Y stand-up rotation and the head bone is axis-aligned
 * with world, so no extra rotation is needed. Shared geometry is NEVER disposed;
 * the returned clone's cloned materials are pushed into `out` for the caller to
 * dispose with the avatar.
 */
function attachCrown(crownScene: Object3D, cfg: CrownConfig, out: Material[]): Object3D {
  const crown = crownScene.clone(true);
  crown.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => cloneUntinted(m, out))
      : cloneUntinted(mesh.material, out);
  });
  const [sx, sy, sz] = crownLocalScale(cfg, CROWN_BASE_SCALE);
  crown.scale.set(sx, sy, sz);
  crown.position.set(0, CROWN_Y_OFFSET, 0);
  return crown;
}

/**
 * Clone `scene` (a cached GLTF root) into an independent skeleton, clone+tint its
 * materials once, and give skinned meshes a cull-safe bounding sphere. With
 * `decor`, additionally hide accessory nodes and attach a crown to the `head`
 * bone AFTER tinting (so the crown keeps its own gold/red). The crown, being a
 * child of the head bone, animates with the head for free (walk/sit included).
 */
export function cloneTinted(scene: Object3D, tint: number, decor?: AvatarDecor): TintedAvatar {
  const root = SkeletonUtils.clone(scene);
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
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => tintOne(m, color, materials))
      : tintOne(mesh.material, color, materials);
  });

  if (decor?.hideNodes) {
    for (const name of decor.hideNodes) {
      const node = root.getObjectByName(name);
      if (node) node.visible = false;
    }
  }

  if (decor?.crown && decor.crownScene) {
    const head = root.getObjectByName(HEAD_BONE_NAME);
    if (head) head.add(attachCrown(decor.crownScene, decor.crown, materials));
  }

  return { root, materials };
}
