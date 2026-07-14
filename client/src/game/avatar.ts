/**
 * Remote-avatar instantiation helper. Clones a cached GLTF scene into an
 * independent, tinted, cull-safe skinned hierarchy — and hands back exactly the
 * resources the caller must dispose on unmount (the CLONED materials), never the
 * shared cached geometry/textures.
 */

import { SkeletonUtils } from "three-stdlib";
import { Color, Material, Mesh, Object3D, Sphere, Vector3 } from "three";
import { TINT_COLORS } from "@caysonverse/shared/constants";

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

/**
 * Clone `scene` (a cached GLTF root) into an independent skeleton, clone+tint its
 * materials once, and give skinned meshes a cull-safe bounding sphere.
 */
export function cloneTinted(scene: Object3D, tint: number): TintedAvatar {
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

  return { root, materials };
}
