import { describe, expect, it } from "vitest";
import {
  BUS_CABIN_BOUNDS,
  BUS_CEILING,
  BUS_ENTRY,
  BUS_EXIT_ZONE,
  BUS_HOLDS,
  BUS_HOLD_COUNT,
  BUS_SEATS,
  BUS_SEAT_COUNT,
  busHoldNumber,
  busLocalToWorld,
  busPlaceOf,
  busRiderWorldPose,
  busSeatNumber,
  cabinBlocked,
  cabinFloorAt,
  facingVector,
  inExitZone,
  nearestFreeSpot,
  seatApproachOk,
  seatFrontPoint,
  seatStandUpSpot,
  stepInCabin,
} from "./busCabin";
import { busLocal } from "./busBody";
import { TRANSIT } from "./transit";

/** Grid flood fill over the free cabin from the entry (0.05 m cells): every cell a rider can stand on. */
function reachable(step = 0.05): Set<string> {
  const key = (i: number, j: number) => `${i},${j}`;
  const toP = (i: number, j: number) => ({ ahead: BUS_ENTRY.ahead + i * step, right: BUS_ENTRY.right + j * step });
  const seen = new Set<string>([key(0, 0)]);
  const queue: Array<[number, number]> = [[0, 0]];
  while (queue.length) {
    const [i, j] = queue.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di;
      const nj = j + dj;
      const k = key(ni, nj);
      if (seen.has(k)) continue;
      const p = toP(ni, nj);
      if (cabinBlocked(p.ahead, p.right)) continue;
      seen.add(k);
      queue.push([ni, nj]);
    }
  }
  return seen;
}

const cellOf = (p: { ahead: number; right: number }, step = 0.05) => `${Math.round((p.ahead - BUS_ENTRY.ahead) / step)},${Math.round((p.right - BUS_ENTRY.right) / step)}`;

describe("the bus cabin data (generated from the Blender model)", () => {
  it("14 seats with unique ids, two folding seats facing the aisle, holds with unique ids", () => {
    expect(BUS_SEATS).toHaveLength(14);
    expect(new Set(BUS_SEATS.map((s) => s.id)).size).toBe(14);
    for (const id of ["W1", "W2"]) {
      const s = BUS_SEATS.find((x) => x.id === id)!;
      expect(s.yaw).toBeCloseTo(-Math.PI / 2, 2); // towards the doors (the aisle)
      expect(facingVector(s.yaw).right).toBeGreaterThan(0.99);
    }
    expect(BUS_HOLDS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(BUS_HOLDS.map((h) => h.id)).size).toBe(BUS_HOLD_COUNT);
  });

  it("a standing avatar head (2.18) and hat (2.69) are under the 3.15 ceiling on the low floor, the head on the raised rear", () => {
    expect(BUS_CEILING).toBeGreaterThanOrEqual(3.15);
    const low = cabinFloorAt(BUS_ENTRY.ahead);
    expect(low).toBeCloseTo(0.34, 3);
    expect(low + 2.69).toBeLessThan(BUS_CEILING);
    const rear = cabinFloorAt(-3);
    expect(rear).toBeCloseTo(0.75, 3);
    expect(rear + 2.18).toBeLessThan(BUS_CEILING);
  });

  it("the floor steps up at xf 5.85 and 6.15", () => {
    const ahead = (xf: number) => TRANSIT.busLengthM / 2 - xf;
    expect(cabinFloorAt(ahead(5.0))).toBeCloseTo(0.34, 3);
    expect(cabinFloorAt(ahead(6.0))).toBeCloseTo(0.545, 3);
    expect(cabinFloorAt(ahead(7.0))).toBeCloseTo(0.75, 3);
  });

  it("busSeat numbers: 0 free, 1..14 seats, then the holds", () => {
    expect(busPlaceOf(-1).kind).toBe("free");
    expect(busPlaceOf(0).kind).toBe("free");
    expect(busPlaceOf(1)).toEqual({ kind: "seat", index: 0 });
    expect(busPlaceOf(BUS_SEAT_COUNT)).toEqual({ kind: "seat", index: BUS_SEAT_COUNT - 1 });
    expect(busPlaceOf(busHoldNumber(0))).toEqual({ kind: "hold", index: 0 });
    expect(busPlaceOf(busHoldNumber(BUS_HOLD_COUNT - 1)).kind).toBe("hold");
    expect(busPlaceOf(busHoldNumber(BUS_HOLD_COUNT)).kind).toBe("free");
    expect(busSeatNumber(3)).toBe(4);
  });
});

describe("walking in the cabin", () => {
  it("the entry just inside the front door is free; the dashboard, the partition and the walls are not", () => {
    expect(cabinBlocked(BUS_ENTRY.ahead, BUS_ENTRY.right)).toBe(false);
    expect(cabinBlocked(BUS_CABIN_BOUNDS.aheadMax - 0.1, 0)).toBe(true);
    expect(cabinBlocked(3.5, -0.9)).toBe(true); // the driver partition
    expect(cabinBlocked(0, 1.1)).toBe(true); // the wall
    expect(cabinBlocked(Number.NaN, 0)).toBe(true);
  });

  it("every seat stand-up spot, every hold spot and the exit zone are reachable from the entry through the aisle", () => {
    const free = reachable();
    for (const s of BUS_SEATS) {
      const spot = seatStandUpSpot(s);
      expect(cabinBlocked(spot.ahead, spot.right), `stand-up of ${s.id}`).toBe(false);
      expect(free.has(cellOf(spot)), `reach ${s.id}`).toBe(true);
    }
    for (const h of BUS_HOLDS) expect(free.has(cellOf(h)), `reach hold ${h.id}`).toBe(true);
    const z = BUS_EXIT_ZONE;
    const mid = { ahead: (z.aheadMin + z.aheadMax) / 2, right: 0.45 };
    expect(cabinBlocked(mid.ahead, mid.right)).toBe(false);
    expect(free.has(cellOf(mid))).toBe(true);
    expect(inExitZone(mid.ahead, mid.right)).toBe(true);
  });

  it("from the entry a rider can sit in every seat from its front (the approach point is reachable and allowed)", () => {
    const free = reachable();
    for (const s of BUS_SEATS) {
      const spot = seatStandUpSpot(s);
      expect(seatApproachOk(s, spot.ahead, spot.right), `approach ${s.id}`).toBe(true);
      expect(free.has(cellOf(spot)), s.id).toBe(true);
      expect(nearestFreeSpot(spot.ahead, spot.right, new Set(), new Set())).not.toBeNull();
    }
  });

  it("stepInCabin slides along a seat or wall and never ends inside one", () => {
    let p = { ahead: BUS_ENTRY.ahead, right: BUS_ENTRY.right };
    for (let i = 0; i < 400; i++) {
      const want = { ahead: p.ahead - 0.04, right: p.right + 0.03 * Math.sin(i / 7) };
      p = { ...stepInCabin(p, want) };
      expect(cabinBlocked(p.ahead, p.right)).toBe(false);
    }
    const q = stepInCabin({ ahead: 0, right: 0.5 }, { ahead: 0, right: 2 });
    expect(Math.abs(q.right - 0.5)).toBeLessThan(1e-9);
  });
});

describe("sitting rules: backed seats from the front only", () => {
  it("behind a seat is refused, in front of it accepted; a folding seat is sat from the aisle", () => {
    const s = BUS_SEATS.find((x) => x.id === "L2")!;
    const front = seatFrontPoint(s);
    expect(seatApproachOk(s, front.ahead, front.right)).toBe(true);
    expect(seatApproachOk(s, s.ahead - 0.6, s.right)).toBe(false); // behind it
    expect(seatApproachOk(s, s.ahead + 1.6, s.right)).toBe(false); // too far
    const w = BUS_SEATS.find((x) => x.id === "W1")!;
    expect(seatApproachOk(w, w.ahead, w.right + 0.6)).toBe(true);
    expect(seatApproachOk(w, w.ahead, w.right - 0.2)).toBe(false);
  });

  it("nearestFreeSpot skips taken seats and offers a hold spot by a pole", () => {
    const s = BUS_SEATS.find((x) => x.id === "L2")!;
    const front = seatFrontPoint(s);
    const first = nearestFreeSpot(front.ahead, front.right, new Set(), new Set());
    expect(first).not.toBeNull();
    const taken = new Set<number>([BUS_SEATS.indexOf(s)]);
    const second = nearestFreeSpot(front.ahead, front.right, taken, new Set());
    expect(second === null || !(second.kind === "seat" && second.index === BUS_SEATS.indexOf(s))).toBe(true);
    const h = BUS_HOLDS[1]!;
    const hold = nearestFreeSpot(h.ahead, h.right, new Set(BUS_SEATS.map((_, i) => i)), new Set());
    expect(hold?.kind).toBe("hold");
  });
});

describe("the rider place in the world", () => {
  it("a free rider is drawn at its bus-local point and turns with the bus; a seated one on its seat", () => {
    const bus = { x: 10, z: -4, yaw: 1.2 };
    const free = busRiderWorldPose(bus, 0, 1.0, -0.2, 0.5);
    const local = busLocal(bus, free.x, free.z);
    expect(local.ahead).toBeCloseTo(1.0, 6);
    expect(local.right).toBeCloseTo(-0.2, 6);
    expect(free.yaw).toBeCloseTo(1.7, 9);
    expect(free.seated).toBe(false);
    const seated = busRiderWorldPose(bus, 2, 0, 0, 0);
    expect(seated.seated).toBe(true);
    const s = BUS_SEATS[1]!;
    expect(seated.y).toBeGreaterThan(s.floor);
    const w = busLocalToWorld(bus, 3, 1);
    expect(busLocal(bus, w.x, w.z).ahead).toBeCloseTo(3, 9);
  });
});
