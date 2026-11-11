import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Mesh, MeshStandardMaterial } from "three";
import { CLOSED_AUTO_DOOR, PUBLIC_AUTO_DOOR, stepAutoDoor, type AutoDoorState } from "@caysonverse/shared/village/autoDoor";
import { VILLAGE_LAYOUT, type AreaId } from "@caysonverse/shared/village/villageLayout";
import type { Pose } from "../game/types";
import { autoDoorOpenAmount } from "./publicAutoDoorModel";

/**
 * A lightweight public entrance overlay for the current memorial hall GLB. It gives the player immediate visual
 * feedback for the proximity door while `UseDoor` remains the validated teleport action. The model can later replace
 * these panels with `door__*` nodes without changing the shared state machine or the server boundary.
 */
export function PublicAutoDoor({ area, pose }: { area: AreaId; pose: Pose }) {
  const root = useRef<Group>(null);
  const left = useRef<Mesh>(null);
  const right = useRef<Mesh>(null);
  const sensor = useRef<Mesh>(null);
  const state = useRef<AutoDoorState>({ ...CLOSED_AUTO_DOOR });
  const pad = area === "hall" ? VILLAGE_LAYOUT.memorial.interior.doorPad : VILLAGE_LAYOUT.memorial.exterior.doorPad;
  const base = area === "hall" ? { x: pad.centre.x, z: 6 } : { x: pad.centre.x, z: -52 };

  useFrame(({ clock }) => {
    const nowMs = clock.elapsedTime * 1000;
    const currentDistance = Math.hypot(pose.x - pad.centre.x, pose.z - pad.centre.z);
    // Keep the threshold occupied while the player is in the sweep, preventing a closing panel from clipping them.
    state.current = stepAutoDoor(
      state.current,
      nowMs,
      { playerDistancesM: [currentDistance], doorwayOccupied: currentDistance <= 1.15 },
      { ...PUBLIC_AUTO_DOOR, approachRadiusM: Math.max(PUBLIC_AUTO_DOOR.approachRadiusM, pad.radius + 0.75) },
    );
    const amount = autoDoorOpenAmount(state.current, nowMs, PUBLIC_AUTO_DOOR);
    if (left.current) left.current.position.x = -0.58 - amount * 0.52;
    if (right.current) right.current.position.x = 0.58 + amount * 0.52;
    if (sensor.current) {
      const material = sensor.current.material as MeshStandardMaterial;
      material.emissiveIntensity = state.current.phase === "closed" ? 0.35 : 1.5;
    }
  });

  return (
    <group ref={root} position={[base.x, 0, base.z]} name={`public_auto_door__${area}`}>
      <mesh ref={left} position={[-0.58, 1.5, 0]} castShadow>
        <boxGeometry args={[1.1, 3, 0.12]} />
        <meshStandardMaterial color="#9DD8EA" emissive="#56B9D2" emissiveIntensity={0.35} transparent opacity={0.52} roughness={0.25} metalness={0.05} />
      </mesh>
      <mesh ref={right} position={[0.58, 1.5, 0]} castShadow>
        <boxGeometry args={[1.1, 3, 0.12]} />
        <meshStandardMaterial color="#9DD8EA" emissive="#56B9D2" emissiveIntensity={0.35} transparent opacity={0.52} roughness={0.25} metalness={0.05} />
      </mesh>
      <mesh position={[0, 3.1, 0]}>
        <boxGeometry args={[2.45, 0.16, 0.18]} />
        <meshStandardMaterial color="#E8F4F7" roughness={0.35} />
      </mesh>
      <mesh ref={sensor} position={[0, 2.85, 0.12]}>
        <sphereGeometry args={[0.06, 12, 8]} />
        <meshStandardMaterial color="#D8FFF7" emissive="#74F6D5" emissiveIntensity={0.35} toneMapped={false} />
      </mesh>
    </group>
  );
}
