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
import { selfRide } from "../land/coasterRide";
import { noteSelfBusSeat } from "../net/transitSync";
import { createPlayout } from "./playout";
import {
  createEchoWatch,
  healDeadline,
  noteEcho,
  noteRefusal,
  onServerRefusal,
  RESYNC_EPS,
  requestPoseResend,
  resolveRefusal,
  selfDiverged,
} from "./sentMoves";
import { useClickHint } from "../stores/clickHintStore";

/** The line shown when the self-correction puts me back where the server has me (fix/net-sync: never a silent jump). */
export const RESYNC_HINT = "연결이 잠시 느려서 서버가 아는 자리로 돌아왔어요.";
/** How often (ms) a player standing still is compared with where the server has them (two still looks before acting). */
export const IDLE_RESYNC_MS = 1000;
/** A snap shorter than this (m) is not worth a line (it is barely seen). */
const RESYNC_HINT_MIN_M = 1;
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
      const lookAgainAt = (deadline: number): void => {
        if (recheck !== undefined) return;
        recheck = setTimeout(
          () => {
            recheck = undefined;
            correct();
          },
          Math.max(0, deadline - nowMs()),
        );
      };
      const snapToServer = (): void => {
        const gap = Math.hypot(selfPose.x - player.x, selfPose.z - player.z);
        selfPose.x = player.x;
        selfPose.z = player.z;
        if (gap >= RESYNC_HINT_MIN_M) useClickHint.getState().show(RESYNC_HINT);
      };
      const correct = (): void => {
        const echoed = moverClock(player);
        const verdict = noteEcho(watch, echoed, nowMs());
        if (verdict === "healing") {
          lookAgainAt(healDeadline(watch));
          return;
        }
        if (recheck !== undefined) {
          clearTimeout(recheck);
          recheck = undefined;
        }
        if (verdict === "refused") {
          // It has not taken a Move for a heal window: a small gap gets my pose sent once more (taken unseen), a large one — or a
          // resent pose refused too — puts me where the server has me, with a short line (fix/net-sync).
          const action = resolveRefusal(watch, selfPose, player, nowMs());
          if (action === "resend") {
            requestPoseResend();
            lookAgainAt(healDeadline(watch));
          } else if (action === "snap") snapToServer();
          return;
        }
        if (selfDiverged(selfPose, player, echoed)) {
          selfPose.x = player.x;
          selfPose.z = player.z;
        }
      };
      const offCorrect = $(player).onChange(correct);
      // The server's own word that it refused a Move or a press (net/serverRefusals.ts): a refusal that changes no synced field
      // (the echo was 0 already) is seen too, and judged like any other at the end of its heal window.
      const offRefused = onServerRefusal(() => {
        noteRefusal(watch, moverClock(player), nowMs());
        correct();
      });
      // Standing still with the server somewhere else (fix/net-sync, the phone e2e: the last Moves of a walk were lost on the way, so
      // the server neither took nor refused them, and nothing ever came to correct): still for 2-3 looks of IDLE_RESYNC_MS, my pose is sent
      // once more — the server takes it (the gap closes) or refuses it (its notice, then the usual heal window) — and if a gap is still
      // there at the next look, I am put where the server has me. Held places (a bench, the bus, a ride) are the server's: left alone.
      let stillX = Number.NaN;
      let stillZ = Number.NaN;
      let stillLooks = 0;
      let idleResent = false;
      const idleTimer = setInterval(() => {
        const still = Math.hypot(selfPose.x - stillX, selfPose.z - stillZ) < 0.01;
        stillX = selfPose.x;
        stillZ = selfPose.z;
        const held = selfSeat.index >= 0 || selfBusRide.slot >= 0 || selfRide.slot >= 0;
        const gap = Math.hypot(selfPose.x - player.x, selfPose.z - player.z);
        if (!still || held || !Number.isNaN(watch.refusedAt) || gap <= RESYNC_EPS) {
          stillLooks = 0;
          if (gap <= RESYNC_EPS || !still) idleResent = false;
          return;
        }
        if (++stillLooks < 2) return;
        stillLooks = 0;
        if (!idleResent) {
          idleResent = true;
          requestPoseResend();
        } else {
          idleResent = false;
          snapToServer();
        }
      }, IDLE_RESYNC_MS);
      const off = (): void => {
        offCorrect();
        offRefused();
        clearInterval(idleTimer);
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
      selfBusRide.ahead = player.busAhead ?? 0;
      selfBusRide.right = player.busRight ?? 0;
      selfBusRide.yaw = player.busYaw ?? 0;
      noteSelfBusSeat(selfBusRide.slot);
      const offBus = $(player).listen("busSeat", (value: number) => {
        selfBusRide.slot = value ?? -1;
        noteSelfBusSeat(selfBusRide.slot);
      });
      // My seat on the 별똥별 급행 (land/coasterRide.ts): the camera is the car's while it is >= 0.
      selfRide.slot = player.rideSeat ?? -1;
      selfRide.ride = player.rideId ?? 0;
      const offRide = $(player).listen("rideSeat", (value: number) => {
        selfRide.slot = value ?? -1;
        selfRide.ride = player.rideId ?? 0;
      });
      const offRideId = $(player).listen("rideId", (value: number) => {
        selfRide.ride = value ?? 0;
      });
      const offBusPoint = $(player).onChange(() => {
        selfBusRide.ahead = player.busAhead ?? 0;
        selfBusRide.right = player.busRight ?? 0;
        selfBusRide.yaw = player.busYaw ?? 0;
      });
      const offs = [off, offSeat, offBus, offBusPoint, offRide, offRideId];
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
            // step refused. A door (and a house's stair, 집 실내 G) is always the server's placement: take it whole.
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
        rideSeat: player.rideSeat ?? -1,
        rideId: player.rideId ?? 0,
        busAhead: player.busAhead ?? 0,
        busRight: player.busRight ?? 0,
        busYaw: player.busYaw ?? 0,
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
    // ... and its point in the bus's own frame (walking, sitting, holding): drawn in that frame (RemotePlayer).
    const offBusPoint = $(player).onChange(() => {
      const record = getRemoteRecord(sessionId);
      if (!record) return;
      record.busSeat = player.busSeat ?? -1;
      record.rideSeat = player.rideSeat ?? -1;
      record.rideId = player.rideId ?? 0;
      record.busAhead = player.busAhead ?? 0;
      record.busRight = player.busRight ?? 0;
      record.busYaw = player.busYaw ?? 0;
    });
    perPlayer.set(sessionId, [...offArea, offChange, offConnected, offSeat, offBus, offBusPoint]);
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
