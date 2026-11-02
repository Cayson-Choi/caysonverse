import { useEffect, useState } from "react";
import type { RoomId } from "@caysonverse/shared/escape/constants";
import { ROOM_MAPS } from "@caysonverse/shared/school/roomMaps";
import { PlayShell } from "../game/PlayShell";
import type { ActiveMap } from "../game/activeMap";
import type { PlayersRoom } from "../game/remoteSync";
import { getEscapeRoom } from "../net/connection";
import { useEscapeStore } from "../stores/escapeStore";
import type { Identity } from "../stores/appStore";
import { DialogueQueue, introLines, sayLine } from "./dialogue";
import { leaveToHall } from "./leave";
import { RoomPlaceholder } from "./RoomPlaceholder";
import { EscapeHud } from "./ui/EscapeHud";
import { TeamChatNotice } from "./ui/TeamChatNotice";
import "./escape.css";

/**
 * A team's classroom (AI 학교 탈출, Task 17) — the scene the player sees after the entering
 * transition. A `PlayShell` on the room's own map (collision, camera, click-move and the HUD's room
 * name all read it through `setActiveMap`), under the same bright-day lighting as the hall, with the
 * room's 3D parts (a placeholder until counsel.glb, Task 24), the classroom HUD (clock, covers, story
 * box) and the always-on team-chat line above the chat bar.
 *
 * The chat bar is the shell's own; it binds to the ACTIVE room, which is this classroom while it is
 * open (`getActiveRoom`), so what is typed here is the team's chat. App mounts the scene keyed by
 * `escapeEpoch`, so a classroom reconnect remounts it (chat, emoji and every room binding rebind).
 *
 * Story lines: when the room's content arrives its intro lines go into the scene's DialogueQueue,
 * and so does every later `say` event. Task 20 pushes the escape lines into the same queue.
 */

/** A room's ActiveMap, made once per room — `setActiveMap` ignores the SAME object, so it must be stable. */
const ROOM_ACTIVE_MAPS = new Map<RoomId, ActiveMap>();

export function roomActiveMap(id: RoomId): ActiveMap | null {
  const cached = ROOM_ACTIVE_MAPS.get(id);
  if (cached) return cached;
  const map = ROOM_MAPS[id];
  if (!map) return null;
  const label = map.label;
  const made: ActiveMap = Object.freeze({ geometry: map.geometry, zoneLabel: () => label });
  ROOM_ACTIVE_MAPS.set(id, made);
  return made;
}

/**
 * Feed the queue from the escape store while the scene is up: the intro lines once (when the room's
 * content is here and the team is not already done), then each new `say` event's line. A refresh
 * mid-game replays the intro too — a tap skips it.
 */
function useEscapeDialogue(queue: DialogueQueue): void {
  useEffect(() => {
    queue.clear();
    let introPushed = false;
    let seenEvent = useEscapeStore.getState().eventSeq;

    const sync = (s: ReturnType<typeof useEscapeStore.getState>): void => {
      if (!introPushed && s.content !== null && s.view !== null) {
        introPushed = true;
        // A team that already escaped (or whose class ended) has no use for the opening story.
        if (s.view.phase !== "escaped" && s.view.phase !== "ended") queue.push(introLines(s.content));
      }
      if (s.eventSeq !== seenEvent) {
        seenEvent = s.eventSeq;
        const ev = s.lastEvent;
        if (ev !== null && ev.e === "say" && s.content !== null) {
          const line = sayLine(s.content, ev.lineId);
          if (line) queue.push([line]);
        }
      }
    };

    sync(useEscapeStore.getState());
    const off = useEscapeStore.subscribe(sync);
    return () => {
      off();
      queue.clear();
    };
  }, [queue]);
}

/** Shown while the classroom's state has not arrived (a moment after the join) or names no room we can draw. */
function Waiting({ text, leavable }: { text: string; leavable: boolean }) {
  return (
    <div className="cv-escui cv-esc-waiting" role="status">
      <p>{text}</p>
      {leavable && (
        <button type="button" className="cv-esc-btn" onClick={() => leaveToHall()}>
          복도로 나가기
        </button>
      )}
    </div>
  );
}

const LEAVE = () => leaveToHall();

export function EscapeScene({ identity }: { identity: Identity }) {
  const view = useEscapeStore((s) => s.view);
  // The classroom connection (read once per mount: a reconnect remounts this scene).
  const [room] = useState(() => getEscapeRoom() as unknown as PlayersRoom | null);
  const [queue] = useState(() => new DialogueQueue());
  useEscapeDialogue(queue);

  if (!room || !view) return <Waiting text="불러오는 중…" leavable={false} />;
  const roomId = view.roomDefId;
  const active = roomId ? roomActiveMap(roomId) : null;
  if (!roomId || !active) return <Waiting text="이 교실은 아직 준비 중이에요." leavable />;

  return (
    <PlayShell
      identity={identity}
      room={room}
      activeMap={active}
      lighting="brightDay"
      effects
      adminPanel={false}
      world3d={<RoomPlaceholder roomId={roomId} />}
      hud={
        <>
          <EscapeHud queue={queue} onLeave={LEAVE} />
          <TeamChatNotice />
        </>
      }
    />
  );
}
