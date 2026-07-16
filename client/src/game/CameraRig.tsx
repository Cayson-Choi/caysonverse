import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import { CAMERA, FP_EYE_HEIGHT, HEAD_HEIGHT } from "./constants";
import { normalizeAngle } from "./yaw";
import { clampFpPitch, easeBlend } from "./viewMode";
import { viewState, applyZoom, stepViewBlend, toggleViewMode } from "./viewState";
import { isUiCaptured } from "./uiCapture";
import { aspectDistanceScale } from "./aspectFraming";
import {
  isInMaze,
  stepMazeCapEngage,
  cappedFollowDistance,
  cappedCameraY,
} from "./mazeCamera";
import { cameraProbe } from "./cameraProbe";
import type { Orbit, Pose } from "./types";

interface CameraRigProps {
  pose: Pose;
  orbit: Orbit;
}

/** Follow-distance clamp band shared by the wheel and pinch zoom paths. */
const ZOOM_BAND = { min: CAMERA.minDistance, max: CAMERA.maxDistance } as const;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Pixel distance between the first two active pointers (0 if fewer than two). */
function spread(pointers: Map<number, { x: number; y: number }>): number {
  const values = pointers.values();
  const a = values.next().value;
  const b = values.next().value;
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The ONE follow rig, TWO modes, ONE blend (design 19).
 *
 * Third-person: orbits the player at (orbit.yaw, orbit.pitch, orbit.distance) —
 * one pointer drags to rotate, the wheel/pinch zoom. First-person: the camera
 * sits at the player's eye (FP_EYE_HEIGHT) and the SAME drag handlers rotate a
 * separate fp yaw/pitch (wider pitch clamp). A 0..1 `viewState.blend` eased over
 * ~0.25s interpolates the camera pose between the two on every toggle, so there is
 * no teleport-cut. Four toggle paths reach this rig: the `V` key (guarded by
 * uiCapture so chat typing never toggles), a wheel notch past minDistance, an
 * equivalent pinch, and the 👁 touch button (WorldScene → toggleViewMode).
 *
 * All per-frame state lives in the shared `orbit` object and the module `viewState`
 * (both mutated in place) — never React state.
 *
 * On portrait viewports the TP follow distance is scaled up (aspectFraming); the
 * maze zone caps the TP height/distance (mazeCamera). BOTH act only on the TP pose
 * term below, so at full FP (blend 1, TP weight 0) they are inert by construction —
 * the FP eye ignores follow distance entirely and sits well under the maze walls.
 */
export function CameraRig({ pose, orbit }: CameraRigProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  // Maze anti-peek cap engagement (0 = off, 1 = fully capped). Lerped in useFrame
  // so entering/leaving the maze eases the cap in/out with no snap. Ref, not state.
  const capEngage = useRef(0);

  // Dev/E2E only: expose the live camera (the maze cap is not reflected in
  // orbit.distance, and the FP look yaw lives outside orbit). Tree-shaken in prod.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cvCamera = () => ({ ...cameraProbe });
    return () => {
      delete window.__cvCamera;
    };
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchPrev = 0; // previous two-finger spread (px); 0 while not pinching

    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // synthetic events may have no active pointer; capture is best-effort
      }
      if (pointers.size === 2) pinchPrev = spread(pointers);
    };
    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return; // a move with no prior down (e.g. hovering) — ignore
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size >= 2) {
        // Two fingers → pinch zoom only, never rotate. Routed through applyZoom so
        // a pinch past the extremes crosses into/out of FP just like the wheel.
        const curr = spread(pointers);
        if (pinchPrev > 0) {
          applyZoom(orbit, (pinchPrev - curr) * CAMERA.pinchSpeed, ZOOM_BAND);
        }
        pinchPrev = curr;
        return;
      }
      // Single pointer → rotate the ACTIVE view. In FP the drag turns the separate
      // fp yaw/pitch (wider pitch clamp); in TP it turns the orbit — same drag
      // sensitivity either way.
      if (viewState.mode === "fp") {
        viewState.fpYaw = normalizeAngle(viewState.fpYaw - dx * CAMERA.dragSpeed);
        viewState.fpPitch = clampFpPitch(viewState.fpPitch + dy * CAMERA.dragSpeed);
      } else {
        orbit.yaw = normalizeAngle(orbit.yaw - dx * CAMERA.dragSpeed);
        orbit.pitch = clamp(orbit.pitch + dy * CAMERA.dragSpeed, CAMERA.minPitch, CAMERA.maxPitch);
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchPrev = 0;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // pointer may already be released; ignore
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // deltaY < 0 = zoom in (toward min → one notch past min enters FP);
      // deltaY > 0 = zoom out (an outward notch in FP returns to TP).
      applyZoom(orbit, e.deltaY * CAMERA.zoomSpeed, ZOOM_BAND);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyV") return;
      if (isUiCaptured()) return; // typing 'v' in chat must not toggle the view
      if (e.repeat) return; // one toggle per physical press (no auto-repeat)
      toggleViewMode(orbit);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [gl, orbit]);

  useFrame((_state, delta) => {
    // Advance the TP<->FP blend toward the active mode's target, then ease it.
    const t = easeBlend(stepViewBlend(delta));

    // ── Third-person pose ── `orbit.distance` stays the user's zoom intent; the
    // portrait pull-back and the maze cap apply ONLY here, so they never touch the
    // FP eye. Maze cap: ease engagement toward 1 inside the zone, then clamp both
    // the effective distance and the final height so no pitch/aspect lifts the
    // camera over the walls.
    const aspect = (camera as PerspectiveCamera).aspect;
    const engage = stepMazeCapEngage(capEngage.current, isInMaze(pose.x, pose.z), delta);
    capEngage.current = engage;
    const distance = cappedFollowDistance(orbit.distance * aspectDistanceScale(aspect), engage);
    const horiz = distance * Math.cos(orbit.pitch);
    const height = distance * Math.sin(orbit.pitch);
    const tpX = pose.x + horiz * Math.sin(orbit.yaw);
    const tpY = cappedCameraY(HEAD_HEIGHT + height, engage);
    const tpZ = pose.z + horiz * Math.cos(orbit.yaw);

    // ── First-person pose ── camera at the eye; look along the fp yaw/pitch. The
    // horizontal forward (-sin, -cos) matches worldDirection's convention, so
    // walking "forward" in FP tracks exactly where the view points.
    const cosP = Math.cos(viewState.fpPitch);
    const fwdX = -Math.sin(viewState.fpYaw) * cosP;
    const fwdY = -Math.sin(viewState.fpPitch);
    const fwdZ = -Math.cos(viewState.fpYaw) * cosP;

    // ── Blend the two poses (position + look target) — no teleport-cut. ──
    camera.position.set(
      lerp(tpX, pose.x, t),
      lerp(tpY, FP_EYE_HEIGHT, t),
      lerp(tpZ, pose.z, t),
    );
    camera.lookAt(
      lerp(pose.x, pose.x + fwdX, t),
      lerp(HEAD_HEIGHT, FP_EYE_HEIGHT + fwdY, t),
      lerp(pose.z, pose.z + fwdZ, t),
    );

    // Publish the live camera for the dev/E2E hook.
    cameraProbe.x = camera.position.x;
    cameraProbe.y = camera.position.y;
    cameraProbe.z = camera.position.z;
    cameraProbe.distance = distance;
    cameraProbe.mode = viewState.mode;
    cameraProbe.blend = viewState.blend;
    cameraProbe.fpYaw = viewState.fpYaw;
  });

  return null;
}
