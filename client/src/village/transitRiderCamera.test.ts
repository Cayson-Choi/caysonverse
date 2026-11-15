import { describe, expect, it } from "vitest";
import { BUS_PLACES, busRiderPose } from "@caysonverse/shared/village/busSeats";
import { TRANSIT, routePoseAtDistance } from "@caysonverse/shared/village/transit";
import { transitRiderCamera } from "./transitCamera";

describe("the rider's view from their place in the bus (owner 2026-11-15)", () => {
  it("stays inside the cabin, under its ceiling, behind the rider and looking past them out of their side's window", () => {
    for (const bus of [TRANSIT.parked, routePoseAtDistance(60), routePoseAtDistance(150)]) {
      const fx = Math.sin(bus.yaw);
      const fz = Math.cos(bus.yaw);
      for (let k = 0; k < BUS_PLACES.length * 2; k++) {
        const slot = k % BUS_PLACES.length;
        const cam = transitRiderCamera(bus, slot, k < BUS_PLACES.length ? 16 / 10 : 375 / 812);
        const dx = cam.x - bus.x;
        const dz = cam.z - bus.z;
        const ahead = dx * fx + dz * fz;
        const right = -dx * fz + dz * fx;
        expect(Math.abs(right), `slot ${slot}`).toBeLessThan(1.1);
        expect(Math.abs(ahead)).toBeLessThan(TRANSIT.busLengthM / 2 - 0.2);
        expect(cam.y).toBeLessThanOrEqual(2.3);
        const rider = busRiderPose(bus, slot);
        // behind the rider (the rider is in view), looking forward
        expect((rider.x - cam.x) * fx + (rider.z - cam.z) * fz).toBeGreaterThan(0.5);
        expect((cam.targetX - cam.x) * fx + (cam.targetZ - cam.z) * fz).toBeGreaterThan(0);
      }
    }
  });
});
