import { describe, expect, it } from "vitest";
import { BUS_SEATS, busLocalToWorld, cabinBlocked, cabinFloorAt, seatApproachPoint } from "@caysonverse/shared/village/busCabin";
import { busFloorUnderRay, busSeatUnderRay } from "./busSeatPick";

const bus = { x: 30, z: -8, yaw: 2.1 };

/** A ray from a standing rider's eye (bus-local) at a bus-local target point. */
function rayAt(from: { ahead: number; right: number; h: number }, to: { ahead: number; right: number; h: number }) {
  const o = busLocalToWorld(bus, from.ahead, from.right);
  const t = busLocalToWorld(bus, to.ahead, to.right);
  const d = { x: t.x - o.x, y: to.h - from.h, z: t.z - o.z };
  const n = Math.hypot(d.x, d.y, d.z);
  return { origin: { x: o.x, y: from.h, z: o.z }, dir: { x: d.x / n, y: d.y / n, z: d.z / n } };
}

describe("busSeatUnderRay: a tap or a click on a bus seat (bus v3, owner 2026-11-16: sit anywhere)", () => {
  it("every seat is found from the aisle 1.4 m away, looking at its cushion", () => {
    BUS_SEATS.forEach((s, i) => {
      const ap = seatApproachPoint(s);
      const fromAhead = ap.ahead > -1 ? ap.ahead - 1.4 : ap.ahead + 1.4;
      const eye = { ahead: fromAhead, right: 0, h: cabinFloorAt(fromAhead) + 1.95 };
      const { origin, dir } = rayAt(eye, { ahead: s.ahead + 0.06, right: s.right, h: s.floor + 0.47 });
      expect(busSeatUnderRay(bus, origin, dir), s.id).toBe(i);
    });
  });

  it("a ray at the floor of the aisle, the ceiling or out of a window finds no seat", () => {
    const eye = { ahead: 0.5, right: 0, h: 2.3 };
    expect(busSeatUnderRay(bus, ...Object.values(rayAt(eye, { ahead: 0.2, right: 0, h: 0.34 })) as [never, never])).toBe(-1);
    expect(busSeatUnderRay(bus, ...Object.values(rayAt(eye, { ahead: 0.5, right: 0, h: 3.15 })) as [never, never])).toBe(-1);
    expect(busSeatUnderRay(bus, ...Object.values(rayAt(eye, { ahead: 0.5, right: 3, h: 2.2 })) as [never, never])).toBe(-1);
  });
});

describe("busFloorUnderRay: a tap or a click on the cabin's floor walks there (owner 2026-11-18)", () => {
  const eye = { ahead: 0.5, right: 0, h: 2.3 };
  const at = (to: { ahead: number; right: number; h: number }) => {
    const { origin, dir } = rayAt(eye, to);
    return busFloorUnderRay(bus, origin, dir);
  };
  it("a ray at the aisle's floor gives that spot", () => {
    for (const a of [-3, -1.5, 1.8, 3]) {
      const p = at({ ahead: a, right: 0, h: cabinFloorAt(a) });
      expect(p).not.toBeNull();
      expect(p!.ahead).toBeCloseTo(a, 3);
      expect(Math.abs(p!.right)).toBeLessThan(1e-3);
      expect(cabinBlocked(p!.ahead, p!.right)).toBe(false);
    }
  });
  it("a spot under a seat is moved across to the aisle at its row; the ceiling or outside the cabin is nothing", () => {
    const s = BUS_SEATS[0]!;
    const p = at({ ahead: s.ahead, right: s.right, h: s.floor });
    expect(p).not.toBeNull();
    expect(cabinBlocked(p!.ahead, p!.right)).toBe(false);
    expect(at({ ahead: 0.5, right: 0, h: 3.15 })).toBeNull();
    expect(at({ ahead: 0.5, right: 3, h: 0.34 })).toBeNull(); // out of a window, the ground beside the bus
  });
});
