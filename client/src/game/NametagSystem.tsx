import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import { createNametagFrame } from "./nametagFrame";
import { LABEL_LAYER } from "./spriteCanvas";

/**
 * Drives every registered name tag (labelRegistry) from one place — selection of the
 * nearest 15 + speakers + pinned, overlap stacking, wall-occlusion dimming, sizing,
 * fading, typing "…", the speaking highlight and the speech bubble's anchor. See
 * nametagFrame.ts for the per-frame logic; this component only feeds it the camera, the
 * clock and the renderer's pixel ratio (a tag is rasterized at its on-screen size in device
 * pixels). Renders nothing. Mount it once, inside the Canvas.
 *
 * It also lets the scene's camera see LABEL_LAYER, the layer every label sprite (tags,
 * speech bubbles, emoji, the overview's room names) is on: the light tier draws them in its
 * one pass; the rich tier's post chain takes them out of its scene pass and draws them
 * after its final pass, at full resolution (spriteCanvas.ts, postChain.ts).
 */
export function NametagSystem(): null {
  const frame = useMemo(() => createNametagFrame(), []);
  // Per-label state is forgotten with the scene (and rebuilt on demand if the effect re-runs).
  useEffect(() => () => frame.reset(), [frame]);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.layers.enable(LABEL_LAYER);
  }, [camera]);

  useFrame((state, delta) => {
    frame.update(
      state.camera as PerspectiveCamera,
      state.size.width,
      state.size.height,
      delta,
      performance.now(),
      state.gl.getPixelRatio(),
    );
  });

  return null;
}
