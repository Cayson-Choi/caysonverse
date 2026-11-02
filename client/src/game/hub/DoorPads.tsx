import { useEffect, useMemo } from "react";
import { MeshBasicMaterial, MeshStandardMaterial, type CanvasTexture } from "three";
import { HUB_DOORS, EAST_CORRIDOR, type HubDoor } from "@caysonverse/shared/school/hubMap";
import { ROOM_LABELS, type RoomId } from "@caysonverse/shared/escape/constants";
import { canvas2d, canvasTexture, roundRect } from "../spriteCanvas";
import { FONT_FAMILY } from "../nametag";
import { useClassStore } from "../../stores/classStore";

/**
 * The corridor's room doors and the waiting pads in front of them (AI 학교 탈출, Task 15).
 * Per door (HUB_DOORS): a door leaf on the corridor wall with the room's name above it, and
 * the pad on the floor where a team gathers to go in.
 *  - The pad where MY team has gathered (`padDoor`, at least one member on it) is filled with
 *    my team's colour.
 *  - A door whose room is not open (`openRooms`) is greyed and carries a "준비 중" plate.
 *
 * Reads only discrete class state (classStore, re-rendered on change), nothing per frame.
 * The name / "준비 중" plates are canvas textures made once per mount and released with it.
 */

const DOOR_W = 2;
const DOOR_H = 2.6;
const PAD_Y = 0.015;
const PAD_IDLE = "#F3EFEA";
const PAD_EDGE = "#4B4FD8";
const DOOR_OPEN = "#B98A5A";
const DOOR_CLOSED = "#B9B4AD";

/** Draw a short label on a rounded plate. Returns the texture and its aspect (w / h). */
function plateTexture(text: string, bg: string, fg: string): { texture: CanvasTexture; aspect: number } {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 144;
  const ctx = canvas2d(canvas);
  ctx.fillStyle = bg;
  roundRect(ctx, 6, 6, canvas.width - 12, canvas.height - 12, 36);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = `700 72px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  return { texture: canvasTexture(canvas), aspect: canvas.width / canvas.height };
}

/** The wall face a door sits on (z) and which way it faces (+1 = toward +z). */
function doorFace(d: HubDoor): { z: number; facing: 1 | -1 } {
  return d.side === "n" ? { z: EAST_CORRIDOR.minZ, facing: 1 } : { z: EAST_CORRIDOR.maxZ, facing: -1 };
}

function DoorPad({
  door,
  open,
  teamColor,
  names,
  soon,
}: {
  door: HubDoor;
  open: boolean;
  /** My team's colour when my team has gathered on this pad, else null. */
  teamColor: string | null;
  names: Map<RoomId, { material: MeshBasicMaterial; aspect: number }>;
  soon: { material: MeshBasicMaterial; aspect: number };
}) {
  const { z, facing } = doorFace(door);
  const rotY = facing === 1 ? 0 : Math.PI;
  const pad = door.pad;
  const name = names.get(door.room)!;
  const padMat = useMemo(
    () => new MeshStandardMaterial({ color: PAD_IDLE, roughness: 0.9, transparent: true, opacity: 0.95 }),
    [],
  );
  useEffect(() => () => padMat.dispose(), [padMat]);
  padMat.color.set(teamColor ?? PAD_IDLE);

  return (
    <group>
      {/* The door leaf on the wall, a hair in front of it. */}
      <mesh position={[door.x, DOOR_H / 2, z + facing * 0.04]} rotation={[0, rotY, 0]}>
        <boxGeometry args={[DOOR_W, DOOR_H, 0.08]} />
        <meshStandardMaterial color={open ? DOOR_OPEN : DOOR_CLOSED} roughness={0.7} />
      </mesh>
      {/* The room's name above the door. */}
      <mesh position={[door.x, DOOR_H + 0.45, z + facing * 0.09]} rotation={[0, rotY, 0]} material={name.material}>
        <planeGeometry args={[0.5 * name.aspect, 0.5]} />
      </mesh>
      {!open && (
        <mesh position={[door.x, 1.5, z + facing * 0.1]} rotation={[0, rotY, 0]} material={soon.material}>
          <planeGeometry args={[0.42 * soon.aspect, 0.42]} />
        </mesh>
      )}
      {/* The waiting pad: an edge, then the fill (team colour when my team has gathered). */}
      <mesh position={[door.x, PAD_Y, (pad.minZ + pad.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[pad.maxX - pad.minX, pad.maxZ - pad.minZ]} />
        <meshStandardMaterial color={PAD_EDGE} roughness={0.9} />
      </mesh>
      <mesh
        position={[door.x, PAD_Y + 0.005, (pad.minZ + pad.maxZ) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={padMat}
        receiveShadow
      >
        <planeGeometry args={[pad.maxX - pad.minX - 0.16, pad.maxZ - pad.minZ - 0.16]} />
      </mesh>
    </group>
  );
}

export function DoorPads() {
  const openRooms = useClassStore((s) => s.openRooms);
  const myTeam = useClassStore((s) => s.teams.find((t) => t.mine) ?? null);

  // Plates: one per room name, one "준비 중" — made once per mount, released with it.
  const plates = useMemo(() => {
    const names = new Map<RoomId, { material: MeshBasicMaterial; aspect: number }>();
    for (const d of HUB_DOORS) {
      const { texture, aspect } = plateTexture(ROOM_LABELS[d.room], "#4B4FD8", "#FFFFFF");
      names.set(d.room, { material: new MeshBasicMaterial({ map: texture, transparent: true }), aspect });
    }
    const s = plateTexture("준비 중", "#FFF7E0", "#7A5A12");
    return { names, soon: { material: new MeshBasicMaterial({ map: s.texture, transparent: true }), aspect: s.aspect } };
  }, []);
  useEffect(
    () => () => {
      for (const p of [...plates.names.values(), plates.soon]) {
        p.material.map?.dispose();
        p.material.dispose();
      }
    },
    [plates],
  );

  const gatheredAt = myTeam && myTeam.padCount > 0 ? myTeam.padDoor : "";
  return (
    <group>
      {HUB_DOORS.map((d) => (
        <DoorPad
          key={d.room}
          door={d}
          open={openRooms.includes(d.room)}
          teamColor={gatheredAt === d.room ? myTeam!.color : null}
          names={plates.names}
          soon={plates.soon}
        />
      ))}
    </group>
  );
}
