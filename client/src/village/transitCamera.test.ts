import { describe, expect, it } from "vitest";
import { BUS_HOLDS, BUS_POLES, BUS_SEATS, BUS_ENTRY, cabinFloorAt } from "@caysonverse/shared/village/busCabin";
import { busLocal } from "@caysonverse/shared/village/busBody";
import { BUS_CAM, BUS_SHELL, busRiderCamera, fadingFixtures, ownSeatIndex, riderFov, segmentDistance } from "./transitCamera";
import { BUS_VIEW_YAW } from "../game/busRide";

const bus = { x: 10, z: -4, yaw: 0.9 };
const base = { bus, ahead: 1.0, right: 0.0, floor: 0.34, seated: false, elevation: 0.25, dist: 1.8 } as const;

/** The camera's eye and look point in the bus's own frame. */
function inBus(cam: ReturnType<typeof busRiderCamera>) {
  const e = busLocal(bus, cam.x, cam.z);
  const t = busLocal(bus, cam.targetX, cam.targetZ);
  return { eye: { ahead: e.ahead, right: e.right, h: cam.y }, target: { ahead: t.ahead, right: t.right, h: cam.targetY } };
}

describe("the rider camera in the bus (owner 2026-11-15: look out of every window)", () => {
  it("the four quick views look the right way: front down the bus, back along the aisle, out of the left windows, out of the door side", () => {
    const look = (yaw: number) => {
      const c = inBus(busRiderCamera({ ...base, yaw }));
      return { da: c.target.ahead - c.eye.ahead, dr: c.target.right - c.eye.right };
    };
    expect(look(BUS_VIEW_YAW.front).da).toBeGreaterThan(0.5); // forward
    expect(look(BUS_VIEW_YAW.back).da).toBeLessThan(-0.5); // to the rear
    expect(look(BUS_VIEW_YAW.left).dr).toBeLessThan(-0.3); // towards the left windows
    expect(look(BUS_VIEW_YAW.right).dr).toBeGreaterThan(0.3); // towards the door side's windows
    // each side of the bus is in view: the left view's look direction points at the left wall, the right view's at the right
  });

  it("the camera turns with the bus: the same view at any heading is the same in the bus's frame", () => {
    for (const heading of [0, 1.1, -2.4, 3.0]) {
      const c = busRiderCamera({ ...base, bus: { x: 3, z: 8, yaw: heading }, yaw: BUS_VIEW_YAW.right });
      const e = busLocal({ x: 3, z: 8, yaw: heading }, c.x, c.z);
      const t = busLocal({ x: 3, z: 8, yaw: heading }, c.targetX, c.targetZ);
      expect(t.right - e.right).toBeGreaterThan(0.3);
    }
  });

  it("the eye never leaves the cabin shell, at any azimuth, elevation and arm, standing or seated, anywhere a rider can be", () => {
    const spots = [{ ahead: BUS_ENTRY.ahead, right: BUS_ENTRY.right }, { ahead: 0, right: 0 }, { ahead: -3.0, right: 0 }, { ahead: -3.6, right: 0.2 }, { ahead: 1.2, right: -0.8 }];
    for (const sp of spots) {
      for (let yaw = -Math.PI; yaw <= Math.PI; yaw += 0.2) {
        for (const dist of [0.9, 1.8, 2.6]) {
          for (const elevation of [-0.4, 0.1, 0.7]) {
            const floor = cabinFloorAt(sp.ahead);
            const c = busRiderCamera({ ...base, ahead: sp.ahead, right: sp.right, floor, yaw, dist, elevation });
            const e = inBus(c).eye;
            expect(e.ahead).toBeGreaterThanOrEqual(BUS_SHELL.aheadMin - 1e-6);
            expect(e.ahead).toBeLessThanOrEqual(BUS_SHELL.aheadMax + 1e-6);
            expect(Math.abs(e.right)).toBeLessThanOrEqual(BUS_SHELL.right + 1e-6);
            expect(e.h).toBeLessThanOrEqual(BUS_SHELL.top + 1e-6);
            expect(e.h).toBeGreaterThan(0.3);
          }
        }
      }
    }
  });

  it("a seat back in the way shortens the arm (the rider's own seat does not); first person is the rider's eye", () => {
    const l2 = BUS_SEATS.findIndex((s) => s.id === "L2");
    const seat = BUS_SEATS[l2]!;
    // camera low behind the seat in front of a rider standing in the aisle behind L2: the arm is cut short
    const standingBehind = busRiderCamera({ ...base, ahead: seat.ahead + 2.0, right: seat.right, floor: 0.34, yaw: BUS_VIEW_YAW.front, elevation: -0.5, dist: 2.6 });
    expect(standingBehind.arm).toBeLessThan(2.6);
    const own = busRiderCamera({ ...base, ahead: seat.ahead, right: seat.right, floor: seat.floor, seated: true, yaw: BUS_VIEW_YAW.back, elevation: 0.2, dist: 1.4, ownSeat: l2 });
    expect(own.arm).toBeGreaterThan(0.9);
    const fp = busRiderCamera({ ...base, yaw: 0, dist: 0 });
    expect(fp.firstPerson).toBe(true);
    expect(fp.arm).toBe(0);
    expect(BUS_CAM.firstPersonDist).toBeLessThan(0.5);
    expect(ownSeatIndex(l2 + 1)).toBe(l2);
    expect(ownSeatIndex(0)).toBe(-1);
  });

  it("the lens is wider in the bus, wider still on a portrait phone", () => {
    expect(riderFov(1.6)).toBe(68);
    expect(riderFov(0.46)).toBe(78);
  });
});

describe("poles, rails and straps between the lens and the rider fade (a pole never crosses the arm or the face)", () => {
  const V = (a: number, r: number, h: number) => [a, r, h] as const;

  it("a pole right at the lens fades; one far off the line of sight does not", () => {
    const pole = BUS_POLES[0]!;
    const eye = V(pole.ahead + 0.2, pole.right, 1.6);
    const head = V(pole.ahead + 2.5, pole.right + 0.8, 1.95);
    const chest = V(head[0], head[1], 1.3);
    expect(fadingFixtures(eye, head, chest).has(pole.name)).toBe(true);
    const far = V(pole.ahead - 2.5, pole.right + 0.3, 1.6);
    expect(fadingFixtures(far, V(far[0] - 1.6, far[1] + 0.3, 1.95), V(far[0] - 1.6, far[1] + 0.3, 1.3)).has(pole.name)).toBe(false);
  });


  it("review r1: in third person a pole or strap beside the avatar's body (not on the line of sight) is not drawn", () => {
    const pole = BUS_POLES[0]!;
    const head = V(pole.ahead + 0.3, pole.right + 0.2, 1.62);
    const chest = V(head[0], head[1], 1.0);
    // lens on the far side of the avatar, looking across the body: the pole is beside it, 0.36 m off its axis
    const eye = V(head[0] + 0.1, head[1] + 1.5, 1.8);
    expect(fadingFixtures(eye, head, chest).has(pole.name)).toBe(true);
    // a pole 0.8 m from the avatar's body is drawn (it is not on the line of sight and not at the lens)
    const away = V(pole.ahead + 0.3, pole.right + 0.2 + 0.8, 1.62);
    const awayChest = V(away[0], away[1], 1.0);
    expect(fadingFixtures(V(away[0] + 0.1, away[1] + 2.4, 1.8), away, awayChest).has(pole.name)).toBe(false);
  });
  it("a pole on the line from the lens to the avatar's head or chest fades", () => {
    const hold = BUS_HOLDS[1]!;
    const pole = BUS_POLES.find((p) => p.name === hold.pole)!;
    // lens 1.6 m behind the pole, the rider 1 m beyond it: the pole is on the line
    const eye = V(pole.ahead - 1.6, pole.right, 1.8);
    const head = V(pole.ahead + 1.0, pole.right, 1.8);
    expect(fadingFixtures(eye, head, V(head[0], head[1], 1.3)).has(pole.name)).toBe(true);
  });

  it("segmentDistance is exact for crossing and parallel segments", () => {
    expect(segmentDistance(V(0, 0, 0), V(1, 0, 0), V(0.5, 1, 0), V(0.5, 2, 0))).toBeCloseTo(1, 9);
    expect(segmentDistance(V(0, 0, 0), V(1, 0, 0), V(0.5, -1, 0), V(0.5, 1, 0))).toBeCloseTo(0, 9);
    expect(segmentDistance(V(0, 0, 0), V(1, 0, 0), V(0, 0.3, 0), V(1, 0.3, 0))).toBeCloseTo(0.3, 9);
  });
});
