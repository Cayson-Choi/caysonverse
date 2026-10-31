import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { peekClickTarget } from "./clickMove";

/** Just above the floor, so the ring never z-fights with it. */
const MARKER_Y = 0.02;

/** Ring colour: the brand indigo. */
const RING_COLOR = "#4B4FD8";
const DOT_COLOR = "#ffffff";

/**
 * The destination ring: a flat ring on the floor where the avatar is walking to
 * (a floor click or a single tap). Visible while a click-move target exists, gone
 * the moment it clears (arrival, a key press, a blocked path, a menu).
 *
 * Per-frame work touches the group through a ref only — no React state, no
 * allocation: the target is read with peekClickTarget (the live object, not a copy).
 */
export function ClickMarker() {
  const groupRef = useRef<Group>(null);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const target = peekClickTarget();
    if (!target) {
      if (group.visible) group.visible = false;
      return;
    }
    group.visible = true;
    group.position.set(target.x, MARKER_Y, target.z);
    // A slow breathing pulse so the ring reads as "going here", not as a decal.
    const pulse = 1 + 0.1 * Math.sin(clock.elapsedTime * 6);
    group.scale.set(pulse, 1, pulse);
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <ringGeometry args={[0.3, 0.42, 40]} />
        <meshBasicMaterial
          color={RING_COLOR}
          transparent
          opacity={0.9}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <circleGeometry args={[0.08, 20]} />
        <meshBasicMaterial
          color={DOT_COLOR}
          transparent
          opacity={0.9}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
