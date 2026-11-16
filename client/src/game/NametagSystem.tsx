import { useEffect, useMemo } from "react";
import { addAfterEffect, useThree } from "@react-three/fiber";
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
 * It runs AFTER the frame is drawn (R3F's after-effect), not as one more useFrame: every avatar's useFrame (they mount as
 * players join, so after this component) and the camera's have then written this frame's poses. As a useFrame it ran
 * before the avatars that joined later and measured their tags' size and stacking from the PREVIOUS frame's position
 * while the camera was already at this frame's — in the moving bus (owner 2026-11-16: "버스안에서 이름표가 계속 빠르게
 * 깜빡거리는데") that is the bus's whole step per frame, and the stacked tags bobbed up and down. What it sets (size, lift,
 * opacity) is drawn from the next frame on, a frame behind the measurement, which is invisible while nothing moves
 * relative to the eye.
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
  const get = useThree((s) => s.get);
  useEffect(() => {
    camera.layers.enable(LABEL_LAYER);
  }, [camera]);

  useEffect(() => {
    let last = Number.NaN;
    return addAfterEffect(() => {
      const state = get();
      const now = performance.now();
      // seconds since the last drawn frame (the first one: a 60 Hz frame), capped as R3F caps its own delta
      const delta = Number.isNaN(last) ? 1 / 60 : Math.min((now - last) / 1000, 0.25);
      last = now;
      frame.update(state.camera as PerspectiveCamera, state.size.width, state.size.height, delta, now, state.gl.getPixelRatio());
    });
  }, [frame, get]);

  return null;
}
