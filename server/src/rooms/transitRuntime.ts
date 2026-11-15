import { boardingOpensWords, pedestrianSignalAt, signalAt, type BusTrip } from "@caysonverse/shared/village/transit";
import { busDriveTrip, scheduledDrive, type BusDrive } from "@caysonverse/shared/village/busDrive";
import { busBoardingDistance } from "@caysonverse/shared/village/villageLayout";
import type {
  BusRejectedPayload,
  BusRidePayload,
  BusStatePayload,
} from "@caysonverse/shared/messages";

/**
 * The server's proximity gate at the east-side bus stop: how far (m) outside the boarding area (the bus, the waiting pad
 * and the shelter, villageLayout.ts busBoardingArea) a rider may still board. Review r2: it was a 7.2 m circle round the
 * bus's centre, which left the shelter's south end out. The client offers the button a little tighter (BUS_OFFER_REACH_M).
 */
export const BUS_BOARD_REACH_M = 1.2;

/** How often the room publishes the authoritative bus pose. */
export const BUS_STATE_RATE_MS = 250;

/**
 * The one payload shape broadcast to every village client: the bus under `drive` (the room's BusDriver; the timetable's
 * own drive by default), its pose for old clients and the drive itself for the current ones.
 */
export function transitSnapshotAt(
  utcMs: number,
  drive: BusDrive = scheduledDrive(utcMs),
  extra: { blocked?: boolean; horn?: number } = {},
): BusStatePayload {
  const trip = busDriveTrip(drive, utcMs);
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
    serverMs: utcMs,
    drive: { ...drive, brake: drive.brake ? { ...drive.brake } : null },
    blocked: extra.blocked === true,
    horn: extra.horn ?? 0,
  };
}

/**
 * Whether a rider boarded on trip `riderTripId` is still on it, given the published snapshot: from boarding (the 3 min before
 * the hour, when the trip's id is the coming hour's) through the lap; not once the bus is back at the stop or a later trip is up.
 */
export function riderOnTrip(snapshot: Pick<BusStatePayload, "tripId" | "status">, riderTripId: number | null): boolean {
  return riderTripId !== null && snapshot.tripId === riderTripId && (snapshot.status === "inTransit" || snapshot.status === "boarding");
}

/** A leave asked for while the bus is out on its lap (owner 2026-11-15: the rider is in the bus, not left on the pad). */
export const BUS_LEAVE_MOVING_NOTICE = "버스가 달리는 중이에요. 정류장에 돌아오면 내려요.";

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
  trip: BusTrip = busDriveTrip(scheduledDrive(utcMs), utcMs),
): BusRideDecision {
  if (payload === null || typeof payload !== "object") return { ok: false, notice: "버스 요청을 이해하지 못했어요." };
  const action = (payload as Partial<BusRidePayload>).action;
  if (action !== "board" && action !== "leave") return { ok: false, notice: "버스 요청을 이해하지 못했어요." };

  if (action === "leave") {
    if (!state.boarded) return { ok: false, notice: "지금은 버스에 타고 있지 않아요." };
    // The doors open only at the stop: a rider on the lap gets off when the bus is back (the ride ends there by itself).
    if (trip.status === "inTransit") return { ok: false, notice: BUS_LEAVE_MOVING_NOTICE };
    return { ok: true, tripId: state.boarded ? trip.tripId : -1 };
  }

  if (state.boarded) return { ok: false, notice: "이미 버스에 타고 있어요." };
  if (state.area !== "village") return { ok: false, notice: "버스 정류장 근처에서만 탈 수 있어요." };
  if (trip.status !== "boarding") return { ok: false, notice: `버스는 10분마다(정각, 10분, 20분 …) 출발해요. 출발 ${boardingOpensWords()} 전부터 탈 수 있어요.` };
  if (!Number.isFinite(state.x) || !Number.isFinite(state.z)) return { ok: false, notice: "버스 정류장 근처에서만 탈 수 있어요." };
  if (busBoardingDistance(state.x, state.z) > BUS_BOARD_REACH_M) {
    return { ok: false, notice: "버스 정류장 근처에서만 탈 수 있어요." };
  }
  return { ok: true, tripId: trip.tripId };
}
