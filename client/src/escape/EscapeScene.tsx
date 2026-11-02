import { useEffect, useState } from "react";
import type { RoomId } from "@caysonverse/shared/escape/constants";
import { ROOM_MAPS } from "@caysonverse/shared/school/roomMaps";
import { PlayShell } from "../game/PlayShell";
import type { ActiveMap } from "../game/activeMap";
import type { PlayersRoom } from "../game/remoteSync";
import { getEscapeRoom } from "../net/connection";
import { useEscapeStore } from "../stores/escapeStore";
import type { Identity } from "../stores/appStore";
import { DialogueQueue } from "./dialogue";
import { FEED_START, feedDialogue } from "./dialogueFeed";
import { EscapeFx } from "./EscapeFx";
import { leaveToHall } from "./leave";
import { ROOM_START_ORBIT } from "./roomCamera";
import { CounselRoom } from "./CounselRoom";
import { useEscapeFinish } from "./useEscapeFinish";
import { useEscapeInteractions } from "./useEscapeInteractions";
import { BagPanel } from "./ui/BagPanel";
import { EscapeHud } from "./ui/EscapeHud";
import { EscapeToast } from "./ui/EscapeToast";
import { EscapeVeil } from "./ui/EscapeVeil";
import { FinalePanel } from "./ui/FinalePanel";
import { HintPanel } from "./ui/HintPanel";
import { HoldRing } from "./ui/HoldRing";
import { InspectOverlay } from "./ui/InspectOverlay";
import { SummaryCard } from "./ui/SummaryCard";
import { TeamChatNotice } from "./ui/TeamChatNotice";
import { resetOverlays } from "../ui/overlayStack";
import "./escape.css";

/**
 * A team's classroom (AI 학교 탈출, Task 17) — the scene the player sees after the entering
 * transition. A `PlayShell` on the room's own map (collision, camera, click-move and the HUD's room
 * name all read it through `setActiveMap`), under the same bright-day lighting as the hall, with the
 * room's 3D model (CounselRoom: counsel.glb, loaded only now), the classroom HUD (clock, covers, story
 * box) and the always-on team-chat line above the chat bar.
 *
 * The chat bar is the shell's own; it binds to the ACTIVE room, which is this classroom while it is
 * open (`getActiveRoom`), so what is typed here is the team's chat. App mounts the scene keyed by
 * `escapeEpoch`, so a classroom reconnect remounts it (chat, emoji and every room binding rebind).
 *
 * Story lines: when the room's content arrives its intro lines go into the scene's DialogueQueue,
 * and so does every later `say` event and every hint (Bandit says it). The escape lines go into the same
 * queue (useEscapeFinish).
 *
 * Investigation (Task 18): the room's objects are the context button's targets (useEscapeInteractions);
 * pressing one asks the server for the close-up, which opens the InspectOverlay (on the overlay stack:
 * Esc closes it, the keyboard is held while it is up); a lock on the object shows its plate there (Task 19). The team
 * bag (BagPanel), the lone member's hold ring (HoldRing) and the toast sit with it.
 *
 * The end (Task 20): Bandit's hint button (HintPanel, top right), the last door (FinalePanel — opens for the whole
 * team when the door is ready; unanimous vote on the answer cards) and the escape itself — useEscapeFinish runs the
 * show's clock (the door, EscapeFx's sun and sparkles, the veil's haze lifting), then Ari's lines, then the
 * SummaryCard with its way back to the hall.
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
 * Feed the queue from the escape store while the scene is up (dialogueFeed.ts decides what goes in):
 * the intro lines once — only if the team really starts in its intro, so a refresh mid-game does not
 * replay them — then each new `say` event's line.
 */
function useEscapeDialogue(queue: DialogueQueue): void {
  useEffect(() => {
    queue.clear();
    let feed = { ...FEED_START, seenEvent: useEscapeStore.getState().eventSeq };

    const sync = (s: ReturnType<typeof useEscapeStore.getState>): void => {
      const r = feedDialogue(feed, {
        content: s.content,
        phase: s.view ? s.view.phase : null,
        eventSeq: s.eventSeq,
        lastEvent: s.lastEvent,
      });
      feed = r.next;
      if (r.lines.length > 0) queue.push(r.lines);
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
  // Primitives only: escapeSync rewrites the whole view every second (the clock), and a subscription to it
  // would re-render the scene (and rebuild its slots) once a second.
  const hasView = useEscapeStore((s) => s.view !== null);
  const roomId = useEscapeStore((s) => s.view?.roomDefId ?? null);
  // The classroom connection (read once per mount: a reconnect remounts this scene).
  const [room] = useState(() => getEscapeRoom() as unknown as PlayersRoom | null);
  // Who I am IN THIS ROOM: team chat and emoji carry the classroom's session id, not the class's (the
  // identity App hands over is the hall's), so my own bubble and emoji match only under this one.
  const [self] = useState<Identity>(() => (room ? { ...identity, sessionId: room.sessionId } : identity));
  const [queue] = useState(() => new DialogueQueue());
  useEscapeDialogue(queue);
  useEscapeInteractions(roomId);
  const finish = useEscapeFinish(queue);

  // A fresh scene starts with no close-up open (the store survives a reconnect, the close-up may be stale)
  // and leaves no overlay behind.
  useEffect(() => {
    useEscapeStore.getState().setInspect(null);
    return resetOverlays;
  }, []);

  if (!room || !hasView) return <Waiting text="불러오는 중…" leavable={false} />;
  const active = roomId ? roomActiveMap(roomId) : null;
  if (!roomId || !active) return <Waiting text="이 교실은 아직 준비 중이에요." leavable />;

  return (
    <PlayShell
      identity={self}
      room={room}
      activeMap={active}
      lighting="brightDay"
      effects
      startOrbit={ROOM_START_ORBIT}
      adminPanel={false}
      world3d={
        <>
          <CounselRoom roomId={roomId} />
          <EscapeFx roomId={roomId} />
        </>
      }
      hud={
        <>
          <EscapeVeil mode={finish.mode} />
          <EscapeHud queue={queue} onLeave={LEAVE} />
          <HintPanel />
          <TeamChatNotice />
          <BagPanel />
          <HoldRing />
          <InspectOverlay />
          <FinalePanel queue={queue} />
          <EscapeToast />
          {finish.card && <SummaryCard summary={finish.summary} replay={finish.mode === "replay"} onLeave={LEAVE} />}
        </>
      }
    />
  );
}
