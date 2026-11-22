import { describe, expect, it } from "vitest";
import { isBlocked } from "../collision";
import { PLAYER_RADIUS } from "../worldMap";
import { reachable } from "../school/reachTestUtil";
import {
  CAROUSEL_PAD, COASTER_PAD, DROP_PAD, MOON_BOAT_PAD, PARK_ARRIVAL, PARK_BINS, PARK_BOUNDS, PARK_EXIT_PAD, PARK_FOUNTAIN_RADIUS, PARK_KIOSK, PARK_LAMPS, PARK_PLANTERS,
  PARK_PLAZA, PARK_SHOPS, PARK_SOLIDS, PARK_SOUTH_HEDGE, PARK_TICKET_BOOTH, PARK_TREES, PARK_TROUGHS, WHEEL_PAD, parkFountainSolids, parkGeometry, parkSouthHedgeSolids, parkStreetSolids,
} from "./parkArea";
import { PARK_BENCHES, PARK_BENCH_MODEL, parkBenchFacing, parkBenchSolids } from "./parkBenches";
import { VILLAGE_SEATS, standsClear } from "./benchSeats";
import { standCandidates, standSide } from "./standSpot";
import { SIT_ROOT_AHEAD } from "../sitPose";
import { approachesSeat } from "../worldMap";
import { PARK_ISLANDS, islandPoint, islandSolids, onIsland } from "./parkIslands";

// owner 2026-11-21: the avatar walked through Caysonland's lamp posts ("조명이랑 그냥 통과해버리네"), its benches ("의자도 통과해버리네") and
// its planted beds ("화단에 식물이 있는데 이걸 그냥 통과해버리네"). Every prop of the park is a solid now; nothing solid stands in a walk,
// on a boarding pad or in front of a seat; and no solid reaches out past what is drawn (an invisible corner on the lawn).
const o = parkGeometry.obstacles;
const R = PLAYER_RADIUS;
const blocked = (x: number, z: number, r = R): boolean => isBlocked(x, z, r, o);
const FOUR = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const STREET = parkStreetSolids();

let reachMemo: Set<string> | null = null;
const key = (x: number, z: number) => `${Math.round((x - PARK_ARRIVAL.x) / 0.25)},${Math.round((z - PARK_ARRIVAL.z) / 0.25)}`;
/** The 0.25 m grid points a body walks to from the arrival spot. */
function reached(): Set<string> {
  reachMemo ??= new Set(reachable(parkGeometry, { x: PARK_ARRIVAL.x, z: PARK_ARRIVAL.z }, 0.25, 0).map((p) => key(p.x, p.z)));
  return reachMemo;
}

describe("Caysonland: every prop type has a collider", () => {
  it("every lamp post stops a walker at its base, from four sides, and only at its base", () => {
    expect(PARK_LAMPS.length).toBe(56);
    const posts = STREET.filter((b) => b.maxX - b.minX < 0.5);
    for (const l of PARK_LAMPS) {
      expect(blocked(l.x, l.z, 0.05), `lamp ${l.x},${l.z}`).toBe(true);
      for (const [dx, dz] of FOUR) {
        expect(blocked(l.x + dx * 0.55, l.z + dz * 0.55), `lamp ${l.x},${l.z} from ${dx},${dz}`).toBe(true);
        expect(isBlocked(l.x + dx * 0.85, l.z + dz * 0.85, R, posts), `lamp ${l.x},${l.z}: its box is too big ${dx},${dz}`).toBe(false);
      }
    }
  });

  it("every bench is solid along its whole length; a walker stands right in front of it, behind it and at its ends", () => {
    expect(PARK_BENCHES.length).toBe(17);
    for (const [x, z] of PARK_BENCHES) {
      for (const dz of [-0.9, 0, 0.9]) expect(blocked(x, z + dz, 0.05), `bench ${x},${z}+${dz}`).toBe(true);
      for (const dx of [0.36 + R + 0.05, -0.36 - R - 0.05]) expect(blocked(x + dx, z), `bench ${x},${z} side ${dx}`).toBe(false);
      for (const dz of [1 + R + 0.05, -1 - R - 0.05]) expect(blocked(x, z + dz), `bench ${x},${z} end ${dz}`).toBe(false);
    }
  });

  it("every litter bin, stone planter, plaza trough, the kiosk and every shop is solid", () => {
    expect(PARK_BINS.length).toBe(7);
    expect(PARK_PLANTERS.length).toBe(8);
    expect(PARK_TROUGHS.length).toBe(12);
    for (const b of PARK_BINS) for (const [dx, dz] of [[0, 0], ...FOUR]) expect(blocked(b.x + dx * 0.6, b.z + dz * 0.6), `bin ${b.x},${b.z}`).toBe(true);
    for (const p of PARK_PLANTERS) {
      for (const [dx, dz] of [[0, 0], [0.9, 0], [-0.9, 0], [0, 0.6], [0, -0.6]] as const) expect(blocked(p.x + (dx * p.w) / 2, p.z + (dz * p.d) / 2, 0.05), `planter ${p.x},${p.z}`).toBe(true);
    }
    for (const t of PARK_TROUGHS) for (const [u, v] of [[0.5, 0.5], [0.05, 0.05], [0.95, 0.95]] as const) expect(blocked(t.x0 + (t.x1 - t.x0) * u, t.z0 + (t.z1 - t.z0) * v, 0.05)).toBe(true);
    expect(blocked(PARK_KIOSK.x, PARK_KIOSK.z, 0.05)).toBe(true);
    // the two booths' counters reach 0.66 m out of their fronts: nobody stands in the plank
    for (const b of [PARK_KIOSK, PARK_TICKET_BOOTH]) {
      expect(blocked(b.x, b.z, 0.05), `booth ${b.x},${b.z}`).toBe(true);
      expect(blocked(b.x, b.z + b.d / 2 + 0.5, 0.05), `counter of the booth ${b.x},${b.z}`).toBe(true);
      expect(blocked(b.x, b.z + b.d / 2 + 0.66 + R + 0.05), `in front of the counter ${b.x},${b.z}`).toBe(false);
    }
    for (const s of PARK_SHOPS) expect(blocked(s.x, s.z, 0.05), s.id).toBe(true);
  });

  it("every tree trunk is solid", () => {
    expect(PARK_TREES.length).toBeGreaterThan(100);
    for (const t of PARK_TREES) expect(blocked(t.x, t.z, 0.05), `tree ${t.x},${t.z}`).toBe(true);
  });

  it("the planted islands stop a walker at the kerb all the way round, and reach nowhere past it", () => {
    expect(PARK_ISLANDS).toHaveLength(12);
    const boxes = islandSolids();
    expect(boxes.length).toBeLessThan(320); // (rows 0.4 m deep: about twenty boxes an island)
    for (const island of PARK_ISLANDS) {
      const reach = island[3] + island[4] + 1.5;
      let inside = 0;
      for (let x = island[0] - reach; x <= island[0] + reach; x += 0.2) {
        for (let z = island[1] - reach; z <= island[1] + reach; z += 0.2) {
          // on the bed, 0.3 m in from the kerb: a body's centre can never be here
          if (!onIsland(island, x, z, 0.3)) continue;
          inside++;
          expect(blocked(x, z), `island ${island[0]},${island[1]}: the bed at (${x.toFixed(1)}, ${z.toFixed(1)}) can be stood on`).toBe(true);
        }
      }
      expect(inside).toBeGreaterThan(100);
      // round the island: a body standing 0.25 m or more off the kerb is free of the island's own boxes (no corner past the kerb)
      const outline = Array.from({ length: 240 }, (_, k) => islandPoint(island, Math.cos((k / 240) * Math.PI * 2), Math.sin((k / 240) * Math.PI * 2)));
      let ring = 0;
      for (let x = island[0] - reach; x <= island[0] + reach; x += 0.2) {
        for (let z = island[1] - reach; z <= island[1] + reach; z += 0.2) {
          if (onIsland(island, x, z)) continue;
          const d = Math.min(...outline.map((p) => Math.hypot(p.x - x, p.z - z)));
          if (d < R + 0.25 || d > R + 1) continue;
          ring++;
          expect(isBlocked(x, z, R, boxes), `island ${island[0]},${island[1]}: a box reaches past the kerb at (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(false);
        }
      }
      expect(ring).toBeGreaterThan(100);
    }
  });

  it("the fountain's round basin: solid all the way round its rim, no square corner out on the paving", () => {
    const { x, z } = PARK_PLAZA;
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      // a body's centre never comes within 0.15 m of the basin's edge
      expect(blocked(x + Math.cos(a) * (PARK_FOUNTAIN_RADIUS + 0.15), z + Math.sin(a) * (PARK_FOUNTAIN_RADIUS + 0.15)), `rim at ${k}`).toBe(true);
      // ...and a body stands 0.4 m off it anywhere round
      expect(isBlocked(x + Math.cos(a) * (PARK_FOUNTAIN_RADIUS + R + 0.4), z + Math.sin(a) * (PARK_FOUNTAIN_RADIUS + R + 0.4), R, parkFountainSolids()), `clear at ${k}`).toBe(false);
    }
  });

  it("the south hedge is a wall at its north face (the walk bounds end inside the row)", () => {
    expect(PARK_BOUNDS.maxZ).toBeGreaterThan(PARK_SOUTH_HEDGE.z); // the reason: without the box a body stands in the shrubs
    for (let x = PARK_BOUNDS.minX + 2; x < PARK_BOUNDS.maxX; x += 3) {
      if (x > -PARK_SOUTH_HEDGE.gap && x < PARK_SOUTH_HEDGE.gap) continue;
      expect(isBlocked(x, PARK_SOUTH_HEDGE.z - 0.6, R, parkSouthHedgeSolids()), `hedge at ${x}`).toBe(true);
      expect(isBlocked(x, PARK_SOUTH_HEDGE.face - R - 0.05, R, parkSouthHedgeSolids()), `lawn north of the hedge at ${x}`).toBe(false);
    }
    // the station's frontage (no hedge there) is as it was
    expect(isBlocked(0, -8.5, R, parkSouthHedgeSolids())).toBe(false);
  });
});

describe("Caysonland: no collider blocks a walk, a pad, a shop front or a seat's approach", () => {
  it("the promenade, the avenue, the station approach and the plaza ring stay open", () => {
    for (let z = -178; z <= -138; z += 0.5) for (const x of [36, 38, 40, 42, 44]) expect(blocked(x, z), `promenade ${x},${z}`).toBe(false);
    for (let x = 67; x <= 340; x += 0.5) for (const z of [-114.5, -113, -112, -111]) expect(blocked(x, z), `avenue ${x},${z}`).toBe(false);
    for (let z = -104; z <= -28; z += 0.5) for (const x of [0, 2, 4]) expect(blocked(x, z), `station approach ${x},${z}`).toBe(false);
    // round the fountain, between its basin and the flower troughs, and round the plaza outside the troughs
    for (let k = 0; k < 180; k++) {
      const a = (k / 180) * Math.PI * 2;
      for (const r of [PARK_FOUNTAIN_RADIUS + 1.2, 12, 21]) expect(blocked(PARK_PLAZA.x + Math.cos(a) * r, PARK_PLAZA.z + Math.sin(a) * r), `plaza ring r ${r} at ${k}`).toBe(false);
    }
    // the promenade's outer lanes, between the benches (x 34 / 46) and the lamps (x 31 / 49): clear paving each side, but for the bins
    for (let z = -176; z <= -140; z += 0.5) for (const x of [32.5, 47.5]) {
      if (PARK_BINS.some((b) => Math.hypot(b.x - x, b.z - z) < 1.2)) continue;
      expect(blocked(x, z), `promenade's outer lane ${x},${z}`).toBe(false);
    }
  });

  it("no street solid on a ride's boarding pad, the exit pad or the arrival spot", () => {
    for (const p of [PARK_EXIT_PAD, COASTER_PAD, CAROUSEL_PAD, WHEEL_PAD, MOON_BOAT_PAD, DROP_PAD]) {
      expect(blocked(p.x, p.z), `pad ${p.x},${p.z}`).toBe(false);
      for (const b of STREET) {
        const d = Math.hypot(Math.max(b.minX - p.x, 0, p.x - b.maxX), Math.max(b.minZ - p.z, 0, p.z - b.maxZ));
        expect(d, `a street solid ${JSON.stringify(b)} on the pad ${p.x},${p.z}`).toBeGreaterThan(Math.min(p.radius, 1.8));
      }
    }
    expect(blocked(PARK_ARRIVAL.x, PARK_ARRIVAL.z)).toBe(false);
  });

  it("everywhere a visitor goes is reached on foot from the arrival: pads, shop fronts, both sides of every bench, every bin, lamp, island and trough", () => {
    const set = reached();
    /** A reached grid point within `tol` m of (x, z). */
    const near = (x: number, z: number, tol = 0.6): boolean => {
      const n = Math.ceil(tol / 0.25);
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (Math.hypot(i, j) * 0.25 <= tol + 0.13 && set.has(key(x + i * 0.25, z + j * 0.25))) return true;
      return false;
    };
    for (const p of [PARK_EXIT_PAD, COASTER_PAD, CAROUSEL_PAD, WHEEL_PAD, MOON_BOAT_PAD, DROP_PAD]) expect(near(p.x, p.z), `pad ${p.x},${p.z}`).toBe(true);
    for (const s of PARK_SHOPS) expect(near(s.x + s.faces * (s.d / 2 + 1.2), s.z, 0.8), `shop front ${s.id}`).toBe(true);
    for (const [x, z] of PARK_BENCHES) for (const dx of [0.36 + R + 0.15, -0.36 - R - 0.15]) expect(near(x + dx, z, 0.3), `bench ${x},${z} side ${dx}`).toBe(true);
    for (const b of PARK_BINS) expect(near(b.x, b.z, 0.95), `bin ${b.x},${b.z}`).toBe(true);
    for (const l of PARK_LAMPS) expect(near(l.x, l.z, 0.9), `lamp ${l.x},${l.z}`).toBe(true);
    for (const t of PARK_TROUGHS) expect(near((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2, 1.6), `trough`).toBe(true);
    for (const island of PARK_ISLANDS) for (const u of [-1.2, 1.2]) {
      const p = islandPoint(island, u, 0);
      expect(near(p.x, p.z, 0.75), `island ${island[0]},${island[1]} end`).toBe(true);
    }
  }, 120000);

  it("no trap: every spot a body fits on within 3 m of a street solid is reached from the arrival", () => {
    const set = reached();
    const stranded: string[] = [];
    const seen = new Set<string>();
    for (const b of STREET) {
      for (let x = Math.floor((b.minX - 3) / 0.25) * 0.25; x <= b.maxX + 3; x += 0.25) {
        for (let z = Math.floor((b.minZ - 3) / 0.25) * 0.25; z <= b.maxZ + 3; z += 0.25) {
          const gx = PARK_ARRIVAL.x + Math.round((x - PARK_ARRIVAL.x) / 0.25) * 0.25;
          const gz = PARK_ARRIVAL.z + Math.round((z - PARK_ARRIVAL.z) / 0.25) * 0.25;
          const k = key(gx, gz);
          if (seen.has(k)) continue;
          seen.add(k);
          if (gx < PARK_BOUNDS.minX || gx > PARK_BOUNDS.maxX || gz < PARK_BOUNDS.minZ || gz > PARK_BOUNDS.maxZ) continue;
          if (blocked(gx, gz)) continue;
          if (!set.has(k)) stranded.push(`(${gx.toFixed(2)}, ${gz.toFixed(2)})`);
        }
      }
    }
    expect(stranded).toEqual([]);
  }, 120000);

  it("the collision list stays small (it is scanned once a frame by the walker's own client, once a move by the server)", () => {
    expect(parkBenchSolids()).toHaveLength(17);
    expect(PARK_SOLIDS.length).toBeLessThan(900);
  });
});

describe("Caysonland: every bench is a seat (owner: every seat can be sat on; a backed one from its front only)", () => {
  const seats = VILLAGE_SEATS.map((s, i) => ({ s, i })).filter(({ s }) => s.area === "park");

  it("two places on each of the 17 benches, appended after every other seat (no index moved)", () => {
    expect(seats).toHaveLength(PARK_BENCHES.length * 2);
    expect(seats[0]!.i).toBe(VILLAGE_SEATS.length - seats.length);
    expect(new Set(seats.map(({ s }) => s.bench)).size).toBe(PARK_BENCHES.length);
    for (const { s } of seats) expect(s.kind, s.id).toBe("backed");
  });

  it("the sitter is on the bench, facing away from its backrest, between the arm frames; the two keep their hands apart", () => {
    PARK_BENCHES.forEach(([x, z, yaw], k) => {
      const pair = seats.filter(({ s }) => s.bench === `park_bench_${k + 1}`).map(({ s }) => s);
      expect(pair).toHaveLength(2);
      for (const s of pair) {
        expect(s.yaw, s.id).toBeCloseTo(parkBenchFacing(yaw), 5);
        // the hips (0.147 m behind the front edge) are over the slats: ahead of the centre by less than the front edge
        const ahead = (s.x - x) * Math.sin(s.yaw) + (s.z - z) * Math.cos(s.yaw);
        expect(ahead - SIT_ROOT_AHEAD, s.id).toBeCloseTo(PARK_BENCH_MODEL.frontEdge, 2);
        const along = Math.abs((s.x - x) * Math.cos(s.yaw) - (s.z - z) * Math.sin(s.yaw));
        expect(along, s.id).toBeLessThan(0.76 - 0.15);
        expect(s.seatY, s.id).toBe(PARK_BENCH_MODEL.seatTop);
      }
      expect(Math.hypot(pair[0]!.x - pair[1]!.x, pair[0]!.z - pair[1]!.z)).toBeGreaterThan(1.107);
    });
  });

  it("every stand spot: in front of the seat, clear of every park collider with the dismount clearance, reached on foot from the arrival", () => {
    const seen = reached();
    for (const { s } of seats) {
      expect(standSide(s, s.standX, s.standZ), s.id).toBe("front");
      expect(standsClear(s.standX, s.standZ, PARK_BOUNDS, parkGeometry), s.id).toBe(true);
      expect(Math.hypot(s.standX - s.x, s.standZ - s.z), s.id).toBeLessThan(0.6);
      const near = [...FOUR, [0, 0] as const].some(([dx, dz]) => seen.has(key(s.standX + dx * 0.25, s.standZ + dz * 0.25)));
      expect(near, s.id).toBe(true);
      // the server picks it (or a spot beside it when someone stands there) and never one behind the backrest
      for (const c of standCandidates(s)) expect(standSide(s, c.x, c.z), s.id).not.toBe("behind");
    }
  });

  it("offered from in front of the bench and from its ends, never from behind its backrest", () => {
    for (const { s } of seats) {
      expect(approachesSeat(s, s.standX, s.standZ), s.id).toBe(true);
      const bx = s.x - Math.sin(s.yaw) * 1.5;
      const bz = s.z - Math.cos(s.yaw) * 1.5;
      expect(approachesSeat(s, bx, bz), s.id).toBe(false);
    }
  });
});
