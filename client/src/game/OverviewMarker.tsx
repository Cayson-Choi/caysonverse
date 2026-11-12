import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DoubleSide, type Group } from "three";
import { viewState } from "./viewState";
import { OV_VIS_BLEND } from "./viewMode";
import type { Pose } from "./types";

/**
 * Overview self-marker (design 20): a bright pulsing beacon over the local
 * avatar, visible ONLY in the top-down overview so "where am I?" reads at a
 * glance from 60 m up. A red downward cone floating above the head + two glowing
 * ground rings, both unlit (`meshBasicMaterial`, `toneMapped={false}`) so they
 * stay vivid against the map, and a gentle scale pulse.
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
    <group ref={ref} name="overview-self-marker" visible={false}>
      {/* Downward-pointing red cone hovering above the avatar's head. */}
      <mesh position={[0, 3.8, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[1.08, 2.1, 6]} />
        <meshBasicMaterial color="#ff3347" toneMapped={false} />
      </mesh>
      {/* Large glowing red rings under the feet; the inner ring keeps the marker legible over paving. */}
      <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.1, 1.75, 32]} />
        <meshBasicMaterial color="#ff3347" transparent opacity={0.9} side={DoubleSide} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.065, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.58, 0.82, 28]} />
        <meshBasicMaterial color="#ff6674" transparent opacity={0.72} side={DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}
