import { TRANSIT, busTripAt, pedestrianSignalAt, signalAt } from "@caysonverse/shared/village/transit";
import type {
  BusRejectedPayload,
  BusRidePayload,
  BusStatePayload,
} from "@caysonverse/shared/messages";

/** The server's proximity gate around the east-side bus stop. */
export const BUS_BOARD_REACH_M = 4.5;

/** How often the room publishes the authoritative bus pose. */
export const BUS_STATE_RATE_MS = 250;

/** The one payload shape broadcast to every village client. */
export function transitSnapshotAt(utcMs: number): BusStatePayload {
  const trip = busTripAt(utcMs);
  return {
    tripId: trip.tripId,
    status: trip.status,
    progress: trip.progress,
    x: trip.pose.x,
    z: trip.pose.z,
    yaw: trip.pose.yaw,
    signal: signalAt(utcMs).color,
    pedestrianSignal: pedestrianSignalAt(utcMs).color,
  };
}

export type BusRideDecision =
  | { ok: true; tripId: number }
  | { ok: false; notice: BusRejectedPayload["reason"] };

/**
 * Authoritative board/leave validation. The room keeps the resulting `boarded`
 * bit in its private tracking; this helper makes duplicate requests and the
 * distance/phase gates deterministic and easy to test without a live room.
 */
export function validateBusRide(
  payload: unknown,
  state: { boarded: boolean; area: string; x: number; z: number },
  utcMs: number,
): BusRideDecision {
  if (payload === null || typeof payload !== "object") return { ok: false, notice: "버스 요청을 이해하지 못했어요." };
  const action = (payload as Partial<BusRidePayload>).action;
  if (action !== "board" && action !== "leave") return { ok: false, notice: "버스 요청을 이해하지 못했어요." };

  const trip = busTripAt(utcMs);
  if (action === "leave") {
    if (!state.boarded) return { ok: false, notice: "지금은 버스에 타고 있지 않아요." };
    return { ok: true, tripId: state.boarded ? trip.tripId : -1 };
  }

  if (state.boarded) return { ok: false, notice: "이미 버스에 타고 있어요." };
  if (state.area !== "village") return { ok: false, notice: "버스 정류장 근처에서만 탈 수 있어요." };
  if (trip.status !== "boarding") return { ok: false, notice: "버스는 매시 출발 30초 전부터 탈 수 있어요." };
  if (!Number.isFinite(state.x) || !Number.isFinite(state.z)) return { ok: false, notice: "버스 정류장 근처에서만 탈 수 있어요." };
  if (Math.hypot(state.x - TRANSIT.stop.x, state.z - TRANSIT.stop.z) > BUS_BOARD_REACH_M) {
    return { ok: false, notice: "버스 정류장 근처에서만 탈 수 있어요." };
  }
  return { ok: true, tripId: trip.tripId };
}
