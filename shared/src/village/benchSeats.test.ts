import { describe, expect, it } from "vitest";
import { isBlocked, type AABB } from "../collision";
import { PLAYER_RADIUS, SEAT_REACH, SEATS, approachesSeat, nearestFreeSeat } from "../worldMap";
import { SIT_POSE, SIT_ROOT_AHEAD, liftForSeatY } from "../sitPose";
import { VILLAGE_COLLIDERS } from "./generated/villageColliders";
import { MEMORIAL_COLLIDERS } from "./generated/memorialColliders";
import { VILLAGE_LAYOUT, villageGeometry } from "./villageLayout";
import { STAND_CLEARANCE, VILLAGE_BENCHES, VILLAGE_SEATS, benchSeatOffsets, type VillageBench } from "./benchSeats";

/** The seated figure's width across the arms (sitPose.ts: the torso with the upper arms, -0.52..0.54 m) and the hands' (-0.53..0.58). */
const SEATED_HANDS_WIDTH = 0.532 + 0.575;

const L = VILLAGE_LAYOUT;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The axis-aligned box of an `sx` x `sz` rectangle centred on (cx, cz) and turned by `yaw` (parts_props.py aabb_of). */
function turnedBox(cx: number, cz: number, yaw: number, sx: number, sz: number): AABB {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const hx = (sx * c + sz * s) / 2;
  const hz = (sx * s + sz * c) / 2;
  return { minX: r2(cx - hx), maxX: r2(cx + hx), minZ: r2(cz - hz), maxZ: r2(cz + hz) };
}
const sameBox = (a: AABB, b: AABB, tol = 0.011) =>
  Math.abs(a.minX - b.minX) <= tol && Math.abs(a.maxX - b.maxX) <= tol && Math.abs(a.minZ - b.minZ) <= tol && Math.abs(a.maxZ - b.maxZ) <= tol;
const contains = (outer: AABB, inner: AABB) =>
  outer.minX <= inner.minX + 1e-9 && outer.maxX >= inner.maxX - 1e-9 && outer.minZ <= inner.minZ + 1e-9 && outer.maxZ >= inner.maxZ - 1e-9;

/** A seat point expressed in its bench's frame: `along` the bench (local x) and `ahead` of its centre along the facing. */
function inBenchFrame(b: VillageBench, x: number, z: number): { along: number; ahead: number } {
  const dx = x - b.centre.x;
  const dz = z - b.centre.z;
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { along: dx * c - dz * s, ahead: dx * s + dz * c };
}
const benchOf = (id: string) => VILLAGE_BENCHES.find((b) => b.id === id)!;

describe("village benches (the models sitting needs)", () => {
  it("lists the eight plaza benches, the forecourt bench and the hall bench, in that order", () => {
    expect(VILLAGE_BENCHES.map((b) => b.id)).toEqual([
      ...L.plaza.benches.map((_, i) => `plaza_${i + 1}`),
      "memorial_forecourt",
      "hall",
    ]);
    expect(VILLAGE_BENCHES.filter((b) => b.area === "hall").map((b) => b.id)).toEqual(["hall"]);
  });

  it("each plaza bench is the layout's, and the model's collider is its 1.9 x 0.66 footprint turned to face the fountain", () => {
    L.plaza.benches.forEach((p, i) => {
      const b = VILLAGE_BENCHES[i]!;
      expect(b.centre).toEqual({ x: p.x, z: p.z });
      expect(b.yaw).toBe(p.yaw);
      // the art builds col__bench_<n> as exactly this box (parts_props.py benches): the model really is where we sit
      const box = turnedBox(p.x, p.z, p.yaw, 1.9, 0.66);
      expect(VILLAGE_COLLIDERS.some((c) => sameBox(c, box)), b.id).toBe(true);
      // the seat (1.86 long, front edge 0.2625 ahead) lies inside that footprint
      expect(b.length).toBeLessThanOrEqual(1.9);
      expect(b.frontEdge).toBeLessThanOrEqual(0.33);
    });
  });

  it("the forecourt's stone block and the hall's oak board sit inside their colliders", () => {
    const fore = benchOf("memorial_forecourt");
    expect(VILLAGE_COLLIDERS.some((c) => contains(c, turnedBox(fore.centre.x, fore.centre.z, fore.yaw, fore.length, fore.frontEdge * 2)))).toBe(true);
    const hall = benchOf("hall");
    const board = turnedBox(hall.centre.x, hall.centre.z, hall.yaw, hall.length, hall.frontEdge * 2);
    expect(MEMORIAL_COLLIDERS.some((c) => sameBox(c, board))).toBe(true); // col__bench is exactly the board
  });

  it("seat surfaces are ordinary bench height, a few cm above the sit pose's butt (the avatar is lifted, never sunk)", () => {
    for (const b of VILLAGE_BENCHES) {
      expect(b.seatTop).toBeGreaterThanOrEqual(0.43);
      expect(b.seatTop).toBeLessThanOrEqual(0.47);
      const lift = liftForSeatY(b.seatTop);
      expect(lift).toBeGreaterThan(0);
      expect(lift).toBeLessThan(0.1);
    }
    expect(liftForSeatY(undefined)).toBe(0); // the legacy chairs: drawn as authored
  });
});

describe("village seats (where a sitter goes)", () => {
  it("two seats per bench, in bench order, further apart than the seated figure is wide (hands to hands)", () => {
    expect(VILLAGE_SEATS).toHaveLength(VILLAGE_BENCHES.length * 2);
    VILLAGE_BENCHES.forEach((b, i) => {
      const pair = VILLAGE_SEATS.slice(i * 2, i * 2 + 2);
      for (const s of pair) {
        expect(s.bench).toBe(b.id);
        expect(s.area).toBe(b.area);
        expect(s.yaw).toBe(b.yaw);
        expect(s.seatY).toBe(b.seatTop);
        expect(s.frontEdge).toBe(SIT_ROOT_AHEAD);
      }
      const apart = Math.hypot(pair[0]!.x - pair[1]!.x, pair[0]!.z - pair[1]!.z);
      expect(apart).toBeCloseTo(2 * benchSeatOffsets(b.length)[1]!, 2);
      expect(apart).toBeGreaterThan(SEATED_HANDS_WIDTH);
    });
    expect(benchSeatOffsets(1.86)).toEqual([-0.58, 0.58]); // the plaza benches
    expect(benchSeatOffsets(2.4)).toEqual([-0.6, 0.6]); // the hall's
  });

  it("the sit pose lands ON the seat: hips on its front half, the butt between its edges, the hanging calves clear of the front edge", () => {
    for (const s of VILLAGE_SEATS) {
      const b = benchOf(s.bench);
      const root = inBenchFrame(b, s.x, s.z);
      const hips = root.ahead - SIT_POSE.hipsBehindRoot;
      const calves = root.ahead - SIT_POSE.calvesBehindRoot;
      // the butt spans 0.0..0.17 m behind the hips (z -0.40..-0.57 in the pose); all of it on the seat
      expect(hips).toBeLessThan(b.frontEdge - 0.1);
      expect(hips - 0.17).toBeGreaterThan(-b.frontEdge);
      expect(hips).toBeGreaterThan(0); // the front half
      expect(calves).toBeGreaterThan(b.frontEdge); // the shins hang in front of the edge, not through it
      // the thighs (0.31 m either side of the hips) stay on the seat's length
      expect(Math.abs(root.along) + 0.31).toBeLessThanOrEqual(b.length / 2);
    }
  });

  it("plaza sitters face the fountain with the backrest behind them; the forecourt faces the plaza, the hall faces the memorial table", () => {
    for (const s of VILLAGE_SEATS.filter((v) => v.bench.startsWith("plaza_"))) {
      const toFountain = Math.atan2(-s.x, -s.z);
      expect(Math.abs(Math.atan2(Math.sin(s.yaw - toFountain), Math.cos(s.yaw - toFountain)))).toBeLessThan(0.15);
    }
    for (const s of VILLAGE_SEATS.filter((v) => v.bench === "memorial_forecourt")) {
      expect(s.yaw).toBe(0); // +z: away from the building to the north
      expect(s.z).toBeGreaterThan(L.memorial.exterior.centre.z + L.memorial.exterior.size.z / 2);
    }
    for (const s of VILLAGE_SEATS.filter((v) => v.bench === "hall")) {
      expect(s.yaw).toBeCloseTo(Math.PI, 9); // -z: toward the memorial table and the back wall
      expect(s.x).toBeGreaterThan(L.memorial.interior.room.minX);
      expect(s.x).toBeLessThan(L.memorial.interior.room.maxX);
    }
  });

  it("no two sitters overlap: seats of different benches are far apart, and every seat point is in its own area", () => {
    for (let i = 0; i < VILLAGE_SEATS.length; i++) {
      const a = VILLAGE_SEATS[i]!;
      const bounds = L.areas[a.area];
      expect(a.x).toBeGreaterThan(bounds.minX);
      expect(a.x).toBeLessThan(bounds.maxX);
      expect(a.z).toBeGreaterThan(bounds.minZ);
      expect(a.z).toBeLessThan(bounds.maxZ);
      for (let j = i + 1; j < VILLAGE_SEATS.length; j++) {
        const b = VILLAGE_SEATS[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${i} vs ${j}`).toBeGreaterThan(SEATED_HANDS_WIDTH);
      }
    }
  });
});

describe("village seats (where a sitter gets up to)", () => {
  it("every dismount spot is clear of every collider of the village (a standing body plus margin) and inside its area", () => {
    for (const s of VILLAGE_SEATS) {
      expect(isBlocked(s.standX, s.standZ, PLAYER_RADIUS + STAND_CLEARANCE, villageGeometry.obstacles, 0), s.bench).toBe(false);
      const bounds = L.areas[s.area];
      expect(s.standX - PLAYER_RADIUS).toBeGreaterThan(bounds.minX);
      expect(s.standX + PLAYER_RADIUS).toBeLessThan(bounds.maxX);
      expect(s.standZ - PLAYER_RADIUS).toBeGreaterThan(bounds.minZ);
      expect(s.standZ + PLAYER_RADIUS).toBeLessThan(bounds.maxZ);
    }
  });

  it("gets up in front of the bench, a short step from the seat (within reach, so the seat is offered again from there)", () => {
    for (const s of VILLAGE_SEATS) {
      const ahead = (s.standX - s.x) * Math.sin(s.yaw) + (s.standZ - s.z) * Math.cos(s.yaw);
      const d = Math.hypot(s.standX - s.x, s.standZ - s.z);
      expect(ahead).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(0.85);
      expect(d).toBeLessThan(SEAT_REACH);
      expect(approachesSeat(s, s.standX, s.standZ)).toBe(true);
    }
  });

  it("two sitters of one bench get up to different spots, clear of each other and of the other seat", () => {
    for (let i = 0; i < VILLAGE_SEATS.length; i += 2) {
      const a = VILLAGE_SEATS[i]!;
      const b = VILLAGE_SEATS[i + 1]!;
      expect(Math.hypot(a.standX - b.standX, a.standZ - b.standZ)).toBeGreaterThan(2 * PLAYER_RADIUS);
      expect(Math.hypot(a.standX - b.x, a.standZ - b.z)).toBeGreaterThan(2 * PLAYER_RADIUS);
      expect(Math.hypot(b.standX - a.x, b.standZ - a.z)).toBeGreaterThan(2 * PLAYER_RADIUS);
    }
  });
});

describe("benches are sat on from the front (approachesSeat / nearestFreeSeat)", () => {
  const s = VILLAGE_SEATS[0]!;
  const fwd = { x: Math.sin(s.yaw), z: Math.cos(s.yaw) };

  it("offers the seat in front of the bench, not behind its backrest, even within reach", () => {
    expect(approachesSeat(s, s.x + fwd.x, s.z + fwd.z)).toBe(true);
    expect(approachesSeat(s, s.x - fwd.x * 1.2, s.z - fwd.z * 1.2)).toBe(false); // behind the bench, 1.2 m from the seat
    const free = () => false;
    expect(nearestFreeSeat(s.x - fwd.x * 1.2, s.z - fwd.z * 1.2, free, SEAT_REACH, VILLAGE_SEATS)).toBeNull();
    expect(nearestFreeSeat(s.standX, s.standZ, free, SEAT_REACH, VILLAGE_SEATS)).toBe(0);
  });

  it("offers the nearest free seat of a bench: the neighbour when the near one is taken", () => {
    const n = VILLAGE_SEATS[1]!;
    // 0.4 m in front of the bench's middle, a hair nearer seat 0
    const x = (s.x * 0.52 + n.x * 0.48) + fwd.x * 0.4;
    const z = (s.z * 0.52 + n.z * 0.48) + fwd.z * 0.4;
    expect(nearestFreeSeat(x, z, () => false, SEAT_REACH, VILLAGE_SEATS)).toBe(0);
    expect(nearestFreeSeat(x, z, (i) => i === 0, SEAT_REACH, VILLAGE_SEATS)).toBe(1);
  });

  it("the legacy chairs keep their any-side reach (no front edge), and the default list is still the world's", () => {
    for (const c of SEATS) {
      expect(c.frontEdge).toBeUndefined();
      expect(c.seatY).toBeUndefined();
      expect(approachesSeat(c, c.x - 1, c.z)).toBe(true);
    }
    expect(nearestFreeSeat(SEATS[0]!.standX, SEATS[0]!.standZ, () => false)).toBe(0);
  });
});
