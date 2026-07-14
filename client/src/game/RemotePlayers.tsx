import { Suspense, useEffect, useSyncExternalStore } from "react";
import { useGLTF } from "@react-three/drei";
import { getRoom } from "../net/connection";
import { startRemoteSync } from "./remoteSync";
import { getRoster, subscribeRoster } from "./remoteStore";
import { RemotePlayer } from "./RemotePlayer";
import { CHARACTERS } from "./constants";
import type { Pose } from "./types";

/**
 * Roster container. Wires the Colyseus state callbacks into the remote store
 * once (and tears them down on unmount), then mounts exactly one <RemotePlayer>
 * per remote session id. React only re-renders when the roster changes (join/
 * leave) — never on movement, which streams through the store directly.
 *
 * `selfPose` is threaded through so the sync layer can apply self kick-back
 * corrections to the local player's live pose.
 */
export function RemotePlayers({ selfPose }: { selfPose: Pose }) {
  useEffect(() => {
    const room = getRoom();
    if (!room) return;
    // Warm the loader cache for every character now that we're in-world, so a
    // joining remote of any preset appears without a hitch (dedupes with the
    // local player's already-loaded model). Not done at module load — that would
    // fetch every GLB on the entry screen before the user even joins.
    for (const preset of CHARACTERS) useGLTF.preload(preset.model);
    return startRemoteSync(room, () => performance.now(), selfPose);
  }, [selfPose]);

  const roster = useSyncExternalStore(subscribeRoster, getRoster, getRoster);

  return (
    <>
      {roster.map((sessionId) => (
        // Per-avatar Suspense so one remote's model load never blanks the others
        // (or the local player, which shares the scene's outer boundary).
        <Suspense key={sessionId} fallback={null}>
          <RemotePlayer sessionId={sessionId} />
        </Suspense>
      ))}
    </>
  );
}
