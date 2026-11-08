import { createContext, useContext } from "react";
import type { MeshBasicMaterial } from "three";

/**
 * Where a scene's ground decals lie: the avatars' blob shadows (light tier) and the rich tier's shadow floor
 * (`ShadowFloor`). Every scene but 케이슨 마을 keeps the defaults (3 cm up, no polygon offset), which sit above their
 * flat floors. The village's ground is layers 1-3 cm thick that carry polygon offsets of their own (the memorial
 * forecourt's top is at 3 cm with units -2), so a decal at 3 cm without an offset drew under them and the avatars lost
 * their shadows there (Task 7 review I2): the village raises its decals and gives them a stronger offset.
 */
export interface GroundDecal {
  /** Height of the decal above y = 0 (m). */
  y: number;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
}

/** The decals' place in every scene that does not ask for its own (what they always were). */
export const DEFAULT_DECAL_Y = 0.03;

/** The height a decal is drawn at: the scene's, or the default. */
export function decalY(decal: GroundDecal | null | undefined): number {
  return decal ? decal.y : DEFAULT_DECAL_Y;
}

/** Give a decal material the scene's polygon offset (no offset without one). Returns the material. */
export function applyDecalOffset<M extends Pick<MeshBasicMaterial, "polygonOffset" | "polygonOffsetFactor" | "polygonOffsetUnits">>(
  material: M,
  decal: GroundDecal | null | undefined,
): M {
  material.polygonOffset = !!decal;
  material.polygonOffsetFactor = decal ? decal.polygonOffsetFactor : 0;
  material.polygonOffsetUnits = decal ? decal.polygonOffsetUnits : 0;
  return material;
}

/** The enclosing `PlayShell`'s decal placement (null: the defaults). */
export const GroundDecalContext = createContext<GroundDecal | null>(null);

export function useGroundDecal(): GroundDecal | null {
  return useContext(GroundDecalContext);
}
