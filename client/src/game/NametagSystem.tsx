import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import { createNametagFrame } from "./nametagFrame";

/**
 * Drives every registered name tag (labelRegistry) from one place — selection of the
 * nearest 15 + speakers + pinned, overlap stacking, wall-occlusion dimming, sizing,
 * fading, typing "…", the speaking highlight and the speech bubble's anchor. See
 * nametagFrame.ts for the per-frame logic; this component only feeds it the camera and
 * the clock. Renders nothing. Mount it once, inside the Canvas.
 */
export function NametagSystem(): null {
  const frame = useMemo(() => createNametagFrame(), []);
  // Per-label state is forgotten with the scene (and rebuilt on demand if the effect re-runs).
  useEffect(() => () => frame.reset(), [frame]);

  useFrame((state, delta) => {
    frame.update(
      state.camera as PerspectiveCamera,
      state.size.width,
      state.size.height,
      delta,
      performance.now(),
    );
  });

  return null;
}
