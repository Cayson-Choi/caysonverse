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
