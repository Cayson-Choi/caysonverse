import { describe, expect, it } from "vitest";
import { BUS_PLACES, busPlace, busRiderPose } from "@caysonverse/shared/village/busSeats";
import { TRANSIT, routePoseAtDistance } from "@caysonverse/shared/village/transit";
import { CABIN_BARS, RIDER_EYE_CLEARANCE, RIDER_SIGHT_CLEARANCE, riderShot, segmentDistance, transitRiderCamera } from "./transitCamera";

describe("the rider's view from their place in the bus (owner 2026-11-15; checker r2: cramped, straps across the neck)", () => {
  it("stays inside the cabin, under its ceiling, clear of every pole, and with nothing between it and the rider's head and chest", () => {
    for (const portrait of [false, true]) {
      for (let slot = 0; slot < BUS_PLACES.length; slot++) {
        const shot = riderShot(slot, portrait);
        const [ahead, right, y] = shot.eye;
        expect(Math.abs(right), `slot ${slot}`).toBeLessThanOrEqual(0.95);
        expect(Math.abs(ahead)).toBeLessThan(TRANSIT.busLengthM / 2 - 0.3);
        expect(y).toBeLessThan(2.3);
        for (const bar of CABIN_BARS) {
          expect(segmentDistance(shot.eye, shot.eye, bar.a, bar.b), `slot ${slot} near a bar`).toBeGreaterThanOrEqual(RIDER_EYE_CLEARANCE);
          expect(segmentDistance(shot.eye, shot.head, bar.a, bar.b), `slot ${slot} head`).toBeGreaterThanOrEqual(shot.clearance);
          expect(segmentDistance(shot.eye, shot.chest, bar.a, bar.b), `slot ${slot} chest`).toBeGreaterThanOrEqual(shot.clearance);
        }
        expect(shot.clearance).toBeGreaterThanOrEqual(slot < 12 ? RIDER_SIGHT_CLEARANCE : 0.03); // every seat: the full space
        // far enough that the toy figure's big head does not fill the frame
        const d = Math.hypot(ahead - shot.head[0], right - shot.head[1], y - shot.head[2]);
        expect(d, `slot ${slot}`).toBeGreaterThanOrEqual(1.6);
        expect(d).toBeLessThanOrEqual(3.2);
      }
    }
  });

  it("the seats with room in front are seen from the front (face and window behind them), face on", () => {
    let fromFront = 0;
    for (let slot = 0; slot < BUS_PLACES.length; slot++) {
      const shot = riderShot(slot);
      if (shot.eye[0] > busPlace(slot).ahead) fromFront++;
    }
    // only the places right behind the driver and the front door (the wheel-arch pair, the front of the aisle) from behind
    expect(fromFront).toBeGreaterThanOrEqual(BUS_PLACES.length - 5);
    // the first rider's seat (door side, middle): from the front, face on
    const first = riderShot(0);
    expect(first.eye[0]).toBeGreaterThan(busPlace(0).ahead + 1.2);
  });

  it("follows the bus: the camera is at the same spot in the cabin wherever the bus is, aimed at the rider", () => {
    for (const bus of [TRANSIT.parked, routePoseAtDistance(60), routePoseAtDistance(150)]) {
      for (let slot = 0; slot < BUS_PLACES.length; slot++) {
        const cam = transitRiderCamera(bus, slot);
        const rider = busRiderPose(bus, slot);
        const toRider = { x: rider.x - cam.x, z: rider.z - cam.z };
        const toLook = { x: cam.targetX - cam.x, z: cam.targetZ - cam.z };
        const cos = (toRider.x * toLook.x + toRider.z * toLook.z) / (Math.hypot(toRider.x, toRider.z) * Math.hypot(toLook.x, toLook.z));
        expect(cos, `slot ${slot}`).toBeGreaterThan(0.9);
      }
    }
  });
});
