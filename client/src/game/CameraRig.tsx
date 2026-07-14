import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CAMERA, HEAD_HEIGHT } from "./constants";
import { normalizeAngle } from "./yaw";
import { applyPinchZoom } from "./pinchZoom";
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
 */
export function CameraRig({ pose, orbit }: CameraRigProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

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

  useFrame(() => {
    const horiz = orbit.distance * Math.cos(orbit.pitch);
    const height = orbit.distance * Math.sin(orbit.pitch);
    camera.position.set(
      pose.x + horiz * Math.sin(orbit.yaw),
      HEAD_HEIGHT + height,
      pose.z + horiz * Math.cos(orbit.yaw),
    );
    camera.lookAt(pose.x, HEAD_HEIGHT, pose.z);
  });

  return null;
}
