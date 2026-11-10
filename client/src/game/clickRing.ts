import { DEFAULT_DECAL_Y, type GroundDecal } from "./groundDecal";

/**
 * How the destination ring (ClickMarker.tsx) sits on the ground — pure, so the numbers are tested.
 *
 * It used to lie at a fixed y = 0.02 with no polygon offset. The village's ground is thin layers 1-3 cm apart that
 * carry slope-scaled polygon offsets (plaza and road -1/-1, lanes -1/-2, plot lawns -1/-1, forecourt -1/-2,
 * villageModelPrep.ts GROUND_LAYER_OFFSET): at the grazing angles of a click 8 m or more away the offset outweighed
 * the ring's 1 cm lead and the paving won the depth test — the ring was set and drawn every frame and never reached
 * the screen (owner 2026-11-10: "간혹 안 나타나거나 제대로 표시가 안 된다"), and the forecourt (3 cm) lay over it
 * outright. The same hid it on the escape hall's rugs (3.6 cm) and the legacy rugs (2.2 cm).
 *
 * Now it lies on the surface that was clicked (the target's `y`, clickPick.ts) plus the scene's decal lift (5 cm in
 * the village, 3 cm elsewhere — groundDecal.ts), with a polygon offset stronger than every ground layer's on both terms
 * (the recipe of the blob shadows and the shadow floor), in every scene. The depth test stays on, so a bench, a wall
 * or an avatar in front of it still hides it as it should, and it draws after the shadow floor and the blob shadows.
 */

/** factor / units: more negative than every ground layer (-1 / -2 at most) and equal to the village's decals. */
export const RING_POLYGON_OFFSET = { factor: -2, units: -8 } as const;

/** Drawn after the shadow floor and the decals (renderOrder 2). */
export const RING_RENDER_ORDER = 3;

/** How far above the clicked surface the ring lies (m): the scene's decal height, else the default 3 cm. */
export function ringLift(decal: GroundDecal | null | undefined): number {
  return decal ? decal.y : DEFAULT_DECAL_Y;
}

/** The ring's height for a target on a surface at `surfaceY`. */
export function ringY(surfaceY: number, decal: GroundDecal | null | undefined): number {
  return surfaceY + ringLift(decal);
}
