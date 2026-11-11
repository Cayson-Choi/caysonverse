import { describe, expect, it } from "vitest";
import { TRANSIT } from "@caysonverse/shared/village/transit";
import { BUS_BOARD_REACH_M, transitSnapshotAt, validateBusRide } from "./transitRuntime";

const hour = Math.floor(1_700_000_000_000 / TRANSIT.hourMs) * TRANSIT.hourMs;
const boarding = hour + TRANSIT.hourMs - TRANSIT.boardingMs + 5;
const nearStop = { area: "village", x: TRANSIT.stop.x, z: TRANSIT.stop.z };

describe("VillageRoom transit runtime", () => {
  it("publishes the scheduled pose and signal in one authoritative snapshot", () => {
    const snapshot = transitSnapshotAt(hour + 1_000);
    expect(snapshot.status).toBe("inTransit");
    expect(snapshot.tripId).toBe(hour);
    expect(snapshot.progress).toBeCloseTo(1_000 / TRANSIT.lapMs);
    expect(["green", "amber", "red"]).toContain(snapshot.signal);
  });

  it("accepts a nearby boarding request only in the 30-second boarding window", () => {
    const accepted = validateBusRide({ action: "board" }, { ...nearStop, boarded: false }, boarding);
    expect(accepted).toEqual({ ok: true, tripId: hour + TRANSIT.hourMs });
    expect(BUS_BOARD_REACH_M).toBeGreaterThan(4);

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
    expect(validateBusRide({ action: "board" }, { area: "village", x: TRANSIT.stop.x + BUS_BOARD_REACH_M + 1, z: TRANSIT.stop.z, boarded: false }, boarding).ok).toBe(false);
  });
});
