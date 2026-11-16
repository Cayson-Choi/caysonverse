import { describe, expect, it } from "vitest";
import {
  BUS_CABIN_BOUNDS,
  BUS_CAPACITY,
  BUS_CEILING,
  BUS_DRIVER,
  BUS_ENTRY,
  BUS_EXIT_ZONE,
  BUS_RIDER_APART,
  BUS_SEATS,
  BUS_SEAT_COUNT,
  BUS_SOLIDS,
  BUS_STANDING_COUNT,
  BUS_STANDING_SPOTS,
  BUS_STAND_APART,
  BUS_WALL_SEAT_SHIFT,
  busLocalToWorld,
  busPlaceOf,
  busRiderWorldPose,
  busSeatNumber,
  cabinBlocked,
  cabinFloorAt,
  crowdBlocks,
  facingVector,
  freeBusEntry,
  inExitZone,
  nearestFreeSpot,
  seatApproachOk,
  seatApproachPoint,
  seatBodyPoint,
  seatFrontPoint,
  seatStandUpSpot,
  stepInCabin,
} from "./busCabin";
import { busLocal } from "./busBody";
import { TRANSIT } from "./transit";
import { SIT_POSE } from "../sitPose";

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
/** Reachable: the point's grid cell or one of its eight neighbours (the grid is 5 cm; a point between cells may round into a wall's margin). */
const reached = (free: Set<string>, p: { ahead: number; right: number }, step = 0.05): boolean => {
  const i = Math.round((p.ahead - BUS_ENTRY.ahead) / step);
  const j = Math.round((p.right - BUS_ENTRY.right) / step);
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (free.has(`${i + di},${j + dj}`)) return true;
  return false;
};

describe("bus v3: the cabin data (generated from the Blender model)", () => {
  it("ten seats with unique ids, all facing forward and backed; no hold places", () => {
    expect(BUS_SEAT_COUNT).toBe(10);
    expect(new Set(BUS_SEATS.map((s) => s.id)).size).toBe(10);
    for (const s of BUS_SEATS) {
      expect(s.backed, s.id).toBe(true);
      expect(s.yaw, s.id).toBeCloseTo(0, 6);
    }
    expect(busPlaceOf(BUS_SEAT_COUNT + 1).kind).toBe("free"); // the old hold numbers are nothing now
  });

  it("seats are sized for the chibi: a seated root never ends inside another seat, seated bodies 0.6 m+ apart", () => {
    for (const s of BUS_SEATS) {
      const body = seatBodyPoint(s);
      for (const o of BUS_SOLIDS) {
        if (o.id === `seat_${s.id}` || o.id.startsWith("housing")) continue;
        const inside = body.ahead > o.minAhead - 0.05 && body.ahead < o.maxAhead + 0.05 && body.right > o.minRight && body.right < o.maxRight;
        expect(inside, `${s.id} root in ${o.id}`).toBe(false);
      }
    }
    for (let a = 0; a < BUS_SEATS.length; a++) {
      for (let b = a + 1; b < BUS_SEATS.length; b++) {
        const A = seatBodyPoint(BUS_SEATS[a]!);
        const B = seatBodyPoint(BUS_SEATS[b]!);
        expect(Math.hypot(A.ahead - B.ahead, A.right - B.right), `${BUS_SEATS[a]!.id}-${BUS_SEATS[b]!.id}`).toBeGreaterThanOrEqual(0.6);
      }
    }
  });

  it("a standing avatar head (2.18) and hat (2.69) are under the 3.15 ceiling on the low floor, the head on the raised rear", () => {
    expect(BUS_CEILING).toBeGreaterThanOrEqual(3.15);
    const low = cabinFloorAt(BUS_ENTRY.ahead);
    expect(low).toBeCloseTo(0.34, 3);
    expect(low + 2.69).toBeLessThan(BUS_CEILING);
    expect(cabinFloorAt(-3) + 2.18).toBeLessThan(BUS_CEILING);
  });

  it("the floor steps up at xf 5.85 and 6.15", () => {
    const ahead = (xf: number) => TRANSIT.busLengthM / 2 - xf;
    expect(cabinFloorAt(ahead(5.0))).toBeCloseTo(0.34, 3);
    expect(cabinFloorAt(ahead(6.0))).toBeCloseTo(0.545, 3);
    expect(cabinFloorAt(ahead(7.0))).toBeCloseTo(0.75, 3);
  });

  it("busSeat numbers: 0 free, 1..10 seats", () => {
    expect(busPlaceOf(-1).kind).toBe("free");
    expect(busPlaceOf(0).kind).toBe("free");
    expect(busPlaceOf(1)).toEqual({ kind: "seat", index: 0 });
    expect(busPlaceOf(BUS_SEAT_COUNT)).toEqual({ kind: "seat", index: BUS_SEAT_COUNT - 1 });
    expect(busSeatNumber(3)).toBe(4);
  });

  it("the driver's place is generated and no passenger can walk into it", () => {
    expect(BUS_DRIVER.seat.ahead).toBeGreaterThan(2.9);
    expect(BUS_DRIVER.seat.right).toBeLessThan(-0.3);
    expect(cabinBlocked(BUS_DRIVER.sit.ahead, BUS_DRIVER.sit.right)).toBe(true);
    expect(cabinBlocked(BUS_DRIVER.seat.ahead, BUS_DRIVER.seat.right)).toBe(true);
    expect(BUS_DRIVER.wheel.y).toBeGreaterThan(BUS_DRIVER.seat.floor + BUS_DRIVER.seat.surface);
  });
});

describe("bus v3: capacity", () => {
  it("standing places: on free floor, a body apart, clear of the seated, all reachable from the door; capacity = seats + standing", () => {
    const free = reachable();
    expect(BUS_STANDING_COUNT).toBeGreaterThanOrEqual(10);
    expect(BUS_STANDING_COUNT).toBeLessThanOrEqual(20);
    expect(BUS_CAPACITY).toBe(BUS_SEAT_COUNT + BUS_STANDING_COUNT);
    BUS_STANDING_SPOTS.forEach((p, i) => {
      expect(cabinBlocked(p.ahead, p.right), `spot ${i}`).toBe(false);
      expect(reached(free, p), `reach spot ${i}`).toBe(true);
      for (const s of BUS_SEATS) {
        const b = seatBodyPoint(s);
        expect(Math.hypot(b.ahead - p.ahead, b.right - p.right), `spot ${i} vs ${s.id}`).toBeGreaterThanOrEqual(0.55);
      }
      for (let j = i + 1; j < BUS_STANDING_SPOTS.length; j++) {
        const q = BUS_STANDING_SPOTS[j]!;
        expect(Math.hypot(p.ahead - q.ahead, p.right - q.right)).toBeGreaterThanOrEqual(BUS_STAND_APART - 1e-9);
      }
    });
  });

  it("boarding riders get standing places one after another, none inside another, and none once every place is taken", () => {
    const riders: Array<{ ahead: number; right: number }> = [];
    for (let k = 0; k < BUS_STANDING_COUNT; k++) {
      const e = freeBusEntry(riders);
      expect(e, `rider ${k}`).not.toBeNull();
      for (const o of riders) expect(Math.hypot(o.ahead - e!.ahead, o.right - e!.right)).toBeGreaterThanOrEqual(BUS_RIDER_APART);
      riders.push(e!);
    }
    expect(freeBusEntry(riders)).toBeNull();
    expect(freeBusEntry([])).toEqual({ ahead: BUS_ENTRY.ahead, right: BUS_ENTRY.right, yaw: Math.PI });
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

  it("every seat's approach point and stand-up spot and the exit zone are reachable from the entry through the aisle", () => {
    const free = reachable();
    for (const s of BUS_SEATS) {
      const ap = seatApproachPoint(s);
      expect(reached(free, ap), `reach ${s.id}`).toBe(true);
      expect(seatApproachOk(s, ap.ahead, ap.right), `approach ${s.id}`).toBe(true);
      expect(nearestFreeSpot(ap.ahead, ap.right, new Set())).not.toBeNull();
      const spot = seatStandUpSpot(s);
      expect(cabinBlocked(spot.ahead, spot.right), `stand-up of ${s.id}`).toBe(false);
      expect(reached(free, spot), `reach ${s.id}`).toBe(true);
    }
    const z = BUS_EXIT_ZONE;
    const mid = { ahead: (z.aheadMin + z.aheadMax) / 2, right: 0.6 };
    expect(cabinBlocked(mid.ahead, mid.right)).toBe(false);
    expect(reached(free, mid)).toBe(true);
    expect(inExitZone(mid.ahead, mid.right)).toBe(true);
  });

  it("stepInCabin slides along a seat or wall and never ends inside one", () => {
    let p: { ahead: number; right: number } = { ahead: BUS_ENTRY.ahead, right: BUS_ENTRY.right };
    for (let i = 0; i < 400; i++) {
      const want = { ahead: p.ahead - 0.04, right: p.right + 0.03 * Math.sin(i / 7) - 0.01 * p.right };
      p = { ...stepInCabin(p, want) };
      expect(cabinBlocked(p.ahead, p.right)).toBe(false);
    }
    expect(p.ahead).toBeLessThan(-3); // walked the whole aisle, past the step to the back row
    const q = stepInCabin({ ahead: 3.0, right: 0.5 }, { ahead: 3.0, right: 2 });
    expect(Math.abs(q.right - 0.5)).toBeLessThan(1e-9);
  });

  it("holding one key (straight down the bus) from the entry by the door walks the whole aisle: a seat's corner slides the rider to the middle", () => {
    let p: { ahead: number; right: number } = { ahead: BUS_ENTRY.ahead, right: BUS_ENTRY.right };
    for (let i = 0; i < 300; i++) p = { ...stepInCabin(p, { ahead: p.ahead - 0.04, right: p.right }) };
    expect(p.ahead).toBeLessThan(-3);
    // and back up to the front
    for (let i = 0; i < 300; i++) p = { ...stepInCabin(p, { ahead: p.ahead + 0.04, right: p.right }) };
    expect(p.ahead).toBeGreaterThan(2.5);
  });

  it("a step into another rider is refused, a step away from one is not, and riders never end within a body of each other", () => {
    const o = { ahead: 0, right: 0 };
    expect(crowdBlocks({ ahead: 1, right: 0 }, { ahead: 0.7, right: 0 }, [o])).toBe(false);
    expect(crowdBlocks({ ahead: 0.8, right: 0 }, { ahead: 0.3, right: 0 }, [o])).toBe(true);
    expect(crowdBlocks({ ahead: 0.05, right: 0 }, { ahead: 0.1, right: 0 }, [o])).toBe(false); // already inside: may walk out
    const out = stepInCabin({ ahead: 0.8, right: 0 }, { ahead: 0.3, right: 0 }, undefined, undefined, [o]);
    expect(Math.hypot(out.ahead - o.ahead, out.right - o.right)).toBeGreaterThanOrEqual(BUS_RIDER_APART - 1e-9);
  });

  it("standing up never puts a rider inside another", () => {
    for (const seat of BUS_SEATS) {
      const first = seatStandUpSpot(seat);
      const second = seatStandUpSpot(seat, [{ ahead: first.ahead, right: first.right }]);
      expect(Math.hypot(second.ahead - first.ahead, second.right - first.right), seat.id).toBeGreaterThanOrEqual(BUS_RIDER_APART);
      expect(cabinBlocked(second.ahead, second.right)).toBe(false);
    }
  });
});

describe("sitting rules: backed seats from the front only", () => {
  it("behind a seat is refused, in front of it accepted, too far refused", () => {
    const s = BUS_SEATS.find((x) => x.id === "L2")!;
    const front = seatFrontPoint(s);
    expect(seatApproachOk(s, front.ahead, front.right)).toBe(true);
    expect(seatApproachOk(s, s.ahead - 0.6, s.right)).toBe(false); // behind it
    expect(seatApproachOk(s, s.ahead + 1.8, s.right)).toBe(false); // too far
  });

  it("nearestFreeSpot skips taken seats", () => {
    const s = BUS_SEATS.find((x) => x.id === "L2")!;
    const ap = seatApproachPoint(s);
    expect(nearestFreeSpot(ap.ahead, ap.right, new Set())).not.toBeNull();
    const second = nearestFreeSpot(ap.ahead, ap.right, new Set([BUS_SEATS.indexOf(s)]));
    expect(second === null || second.index !== BUS_SEATS.indexOf(s)).toBe(true);
  });

  it("each seat is the offered one from some aisle point and facing", () => {
    const offered = new Set<string>();
    for (let a = -3.6; a <= 3.4; a += 0.05) {
      for (let r = -0.3; r <= 0.3001; r += 0.05) {
        if (cabinBlocked(a, r)) continue;
        for (let k = 0; k < 8; k++) {
          const spot = nearestFreeSpot(a, r, new Set(), -Math.PI + (k * Math.PI) / 4);
          if (spot) offered.add(BUS_SEATS[spot.index]!.id);
        }
      }
    }
    expect([...offered].sort()).toEqual(BUS_SEATS.map((s) => s.id).sort());
  });

  it("seated riders by the wall sit towards the aisle: their 0.5 m reach ends inside the bus's skin", () => {
    for (const s of BUS_SEATS) {
      const body = seatBodyPoint(s);
      expect(Math.abs(body.right) + 0.5, s.id).toBeLessThanOrEqual(1.245 - 0.04);
    }
    expect(BUS_WALL_SEAT_SHIFT).toBeGreaterThan(0.1);
  });
});

describe("the rider place in the world", () => {
  it("a free rider is drawn at its bus-local point and turns with the bus; a seated one on its seat's surface", () => {
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
    expect(seated.y + SIT_POSE.contactY).toBeCloseTo(s.floor + 0.452, 6);
    const w = busLocalToWorld(bus, 3, 1);
    expect(busLocal(bus, w.x, w.z).ahead).toBeCloseTo(3, 9);
    expect(facingVector(0).ahead).toBe(1);
  });
});
