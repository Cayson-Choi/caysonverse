import { MeshBasicMaterial, SRGBColorSpace, type Material, type Mesh, type Object3D, type Texture } from "three";

/**
 * Shared GLB dressing rules for the baked models (village.glb, memorial.glb, village_bus.glb) — the pure part: what the
 * art pipeline promises about a file and how the game dresses it, so every rule is unit-tested without a browser or a
 * GLB loader. (The file keeps its old name: the first model it served was the school hall.)
 *
 * The file's contract (checked by scripts/check-school-glb.ts):
 *  - Materials named `LM_*` are unlit (KHR_materials_unlit → MeshBasicMaterial) and carry a baked light on the
 *    second UV set; the game adds the light map: `lightMap` from the WebP, channel 1, flipY false, sRGB, and
 *    `lightMapIntensity = 1.6π` (three's basic shader computes albedo × lightMap × intensity / π; the file stores
 *    L / 2, so 2π would reproduce the bake exactly and 1.6π is the tuned brightness).
 *  - `M_*` materials never get a light map.
 *  - `col__*` nodes are the collision boxes (shared/…/generated/villageColliders.ts is generated from them): hidden at load.
 */

/** Where the Draco decoder lives (copied from three's examples, Apache-2.0: client/public/draco/). */
export const DRACO_PATH = "/draco/";

/** The light map's strength: 1.6π (see above). */
export const LIGHTMAP_INTENSITY = 1.6 * Math.PI;
/** The light map sits on the second UV set (`uv1`). */
export const LIGHTMAP_CHANNEL = 1;

export const COLLIDER_PREFIX = "col__";
export const LIGHTMAP_MATERIAL_PREFIX = "LM_";

export function isMesh(o: Object3D): o is Mesh {
  return (o as Mesh).isMesh === true;
}

/** Every material of a mesh as an array (a mesh may hold one or several). */
export function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** Light-map texture settings (idempotent: a texture that is already right is left alone, no re-upload). */
export function configureLightmap(texture: Texture): Texture {
  if (texture.flipY || texture.colorSpace !== SRGBColorSpace || texture.channel !== LIGHTMAP_CHANNEL) {
    texture.flipY = false;
    texture.colorSpace = SRGBColorSpace;
    texture.channel = LIGHTMAP_CHANNEL;
    texture.needsUpdate = true;
  }
  return texture;
}

/** Put the light map on one material (the `LM_*` rule). The same material twice is harmless. */
export function lightmapMaterial(material: Material, lightmap: Texture): void {
  const m = material as MeshBasicMaterial;
  if (m.lightMap === lightmap && m.lightMapIntensity === LIGHTMAP_INTENSITY) return;
  m.lightMap = lightmap;
  m.lightMapIntensity = LIGHTMAP_INTENSITY;
  m.needsUpdate = true;
}
