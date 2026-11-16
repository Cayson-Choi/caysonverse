import { useEffect, useMemo } from "react";
import { MeshBasicMaterial } from "three";
import { VILLAGE_LAYOUT, hallWalls, type Disc } from "@caysonverse/shared/village/villageLayout";
import { makeGeometry, type MapGeometry } from "@caysonverse/shared/school/geometry";
import { MapBoxes } from "../game/MapBoxes";

/**
 * The memorial hall's plain room: since Task 9 the stand-in while memorial.glb loads (MemorialHall.tsx). A floor, the four walls (the colliders, drawn by
 * MapBoxes) and the ceiling slab the indoor camera stays under (Task 5). No door pad (owner 2026-11-16).
 */

const COLOUR = { room: "#E9E1D2", ceiling: "#F2ECE0", doorPad: "#6D70F0" } as const;

const HALL_DRAW: MapGeometry = makeGeometry("village", VILLAGE_LAYOUT.areas.hall, hallWalls(VILLAGE_LAYOUT), [], []);

/**
 * A glowing disc where a door is used (the house interiors' way out). The memorial hall draws none, inside or out (owner
 * 2026-11-16: "추모관 들어오는 입구와 나가는 입구에 보라색 부분을 없애"): its glass door (which slides open as a visitor nears) and the
 * "들어가기 / 나가기" button are the cue.
 */
export function DoorPad({ pad, y = 0.05 }: { pad: Disc; y?: number }) {
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: COLOUR.doorPad,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh position={[pad.centre.x, y, pad.centre.z]} rotation-x={-Math.PI / 2} material={material} renderOrder={2}>
      <circleGeometry args={[pad.radius, 40]} />
    </mesh>
  );
}

export function HallRoom() {
  const { room, ceilingHeight } = VILLAGE_LAYOUT.memorial.interior;
  const cx = (room.minX + room.maxX) / 2;
  const cz = (room.minZ + room.maxZ) / 2;
  return (
    <group>
      <mesh position={[cx, -0.01, cz]} receiveShadow>
        <boxGeometry args={[room.maxX - room.minX, 0.02, room.maxZ - room.minZ]} />
        <meshStandardMaterial color={COLOUR.room} roughness={0.95} />
      </mesh>
      <MapBoxes geometry={HALL_DRAW} />
      {/* The ceiling (Task 5): the roof seen from inside. The camera is held under it (indoorCamera.ts), so the
          player never sees the sky or the village through it. A plain slab until Task 9 dresses the room. */}
      <mesh position={[cx, ceilingHeight + 0.05, cz]}>
        <boxGeometry args={[room.maxX - room.minX + 1, 0.1, room.maxZ - room.minZ + 1]} />
        <meshStandardMaterial color={COLOUR.ceiling} emissive={COLOUR.ceiling} emissiveIntensity={0.35} roughness={1} />
      </mesh>
    </group>
  );
}
