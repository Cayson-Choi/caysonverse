import { useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  EAST_CORRIDOR,
  EAST_GATE,
  HALL,
  PROGRESS_BOARD,
  TEAM_ZONE,
  hubGeometry,
} from "@caysonverse/shared/school/hubMap";
import type { AABB } from "@caysonverse/shared/collision";
import { ROOM_IDS } from "@caysonverse/shared/escape/constants";
import { ClassMsg } from "@caysonverse/shared/escape/messages";
import { PlayShell } from "./PlayShell";
import { MapBoxes, collidersDebugOn } from "./MapBoxes";
import { Gate } from "./hub/Gate";
import { DoorPads } from "./hub/DoorPads";
import { ProgressBoard } from "./hub/ProgressBoard";
import { hubTargets } from "./hub/hubTargets";
import { hubActiveMap } from "./activeMap";
import { clearClickTarget } from "./clickMove";
import { setTargetHandler, setTargetSource } from "./interactTargets";
import type { PlayersRoom } from "./remoteSync";
import type { Pose } from "./types";
import { getRoom, sendClass } from "../net/connection";
import { takeHubSnap } from "../net/classSync";
import { useAppStore } from "../stores/appStore";
import { useClassStore } from "../stores/classStore";
import type { Identity } from "../stores/appStore";
import { HubHud } from "../ui/hub/HubHud";
import { TeacherPanel } from "../ui/hub/TeacherPanelView";
import { useHubUi } from "../ui/hub/hubUi";

/**
 * The school hub — the central hall (중앙 홀) and the east corridor (동쪽 복도) of a class
 * (AI 학교 탈출, Task 15). A `PlayShell` on the hub map — `hubGeometry(open)`, the east gate
 * shut until the teacher starts the class (the server's rule: open while running or paused) —
 * under the bright-day lighting, with the hub's own 3D parts: for now TEMPORARY boxes for the
 * walls and props (`MapBoxes`; the hub model replaces them in Task 23), the floors, the east
 * `Gate` and the corridor's `DoorPads`.
 *
 * Task 16 adds the hall's life: the progress board on the north wall, the targets the context button
 * offers (the team rug's "팀 만들기", a door pad's "입장" / "팀에게 가기" — hubTargets.ts, plugged in through
 * interactTargets.ts) and the hall's DOM (team panel, phase banner, notice toast, and for the teacher the
 * teacher panel in the top-left column).
 *
 * Class sync is NOT started here: the connection layer binds it for the whole class session
 * (classSync.ts). This scene reads the class store (discrete state) and, every frame, takes the
 * snap back into the hall when the server moved us out of a classroom (`takeHubSnap`).
 *
 * App mounts it keyed by `connectionEpoch`, so a reconnect remounts it (chat, emoji and every
 * room binding rebind to the new class room).
 */

const FLOOR_Y = 0;

/** A flat rectangle on the floor. */
function FloorRect({ box, color, y = FLOOR_Y, opacity }: { box: AABB; color: string; y?: number; opacity?: number }) {
  return (
    <mesh position={[(box.minX + box.maxX) / 2, y, (box.minZ + box.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[box.maxX - box.minX, box.maxZ - box.minZ]} />
      <meshStandardMaterial
        color={color}
        roughness={0.9}
        transparent={opacity !== undefined}
        opacity={opacity ?? 1}
      />
    </mesh>
  );
}

/** The school grounds around the building. */
const GROUNDS: AABB = { minX: -80, maxX: 110, minZ: -80, maxZ: 80 };

/** Every frame: back from a classroom (place 1 → 0), jump to where the server put us. */
function HubSnap({ pose }: { pose: Pose }) {
  useFrame(() => {
    if (takeHubSnap(pose)) clearClickTarget();
  });
  return null;
}

function HubWorld({ pose, gateOpen, debugColliders }: { pose: Pose; gateOpen: boolean; debugColliders: boolean }) {
  const geometry = hubGeometry(gateOpen);
  return (
    <>
      <FloorRect box={GROUNDS} color="#CFE3B4" y={-0.02} />
      <FloorRect box={HALL} color="#E3CFAE" />
      <FloorRect box={EAST_CORRIDOR} color="#D9D2C6" />
      {/* The team-building rug (no collider: anyone may step on it). */}
      <FloorRect box={TEAM_ZONE} color="#B9A8F5" y={0.01} opacity={0.75} />
      {/* The progress board is drawn by ProgressBoard on its footprint, the gate by Gate. */}
      <MapBoxes geometry={geometry} skip={[EAST_GATE, PROGRESS_BOARD]} />
      {debugColliders && <MapBoxes geometry={geometry} variant="wire" />}
      <Gate open={gateOpen} />
      <DoorPads />
      <ProgressBoard />
      <HubSnap pose={pose} />
    </>
  );
}

/** "AI 학교 탈출" and the class code, under the room name (ruling E26: the hub HUD only). */
function HubTitle() {
  const classCode = useClassStore((s) => s.classCode);
  return (
    <span
      className="cv-hud-zone cv-hub-title"
      // Below the top row, so it may use the column's full width (the room chip's phone cap is for the top row).
      style={{
        background: "linear-gradient(135deg, #4B4FD8, #8B5CF6)",
        borderColor: "rgba(255,255,255,0.35)",
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      AI 학교 탈출{classCode ? ` · 반 ${classCode}` : ""}
    </span>
  );
}

/**
 * Plug the hall's targets into the context button (interactTargets.ts) for this scene's lifetime.
 * The source runs at the button's ~5 Hz pass: it reads the class store once, asks `hubTargets`, files
 * the guidance line for the floor and returns the targets. Pressing one opens the team panel (the rug)
 * or sends "enter" (a door pad: the leader's 입장, a latecomer's 팀에게 가기 — the same message, the
 * server tells them apart).
 */
function useHubInteractions(selfSid: string, isTeacher: boolean): void {
  useEffect(() => {
    setTargetSource((pose) => {
      const st = useClassStore.getState();
      const r = hubTargets({
        x: pose.x,
        z: pose.z,
        selfSid,
        isTeacher,
        phase: st.phase,
        openRooms: st.openRooms,
        myTeam: st.teams.find((t) => t.mine) ?? null,
      });
      useHubUi.getState().setInfo(r.info);
      return r.targets;
    });
    setTargetHandler((target, phase) => {
      if (phase !== "press") return;
      if (target.kind === "teamDesk") {
        useHubUi.getState().openTeamPanel();
      } else if (target.kind === "door") {
        const room = ROOM_IDS.find((id) => id === target.id);
        if (room) sendClass(ClassMsg.EnterRoom, { room });
      }
    });
    return () => {
      setTargetSource(null);
      setTargetHandler(null);
      useHubUi.getState().reset();
    };
  }, [selfSid, isTeacher]);
}

export function HubScene({ identity }: { identity: Identity }) {
  const phase = useClassStore((s) => s.phase);
  // In a class `isAdmin` is the teacher flag (appStore.enterHub).
  const isTeacher = useAppStore((s) => s.isAdmin);
  useHubInteractions(identity.sessionId, isTeacher);
  // The server's rule (ClassRoom.geometry): the gate is open while the class runs or is paused.
  const gateOpen = phase === "running" || phase === "paused";
  const [debugColliders] = useState(() => collidersDebugOn());
  // The class connection (read once per mount: a reconnect remounts this scene).
  const [room] = useState(() => getRoom() as unknown as PlayersRoom | null);
  if (!room) return null;

  return (
    <PlayShell
      identity={identity}
      room={room}
      activeMap={hubActiveMap(gateOpen)}
      lighting="brightDay"
      effects
      world3d={({ pose }) => <HubWorld pose={pose} gateOpen={gateOpen} debugColliders={debugColliders} />}
      hud={<HubHud isTeacher={isTeacher} />}
      adminPanel={false}
      hudColumn={
        <>
          <HubTitle />
          {isTeacher && <TeacherPanel />}
        </>
      }
    />
  );
}
