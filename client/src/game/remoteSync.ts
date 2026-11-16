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
import { visibilityChange } from "./placeFilter";
import { normalizeArea, showsInArea, type AreaGate } from "./areaFilter";
import type { Pose, SeatState } from "./types";
import { selfBusRide } from "./busRide";
import { noteSelfBusSeat } from "../net/transitSync";
import { createPlayout } from "./playout";
import { createEchoWatch, healDeadline, noteEcho, selfDiverged } from "./sentMoves";
import {
  addRemote,
  clearRemotes,
  getRemoteRecord,
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
      // My place in the bus (busRide.ts): LocalPlayer draws me there while I ride.
      selfBusRide.slot = player.busSeat ?? -1;
      noteSelfBusSeat(selfBusRide.slot);
      const offBus = $(player).listen("busSeat", (value: number) => {
        selfBusRide.slot = value ?? -1;
        noteSelfBusSeat(selfBusRide.slot);
      });
      const offs = [off, offSeat, offBus];
      // Which area I am in (the village scene's maps, bounds, lighting and filter follow it). Seeds the
      // current value immediately, then follows every door.
      if (areas) {
        let seenArea: string | undefined;
        offs.push(
          $(player).listen("area", (value: string) => {
            // A door puts me down WHERE and FACING the way the server says (into the room / away from the building),
            // so the camera that swings behind me (CameraRig) looks the way I do. The first call is the seed (join,
            // reconnect), not a door. The position is set here, not left to the divergence check above (owner
            // 2026-11-16, live: "추모관 나오기를 했더니 이상한 공간에 들어와서 움직이지도 않아"): through the door and
            // straight back out without a step inside, my echoed stamp still names my last Move at the OUTSIDE door,
            // a metre or two from where the way out puts me, so the check took the new place for that old echo and
            // kept me at the hall's coordinates in the village — an empty grey void, 300 m from anything, every
            // step refused. A door is always the server's placement: take it whole.
            if (seenArea !== undefined && seenArea !== value) {
              selfPose.x = player.x;
              selfPose.z = player.z;
              selfPose.yaw = player.yaw;
            }
            seenArea = value;
            areas.setLocal(normalizeArea(value));
          }),
        );
      }
      perPlayer.set(sessionId, offs);
      return;
    }

    // (Re)add the avatar from the player's CURRENT fields — on join, and when it comes back into my area.
    const show = (): void => {
      addRemote({
        sessionId,
        nickname: player.nickname,
        // Fixed for the session by the server (written once at join): read once, no listener.
        appearance: pickAppearance(player),
        connected: player.connected,
        seatIndex: player.seatIndex,
        busSeat: player.busSeat ?? -1,
        snapshots: [],
        // The current moveT times a move we never saw (they may have stopped long ago): only a newer one counts.
        playout: createPlayout(moverClock(player)),
      });
      // Seed with the current position so the avatar shows up immediately (no clock: it is a standing pose).
      receiveRemotePose(sessionId, nowMs(), 0, player.x, player.z, player.yaw);
    };
    // Shown = in my area. Every field that decides it goes through `reconcile`, which reads them live, so no
    // change can be judged on a stale copy.
    const wanted = (): boolean => !areas || showsInArea(player.area, areas.local());
    let shown = wanted();
    if (shown) show();
    const reconcile = (): void => {
      const want = wanted();
      const change = visibilityChange(shown, want);
      if (change === "add") show();
      else if (change === "remove") removeRemote(sessionId);
      shown = want;
    };

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
    // A rider is drawn in the bus (RemotePlayer, busSeats.ts) from the moment the server gives the place.
    const offBus = $(player).listen("busSeat", (value: number) => {
      const record = getRemoteRecord(sessionId);
      if (record) record.busSeat = value ?? -1;
    });
    perPlayer.set(sessionId, [...offArea, offChange, offConnected, offSeat, offBus]);
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
    selfBusRide.slot = -1;
  };
}
