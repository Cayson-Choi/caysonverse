import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import { CAMERA, HEAD_HEIGHT } from "./constants";
import { normalizeAngle } from "./yaw";
import { applyPinchZoom } from "./pinchZoom";
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

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
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
 * Third-person follow camera. Orbits the player at (orbit.yaw, orbit.pitch,
 * orbit.distance): one pointer drags to rotate (yaw free, pitch clamped), the
 * wheel zooms (desktop), and two fingers pinch to zoom (touch). All state lives
 * in the shared `orbit` object (mutated in place) — never React state — and the
 * camera is positioned every frame in useFrame.
 *
 * A single pointer map serves BOTH mouse and touch: one active pointer rotates
 * (mouse-drag / one-finger), two active pointers pinch-zoom. Joystick and UI
 * touches never reach here — those DOM overlays sit above the canvas and swallow
 * their own pointers — so dragging the stick can't rotate the camera.
 *
 * On portrait viewports the effective follow distance is scaled up (see
 * `aspectFraming`) so a phone doesn't render a close-up of the avatar's back.
 */
export function CameraRig({ pose, orbit }: CameraRigProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  // Maze anti-peek cap engagement (0 = off, 1 = fully capped). Lerped in useFrame
  // so entering/leaving the maze eases the cap in/out with no snap. Ref, not state.
  const capEngage = useRef(0);

  // Dev/E2E only: expose the live camera (the maze cap is not reflected in
  // orbit.distance, so this is the only truthful readout). Tree-shaken in prod.
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
        // Two fingers → pinch zoom only, never rotate.
        const curr = spread(pointers);
        if (pinchPrev > 0) {
          orbit.distance = applyPinchZoom(orbit.distance, pinchPrev, curr, {
            speed: CAMERA.pinchSpeed,
            min: CAMERA.minDistance,
            max: CAMERA.maxDistance,
          });
        }
        pinchPrev = curr;
        return;
      }
      // Single pointer → rotate.
      orbit.yaw = normalizeAngle(orbit.yaw - dx * CAMERA.dragSpeed);
      orbit.pitch = clamp(orbit.pitch + dy * CAMERA.dragSpeed, CAMERA.minPitch, CAMERA.maxPitch);
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
      orbit.distance = clamp(
        orbit.distance + e.deltaY * CAMERA.zoomSpeed,
        CAMERA.minDistance,
        CAMERA.maxDistance,
      );
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [gl, orbit]);

  useFrame((_state, delta) => {
    // `orbit.distance` stays the user's zoom intent (wheel/pinch); the portrait
    // pull-back is applied only at render time, so a phone shows the world
    // around the avatar instead of a close-up. Landscape is scale 1 (unchanged).
    const aspect = (camera as PerspectiveCamera).aspect;

    // Maze anti-peek cap: ease the engagement toward 1 while the LOCAL player is
    // inside the maze zone, then clamp BOTH the effective distance and the final
    // camera height so no pitch/aspect combination lifts the camera over the walls.
    const engage = stepMazeCapEngage(capEngage.current, isInMaze(pose.x, pose.z), delta);
    capEngage.current = engage;

    const distance = cappedFollowDistance(orbit.distance * aspectDistanceScale(aspect), engage);
    const horiz = distance * Math.cos(orbit.pitch);
    const height = distance * Math.sin(orbit.pitch);
    const camY = cappedCameraY(HEAD_HEIGHT + height, engage);
    camera.position.set(
      pose.x + horiz * Math.sin(orbit.yaw),
      camY,
      pose.z + horiz * Math.cos(orbit.yaw),
    );
    camera.lookAt(pose.x, HEAD_HEIGHT, pose.z);

    // Publish the live camera for the dev/E2E hook (getCamera) — the cap is not
    // reflected in orbit.distance, so this is the only truthful readout.
    cameraProbe.x = camera.position.x;
    cameraProbe.y = camera.position.y;
    cameraProbe.z = camera.position.z;
    cameraProbe.distance = distance;
  });

  return null;
}
