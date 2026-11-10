import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { peekClickRing } from "./clickMove";
import { CLICK_PICK_KEY } from "./clickPick";
import { RING_POLYGON_OFFSET, RING_RENDER_ORDER, ringLift } from "./clickRing";
import { useGroundDecal } from "./groundDecal";

/** Ring colour: the brand indigo. */
const RING_COLOR = "#4B4FD8";
const DOT_COLOR = "#ffffff";

/** The click pick passes through the ring (clickPick.ts): a click on it is a click on the ground under it. */
const IGNORED_BY_PICK = { [CLICK_PICK_KEY]: "ignore" };

/**
 * The destination ring: a flat ring on the ground where the avatar is walking to (a floor click or a single tap).
 * Visible while a click-move target exists — or, for a tap held back to see whether a second one follows, from the
 * tap on (clickMove.ts `pending`) — gone the moment it clears (arrival, a key press, a blocked path, a menu).
 *
 * It lies on the surface that was clicked (the target's `y`) plus the scene's decal lift, with a polygon offset that
 * beats every ground layer, drawn after the shadow floor (clickRing.ts): at y = 0.02 with no offset the village's
 * offset paving won the depth test and hid it past ~8 m, and the forecourt covered it outright.
 *
 * Per-frame work touches the group through a ref only — no React state, no allocation: the target is read with
 * peekClickRing (the live object, not a copy).
 */
export function ClickMarker() {
  const groupRef = useRef<Group>(null);
  const lift = ringLift(useGroundDecal());

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const target = peekClickRing();
    if (!target) {
      if (group.visible) group.visible = false;
      return;
    }
    group.visible = true;
    group.position.set(target.x, target.y + lift, target.z);
    // A slow breathing pulse so the ring reads as "going here", not as a decal.
    const pulse = 1 + 0.1 * Math.sin(clock.elapsedTime * 6);
    group.scale.set(pulse, 1, pulse);
  });

  return (
    <group ref={groupRef} visible={false} userData={IGNORED_BY_PICK}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={RING_RENDER_ORDER}>
        <ringGeometry args={[0.3, 0.42, 40]} />
        <meshBasicMaterial
          color={RING_COLOR}
          transparent
          opacity={0.9}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={RING_POLYGON_OFFSET.factor}
          polygonOffsetUnits={RING_POLYGON_OFFSET.units}
          fog={false}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={RING_RENDER_ORDER}>
        <circleGeometry args={[0.08, 20]} />
        <meshBasicMaterial
          color={DOT_COLOR}
          transparent
          opacity={0.9}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={RING_POLYGON_OFFSET.factor}
          polygonOffsetUnits={RING_POLYGON_OFFSET.units}
          fog={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
