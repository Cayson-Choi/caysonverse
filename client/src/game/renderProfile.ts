/**
 * Low-spec rendering profile (Task 10). A single pure switch on the touch verdict
 * that yields the render budget applied at Canvas creation. Profile is STATIC per
 * session — there is no runtime switching — so callers read it once and wire the
 * values straight into <Canvas>, the directional light, and the blob-shadow gate.
 */

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
 * BINDING matrix:
 *   touch  → dpr [1, 1],   shadows off, blob shadows on
 *   desktop→ dpr [1, 1.5], shadows on,  blob shadows off (current behavior)
 */
export function getRenderProfile(isTouch: boolean): RenderProfile {
  if (isTouch) {
    return { dpr: [1, 1], shadows: false, blobShadows: true };
  }
  return { dpr: [1, 1.5], shadows: true, blobShadows: false };
}
