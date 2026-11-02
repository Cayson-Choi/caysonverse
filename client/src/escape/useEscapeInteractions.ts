import { useEffect } from "react";
import type { RoomId } from "@caysonverse/shared/escape/constants";
import { EscapeMsg } from "@caysonverse/shared/escape/messages";
import { ROOM_MAPS } from "@caysonverse/shared/school/roomMaps";
import type { InteractTarget } from "../game/interact";
import { setTargetHandler, setTargetSource, type TargetPhase } from "../game/interactTargets";
import { getEscapeRoom, sendEscape } from "../net/connection";
import { useEscapeStore } from "../stores/escapeStore";
import { topOverlay } from "../ui/overlayStack";
import { escapeActionsLive, escapeTargets, objectKindOf } from "./escapeTargets";
import { openFinale } from "./finaleStore";
import { holdConfirmed, holdPress, holdRelease, holdStopped, resetHold } from "./holdSession";
import { noteInspectRequest } from "./inspectRequests";
import { coopEventText } from "./ui/lockInput";

/** The shared empty answer (nothing offered): the ~5 Hz source allocates nothing when it has nothing to say. */
const NO_TARGETS: readonly InteractTarget[] = Object.freeze([]);

/** The team's toast when a lock opens. */
const LOCK_OPENED_TEXT = "자물쇠가 열렸어요!";

/**
 * Let go of a hold: tell the server (`HoldEnd` — always accepted, it can only end the sender's own hold) and
 * drop the ring. Nothing is sent when nothing was pressed.
 */
function releaseHold(): void {
  const id = holdRelease();
  if (id !== null) sendEscape(EscapeMsg.HoldEnd, { objectId: id });
}

/**
 * A coop switch (a key on a wall): two members press theirs within COOP_WINDOW_MS, or a lone member holds one
 * for SOLO_HOLD_MS. The button decided which by the target (`hold` is set only for a lone member).
 * A hold target is pressed now and released when the finger / key lets go — and on every other way out
 * (ActionButton calls "release" for each; this file adds the scene ending and the page going).
 */
function pressSwitch(target: InteractTarget, phase: TargetPhase): void {
  if (phase === "release") {
    releaseHold();
    return;
  }
  if (target.hold) {
    holdPress(target.id);
    sendEscape(EscapeMsg.HoldStart, { objectId: target.id });
  } else {
    sendEscape(EscapeMsg.Press, { objectId: target.id });
  }
}

/**
 * Plug the classroom's objects into the context button (game/interactTargets.ts) for the scene's lifetime
 * (Task 18, 19). The source runs at the button's ~5 Hz pass and reads the escape store through getState():
 * it offers nothing while an overlay is open (the close-up covers the room), until the room's content
 * and state are here, or while the game is not live (intro, paused, time up, escaped, ended).
 *
 * Pressing a target asks the server for the close-up (`Inspect`): the answer comes back to the asker only
 * and opens the InspectOverlay. A coop switch is not inspected: with a partner it sends `Press` (and the
 * team's `coop` event becomes the toast "○○님이 서쪽 열쇠를 잡았어요! 2초 안에 함께 돌려요"); alone it is a
 * hold — `HoldStart` on the press, `HoldEnd` on the release, the ring (HoldRing) drawn from the server's
 * `hold` event until its `coopDone`.
 *
 * The last door ("door" kind) opens the FinalePanel while the team is in its last-door phase (Task 20).
 *
 * It also turns the room's events into what the player sees here: that toast, the ring starting and
 * stopping, and "자물쇠가 열렸어요!" when any lock opens.
 */
export function useEscapeInteractions(roomId: RoomId | null): void {
  useEffect(() => {
    const map = roomId === null ? undefined : ROOM_MAPS[roomId];
    if (!map) return;
    setTargetSource((pose) => {
      if (topOverlay() !== null) return NO_TARGETS;
      const s = useEscapeStore.getState();
      if (s.content === null || s.view === null || !escapeActionsLive(s.view)) return NO_TARGETS;
      return escapeTargets(pose.x, pose.z, map.anchors, s.content, s.view.flags, map.visuals, s.view.solo);
    });
    setTargetHandler((target, phase) => {
      const kind = objectKindOf(useEscapeStore.getState().content, target.id);
      if (kind === null) return;
      if (kind === "switch") {
        pressSwitch(target, phase);
        return;
      }
      if (phase !== "press") return;
      // The last door, once it is ready: the team's vote on Ari (FinalePanel) instead of a plain close-up.
      // Before that the door is a close-up like any other ("아리가 문을 잠그고 있어요.").
      if (kind === "door" && useEscapeStore.getState().view?.phase === "finale") {
        openFinale();
        return;
      }
      noteInspectRequest(target.id); // the close-up that comes back is wanted (inspectRequests.ts)
      sendEscape(EscapeMsg.Inspect, { objectId: target.id });
    });

    // The room's events, as the player sees them here. (An event that was already there at mount is not replayed.)
    let seen = useEscapeStore.getState().eventSeq;
    const offEvents = useEscapeStore.subscribe((s) => {
      if (s.eventSeq === seen) return;
      seen = s.eventSeq;
      const ev = s.lastEvent;
      if (ev === null || s.content === null) return;
      switch (ev.e) {
        case "coop": {
          const text = coopEventText(ev, s.content.objects, s.view?.members ?? []);
          if (text !== null) s.showToast(text);
          break;
        }
        case "hold":
          // Only my own hold draws a ring (a lone member is the only one who can hold).
          if (!ev.on) holdStopped();
          else if (ev.by === getEscapeRoom()?.sessionId) holdConfirmed(ev.objectId, performance.now());
          break;
        case "coopDone":
          holdStopped();
          break;
        case "solved":
          if (s.content.locks.some((l) => l.id === ev.lockId)) s.showToast(LOCK_OPENED_TEXT);
          break;
      }
    });

    // The page going away with the key / finger down: tell the server before the connection goes.
    window.addEventListener("pagehide", releaseHold);

    return () => {
      window.removeEventListener("pagehide", releaseHold);
      offEvents();
      releaseHold(); // the scene ends mid-hold
      resetHold();
      setTargetSource(null);
      setTargetHandler(null);
    };
  }, [roomId]);
}
