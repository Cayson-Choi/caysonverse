import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DoubleSide, type Group } from "three";
import { viewState } from "./viewState";
import { OV_VIS_BLEND } from "./viewMode";
import type { Pose } from "./types";

/**
 * Overview self-marker (design 20): a bright pulsing beacon over the local
 * avatar, visible ONLY in the top-down overview so "where am I?" reads at a
 * glance from 60 m up. A downward cone floating above the head + a glowing ground
 * ring, both unlit (`meshBasicMaterial`, `toneMapped={false}`) so they stay
 * vivid against the map, and a gentle scale pulse.
 *
 * Per-frame, ref-driven (never React state): it follows the shared mutable
 * `pose` and toggles visibility off the module `viewState` — so it costs nothing
 * outside the overview. Mounted by WorldScene inside the Canvas.
 */
export function OverviewMarker({ pose }: { pose: Pose }) {
  const ref = useRef<Group>(null);

  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    // Gate on the ov blend, not the mode flip: the marker appears once the camera
    // is high enough mid-ascent and STAYS through most of the exit descent (the
    // user keeps their "where am I" anchor while the map is still readable).
    const show = viewState.ovBlend > OV_VIS_BLEND;
    g.visible = show;
    if (!show) return;
    g.position.set(pose.x, 0, pose.z);
    const pulse = 1 + 0.18 * Math.sin(state.clock.elapsedTime * 4);
    g.scale.setScalar(pulse);
  });

  return (
    <group ref={ref} visible={false}>
      {/* Downward-pointing cone hovering above the avatar's head. */}
      <mesh position={[0, 3.6, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.85, 1.7, 5]} />
        <meshBasicMaterial color="#ffe14d" toneMapped={false} />
      </mesh>
      {/* Glowing ground ring under the feet. */}
      <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1.4, 28]} />
        <meshBasicMaterial color="#ffe14d" transparent opacity={0.8} side={DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}
