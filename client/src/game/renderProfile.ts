/**
 * Low-spec rendering profile (Task 10). A single pure switch on the touch verdict
 * that yields the render budget applied at Canvas creation. Profile is STATIC per
 * session — there is no runtime switching — so callers read it once and wire the
 * values straight into <Canvas>, the directional light, and the blob-shadow gate.
 */

import { QUALITY, type QualityTier } from "./quality";

export interface RenderProfile {
  /**
   * react-three-fiber `dpr` clamp `[min, max]`. Touch caps at 1 (never
   * supersample on a phone); desktop keeps a modest 1.5 ceiling.
   */
  dpr: [number, number];
  /** Whether the WebGL shadow map + directional shadow are enabled. */
  shadows: boolean;
  /** Whether cheap radial-gradient blob shadows are drawn under every avatar. */
  blobShadows: boolean;
}

/**
 * BINDING matrix, for a scene without a quality tier (the legacy world):
 *   touch  → dpr [1, 1],   shadows off, blob shadows on
 *   desktop→ dpr [1, 1.5], shadows on,  blob shadows off (current behavior)
 *
 * The school scenes (AI 학교 탈출, Task 21) pass the player's quality tier instead: the budget then
 * comes from `QUALITY[tier]` (quality.ts) and the device no longer matters — a phone that chose "화려하게"
 * gets the rich budget, a PC that chose "가볍게" the light one. Either way THIS function is the only place a
 * Canvas gets its dpr and shadow kind from (ruling E17).
 */
export function getRenderProfile(isTouch: boolean, tier?: QualityTier): RenderProfile {
  if (tier) {
    const q = QUALITY[tier];
    return { dpr: [q.dpr[0], q.dpr[1]], shadows: q.shadows === "soft", blobShadows: q.shadows === "blob" };
  }
  if (isTouch) {
    return { dpr: [1, 1], shadows: false, blobShadows: true };
  }
  return { dpr: [1, 1.5], shadows: true, blobShadows: false };
}
