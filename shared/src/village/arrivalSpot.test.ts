import { describe, expect, it } from "vitest";
import { isBlocked } from "../collision";
import { PLAYER_RADIUS } from "../worldMap";
import { VILLAGE_MAX_CLIENTS } from "../constants";
import {
  ARRIVAL_RINGS,
  ARRIVAL_SPACING_M,
  DOOR_PAD_CLEARANCE_M,
  SPACING_SLACK_M,
  SPAWN_TRIES,
  arrivalArea,
  arrivalCandidates,
  findFreeSpot,
  freeSpawnSpot,
  isValidSpot,
  makeArrivalArea,
  pathClear,
  spreadArrival,
  type ArrivalArea,
  type ArrivalPose,
  type ArrivalSpot,
} from "./arrivalSpot";
import { VILLAGE_LAYOUT, houseInteriorGeometry, villageGeometry, type Point2 } from "./villageLayout";

const L = VILLAGE_LAYOUT;
const HALL_SPAWN = L.memorial.interior.spawn;
const OUT_ARRIVAL = L.memorial.exterior.arrival;
const PLAZA: ArrivalPose = { x: L.spawn.x, z: L.spawn.z, yaw: L.spawn.yaw };
const IN_PAD = L.memorial.interior.doorPad;
const OUT_PAD = L.memorial.exterior.doorPad;

/** `n` players arriving at the same nominal spot one after the other (the same server tick: each sees the ones before). */
function arriveTogether(n: number, area: string, nominal: ArrivalPose, already: Point2[] = []): ArrivalSpot[] {
  const occupants = [...already];
  const out: ArrivalSpot[] = [];
  for (let i = 0; i < n; i++) {
    const s = spreadArrival(area, nominal, occupants);
    out.push(s);
    occupants.push(s);
  }
  return out;
}

function minPairGap(spots: readonly Point2[]): number {
  let best = Infinity;
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) best = Math.min(best, Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z));
  }
  return best;
}

/** Every spot fits `area`: inside the room with the whole body, on no collider (strict), off every door pad. */
function expectValid(spots: readonly Point2[], area: ArrivalArea): void {
  for (const s of spots) {
    const at = JSON.stringify(s);
    expect(s.x, at).toBeGreaterThanOrEqual(area.bounds.minX + PLAYER_RADIUS - 1e-9);
    expect(s.x, at).toBeLessThanOrEqual(area.bounds.maxX - PLAYER_RADIUS + 1e-9);
    expect(s.z, at).toBeGreaterThanOrEqual(area.bounds.minZ + PLAYER_RADIUS - 1e-9);
    expect(s.z, at).toBeLessThanOrEqual(area.bounds.maxZ - PLAYER_RADIUS + 1e-9);
    expect(isBlocked(s.x, s.z, PLAYER_RADIUS, area.obstacles, 0), at).toBe(false);
    for (const pad of area.pads) {
      expect(Math.hypot(s.x - pad.centre.x, s.z - pad.centre.z), at).toBeGreaterThanOrEqual(pad.radius + DOOR_PAD_CLEARANCE_M - 1e-6);
    }
  }
}

describe("arrival spacing rules", () => {
  it("two arrivals keep 1.4 m centre to centre (two 0.4 m bodies + 0.6 m of air, so arms-out hands do not cross), and stay 0.2 m off a door pad's edge", () => {
    expect(PLAYER_RADIUS).toBe(0.4);
    expect(ARRIVAL_SPACING_M).toBeCloseTo(1.4, 12);
    expect(ARRIVAL_SPACING_M).toBeGreaterThan(2 * PLAYER_RADIUS);
    expect(DOOR_PAD_CLEARANCE_M).toBe(0.2);
    expect(SPACING_SLACK_M).toBeLessThan(0.01);
  });

  it("the layout's own arrival points are valid spots (each exactly 0.2 m off its pad)", () => {
    expect(isValidSpot(HALL_SPAWN, arrivalArea("hall"))).toBe(true);
    expect(isValidSpot(OUT_ARRIVAL, arrivalArea("village"))).toBe(true);
    expect(isValidSpot(PLAZA, arrivalArea("village"))).toBe(true);
    expect(isValidSpot(HALL_SPAWN, arrivalArea("house:house_1"))).toBe(true);
    expect(Math.hypot(HALL_SPAWN.x - IN_PAD.centre.x, HALL_SPAWN.z - IN_PAD.centre.z)).toBeCloseTo(IN_PAD.radius + DOOR_PAD_CLEARANCE_M, 9);
    expect(Math.hypot(OUT_ARRIVAL.x - OUT_PAD.centre.x, OUT_ARRIVAL.z - OUT_PAD.centre.z)).toBeCloseTo(OUT_PAD.radius + DOOR_PAD_CLEARANCE_M, 9);
  });

  it("each area has its own rectangle, colliders and door pad", () => {
    const hall = arrivalArea("hall");
    const village = arrivalArea("village");
    const house = arrivalArea("house:house_3");
    expect(hall.bounds).toEqual(L.areas.hall);
    expect(village.bounds).toEqual(L.areas.village);
    expect(house.bounds).toEqual(L.areas.hall);
    expect(hall.pads).toEqual([IN_PAD]);
    expect(village.pads).toEqual([OUT_PAD]);
    expect(house.pads).toEqual([IN_PAD]);
    // The hall keeps its furniture; a house interior uses its own (wall-only) geometry.
    expect(hall.obstacles.length).toBeGreaterThan(house.obstacles.length);
    for (const b of house.obstacles) expect(houseInteriorGeometry.obstacles).toContain(b);
    for (const b of hall.obstacles) expect(villageGeometry.obstacles).toContain(b);
    // Only the colliders that can touch the room are kept (the village's hundreds are not scanned for the hall).
    expect(hall.obstacles.length).toBeLessThan(villageGeometry.obstacles.length);
    expect(arrivalArea("somewhere")).toBe(village);
  });

  it("a spot on a collider, outside the room or on a door pad is not valid", () => {
    const hall = arrivalArea("hall");
    expect(isValidSpot({ x: 296, z: 3 }, hall)).toBe(false); // the long sofa
    expect(isValidSpot({ x: 300, z: 5.7 }, hall)).toBe(false); // against the south wall, on the pad
    expect(isValidSpot({ x: IN_PAD.centre.x, z: IN_PAD.centre.z }, hall)).toBe(false); // on the way out
    expect(isValidSpot({ x: 300, z: IN_PAD.centre.z - IN_PAD.radius - 0.1 }, hall)).toBe(false); // 0.1 m off the pad's edge
    expect(isValidSpot({ x: 292.6, z: 0 }, hall)).toBe(false); // half the body in the west wall
    expect(isValidSpot({ x: Number.NaN, z: 0 }, hall)).toBe(false);
    expect(isValidSpot({ x: OUT_PAD.centre.x, z: OUT_PAD.centre.z }, arrivalArea("village"))).toBe(false);
  });
});

describe("the candidate lattice", () => {
  const nominal: ArrivalPose = { x: 10, z: -4, yaw: Math.PI / 3 };
  const cands = arrivalCandidates(nominal);

  it("starts at the nominal spot and goes nearest first, out to 8 rings", () => {
    expect(cands[0]).toEqual({ x: 10, z: -4 });
    const d = cands.map((c) => Math.hypot(c.x - nominal.x, c.z - nominal.z));
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1] - 1e-9);
    expect(Math.max(...d)).toBeLessThanOrEqual(ARRIVAL_RINGS * ARRIVAL_SPACING_M + 1e-6);
    expect(cands.length).toBeGreaterThanOrEqual(200);
  });

  it("is a hex lattice of the spacing: any two spots are at least one spacing apart, and each has six neighbours at exactly that", () => {
    expect(minPairGap(cands)).toBeGreaterThanOrEqual(ARRIVAL_SPACING_M - 1e-9);
    const ring1 = cands.slice(1, 7).map((c) => Math.hypot(c.x - nominal.x, c.z - nominal.z));
    for (const r of ring1) expect(r).toBeCloseTo(ARRIVAL_SPACING_M, 9);
  });

  it("the first spots after the nominal one are right beside it (right, then left), then diagonally ahead", () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
      const n: ArrivalPose = { x: 0, z: 0, yaw };
      const c = arrivalCandidates(n);
      const fwd = (p: Point2) => p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
      // the right hand, looking along the facing on the ground plane (y up): (-cos yaw, sin yaw)
      const right = (p: Point2) => -p.x * Math.cos(yaw) + p.z * Math.sin(yaw);
      expect(fwd(c[1])).toBeCloseTo(0, 9);
      expect(right(c[1])).toBeCloseTo(ARRIVAL_SPACING_M, 9);
      expect(fwd(c[2])).toBeCloseTo(0, 9);
      expect(right(c[2])).toBeCloseTo(-ARRIVAL_SPACING_M, 9);
      expect(fwd(c[3])).toBeGreaterThan(0.9);
      expect(fwd(c[4])).toBeGreaterThan(0.9);
      expect(fwd(c[5])).toBeLessThan(-0.9);
    }
    // In the hall (facing north, -z) the right hand is east (+x).
    const h = arrivalCandidates(HALL_SPAWN);
    expect(h[1].x).toBeCloseTo(HALL_SPAWN.x + ARRIVAL_SPACING_M, 9);
    expect(h[1].z).toBeCloseTo(HALL_SPAWN.z, 9);
  });

  it("the same pose always gives the same list (deterministic)", () => {
    expect(arrivalCandidates(nominal)).toEqual(cands);
  });
});

describe("findFreeSpot", () => {
  it("uses the nominal spot when it is free: nobody there, or everyone at least one spacing away", () => {
    for (const [area, nominal] of [
      ["hall", HALL_SPAWN],
      ["village", OUT_ARRIVAL],
      ["village", PLAZA],
      ["house:house_2", HALL_SPAWN],
    ] as const) {
      expect(spreadArrival(area, nominal, [])).toEqual({ x: nominal.x, z: nominal.z, yaw: nominal.yaw, free: true });
      const near = [{ x: nominal.x + ARRIVAL_SPACING_M, z: nominal.z }, { x: nominal.x, z: nominal.z - 1.5 }];
      expect(spreadArrival(area, nominal, near)).toEqual({ x: nominal.x, z: nominal.z, yaw: nominal.yaw, free: true });
    }
  });

  it("someone standing on the hall's spawn: the newcomer appears right beside them (east, their right hand), facing the same way", () => {
    const s = spreadArrival("hall", HALL_SPAWN, [{ x: HALL_SPAWN.x, z: HALL_SPAWN.z }]);
    expect(s.free).toBe(true);
    expect(s.x).toBeCloseTo(HALL_SPAWN.x + ARRIVAL_SPACING_M, 9);
    expect(s.z).toBeCloseTo(HALL_SPAWN.z, 9);
    expect(s.yaw).toBe(HALL_SPAWN.yaw);
  });

  it("someone 0.5 m in front of the spawn (walked a step in): the nominal spot is not used, the one chosen keeps the spacing", () => {
    const blocker = { x: HALL_SPAWN.x, z: HALL_SPAWN.z - 0.5 };
    const s = spreadArrival("hall", HALL_SPAWN, [blocker]);
    expect(s.free).toBe(true);
    expect(Math.hypot(s.x - blocker.x, s.z - blocker.z)).toBeGreaterThanOrEqual(ARRIVAL_SPACING_M - SPACING_SLACK_M);
    expectValid([s], arrivalArea("hall"));
  });

  it(`up to 12 (and the room's ${VILLAGE_MAX_CLIENTS}) entering the hall in the same tick get distinct, valid spots at least the spacing apart`, () => {
    const hall = arrivalArea("hall");
    for (const n of [2, 3, 5, 8, 12, VILLAGE_MAX_CLIENTS]) {
      const spots = arriveTogether(n, "hall", HALL_SPAWN);
      expect(spots.every((s) => s.free), `n = ${n}`).toBe(true);
      expect(new Set(spots.map((s) => `${s.x.toFixed(4)},${s.z.toFixed(4)}`)).size).toBe(n);
      expect(minPairGap(spots), `n = ${n}`).toBeGreaterThanOrEqual(ARRIVAL_SPACING_M - SPACING_SLACK_M);
      expectValid(spots, hall);
      for (const s of spots) {
        expect(s.yaw).toBe(HALL_SPAWN.yaw);
        expect(pathClear(HALL_SPAWN, s, hall.obstacles), JSON.stringify(s)).toBe(true); // stepped aside, not behind a sofa
      }
    }
    // The first twelve stay close to the door: within 4 m of the spawn.
    for (const s of arriveTogether(12, "hall", HALL_SPAWN)) expect(Math.hypot(s.x - HALL_SPAWN.x, s.z - HALL_SPAWN.z)).toBeLessThan(4);
  });

  it("the first two into the hall stay by the way out: the first within the button's reach, the second within the server's door reach (one small step brings the button)", () => {
    const [a, b] = arriveTogether(2, "hall", HALL_SPAWN);
    const d = (s: { x: number; z: number }) => Math.hypot(s.x - IN_PAD.centre.x, s.z - IN_PAD.centre.z);
    expect(d(a)).toBeLessThanOrEqual(IN_PAD.radius + 0.7); // villageTargets DOOR_OFFER_REACH_M
    expect(d(b)).toBeLessThanOrEqual(IN_PAD.radius + 0.9); // villageDoor DOOR_REACH_M
  });

  it("12 coming out of the hall together spread in front of the memorial, off its door pad and clear of the building", () => {
    const village = arrivalArea("village");
    const spots = arriveTogether(12, "village", OUT_ARRIVAL);
    expect(spots.every((s) => s.free)).toBe(true);
    expect(minPairGap(spots)).toBeGreaterThanOrEqual(ARRIVAL_SPACING_M - SPACING_SLACK_M);
    expectValid(spots, village);
    const front = L.memorial.exterior.centre.z + L.memorial.exterior.size.z / 2;
    for (const s of spots) expect(s.z, JSON.stringify(s)).toBeGreaterThan(front + PLAYER_RADIUS); // south of the façade
    expect(spots[1].x).toBeCloseTo(OUT_ARRIVAL.x - ARRIVAL_SPACING_M, 9); // facing south, the right hand is west
  });

  it("people already standing in front of the memorial count too: nobody comes out on top of them", () => {
    const loiterers = [OUT_ARRIVAL, { x: OUT_ARRIVAL.x - 1, z: OUT_ARRIVAL.z + 0.3 }, { x: OUT_ARRIVAL.x + 0.9, z: OUT_ARRIVAL.z + 0.4 }];
    const spots = arriveTogether(6, "village", OUT_ARRIVAL, loiterers);
    expect(minPairGap([...loiterers, ...spots])).toBeGreaterThanOrEqual(0.95); // the loiterers themselves are 0.95+ apart
    for (const s of spots) for (const o of loiterers) expect(Math.hypot(s.x - o.x, s.z - o.z)).toBeGreaterThanOrEqual(ARRIVAL_SPACING_M - SPACING_SLACK_M);
  });

  it("a house interior (keypad entry) spreads its arrivals the same way", () => {
    const spots = arriveTogether(12, "house:house_4", HALL_SPAWN);
    expect(spots.every((s) => s.free)).toBe(true);
    expect(minPairGap(spots)).toBeGreaterThanOrEqual(ARRIVAL_SPACING_M - SPACING_SLACK_M);
    expectValid(spots, arrivalArea("house:house_4"));
  });

  it("a full room falls back gracefully: free is false, the spot is still valid (no collider, no pad), the least crowded one, and deterministic", () => {
    const hall = arrivalArea("hall");
    // A crowd every 0.7 m over the whole floor: no spot has 1.4 m of room.
    const crowd: Point2[] = [];
    for (let x = hall.bounds.minX + 0.4; x <= hall.bounds.maxX - 0.4; x += 0.7) for (let z = hall.bounds.minZ + 0.4; z <= hall.bounds.maxZ - 0.4; z += 0.7) crowd.push({ x, z });
    const s = spreadArrival("hall", HALL_SPAWN, crowd);
    expect(s.free).toBe(false);
    expectValid([s], hall);
    expect(s.yaw).toBe(HALL_SPAWN.yaw);
    expect(spreadArrival("hall", HALL_SPAWN, crowd)).toEqual(s);
    // The least crowded: no valid, reachable candidate has a farther nearest neighbour.
    const gap = (p: Point2) => Math.min(...crowd.map((o) => Math.hypot(p.x - o.x, p.z - o.z)));
    for (const c of arrivalCandidates(HALL_SPAWN)) {
      if (!isValidSpot(c, hall) || !pathClear(HALL_SPAWN, c, hall.obstacles)) continue;
      expect(gap(c)).toBeLessThanOrEqual(gap(s) + 1e-9);
    }
  });

  it("the same full room but with the players standing exactly on the lattice: still an answer, never the door pad", () => {
    const hall = arrivalArea("hall");
    const everywhere = arrivalCandidates(HALL_SPAWN).filter((c) => isValidSpot(c, hall));
    const s = spreadArrival("hall", HALL_SPAWN, everywhere);
    expect(s.free).toBe(false);
    expectValid([s], hall);
  });

  it("an area with no valid spot at all returns the nominal pose (free: false) instead of throwing", () => {
    const tiny = makeArrivalArea({ minX: 0, maxX: 0.5, minZ: 0, maxZ: 0.5 }, [], []);
    expect(findFreeSpot({ x: 0.25, z: 0.25, yaw: 1 }, tiny, [])).toEqual({ x: 0.25, z: 0.25, yaw: 1, free: false });
  });

  it("never steps through a wall: around a nominal spot boxed in by a wall, only the spots on its own side are used", () => {
    const wall = { minX: 0.9, maxX: 1.1, minZ: -20, maxZ: 20 };
    const area = makeArrivalArea({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, [wall], []);
    const nominal: ArrivalPose = { x: 0, z: 0, yaw: Math.PI }; // facing north: the right hand is +x, the wall's side
    const spots: ArrivalSpot[] = [];
    for (let i = 0; i < 20; i++) spots.push(findFreeSpot(nominal, area, spots));
    for (const s of spots) expect(s.x, JSON.stringify(s)).toBeLessThan(0.9 - PLAYER_RADIUS + 1e-9);
  });
});

describe("freeSpawnSpot (the plaza's random spawn)", () => {
  const village = arrivalArea("village");

  it("an empty plaza: the first random draw is used as it is (the jitter stays)", () => {
    let calls = 0;
    const s = freeSpawnSpot(() => (calls++, { x: 1.2, z: 15.1 }), PLAZA, village, []);
    expect(s).toEqual({ x: 1.2, z: 15.1, yaw: PLAZA.yaw, free: true });
    expect(calls).toBe(1);
  });

  it("a draw that lands on someone is rejected and the next draw is tried", () => {
    const draws = [{ x: 0.5, z: 14 }, { x: 0.9, z: 14.2 }, { x: -2, z: 15 }];
    let i = 0;
    const s = freeSpawnSpot(() => draws[i++], PLAZA, village, [{ x: 0.5, z: 14.3 }]);
    expect(s).toEqual({ x: -2, z: 15, yaw: PLAZA.yaw, free: true });
    expect(i).toBe(3);
  });

  it(`after ${SPAWN_TRIES} occupied draws the lattice round the spawn point decides`, () => {
    let i = 0;
    const s = freeSpawnSpot(() => (i++, { x: PLAZA.x, z: PLAZA.z }), PLAZA, village, [{ x: PLAZA.x, z: PLAZA.z }]);
    expect(i).toBe(SPAWN_TRIES);
    expect(s.free).toBe(true);
    expect(Math.hypot(s.x - PLAZA.x, s.z - PLAZA.z)).toBeCloseTo(ARRIVAL_SPACING_M, 9);
  });

  it(`${VILLAGE_MAX_CLIENTS} joining at once with an unlucky random source (always the centre) still all get their own spot`, () => {
    const spots: ArrivalSpot[] = [];
    for (let k = 0; k < VILLAGE_MAX_CLIENTS; k++) spots.push(freeSpawnSpot(() => ({ x: PLAZA.x, z: PLAZA.z }), PLAZA, village, spots));
    expect(spots.every((s) => s.free)).toBe(true);
    expect(minPairGap(spots)).toBeGreaterThanOrEqual(ARRIVAL_SPACING_M - SPACING_SLACK_M);
    expectValid(spots, village);
  });

  it(`${VILLAGE_MAX_CLIENTS} joining with real random draws in the 3 m disk: all apart, all valid`, () => {
    // A seeded generator (mulberry32) for a repeatable run; the room uses Math.random.
    let seed = 12345;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const draw = () => {
      const r = L.spawn.jitter * Math.sqrt(rnd());
      const a = rnd() * Math.PI * 2;
      return { x: L.spawn.x + r * Math.cos(a), z: L.spawn.z + r * Math.sin(a) };
    };
    const spots: ArrivalSpot[] = [];
    for (let k = 0; k < VILLAGE_MAX_CLIENTS; k++) spots.push(freeSpawnSpot(draw, PLAZA, village, spots));
    expect(minPairGap(spots)).toBeGreaterThanOrEqual(ARRIVAL_SPACING_M - SPACING_SLACK_M);
    expectValid(spots, village);
  });
});
