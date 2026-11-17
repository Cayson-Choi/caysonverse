import { describe, it, expect } from "vitest";
import { MOVE_ELAPSED_CEIL_MS, PLAYER_RADIUS } from "@caysonverse/shared/constants";
import { isBlocked } from "@caysonverse/shared/collision";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { fallsWalkSurfaceOk, onSlab, poolRadius } from "@caysonverse/shared/village/fallsWalk";
import { SEAT_REACH } from "@caysonverse/shared/worldMap";
import { validateMove } from "./movement";
import { SEAT_OCCUPIED, validateSit } from "./seating";

/**
 * The waterfall's rest area (B1 W5) through the REAL `validateMove` and `validateSit`: the server judges only where a Move
 * lands (steps up to 4.8 m), so these throw legal-speed steps at the pool, the pocket's edges and the village's west
 * column and expect every one that lands in the water or out of the pocket to be dropped.
 */
const L = VILLAGE_LAYOUT;
const W = L.backdrop.waterfall;
const R = PLAYER_RADIUS;
const G = villageGeometry;
const ELAPSED = MOVE_ELAPSED_CEIL_MS;
const move = (from: { x: number; z: number }, to: { x: number; z: number }) => validateMove(from, { x: to.x, z: to.z, yaw: 0 }, ELAPSED, G);
const inPocket = (p: { x: number; z: number }) => p.x >= W.pocket.minX && p.x <= W.pocket.maxX && p.z >= W.pocket.minZ && p.z <= W.pocket.maxZ;

describe("the village's west edge: from the plaza side into the rest area and back", () => {
  it("a walk from the village over x -95 into the pocket (and a step of 4 m across the line) is accepted, and so is the way back", () => {
    expect(move({ x: -92, z: -78 }, { x: -96, z: -78 })).not.toBeNull();
    expect(move({ x: -96, z: -78 }, { x: -100, z: -78 })).not.toBeNull();
    expect(move({ x: -100, z: -78 }, { x: -96, z: -78 })).not.toBeNull();
    expect(move({ x: -96, z: -78 }, { x: -92, z: -78 })).not.toBeNull();
    // the whole entry z -86..-70 and the pocket's corners beside it
    for (const z of [-89.4, -86, -78, -70, -68.6]) expect(move({ x: -94, z }, { x: -98, z }), `z ${z}`).not.toBeNull();
  });

  it("the column north and south of the pocket stays shut: a step in from the village at z -92 or z -66 is dropped", () => {
    for (const z of [-94, -92, -90.2, -67.8, -66, -60, 0]) {
      expect(move({ x: -92, z }, { x: -97, z }), `z ${z}`).toBeNull();
    }
    // and from inside the pocket out through its north and south edges
    expect(move({ x: -100, z: -89.4 }, { x: -100, z: -92 })).toBeNull();
    expect(move({ x: -100, z: -89.4 }, { x: -100, z: -94.2 })).toBeNull();
    expect(move({ x: -100, z: -68.6 }, { x: -100, z: -66 })).toBeNull();
    expect(move({ x: -100, z: -68.6 }, { x: -100, z: -64 })).toBeNull();
  });

  it("a position forced past the pocket's west edge (x -120, the cliff) is not taken as that: it is clamped to the edge or dropped, never inside the pool", () => {
    for (const z of [-89, -85, -78, -72, -69]) {
      const r = move({ x: -102, z }, { x: -120, z });
      if (r) {
        expect(r.x).toBeGreaterThanOrEqual(W.pocket.minX + R - 1e-9);
        expect(isBlocked(r.x, r.z, R, G.obstacles)).toBe(false);
      }
    }
  });
});

describe("the pool cannot be entered", () => {
  it("a step into the water (any point of the waterline off the flat rocks) is dropped, from any legal start", () => {
    let dropped = 0;
    for (const sx of [-105, -102, -100, -97]) {
      for (const sz of [-89, -86, -82, -78, -74, -70]) {
        if (isBlocked(sx, sz, R, G.obstacles)) continue;
        for (let a = 0; a < 24; a++) {
          for (const d of [1, 2.5, 4.8]) {
            const t = { x: sx + d * Math.cos((a * Math.PI) / 12), z: sz + d * Math.sin((a * Math.PI) / 12) };
            if (poolRadius(L, t.x, t.z) >= 1 || onSlab(L, t.x, t.z)) continue;
            expect(move({ x: sx, z: sz }, t), `${sx},${sz} -> ${t.x.toFixed(2)},${t.z.toFixed(2)}`).toBeNull();
            dropped++;
          }
        }
      }
    }
    expect(dropped).toBeGreaterThan(50);
  });

  it("every Move the server takes in the pocket lands on a point W0's rule allows (in the pocket, off the keep-out unless on a flat rock)", () => {
    let taken = 0;
    for (let sx = -105.5; sx <= -94; sx += 1.5) {
      for (let sz = -89.5; sz <= -68.5; sz += 1.5) {
        if (isBlocked(sx, sz, R, G.obstacles)) continue;
        for (let a = 0; a < 16; a++) {
          for (const d of [0.5, 2, 4.8]) {
            const t = { x: sx + d * Math.cos((a * Math.PI) / 8), z: sz + d * Math.sin((a * Math.PI) / 8) };
            const r = move({ x: sx, z: sz }, t);
            if (!r) continue;
            if (r.x < L.walkBounds.minX) {
              taken++;
              expect(inPocket(r), `${r.x},${r.z}`).toBe(true);
              expect(fallsWalkSurfaceOk(L, r.x, r.z), `${r.x},${r.z}`).toBe(true);
            }
          }
        }
      }
    }
    expect(taken).toBeGreaterThan(500);
  });

  it("the front flat rock can be stood on (a Move onto it is taken, over the water's edge) and left again", () => {
    const front = W.slabs[0];
    const on = { x: front.centre.x - 1.0, z: front.centre.z };
    expect(onSlab(L, on.x, on.z)).toBe(true);
    expect(move({ x: -100.5, z: front.centre.z }, on)).not.toBeNull();
    expect(move(on, { x: -100.5, z: front.centre.z })).not.toBeNull();
    // a step off its front into the water is dropped
    expect(move(on, { x: on.x - 1.5, z: on.z })).toBeNull();
  });
});

describe("the stone seats on the server", () => {
  const stones = VILLAGE_SEATS.map((s, i) => ({ s, i })).filter(({ s }) => s.bench.startsWith("falls_seat_"));
  const standingAt = (x: number, z: number) => ({ x, z, seatIndex: -1 });

  it("a visitor standing on a seat's own side asks and is seated; the seat's other side is refused (silent)", () => {
    expect(stones).toHaveLength(8);
    for (const { s, i } of stones) {
      expect(validateSit(standingAt(s.standX, s.standZ), { seatIndex: i }, new Map(), "a", VILLAGE_SEATS)).toEqual({ seatIndex: i });
      // from the stone's far side (more than SEAT_REACH behind the front edge, or at least behind it): refused
      const behind = { x: s.x - Math.sign(Math.sin(s.yaw)) * 1.4, z: s.z };
      if (Math.hypot(behind.x - s.x, behind.z - s.z) <= SEAT_REACH) expect(validateSit(standingAt(behind.x, behind.z), { seatIndex: i }, new Map(), "a", VILLAGE_SEATS)).toBeNull();
    }
  });

  it("first come, first seated: a taken seat is refused with the Korean notice, the same stone's other places are free", () => {
    const [a, b] = stones.filter(({ s }) => s.bench === "falls_seat_n" && s.yaw > 0);
    const taken = new Map([[a.i, "alice"]]);
    expect(validateSit(standingAt(a.s.standX, a.s.standZ), { seatIndex: a.i }, taken, "bob", VILLAGE_SEATS)).toEqual({ reason: SEAT_OCCUPIED });
    expect(validateSit(standingAt(b.s.standX, b.s.standZ), { seatIndex: b.i }, taken, "bob", VILLAGE_SEATS)).toEqual({ seatIndex: b.i });
    // the west-facing seat of the same stone is the other side: free
    const w = stones.find(({ s }) => s.bench === "falls_seat_n" && s.yaw < 0)!;
    expect(validateSit(standingAt(w.s.standX, w.s.standZ), { seatIndex: w.i }, taken, "bob", VILLAGE_SEATS)).toEqual({ seatIndex: w.i });
  });

  it("a seated visitor gets up onto free ground in the rest area, inside the pocket", () => {
    for (const { s } of stones) {
      expect(isBlocked(s.standX, s.standZ, R, G.obstacles, 0)).toBe(false);
      expect(inPocket({ x: s.standX, z: s.standZ })).toBe(true);
    }
  });
});
