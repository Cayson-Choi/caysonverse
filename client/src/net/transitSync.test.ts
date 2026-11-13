import { describe, expect, it, vi } from "vitest";
import { MessageType } from "@caysonverse/shared/messages";
import {
  getTransitRenderPose,
  getTransitState,
  sendBusRide,
  startTransitSync,
  stepTransitRender,
  type TransitRoom,
} from "./transitSync";

function fakeRoom() {
  const handlers = new Map<string, Set<(value: unknown) => void>>();
  const room: TransitRoom = {
    send: vi.fn(),
    onMessage(type, callback) {
      let set = handlers.get(type);
      if (!set) handlers.set(type, (set = new Set()));
      set.add(callback as (value: unknown) => void);
      return () => set!.delete(callback as (value: unknown) => void);
    },
  };
  return {
    room,
    emit(type: string, value: unknown) {
      for (const callback of handlers.get(type) ?? []) callback(value);
    },
  };
}

describe("transitSync", () => {
  it("bridges authoritative snapshots and ride state, and sends board/leave actions", () => {
    const f = fakeRoom();
    const stop = startTransitSync(f.room);
    f.emit(MessageType.BusState, { tripId: 2, status: "inTransit", progress: 0.5, x: 2, z: 3, yaw: 1, signal: "green" });
    f.emit(MessageType.BusRideState, { boarded: true, tripId: 2 });
    expect(getTransitState()).toMatchObject({ boarded: true, tripId: 2, snapshot: { x: 2, signal: "green" } });
    sendBusRide("leave");
    expect(f.room.send).toHaveBeenCalledWith(MessageType.BusRide, { action: "leave" });
    stop();
    expect(getTransitState()).toMatchObject({ boarded: false, snapshot: null });
  });

  it("eases the visual pose toward the latest snapshot without React renders", () => {
    const f = fakeRoom();
    const stop = startTransitSync(f.room);
    f.emit(MessageType.BusState, { tripId: 2, status: "inTransit", progress: 0.5, x: 20, z: 8, yaw: 0.2, signal: "red" });
    const before = getTransitRenderPose();
    stepTransitRender(0.05);
    const after = getTransitRenderPose();
    expect(after.x).toBeGreaterThanOrEqual(before.x);
    expect(after.x).toBeLessThanOrEqual(20);
    stop();
  });
});

describe("the transit clock (review r2: the lamps lagged the bus by about a second)", () => {
  it("runs on the snapshots' server time, taking the quickest delivery of the last few seconds", async () => {
    const { sampleTransitClockForTest, transitNowMs } = await import("./transitSync");
    const stop = startTransitSync(fakeRoom().room);
    // three snapshots: on time (the server's 10_000 seen at 1_000), one 900 ms late (a long frame), one on time
    sampleTransitClockForTest(10_000, 1_000);
    sampleTransitClockForTest(10_250, 2_150);
    sampleTransitClockForTest(10_500, 1_500);
    const now = performance.now();
    expect(Math.abs(transitNowMs() - now - 9_000)).toBeLessThan(50); // the late sample (8_100) does not pull the clock back
    stop();
  });
});

describe("the ride HUD's line (review r2: it said red under a green)", () => {
  it("names the light the bus waits at", async () => {
    const { rideStatusText } = await import("./transitSync");
    expect(rideStatusText(null)).toBe("노선 운행 중");
    expect(rideStatusText({ waiting: false, signal: "red" })).toBe("노선 운행 중");
    expect(rideStatusText({ waiting: true, signal: "red" })).toBe("빨간불 · 신호 대기 중");
    expect(rideStatusText({ waiting: true, signal: "amber" })).toBe("황색불 · 신호 대기 중");
  });
});
