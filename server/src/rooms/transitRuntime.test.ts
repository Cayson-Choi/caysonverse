import { describe, expect, it } from "vitest";
import { TRANSIT } from "@caysonverse/shared/village/transit";
import { VILLAGE_LAYOUT, busBoardingArea } from "@caysonverse/shared/village/villageLayout";
import { BUS_BOARD_REACH_M, riderOnTrip, transitSnapshotAt, validateBusRide } from "./transitRuntime";

const hour = Math.floor(1_700_000_000_000 / TRANSIT.departureEveryMs) * TRANSIT.departureEveryMs;
const boarding = hour + TRANSIT.departureEveryMs - TRANSIT.boardingMs + 5;
const nearStop = { area: "village", x: TRANSIT.stop.x, z: TRANSIT.stop.z };

describe("VillageRoom transit runtime", () => {
  it("publishes the scheduled pose and signal in one authoritative snapshot", () => {
    const snapshot = transitSnapshotAt(hour + 1_000);
    expect(snapshot.serverMs).toBe(hour + 1_000); // the clock the client's lamps run on (review r2)
    expect(snapshot.status).toBe("inTransit");
    expect(snapshot.tripId).toBe(hour);
    expect(snapshot.progress).toBeGreaterThan(0);
    expect(snapshot.progress).toBeLessThan(0.01);
    expect(["green", "amber", "red"]).toContain(snapshot.signal);
  });

  it("tells clients the bus is waiting at a red crosswalk signal, and not moving while it waits", () => {
    const a = transitSnapshotAt(hour + 35_000);
    const b = transitSnapshotAt(hour + 37_000);
    expect(a.waiting).toBe(true);
    expect(a.signal).toBe("red");
    expect(a.pedestrianSignal).toBe("flashing");
    expect([b.x, b.z, b.progress]).toEqual([a.x, a.z, a.progress]);
    const moving = transitSnapshotAt(hour + 10_000);
    expect(moving.waiting).toBe(false);
    expect(moving.signal).toBe("green");
  });

  it("keeps a rider who boarded before the hour on the bus through the wait and the lap, and drops them at the stop", () => {
    const rider = hour + TRANSIT.departureEveryMs; // boarded in the 30 s before the next hour: that trip's id
    expect(riderOnTrip(transitSnapshotAt(boarding), rider)).toBe(true); // still waiting for the departure
    expect(riderOnTrip(transitSnapshotAt(rider + 5_000), rider)).toBe(true); // the lap
    expect(riderOnTrip(transitSnapshotAt(rider + 100_000), rider)).toBe(true);
    expect(riderOnTrip(transitSnapshotAt(rider + TRANSIT.lapMs + 60_000), rider)).toBe(false); // back at the stop
    expect(riderOnTrip(transitSnapshotAt(rider + TRANSIT.departureEveryMs - 5_000), rider)).toBe(false); // the next trip is up
    expect(riderOnTrip(transitSnapshotAt(boarding), null)).toBe(false);
  });

  it("accepts a nearby boarding request only in the 30-second boarding window", () => {
    const accepted = validateBusRide({ action: "board" }, { ...nearStop, boarded: false }, boarding);
    expect(accepted).toEqual({ ok: true, tripId: hour + TRANSIT.departureEveryMs });
    expect(BUS_BOARD_REACH_M).toBeGreaterThan(0.5);
    // review r2: every free spot under the shelter boards, its south end and its middle included (7.0 m from the bus's centre)
    const s = VILLAGE_LAYOUT.busStop.shelter;
    for (const dz of [-1.5, 0, 1.5]) {
      expect(validateBusRide({ action: "board" }, { area: "village", x: s.centre.x, z: s.centre.z + dz, boarded: false }, boarding).ok).toBe(true);
    }

    const tooEarly = validateBusRide({ action: "board" }, { ...nearStop, boarded: false }, hour + 1_000);
    expect(tooEarly.ok).toBe(false);
  });

  it("rejects duplicate board/leave requests and validates the stop area", () => {
    expect(validateBusRide({ action: "board" }, { ...nearStop, boarded: true }, boarding)).toEqual({
      ok: false,
      notice: "이미 버스에 타고 있어요.",
    });
    expect(validateBusRide({ action: "leave" }, { ...nearStop, boarded: false }, boarding)).toEqual({
      ok: false,
      notice: "지금은 버스에 타고 있지 않아요.",
    });
    expect(validateBusRide({ action: "board" }, { area: "hall", x: TRANSIT.stop.x, z: TRANSIT.stop.z, boarded: false }, boarding).ok).toBe(false);
    const area = busBoardingArea();
    expect(validateBusRide({ action: "board" }, { area: "village", x: area.maxX + BUS_BOARD_REACH_M + 0.2, z: TRANSIT.stop.z, boarded: false }, boarding).ok).toBe(false);
    expect(validateBusRide({ action: "board" }, { area: "village", x: TRANSIT.stop.x, z: area.maxZ + BUS_BOARD_REACH_M + 0.2, boarded: false }, boarding).ok).toBe(false);
  });
});
