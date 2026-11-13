import { describe, expect, it, vi } from "vitest";
import { MessageType } from "@caysonverse/shared/messages";
import {
  getTransitRenderPose,
  getTransitState,
  sendBusRide,
  startTransitSync,
  stepTransitRender,
  transitNowMs,
  type TransitRoom,
} from "./transitSync";
import { TRANSIT, busTripAt, routeLength } from "@caysonverse/shared/village/transit";

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

  it("draws the bus from the shared timeline at the synced clock, never from the snapshots' own pose", () => {
    const f = fakeRoom();
    const stop = startTransitSync(f.room);
    const hour = Math.floor(1_700_000_000_000 / TRANSIT.departureEveryMs) * TRANSIT.departureEveryMs;
    const t0 = 5_000;
    const now = vi.spyOn(performance, "now").mockReturnValue(t0);
    // a snapshot whose x/z are rubbish: the pose must come from busTripAt(transitNowMs()), the clock from serverMs
    f.emit(MessageType.BusState, { tripId: hour, status: "inTransit", progress: 0.5, x: 999, z: 999, yaw: 0.2, signal: "red", serverMs: hour + 20_000 });
    const pose = getTransitRenderPose();
    const expected = busTripAt(transitNowMs()).pose;
    expect(pose.x).toBeCloseTo(expected.x, 9);
    expect(pose.z).toBeCloseTo(expected.z, 9);
    expect(pose.yaw).toBeCloseTo(expected.yaw, 9);
    expect(Math.abs(transitNowMs() - (hour + 20_000))).toBeLessThan(1);
    now.mockRestore();
    stop();
  });

  it("moves every frame at the cruise speed between 4 Hz snapshots: no hops, no frozen frames, no easing lag", () => {
    const f = fakeRoom();
    const stop = startTransitSync(f.room);
    const hour = Math.floor(1_700_000_000_000 / TRANSIT.departureEveryMs) * TRANSIT.departureEveryMs;
    const base = hour + 60_000; // well into the first leg, at the cruise
    let mono = 1_000;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => mono);
    const cruise = routeLength() / TRANSIT.lapMs; // m per ms
    let lastSnapshot = -1e9;
    let prev: { x: number; z: number } | null = null;
    let worstLow = Infinity;
    let worstHigh = 0;
    // 20 s at 60 fps with a snapshot every 250 ms, each delivered 20-80 ms after it was stamped (network jitter)
    for (let i = 0; i < 1200; i++) {
      mono += 1000 / 60;
      if (mono - lastSnapshot >= 250) {
        lastSnapshot = mono;
        const lateness = 20 + ((i * 37) % 60);
        f.emit(MessageType.BusState, { tripId: hour, status: "inTransit", progress: 0, x: 0, z: 0, yaw: 0, signal: "green", serverMs: base + (mono - 1_000) - lateness });
      }
      stepTransitRender(1 / 60);
      const p = getTransitRenderPose();
      if (prev) {
        const step = Math.hypot(p.x - prev.x, p.z - prev.z);
        worstLow = Math.min(worstLow, step / (cruise * (1000 / 60)));
        worstHigh = Math.max(worstHigh, step / (cruise * (1000 / 60)));
      }
      prev = { x: p.x, z: p.z };
    }
    // every frame covers the cruise's distance within the clock's 2 % slew (the old easing: 0 to 60x the cruise)
    expect(worstLow).toBeGreaterThan(0.95);
    expect(worstHigh).toBeLessThan(1.05);
    spy.mockRestore();
    stop();
  });

  it("agrees with the server's snapshot pose at the same server time (one shared function)", () => {
    const hour = Math.floor(1_700_000_000_000 / TRANSIT.departureEveryMs) * TRANSIT.departureEveryMs;
    for (const at of [1_000, 20_000, 39_000, 60_000, 150_000, 215_000]) {
      const f = fakeRoom();
      const stop = startTransitSync(f.room);
      const spy = vi.spyOn(performance, "now").mockReturnValue(10_000);
      const server = busTripAt(hour + at); // what the server publishes (transitRuntime.transitSnapshotAt)
      f.emit(MessageType.BusState, { tripId: server.tripId, status: server.status, progress: server.progress, x: server.pose.x, z: server.pose.z, yaw: server.pose.yaw, signal: "green", serverMs: hour + at });
      const p = getTransitRenderPose();
      expect(Math.hypot(p.x - server.pose.x, p.z - server.pose.z)).toBeLessThan(1e-6);
      expect(Math.abs(Math.atan2(Math.sin(p.yaw - server.pose.yaw), Math.cos(p.yaw - server.pose.yaw)))).toBeLessThan(1e-9);
      spy.mockRestore();
      stop();
    }
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
