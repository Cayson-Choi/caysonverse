import { describe, expect, it } from "vitest";
import { isBlocked } from "../collision";
import { PLAYER_RADIUS } from "../worldMap";
import { BUS_PLACES, BUS_SEAT_SURFACE, busDismountSpot, busPlace, busRiderPose, freeBusSlot } from "./busSeats";
import { SIT_POSE } from "../sitPose";
import { VILLAGE_MAX_CLIENTS } from "../constants";
import { TRANSIT, routeLength, routePoseAtDistance, type TransitPoint, type TransitPose } from "./transit";
import { busBoardingDistance, villageGeometry } from "./villageLayout";

/** A point in the bus's own frame at `pose`: m ahead of its centre and m to its right (doors). */
function local(pose: TransitPose, p: TransitPoint): { ahead: number; right: number } {
  const fx = Math.sin(pose.yaw);
  const fz = Math.cos(pose.yaw);
  const dx = p.x - pose.x;
  const dz = p.z - pose.z;
  return { ahead: dx * fx + dz * fz, right: dx * -fz + dz * fx };
}

describe("riders are in the bus (owner 2026-11-15: the avatar stood outside on the pad)", () => {
  it("every place is inside the cabin (its 2.39 m inner width, behind the driver, ahead of the back wall) and apart from the others", () => {
    // all but a full room's last rider or two have a place of their own (a slot past the list shares one)
    expect(BUS_PLACES.length).toBeGreaterThanOrEqual(VILLAGE_MAX_CLIENTS - 2);
    for (const p of BUS_PLACES) {
      // the toy figure's hands reach 0.5 m to each side: inside the cabin's 1.195 m inner half width (no hand through the side)
      expect(Math.abs(p.right) + 0.5).toBeLessThan(1.195);
      expect(p.ahead).toBeLessThan(TRANSIT.busLengthM / 2 - 1.5); // behind the driver's seat (xf 1.02)
      expect(p.ahead).toBeGreaterThan(-TRANSIT.busLengthM / 2 + 0.3);
    }
    for (let i = 0; i < BUS_PLACES.length; i++) {
      for (let j = i + 1; j < BUS_PLACES.length; j++) {
        const a = BUS_PLACES[i]!;
        const b = BUS_PLACES[j]!;
        expect(Math.hypot(a.ahead - b.ahead, a.right - b.right), `${i} vs ${j}`).toBeGreaterThan(0.39);
      }
    }
  });

  it("the first places are the door-side seats (seen through the windows from the pad), the standing ones come last", () => {
    expect(busPlace(0)).toMatchObject({ seated: true });
    expect(busPlace(0).right).toBeGreaterThan(0);
    expect(busPlace(1).right).toBeGreaterThan(0);
    expect(BUS_PLACES.findIndex((p) => !p.seated)).toBe(12); // 12 seated places (a pair of seats each), then standing
    expect(BUS_PLACES.slice(BUS_PLACES.findIndex((p) => !p.seated)).every((p) => !p.seated)).toBe(true);
    // a slot past the list shares a place: the bus never refuses a rider
    expect(busPlace(BUS_PLACES.length)).toBe(busPlace(0));
  });

  it("a seated rider's butt rests on the seat's cushion, a standing one on the cabin floor", () => {
    const pose = busRiderPose(TRANSIT.parked, 0);
    expect(pose.seated).toBe(true);
    expect(pose.y + SIT_POSE.contactY).toBeCloseTo(busPlace(0).floor + BUS_SEAT_SURFACE, 6);
    const standing = BUS_PLACES.findIndex((p) => !p.seated);
    expect(busRiderPose(TRANSIT.parked, standing).y).toBeCloseTo(busPlace(standing).floor, 6);
  });

  it("riders move and turn with the bus: at every point of the lap each one is in the same place of the bus, facing its way", () => {
    const length = routeLength();
    for (let s = 0; s <= length; s += 3.7) {
      const bus = routePoseAtDistance(s);
      for (let slot = 0; slot < BUS_PLACES.length; slot++) {
        const r = busRiderPose(bus, slot);
        const l = local(bus, r);
        expect(l.ahead).toBeCloseTo(busPlace(slot).ahead, 6);
        expect(l.right).toBeCloseTo(busPlace(slot).right, 6);
        expect(r.yaw).toBe(bus.yaw);
      }
    }
  });

  it("a free slot is the lowest one nobody holds", () => {
    expect(freeBusSlot([])).toBe(0);
    expect(freeBusSlot([0, 1, 3])).toBe(2);
    expect(freeBusSlot([-1, 1])).toBe(0);
  });

  it("getting off, riders are put down outside the door on the pavement, clear of every collider, by the stop, apart", () => {
    const spots = [0, 1, 2, 3, 4, 5].map((s) => busDismountSpot(s));
    for (const p of spots) {
      expect(isBlocked(p.x, p.z, PLAYER_RADIUS, villageGeometry.obstacles), `${p.x}, ${p.z}`).toBe(false);
      // on the pavement past the kerb (R 37), facing away from the bus
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(37 + PLAYER_RADIUS);
      expect(busBoardingDistance(p.x, p.z)).toBe(0);
      const l = local(TRANSIT.parked, p);
      expect(l.right).toBeGreaterThan(1.25 + PLAYER_RADIUS);
    }
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.z - spots[j]!.z)).toBeGreaterThan(2 * PLAYER_RADIUS);
      }
    }
  });
});
