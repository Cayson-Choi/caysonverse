/**
 * Shared blob-shadow resource (Task 10 low-spec profile). On touch devices the
 * real directional shadow is off; instead every avatar draws a cheap flat quad
 * with a radial-gradient texture under its feet. There is exactly ONE geometry
 * and ONE material for ALL avatars (self + remote) — created lazily on first use
 * and kept for the app's lifetime (the meshes reference them with dispose={null},
 * so unmounting an avatar never disposes the shared resource).
 */

import { CanvasTexture, DoubleSide, MeshBasicMaterial, PlaneGeometry } from "three";
import { DEFAULT_DECAL_Y, applyDecalOffset, type GroundDecal } from "./groundDecal";

/** Texture resolution (px) of the soft round gradient. */
const BLOB_TEXTURE_SIZE = 128;

/** Radius (m) of the blob quad — a touch wider than an avatar's stance. */
export const BLOB_SHADOW_RADIUS = 0.55;

/** Height (m) above the floor grid (which sits at y=0.02) — avoids z-fighting. */
export const BLOB_SHADOW_Y = DEFAULT_DECAL_Y;

let geometry: PlaneGeometry | null = null;
let material: MeshBasicMaterial | null = null;
/** The base material with a scene's polygon offset (케이슨 마을), one per placement, sharing the base's texture. */
const offsetCopies = new Map<string, MeshBasicMaterial>();

/**
 * The blob material for a scene's decal placement: the base itself without one (every scene but the village), else
 * a cached copy with the offset (never disposed, like the base; the texture is the base's).
 */
export function blobMaterialFor(base: MeshBasicMaterial, decal: GroundDecal | null | undefined): MeshBasicMaterial {
  if (!decal) return base;
  const key = `${decal.polygonOffsetFactor}/${decal.polygonOffsetUnits}`;
  let m = offsetCopies.get(key);
  if (!m) {
    m = applyDecalOffset(base.clone(), decal);
    offsetCopies.set(key, m);
  }
  return m;
}

/** Paint a black-core → transparent-edge radial gradient once. */
function createTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = BLOB_TEXTURE_SIZE;
  canvas.height = BLOB_TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new CanvasTexture(canvas);
  const c = BLOB_TEXTURE_SIZE / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.42)");
  gradient.addColorStop(0.7, "rgba(0, 0, 0, 0.16)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, BLOB_TEXTURE_SIZE, BLOB_TEXTURE_SIZE);
  return new CanvasTexture(canvas);
}

/**
 * The ONE shared blob-shadow geometry + material for every avatar. Lazily built
 * on first call (needs the DOM/canvas + a three context); never disposed. A scene
 * with its own decal placement (`decal`, 케이슨 마을) gets the offset copy.
 */
export function getBlobShadow(decal: GroundDecal | null = null): { geometry: PlaneGeometry; material: MeshBasicMaterial } {
  if (!geometry) {
    geometry = new PlaneGeometry(BLOB_SHADOW_RADIUS * 2, BLOB_SHADOW_RADIUS * 2);
  }
  if (!material) {
    material = new MeshBasicMaterial({
      map: createTexture(),
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
  }
  return { geometry, material: blobMaterialFor(material, decal) };
}
