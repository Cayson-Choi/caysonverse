import { useEffect, useMemo, useRef } from "react";
import { addAfterEffect, useThree } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import { createNametagFrame } from "./nametagFrame";
import { LabelOverlay, labelPixelRatio } from "./labelOverlay";
import { InkLayer } from "./inkLayer";
import { LABEL_LAYER } from "./spriteCanvas";

/**
 * Drives every registered name tag (labelRegistry) from one place — selection of the
 * nearest 15 + speakers + pinned, overlap stacking, wall-occlusion dimming, sizing,
 * fading, typing "…", the speaking highlight and the speech bubble's anchor. See
 * nametagFrame.ts for the per-frame logic; this component only feeds it the camera, the
 * clock and the DEVICE's pixel ratio (a tag is rasterized at its on-screen size in device
 * pixels: labelPixelRatio). Renders nothing in the scene. Mount it once, inside the Canvas.
 *
 * It runs AFTER the frame is drawn (R3F's after-effect), not as one more useFrame: every avatar's useFrame (they mount as
 * players join, so after this component) and the camera's have then written this frame's poses. As a useFrame it ran
 * before the avatars that joined later and measured their tags' size and stacking from the PREVIOUS frame's position
 * while the camera was already at this frame's — in the moving bus (owner 2026-11-16: "버스안에서 이름표가 계속 빠르게
 * 깜빡거리는데") that is the bus's whole step per frame, and the stacked tags bobbed up and down. What it sets (size, lift,
 * opacity) is drawn from the next frame on, a frame behind the measurement, which is invisible while nothing moves
 * relative to the eye.
 *
 * It also owns the label overlay (labelOverlay.ts, fix/crisp-labels): a 2D canvas over the 3D one, at the device's pixel
 * ratio, on which every label sprite (tags, speech bubbles, emoji; LABEL_LAYER) is drawn each frame — in the same
 * after-effect, BEFORE the tags are updated, so it draws exactly what the frame's matrices and opacities say (what WebGL
 * would have drawn). No camera sees LABEL_LAYER: WebGL draws no label.
 */
export function NametagSystem(): null {
  const frame = useMemo(() => createNametagFrame(), []);
  // Per-label state is forgotten with the scene (and rebuilt on demand if the effect re-runs).
  useEffect(() => () => frame.reset(), [frame]);
  const camera = useThree((s) => s.camera);
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);
  const overlay = useRef<LabelOverlay | null>(null);
  useEffect(() => {
    camera.layers.disable(LABEL_LAYER);
  }, [camera]);
  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    const o = new LabelOverlay();
    // the signs' lettering at the device's pixel ratio where the scene is drawn at fewer pixels (inkLabels.ts)
    o.ink = new InkLayer();
    (o.canvas as unknown as HTMLCanvasElement).className = "cv-label-overlay";
    // right after the 3D canvas: under every drei <Html> marker (MapPlaces, OverviewMarker), which are added to the same
    // container, as the labels were when WebGL drew them
    parent.insertBefore(o.canvas as unknown as HTMLCanvasElement, gl.domElement.nextSibling);
    overlay.current = o;
    if (import.meta.env.DEV) (window as unknown as { __cvLabelOverlay?: LabelOverlay }).__cvLabelOverlay = o;
    return () => {
      if (overlay.current === o) overlay.current = null;
      o.ink?.dispose();
      o.ink = null;
      o.dispose();
    };
  }, [gl]);

  useEffect(() => {
    let last = Number.NaN;
    return addAfterEffect(() => {
      const state = get();
      const now = performance.now();
      // seconds since the last drawn frame (the first one: a 60 Hz frame), capped as R3F caps its own delta
      const delta = Number.isNaN(last) ? 1 / 60 : Math.min((now - last) / 1000, 0.25);
      last = now;
      const dpr = labelPixelRatio();
      const o = overlay.current;
      if (o?.ink) {
        const w = Math.max(1, Math.round(state.size.width * dpr));
        const h = Math.max(1, Math.round(state.size.height * dpr));
        o.ink.update(state.gl, state.scene, state.camera, w, h, dpr);
      }
      overlay.current?.draw(state.scene, state.camera, state.size.width, state.size.height, dpr);
      frame.update(state.camera as PerspectiveCamera, state.size.width, state.size.height, delta, now, dpr);
    });
  }, [frame, get]);

  return null;
}
