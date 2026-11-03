import { Suspense, useEffect, useSyncExternalStore } from "react";
import { getRoom } from "../net/connection";
import { startRemoteSync, type PlayersRoom } from "./remoteSync";
import type { AreaGate } from "./areaFilter";
import { getRoster, subscribeRoster } from "./remoteStore";
import { RemotePlayer } from "./RemotePlayer";
import { preloadCharacterAssets } from "./useAvatar";
import type { Pose, SeatState } from "./types";

/**
 * Roster container. Wires the Colyseus state callbacks into the remote store
 * once (and tears them down on unmount), then mounts exactly one <RemotePlayer>
 * per remote session id. React only re-renders when the roster changes (join/
 * leave) — never on movement, which streams through the store directly.
 *
 * `selfPose` is threaded through so the sync layer can apply self kick-back
 * corrections to the local player's live pose.
 *
 * With an `areas` gate (케이슨 마을) the roster holds only the players in the local player's area, so a
 * player in the other area is not mounted at all (remoteSync / areaFilter.ts).
 */
export function RemotePlayers({
  selfPose,
  selfSeat,
  blobShadow,
  room: roomProp,
  areas,
}: {
  selfPose: Pose;
  /** The local player's server-confirmed seat (written by the schema sync). */
  selfSeat: SeatState;
  /** Draw blob shadows under remote avatars (low-spec/touch profile). */
  blobShadow: boolean;
  /** The room whose players to show (a PlayShell scene passes its own); default: the main room. */
  room?: PlayersRoom;
  /** 케이슨 마을: the local player's area; only the avatars of that area are mounted. Absent elsewhere. */
  areas?: AreaGate;
}) {
  useEffect(() => {
    const room: PlayersRoom | null = roomProp ?? (getRoom() as unknown as PlayersRoom | null);
    if (!room) return;
    // Warm the loader cache now that we're in-world, so a joining remote appears
    // without a hitch: one character.glb assembles every look (it dedupes with the
    // entry screen's preload and the local player's already-loaded model).
    preloadCharacterAssets();
    return startRemoteSync(room, () => performance.now(), selfPose, selfSeat, areas);
  }, [selfPose, selfSeat, roomProp, areas]);

  const roster = useSyncExternalStore(subscribeRoster, getRoster, getRoster);

  return (
    <>
      {roster.map((sessionId) => (
        // Per-avatar Suspense so one remote's model load never blanks the others
        // (or the local player, which shares the scene's outer boundary).
        <Suspense key={sessionId} fallback={null}>
          <RemotePlayer sessionId={sessionId} blobShadow={blobShadow} />
        </Suspense>
      ))}
    </>
  );
}
