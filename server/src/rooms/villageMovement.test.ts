import { describe, it, expect } from "vitest";
import { MOVE_ELAPSED_CEIL_MS, PLAYER_RADIUS } from "@caysonverse/shared/constants";
import { isBlocked } from "@caysonverse/shared/collision";
import { DEFAULT_WALL_THICKNESS, makeGeometry } from "@caysonverse/shared/school/geometry";
import {
  VILLAGE_LAYOUT,
  areaGapBlockers,
  greyboxColliders,
  hallWalls,
  segmentBand,
  segmentBank,
  villageBounds,
  villageGeometry,
} from "@caysonverse/shared/village/villageLayout";
import { validateMove } from "./movement";

/**
 * Village movement through the REAL `validateMove`. The server judges only where a Move LANDS (it does not sweep the
 * path), and one Move can be up to RUN_SPEED x 0.5 s x 1.5 = 4.8 m, so a thin wall is no seal by itself: these tests
 * throw legal-speed steps at the hall's walls and at the creek and expect every one that lands beyond to be dropped.
 */

const L = VILLAGE_LAYOUT;
const HALL = L.areas.hall;
const STREAM = L.stream;
const GAP = STREAM.bridgeGap;
/** The largest budget of one Move: the elapsed ceiling the room applies, and so the longest legal step. */
const ELAPSED = MOVE_ELAPSED_CEIL_MS;
const WALL = DEFAULT_WALL_THICKNESS;

const inRoom = (p: { x: number; z: number }) => p.x >= HALL.minX && p.x <= HALL.maxX && p.z >= HALL.minZ && p.z <= HALL.maxZ;
const move = (from: { x: number; z: number }, to: { x: number; z: number }, geo = villageGeometry) =>
  validateMove(from, { x: to.x, z: to.z, yaw: 0 }, ELAPSED, geo);

/** The village geometry with the hall's solid ground removed: only its 0.5 m walls remain around the room. */
const wallsOnly = makeGeometry(
  "village",
  villageBounds(L),
  hallWalls(L),
  [...areaGapBlockers(L), ...greyboxColliders(L).map((c) => c.box)],
);

describe("a legal step through the hall's walls is dropped", () => {
  // One start 0.45 m inside each wall, and a 3 m step straight through it.
  const cases: Array<[string, { x: number; z: number }, { x: number; z: number }]> = [
    ["north", { x: 300, z: HALL.minZ + 0.45 }, { x: 300, z: HALL.minZ + 0.45 - 3 }],
    ["south", { x: 300, z: HALL.maxZ - 0.45 }, { x: 300, z: HALL.maxZ - 0.45 + 3 }],
    ["west", { x: HALL.minX + 0.45, z: 0 }, { x: HALL.minX + 0.45 - 3, z: 0 }],
    ["east", { x: HALL.maxX - 0.45, z: 0 }, { x: HALL.maxX - 0.45 + 3, z: 0 }],
  ];

  it.each(cases)("a 3 m Move through the %s wall is dropped (and the same step inside the room is accepted)", (_side, from, to) => {
    expect(isBlocked(from.x, from.z, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(false); // a legal place to stand
    expect(move(from, to)).toBeNull();
    // A step of the same length along the wall, inside the room, is fine.
    const along = Math.abs(to.x - from.x) > 0 ? { x: from.x, z: from.z + 3 } : { x: from.x + 3, z: from.z };
    expect(move(from, along)).not.toBeNull();
  });

  it("the reviewer's case: a 3 m Move from (300, -5.65) is dropped", () => {
    expect(move({ x: 300, z: -5.65 }, { x: 300, z: -8.65 })).toBeNull();
  });

  it("every Move of up to 4.8 m that lands outside the room is dropped, from every spot in the room, in every direction", () => {
    let outside = 0;
    for (let x = HALL.minX + 0.5; x <= HALL.maxX - 0.5; x += 0.5) {
      for (let z = HALL.minZ + 0.5; z <= HALL.maxZ - 0.5; z += 0.5) {
        for (let deg = 0; deg < 360; deg += 10) {
          for (let d = 0.5; d <= 4.8; d += 0.5) {
            const to = { x: x + d * Math.cos((deg * Math.PI) / 180), z: z + d * Math.sin((deg * Math.PI) / 180) };
            if (inRoom(to)) continue;
            outside++;
            if (move({ x, z }, to) !== null) throw new Error(`(${x}, ${z}) -> (${to.x.toFixed(2)}, ${to.z.toFixed(2)}) landed outside the room`);
          }
        }
      }
    }
    expect(outside).toBeGreaterThan(10000);
  });

  it("the test is not vacuous: with only the 0.5 m walls (no solid ground around them) the north, south and east steps get through", () => {
    for (const [side, from, to] of cases) {
      if (side === "west") continue; // the gap blocker is adjacent to the west wall
      expect(move(from, to, wallsOnly), side).not.toBeNull();
    }
  });
});

describe("a legal step cannot hop the creek", () => {
  const bankAt = (x: number) => {
    const here = STREAM.segments.filter((s) => x >= s.minX && x <= s.maxX).map((s) => segmentBank(STREAM, s));
    return { minZ: Math.min(...here.map((b) => b.minZ)), maxZ: Math.max(...here.map((b) => b.maxZ)) };
  };
  const bandAt = (x: number) => {
    const here = STREAM.segments.filter((s) => x >= s.minX && x <= s.maxX).map((s) => segmentBand(STREAM, s));
    return { minZ: Math.min(...here.map((b) => b.minZ)), maxZ: Math.max(...here.map((b) => b.maxZ)) };
  };

  it("from the north bank, no Move of up to 4.8 m lands in the water or beyond it (except onto the bridge)", () => {
    let tried = 0;
    let accepted = 0;
    for (let x = L.walkBounds.minX + 1; x <= L.walkBounds.maxX - 1; x += 0.5) {
      if (x > GAP.minX - 5 && x < GAP.maxX + 5) continue; // beside the bridge a step onto it is legal
      const from = { x, z: bankAt(x).minZ - 0.45 };
      if (isBlocked(from.x, from.z, PLAYER_RADIUS, villageGeometry.obstacles)) continue;
      for (let deg = 0; deg < 360; deg += 10) {
        for (let d = 0.5; d <= 4.8; d += 0.5) {
          const to = { x: x + d * Math.cos((deg * Math.PI) / 180), z: from.z + d * Math.sin((deg * Math.PI) / 180) };
          tried++;
          const ok = move(from, to);
          if (ok === null) continue;
          accepted++;
          // Accepted moves stay on the north bank: short of the water's north edge at the landing x.
          expect(ok.z, `(${x}, ${from.z}) -> (${to.x.toFixed(2)}, ${to.z.toFixed(2)})`).toBeLessThan(bandAt(ok.x).minZ);
        }
      }
    }
    expect(tried).toBeGreaterThan(10000);
    expect(accepted).toBeGreaterThan(1000); // ordinary steps along the bank are fine
  });

  it("the test is not vacuous: with only the water band solid (no banks) a step hops across where two segments meet", () => {
    const thinLayout = { ...L, stream: { ...STREAM, bankWidth: 0 } };
    const thin = makeGeometry(
      "village",
      villageBounds(thinLayout),
      hallWalls(thinLayout),
      [...areaGapBlockers(thinLayout), ...greyboxColliders(thinLayout).map((c) => c.box)],
    );
    let hops = 0;
    for (const join of STREAM.segments.slice(1).map((s) => s.minX)) {
      for (let x = join - 1.5; x <= join + 1.5; x += 0.25) {
        const from = { x, z: bandAt(x).minZ - 0.45 };
        if (isBlocked(from.x, from.z, PLAYER_RADIUS, thin.obstacles)) continue;
        for (let deg = 0; deg < 360; deg += 5) {
          for (let d = 0.25; d <= 4.8; d += 0.25) {
            const to = { x: x + d * Math.cos((deg * Math.PI) / 180), z: from.z + d * Math.sin((deg * Math.PI) / 180) };
            const ok = validateMove(from, { x: to.x, z: to.z, yaw: 0 }, ELAPSED, thin);
            if (ok !== null && ok.z > bandAt(ok.x).maxZ) hops++; // landed south of the water
          }
        }
      }
    }
    expect(hops).toBeGreaterThan(0);
  });
});

describe("ordinary walking on the village map", () => {
  it("a 1 m step on the plaza and a 0.5 m step in the hall are accepted", () => {
    expect(move({ x: L.spawn.x, z: L.spawn.z }, { x: L.spawn.x, z: L.spawn.z - 1 })).not.toBeNull();
    const s = L.memorial.interior.spawn;
    expect(move({ x: s.x, z: s.z }, { x: s.x, z: s.z - 0.5 })).not.toBeNull();
  });
});
