import { TRANSIT, busTripAt, pedestrianSignalAt, signalAt } from "@caysonverse/shared/village/transit";
import type {
  BusRejectedPayload,
  BusRidePayload,
  BusStatePayload,
} from "@caysonverse/shared/messages";

/** The server's proximity gate around the east-side bus stop: the bus's doors and the waiting pad and shelter 6 m behind them (client BUS_OFFER_REACH_M is a little tighter). */
export const BUS_BOARD_REACH_M = 7.2;

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
    waiting: trip.waiting,
  };
}

/**
 * Whether a rider boarded on trip `riderTripId` is still on it, given the published snapshot: from boarding (the 30 s before
 * the hour, when the trip's id is the coming hour's) through the lap; not once the bus is back at the stop or a later trip is up.
 */
export function riderOnTrip(snapshot: Pick<BusStatePayload, "tripId" | "status">, riderTripId: number | null): boolean {
  return riderTripId !== null && snapshot.tripId === riderTripId && (snapshot.status === "inTransit" || snapshot.status === "boarding");
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
