import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CAMERA, HEAD_HEIGHT } from "./constants";
import { normalizeAngle } from "./yaw";
import type { Orbit, Pose } from "./types";

interface CameraRigProps {
  pose: Pose;
  orbit: Orbit;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Third-person follow camera. Orbits the player at (orbit.yaw, orbit.pitch,
 * orbit.distance): pointer drag rotates (yaw free, pitch clamped), wheel zooms.
 * All state lives in the shared `orbit` object (mutated in place) — never React
 * state — and the camera is positioned every frame in useFrame. Implemented by
 * hand because drei OrbitControls fights a follow camera.
 */
export function CameraRig({ pose, orbit }: CameraRigProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const el = gl.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      orbit.yaw = normalizeAngle(orbit.yaw - dx * CAMERA.dragSpeed);
      orbit.pitch = clamp(orbit.pitch + dy * CAMERA.dragSpeed, CAMERA.minPitch, CAMERA.maxPitch);
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
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
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
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
