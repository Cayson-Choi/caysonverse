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
 * Start syncing remote players from `room` into the store. `nowMs` is the
 * injected local clock stamped onto every snapshot (no server-clock sync).
 * `selfPose` is the local player's live pose, corrected on large server
 * divergence. Returns a teardown that detaches every listener and clears the
 * store (call on unmount / room leave).
 */
export function startRemoteSync(
  room: Room<WorldState>,
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

    addRemote({
      sessionId,
      nickname: player.nickname,
      character: player.character,
      tint: player.tint,
      connected: player.connected,
      seatIndex: player.seatIndex,
      snapshots: [],
    });
    // Seed with the current position so the avatar shows up immediately.
    pushRemoteSnapshot(sessionId, { t: nowMs(), x: player.x, z: player.z, yaw: player.yaw });

    // onChange fires once per decode batch → exactly one snapshot per patch.
    const offChange = $(player).onChange(() => {
      pushRemoteSnapshot(sessionId, { t: nowMs(), x: player.x, z: player.z, yaw: player.yaw });
    });
    const offConnected = $(player).listen("connected", (value: boolean) => {
      setRemoteConnected(sessionId, value);
    });
    const offSeat = $(player).listen("seatIndex", (value: number) => {
      setRemoteSeat(sessionId, value);
    });
    perPlayer.set(sessionId, [offChange, offConnected, offSeat]);
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
