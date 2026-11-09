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
import { visibilityChange, showsInHub } from "./placeFilter";
import { normalizeArea, showsInArea, type AreaGate } from "./areaFilter";
import type { Pose, SeatState } from "./types";
import { createPlayout } from "./playout";
import { createEchoWatch, healDeadline, noteEcho, selfDiverged } from "./sentMoves";
import {
  addRemote,
  clearRemotes,
  receiveRemotePose,
  removeRemote,
  setRemoteConnected,
} from "./remoteStore";

/**
 * The mover's clock at its synced pose (`Player.moveT`), 0 when there is none — including a server that predates
 * the field (the decoded player simply lacks it), so a new client still works against an old server.
 */
function moverClock(player: { moveT?: number }): number {
  const t = player.moveT;
  return typeof t === "number" && Number.isFinite(t) ? t : 0;
}

/**
 * Any room whose state has the synced players map — the legacy world, a class (its hall) or a
 * team classroom. (Room's generic is invariant, so callers holding a narrower handle cast.)
 */
export type PlayersRoom = Room<{ players: WorldState["players"] }>;

/**
 * Start syncing remote players from `room` into the store. `nowMs` is the
 * injected local clock: every received pose is stamped with its arrival, and with
 * the mover's own clock (`Player.moveT`) when the server echoes one — playout.ts
 * times the walk by the latter (see there).
 * `selfPose` is the local player's live pose, corrected on large server
 * divergence. Returns a teardown that detaches every listener and clears the
 * store (call on unmount / room leave).
 *
 * Place (AI 학교 탈출, Task 15): a remote whose `place` is not the hall (inside a team
 * classroom) has no avatar here — it is taken out of the store when it goes in and put back,
 * at its current position, when it comes out (placeFilter.ts). In the world every place is
 * the hall, so nothing changes there.
 *
 * Area (케이슨 마을, Task 4): with an `areas` gate (the village scene passes one) a remote in the OTHER area
 * than the local player's is treated the same way (areaFilter.ts) — not in the store, so not mounted. The
 * local player's own `area` is read from the synced state into the gate, and when it changes (a door) every
 * remote is judged again. Without a gate nothing about areas is read.
 */
export function startRemoteSync(
  room: PlayersRoom,
  nowMs: () => number,
  selfPose: Pose,
  selfSeat: SeatState,
  areas?: AreaGate,
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
      // to the server value on a large divergence (it placed me, or refused my moves).
      // Judged against where I was at the Move the server last accepted (its echoed
      // moveT), not where I am now — so a late echo is never mistaken for one (sentMoves.ts).
      // A refused Move (the echo went from my stamps to 0) is left alone while the server
      // may still heal it, and judged once it has stayed refused for REFUSAL_HEAL_MS — no
      // patch need come then (the server's pose does not change while it refuses), so a
      // timer looks again at the deadline.
      const watch = createEchoWatch();
      let recheck: ReturnType<typeof setTimeout> | undefined;
      const correct = (): void => {
        const echoed = moverClock(player);
        const verdict = noteEcho(watch, echoed, nowMs());
        if (verdict === "healing") {
          if (recheck === undefined) {
            recheck = setTimeout(
              () => {
                recheck = undefined;
                correct();
              },
              Math.max(0, healDeadline(watch) - nowMs()),
            );
          }
          return;
        }
        if (recheck !== undefined) {
          clearTimeout(recheck);
          recheck = undefined;
        }
        if (selfDiverged(selfPose, player, echoed, verdict === "refused")) {
          selfPose.x = player.x;
          selfPose.z = player.z;
        }
      };
      const offCorrect = $(player).onChange(correct);
      const off = (): void => {
        offCorrect();
        if (recheck !== undefined) clearTimeout(recheck);
        recheck = undefined;
      };
      // Seat is server-authoritative: mirror my own seatIndex into the shared
      // SeatState so LocalPlayer confirms sit/stand from the schema, never
      // optimistically. Seeds the current value immediately.
      selfSeat.index = player.seatIndex;
      const offSeat = $(player).listen("seatIndex", (value: number) => {
        selfSeat.index = value;
      });
      const offs = [off, offSeat];
      // Which area I am in (the village scene's maps, bounds, lighting and filter follow it). Seeds the
      // current value immediately, then follows every door.
      if (areas) {
        let seenArea: string | undefined;
        offs.push(
          $(player).listen("area", (value: string) => {
            // A door puts me down FACING the way the server says (into the room / away from the building). The
            // position is snapped just above; the facing comes with it, so the camera that swings behind me
            // (CameraRig) looks the way I do. The first call is the seed (join, reconnect), not a door.
            if (seenArea !== undefined && seenArea !== value) selfPose.yaw = player.yaw;
            seenArea = value;
            areas.setLocal(normalizeArea(value));
          }),
        );
      }
      perPlayer.set(sessionId, offs);
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
        // The current moveT times a move we never saw (they may have stopped long ago): only a newer one counts.
        playout: createPlayout(moverClock(player)),
      });
      // Seed with the current position so the avatar shows up immediately (no clock: it is a standing pose).
      receiveRemotePose(sessionId, nowMs(), 0, player.x, player.z, player.yaw);
    };
    // Shown = in the hall (not inside a classroom) AND, in the village, in my area. Every field that decides it
    // goes through `reconcile`, which reads them live, so no change can be judged on a stale copy.
    const wanted = (): boolean => showsInHub(player.place) && (!areas || showsInArea(player.area, areas.local()));
    let shown = wanted();
    if (shown) show();
    const reconcile = (): void => {
      const want = wanted();
      const change = visibilityChange(shown, want);
      if (change === "add") show();
      else if (change === "remove") removeRemote(sessionId);
      shown = want;
    };

    // In / out of a team classroom (the immediate first call changes nothing).
    const offPlace = $(player).listen("place", reconcile);
    // Through the village's door (theirs), or my own going through it (the gate): in / out of my area.
    const offArea = areas ? [$(player).listen("area", reconcile), areas.subscribe(reconcile)] : [];

    // onChange fires once per decode batch → at most one snapshot per patch (a no-op for a remote not on
    // screen: the store drops poses of unknown ids; and a patch that changed no pose stores nothing). The seat goes
    // with the pose: a patch that changes it also put the player on the seat or its dismount spot, and the store
    // stamps the change with that pose's time (remoteSeat.ts). The seat listener takes the same path, so whichever
    // of the two callbacks the decoder runs first handles the patch, and the other finds nothing new.
    const take = (): void => {
      receiveRemotePose(sessionId, nowMs(), moverClock(player), player.x, player.z, player.yaw, player.seatIndex);
    };
    const offChange = $(player).onChange(take);
    const offConnected = $(player).listen("connected", (value: boolean) => {
      setRemoteConnected(sessionId, value);
    });
    const offSeat = $(player).listen("seatIndex", take);
    perPlayer.set(sessionId, [offPlace, ...offArea, offChange, offConnected, offSeat]);
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
