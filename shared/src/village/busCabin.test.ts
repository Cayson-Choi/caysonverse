import { describe, expect, it } from "vitest";
import {
  BUS_CABIN_BOUNDS,
  BUS_CEILING,
  BUS_ENTRIES,
  BUS_ENTRY,
  BUS_EXIT_ZONE,
  BUS_HOLDS,
  BUS_HOLD_COUNT,
  BUS_HOLD_AT_M,
  BUS_HOLD_OFFER_M,
  BUS_RIDER_APART,
  BUS_WALL_SEAT_SHIFT,
  crowdBlocks,
  seatBodyPoint,
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
  freeBusEntry,
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
    expect(BUS_HOLDS.length).toBeGreaterThanOrEqual(7);
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
      const spot = seatStandUpSpot(s)!;
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

  it("the entry spots are free, reachable from the first one, and a second rider gets another spot (not inside the first)", () => {
    const free = reachable();
    for (const e of BUS_ENTRIES) {
      expect(cabinBlocked(e.ahead, e.right), `entry ${e.ahead}`).toBe(false);
      expect(free.has(cellOf(e)), `reach entry ${e.ahead}`).toBe(true);
    }
    const second = freeBusEntry([{ ahead: BUS_ENTRY.ahead, right: BUS_ENTRY.right }]);
    expect(Math.hypot(second.ahead - BUS_ENTRY.ahead, second.right - BUS_ENTRY.right)).toBeGreaterThanOrEqual(0.6);
    expect(freeBusEntry([]).ahead).toBe(BUS_ENTRY.ahead);
  });

  it("from the entry a rider can sit in every seat from its front (the approach point is reachable and allowed)", () => {
    const free = reachable();
    for (const s of BUS_SEATS) {
      const spot = seatStandUpSpot(s)!;
      expect(seatApproachOk(s, spot.ahead, spot.right), `approach ${s.id}`).toBe(true);
      expect(free.has(cellOf(spot)), s.id).toBe(true);
      expect(nearestFreeSpot(spot.ahead, spot.right, new Set(), new Set())).not.toBeNull();
    }
  });

  it("stepInCabin slides along a seat or wall and never ends inside one", () => {
    let p: { ahead: number; right: number } = { ahead: BUS_ENTRY.ahead, right: BUS_ENTRY.right };
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

describe("review r1: holds, crowd and the wall seats", () => {
  it("every hold spot can be offered: standing at it offers its pole, not the free seat beside it", () => {
    BUS_HOLDS.forEach((h, i) => {
      const spot = nearestFreeSpot(h.ahead, h.right, new Set(), new Set());
      expect(spot, h.id).toMatchObject({ kind: "hold", index: i });
      expect(spot!.dist).toBeLessThanOrEqual(BUS_HOLD_OFFER_M);
    });
  });

  it("two hold spots are at least a body apart, and a spot with someone at it is not offered", () => {
    for (let a = 0; a < BUS_HOLDS.length; a++) {
      for (let b = a + 1; b < BUS_HOLDS.length; b++) {
        const d = Math.hypot(BUS_HOLDS[a]!.ahead - BUS_HOLDS[b]!.ahead, BUS_HOLDS[a]!.right - BUS_HOLDS[b]!.right);
        expect(d, `${BUS_HOLDS[a]!.id}-${BUS_HOLDS[b]!.id}`).toBeGreaterThanOrEqual(0.55);
      }
    }
    const h = BUS_HOLDS[1]!;
    const taken = new Set(BUS_SEATS.map((_, i) => i));
    const spot = nearestFreeSpot(h.ahead, h.right, taken, new Set(), [{ ahead: h.ahead + 0.1, right: h.right }]);
    expect(spot === null || !(spot.kind === "hold" && spot.index === 1)).toBe(true);
  });

  it("a step into another rider is refused, a step away from one is not, and the slide goes round", () => {
    const o = { ahead: 0, right: 0 };
    expect(crowdBlocks({ ahead: 1, right: 0 }, { ahead: 0.7, right: 0 }, [o])).toBe(false);
    expect(crowdBlocks({ ahead: 0.8, right: 0 }, { ahead: 0.05, right: 0 }, [o])).toBe(true);
    expect(crowdBlocks({ ahead: 0.05, right: 0 }, { ahead: 0.1, right: 0 }, [o])).toBe(false); // already inside: may walk out
    // two riders pass in the narrowest aisle (0.5 m of walkable width): at its two edges
    expect(crowdBlocks({ ahead: 0.6, right: 0.2 }, { ahead: 0.0, right: 0.2 }, [{ ahead: 0.3, right: 0.0 }])).toBe(false);
    const out = stepInCabin({ ahead: 0.8, right: 0 }, { ahead: 0.05, right: 0 }, undefined, undefined, [o]);
    expect(Math.hypot(out.ahead - o.ahead, out.right - o.right)).toBeGreaterThanOrEqual(BUS_RIDER_APART - 1e-9);
  });

  it("standing up never puts a rider inside another", () => {
    const seat = BUS_SEATS.find((x) => x.id === "R2")!;
    const first = seatStandUpSpot(seat)!;
    const second = seatStandUpSpot(seat, [{ ahead: first.ahead, right: first.right }])!;
    expect(Math.hypot(second.ahead - first.ahead, second.right - first.right)).toBeGreaterThanOrEqual(0.11);
    expect(cabinBlocked(second.ahead, second.right)).toBe(false);
  });

  it("seated riders by the wall sit towards the aisle: their 0.5 m reach ends inside the bus's skin; neighbours are 0.6 m or more apart", () => {
    for (const s of BUS_SEATS) {
      const f = facingVector(s.yaw);
      const body = seatBodyPoint(s);
      if (Math.abs(f.right) < 0.5) {
        expect(Math.abs(body.right) + 0.5, s.id).toBeLessThanOrEqual(1.245 - 0.04);
      } else {
        expect(Math.abs(body.right), s.id).toBeLessThanOrEqual(Math.abs(s.right) + 0.5);
      }
    }
    expect(BUS_WALL_SEAT_SHIFT).toBeGreaterThan(0.1);
    for (let a = 0; a < BUS_SEATS.length; a++) {
      for (let b = a + 1; b < BUS_SEATS.length; b++) {
        const A = seatBodyPoint(BUS_SEATS[a]!);
        const B = seatBodyPoint(BUS_SEATS[b]!);
        const d = Math.hypot(A.ahead - B.ahead, A.right - B.right);
        // seats that face the same way side by side (same row): the hands may touch but the bodies are 0.65 m or more apart
        if (Math.abs(A.ahead - B.ahead) < 0.3) expect(d, `${BUS_SEATS[a]!.id}-${BUS_SEATS[b]!.id}`).toBeGreaterThanOrEqual(0.6);
      }
    }
  });
});

describe("review r1: every seat can be offered from the aisle by facing it", () => {
  it("each seat is the offered one from some aisle point and facing (the rear row's outer seats too)", () => {
    const offered = new Set<string>();
    for (let a = -3.6; a <= 3.4; a += 0.05) {
      for (let r = -0.2; r <= 0.2001; r += 0.05) {
        if (cabinBlocked(a, r, 0.32)) continue;
        for (let k = 0; k < 8; k++) {
          const spot = nearestFreeSpot(a, r, new Set(), new Set(), undefined, -Math.PI + (k * Math.PI) / 4);
          if (spot?.kind === "seat") offered.add(BUS_SEATS[spot.index]!.id);
        }
      }
    }
    expect([...offered].sort()).toEqual(BUS_SEATS.map((s) => s.id).sort());
  });
});

describe("review 2026-11-16: a pole's offer radius does not hide the seat the rider faces", () => {
  it("L3, RL1 and RR2 are offered from a point inside a pole's offer radius when the rider faces them; right at the pole the pole is", () => {
    for (const id of ["L3", "RL1", "RR2"]) {
      const idx = BUS_SEATS.findIndex((s) => s.id === id);
      const front = seatFrontPoint(BUS_SEATS[idx]!);
      let found = false;
      for (let a = -3.6; a <= 3.4 && !found; a += 0.05) {
        for (let r = -0.25; r <= 0.2501 && !found; r += 0.05) {
          if (cabinBlocked(a, r, 0.32) || !seatApproachOk(BUS_SEATS[idx]!, a, r)) continue;
          const dh = Math.min(...BUS_HOLDS.map((h) => Math.hypot(a - h.ahead, r - h.right)));
          if (dh > BUS_HOLD_OFFER_M || dh <= BUS_HOLD_AT_M) continue;
          const yaw = Math.atan2(-(front.right - r), front.ahead - a); // facingVector(yaw) points at the seat's front
          const o = nearestFreeSpot(a, r, new Set(), new Set(), undefined, yaw);
          if (o?.kind === "seat" && o.index === idx) found = true;
        }
      }
      expect(found, id).toBe(true);
    }
    // standing at the pole itself, the pole is offered whichever way they face
    const h = BUS_HOLDS[2]!;
    expect(nearestFreeSpot(h.ahead, h.right, new Set(), new Set(), undefined, 0)?.kind).toBe("hold");
    expect(nearestFreeSpot(h.ahead, h.right, new Set(), new Set(), undefined, Math.PI / 2)?.kind).toBe("hold");
  });
});
