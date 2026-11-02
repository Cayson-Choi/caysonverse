import { useEffect } from "react";
import type { RoomId } from "@caysonverse/shared/escape/constants";
import { EscapeMsg } from "@caysonverse/shared/escape/messages";
import { ROOM_MAPS } from "@caysonverse/shared/school/roomMaps";
import type { InteractTarget } from "../game/interact";
import { setTargetHandler, setTargetSource } from "../game/interactTargets";
import { sendEscape } from "../net/connection";
import { useEscapeStore } from "../stores/escapeStore";
import { topOverlay } from "../ui/overlayStack";
import { escapeActionsLive, escapeTargets, objectKindOf } from "./escapeTargets";

/** The shared empty answer (nothing offered): the ~5 Hz source allocates nothing when it has nothing to say. */
const NO_TARGETS: readonly InteractTarget[] = Object.freeze([]);

/**
 * Plug the classroom's objects into the context button (game/interactTargets.ts) for the scene's lifetime
 * (Task 18). The source runs at the button's ~5 Hz pass and reads the escape store through getState():
 * it offers nothing while an overlay is open (the close-up covers the room), until the room's content
 * and state are here, or while the game is not live (intro, paused, time up, escaped, ended).
 *
 * Pressing a target asks the server for the close-up (`Inspect`): the answer comes back to the asker only
 * and opens the InspectOverlay. A coop switch is not inspected: its press / hold belongs to Task 19.
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
      if (phase !== "press") return;
      const kind = objectKindOf(useEscapeStore.getState().content, target.id);
      if (kind === null || kind === "switch") return; // Task 19: Press / HoldStart / HoldEnd
      sendEscape(EscapeMsg.Inspect, { objectId: target.id });
    });
    return () => {
      setTargetSource(null);
      setTargetHandler(null);
    };
  }, [roomId]);
}
