/**
 * Colyseus 0.17 state-callback wiring. Bridges the synced `WorldState.players`
 * MapSchema into the module-level remote store (remoteStore.ts) using the 0.17
 * Callbacks API — `getStateCallbacks(room)` → `$(state).players.onAdd/onRemove`,
 * and per-instance `$(player).onChange` / `.listen(field)`. It also owns the
 * self kick-back correction. No React here; the store is the boundary.
 */

import { getStateCallbacks, type Room } from "@colyseus/sdk";
// TYPE-ONLY: schema decorators must never enter the browser bundle.
import type { WorldState } from "@caysonverse/shared/schema";
import { pickAppearance } from "@caysonverse/shared/appearance";
import { placeTransition, showsInHub } from "./placeFilter";
import type { Pose, SeatState } from "./types";
import { exceedsSnapDistance } from "./interpolation";
import {
  addRemote,
  clearRemotes,
  pushRemoteSnapshot,
  removeRemote,
  setRemoteConnected,
  setRemoteSeat,
} from "./remoteStore";

/**
 * Any room whose state has the synced players map — the legacy world, a class (its hall) or a
 * team classroom. (Room's generic is invariant, so callers holding a narrower handle cast.)
 */
export type PlayersRoom = Room<{ players: WorldState["players"] }>;

/**
 * Start syncing remote players from `room` into the store. `nowMs` is the
 * injected local clock stamped onto every snapshot (no server-clock sync).
 * `selfPose` is the local player's live pose, corrected on large server
 * divergence. Returns a teardown that detaches every listener and clears the
 * store (call on unmount / room leave).
 *
 * Place (AI 학교 탈출, Task 15): a remote whose `place` is not the hall (inside a team
 * classroom) has no avatar here — it is taken out of the store when it goes in and put back,
 * at its current position, when it comes out (placeFilter.ts). In the world every place is
 * the hall, so nothing changes there.
 */
export function startRemoteSync(
  room: PlayersRoom,
  nowMs: () => number,
  selfPose: Pose,
  selfSeat: SeatState,
): () => void {
  const $ = getStateCallbacks(room);
  const selfId = room.sessionId;

  // Per-session listener detachers, so a leave removes exactly its own listeners.
  const perPlayer = new Map<string, Array<() => void>>();

  const detach = (sessionId: string): void => {
    const offs = perPlayer.get(sessionId);
    if (!offs) return;
    for (const off of offs) off();
    perPlayer.delete(sessionId);
  };

  const offAdd = $(room.state).players.onAdd((player, sessionId: string) => {
    if (sessionId === selfId) {
      // My own player: ignore normal echoes (client prediction wins), but snap
      // to the server value on a large divergence (it clamped/rejected a move).
      const off = $(player).onChange(() => {
        if (exceedsSnapDistance(selfPose.x, selfPose.z, player.x, player.z)) {
          selfPose.x = player.x;
          selfPose.z = player.z;
        }
      });
      // Seat is server-authoritative: mirror my own seatIndex into the shared
      // SeatState so LocalPlayer confirms sit/stand from the schema, never
      // optimistically. Seeds the current value immediately.
      selfSeat.index = player.seatIndex;
      const offSeat = $(player).listen("seatIndex", (value: number) => {
        selfSeat.index = value;
      });
      perPlayer.set(sessionId, [off, offSeat]);
      return;
    }

    // (Re)add the avatar from the player's CURRENT fields — on join, and when it comes back
    // into the hall from a classroom.
    const show = (): void => {
      addRemote({
        sessionId,
        nickname: player.nickname,
        // Fixed for the session by the server (written once at join): read once, no listener.
        appearance: pickAppearance(player),
        connected: player.connected,
        seatIndex: player.seatIndex,
        role: player.role, // fixed for the session by the server: read once, no listener
        snapshots: [],
      });
      // Seed with the current position so the avatar shows up immediately.
      pushRemoteSnapshot(sessionId, { t: nowMs(), x: player.x, z: player.z, yaw: player.yaw });
    };
    let shown = showsInHub(player.place);
    if (shown) show();

    // In / out of a team classroom (the immediate first call changes nothing).
    const offPlace = $(player).listen("place", (value: number) => {
      const change = placeTransition(shown, value);
      if (change === "add") show();
      else if (change === "remove") removeRemote(sessionId);
      if (change !== null) shown = change === "add";
    });

    // onChange fires once per decode batch → exactly one snapshot per patch (a no-op for a
    // remote not on screen: the store drops snapshots of unknown ids).
    const offChange = $(player).onChange(() => {
      pushRemoteSnapshot(sessionId, { t: nowMs(), x: player.x, z: player.z, yaw: player.yaw });
    });
    const offConnected = $(player).listen("connected", (value: boolean) => {
      setRemoteConnected(sessionId, value);
    });
    const offSeat = $(player).listen("seatIndex", (value: number) => {
      setRemoteSeat(sessionId, value);
    });
    perPlayer.set(sessionId, [offPlace, offChange, offConnected, offSeat]);
  }, true); // immediate → replay players already present when we joined

  const offRemove = $(room.state).players.onRemove((_player, sessionId: string) => {
    detach(sessionId);
    removeRemote(sessionId);
  });

  return () => {
    offAdd();
    offRemove();
    for (const sessionId of [...perPlayer.keys()]) detach(sessionId);
    clearRemotes();
  };
}
