import { describe, expect, it } from "vitest";
import { PLAYER_RADIUS } from "../constants";
import { isBlocked, resolveCollision, type AABB } from "../collision";
import { CAROUSEL_PAD, COASTER_PAD, DROP_PAD, DROP_SITE_AT, MOON_BOAT_PAD, MOON_BOAT_SITE_AT, PARK_PLATFORM, PARK_SOLIDS, WHEEL_PAD } from "./parkArea";
import { CAROUSEL_CENTER } from "../land/carousel";
import { WHEEL_SITE } from "../land/wheel";
import { MOON_BOAT_SITE } from "../land/moonBoat";
import { MOON_DECK, MOON_PAD_DX, MOON_STEPS } from "../land/moonBoatGeometry";
import { DROP_PLATFORM_R, DROP_SITE } from "../land/dropTower";
import { CAROUSEL_FENCE_R, DROP_QUEUE, DROP_SIGN, DROP_STEPS, MOON_QUEUE, MOON_SIGN, RIDE_FENCE_HALF, WHEEL_SIGN, WHEEL_STEPS, discSolids, parkRideSolids } from "./parkRideSolids";

const R = PLAYER_RADIUS;
const M = MOON_BOAT_SITE;
const D = DROP_SITE;
const C = CAROUSEL_CENTER;
const W = WHEEL_SITE;

/** Walk straight from a toward b in 5 cm steps with the game's own slide rule; the path walked. */
function walk(ax: number, az: number, bx: number, bz: number, solids: readonly AABB[] = PARK_SOLIDS): { x: number; z: number }[] {
  const path = [{ x: ax, z: az }];
  let x = ax;
  let z = az;
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.ceil(len / 0.05);
  for (let i = 0; i < n; i++) {
    const p = resolveCollision(x, z, (bx - ax) / n, (bz - az) / n, R, solids);
    x = p.x;
    z = p.z;
    path.push(p);
  }
  return path;
}

/** A barrier: a line a walker must never get across (side(x, z) keeps its sign), approached from `from` toward `to` on the far side. */
interface Barrier {
  name: string;
  from: [number, number];
  to: [number, number];
  /** > 0 on the walker's own side of the barrier */
  side: (x: number, z: number) => number;
}

const barriers: Barrier[] = [];
const add = (name: string, from: [number, number], to: [number, number], side: (x: number, z: number) => number): void => {
  barriers.push({ name, from, to, side });
  // and the other way: from the far side back
  barriers.push({ name: `${name} (from the other side)`, from: to, to: from, side: (x, z) => -side(x, z) });
};

// the 달배: the queue fences along the steps and the path (every 1.5 m of their length), the name board
for (const sz of [-1, 1]) {
  for (const dx of [MOON_STEPS.x1 + 0.6, MOON_STEPS.x1 + 2.2, MOON_STEPS.x1 + 3.7]) add(`moon queue fence z${sz} at x+${dx.toFixed(1)}`, [M.x + dx, M.z + sz * 4.2], [M.x + dx, M.z + sz * 0.9], (_x, z) => (z - M.z) * sz - MOON_QUEUE.z);
}
add("moon name board", [M.x + MOON_SIGN.x + 1.5, M.z - 4.6], [M.x + MOON_SIGN.x - 1.5, M.z - 4.6], (x) => x - (M.x + MOON_SIGN.x));
// the 구름 낙하탑: the queue fences and the name board
for (const sz of [-1, 1]) {
  for (const dx of [DROP_STEPS.x1 + 0.5, DROP_STEPS.x1 + 2.2, DROP_STEPS.x1 + 3.4, DROP_STEPS.x1 + 4.3]) add(`drop queue fence z${sz} at x+${dx.toFixed(1)}`, [D.x + dx, D.z + sz * 3.6], [D.x + dx, D.z + sz * 0.7], (_x, z) => (z - D.z) * sz - DROP_QUEUE.z);
}
add("drop name board", [D.x + DROP_SIGN.x + 1.5, D.z - 4.2], [D.x + DROP_SIGN.x - 1.5, D.z - 4.2], (x) => x - (D.x + DROP_SIGN.x));
// the wheel's name board
add("wheel name board", [W.x + 7.5, W.z + WHEEL_SIGN.z + 1.5], [W.x + 7.5, W.z + WHEEL_SIGN.z - 1.5], (_x, z) => z - (W.z + WHEEL_SIGN.z));

/** One-way barriers: the far side is inside a solid block (a deck, a flight of steps, the hull's lane), so there is no "other side" to come from. */
const blocks: Barrier[] = [
  { name: "moon steps from the pad", from: [M.x + MOON_PAD_DX, M.z], to: [M.x + MOON_DECK.x0 + 1, M.z], side: (x) => x - (M.x + MOON_STEPS.x1) },
  { name: "moon deck rail from the north", from: [M.x + 5.4, M.z - 8], to: [M.x + 5.4, M.z], side: (_x, z) => M.z + MOON_DECK.z0 - z },
  { name: "moon deck rail from the south", from: [M.x + 5.4, M.z + 8], to: [M.x + 5.4, M.z], side: (_x, z) => z - (M.z + MOON_DECK.z1) },
  { name: "moon lane from the west", from: [M.x - 8, M.z + 6], to: [M.x, M.z + 6], side: (x) => M.x - 2.9 - x },
  { name: "drop steps from the pad", from: [DROP_PAD.x, DROP_PAD.z], to: [D.x + 5, D.z], side: (x) => x - (D.x + DROP_STEPS.x1) },
  { name: "drop platform rail from the north", from: [D.x + 3, D.z - 12], to: [D.x + 3, D.z], side: (_x, z) => D.z - DROP_PLATFORM_R - z },
  { name: "drop platform rail from the south", from: [D.x - 3, D.z + 12], to: [D.x - 3, D.z], side: (_x, z) => z - (D.z + DROP_PLATFORM_R) },
  { name: "drop platform rail from the west", from: [D.x - 12, D.z + 2], to: [D.x, D.z + 2], side: (x) => D.x - DROP_PLATFORM_R - x },
  { name: "drop platform rail from the east, north of the gate", from: [D.x + 12, D.z - 4.5], to: [D.x, D.z - 4.5], side: (x) => x - (D.x + DROP_PLATFORM_R) },
  { name: "wheel steps from the pad", from: [WHEEL_PAD.x, WHEEL_PAD.z], to: [W.x, W.z + 6], side: (_x, z) => z - (W.z + WHEEL_STEPS.z1) },
  { name: "wheel deck rail from the east", from: [W.x + 8, W.z + 6.5], to: [W.x, W.z + 6.5], side: (x) => x - (W.x + 3.4) },
  { name: "wheel deck rail from the west", from: [W.x - 8, W.z + 6.5], to: [W.x, W.z + 6.5], side: (x) => W.x - 3.4 - x },
  { name: "coaster steps from the pad", from: [COASTER_PAD.x, COASTER_PAD.z], to: [COASTER_PAD.x, PARK_PLATFORM.minZ + 1], side: (_x, z) => PARK_PLATFORM.minZ - 4.3 - z },
];

describe("the rides' railings, fences, steps and signs are solid (owner 2026-11-21)", () => {
  for (const b of [...barriers, ...blocks]) {
    it(b.name, () => {
      // the start stands in the open, on its own side
      expect(isBlocked(b.from[0], b.from[1], R, PARK_SOLIDS)).toBe(false);
      expect(b.side(b.from[0], b.from[1])).toBeGreaterThan(0);
      const path = walk(b.from[0], b.from[1], b.to[0], b.to[1]);
      for (const p of path) {
        // never across, and the body (a circle of PLAYER_RADIUS) never over the barrier's own line
        expect(b.side(p.x, p.z)).toBeGreaterThan(R - 0.011);
        expect(isBlocked(p.x, p.z, R, PARK_SOLIDS)).toBe(false);
      }
      const end = path[path.length - 1]!;
      expect(Math.hypot(end.x - b.to[0], end.z - b.to[1])).toBeGreaterThan(0.4);
    });
  }

  it("the carousel's round fence stops a walker from every direction, at the fence and never far outside it", () => {
    for (let k = 0; k < 360; k += 3) {
      const a = (k * Math.PI) / 180;
      const from: [number, number] = [C.x + Math.sin(a) * 26, C.z - Math.cos(a) * 26];
      if (isBlocked(from[0], from[1], R, PARK_SOLIDS)) continue; // a tree or a lamp stands there
      const path = walk(from[0], from[1], C.x, C.z);
      let nearest = Infinity;
      for (const p of path) nearest = Math.min(nearest, Math.hypot(p.x - C.x, p.z - C.z));
      // never inside the fence line (the body's edge at most touches it) ...
      expect(nearest).toBeGreaterThan(CAROUSEL_FENCE_R + R - 0.011);
      // ... and stopped by the fence, not by an invisible wall metres outside it (a straight push slides along a box's flat face first)
      expect(nearest).toBeLessThan(CAROUSEL_FENCE_R + R + 1.9);
    }
  });

  it("a disc's boxes cover it and reach no more than a sixth of its radius past it", () => {
    const boxes = discSolids(0, 0, 10);
    for (let k = 0; k < 720; k++) {
      const a = (k / 720) * Math.PI * 2;
      const inside = (r: number): boolean => boxes.some((b) => Math.cos(a) * r > b.minX - 1e-9 && Math.cos(a) * r < b.maxX + 1e-9 && Math.sin(a) * r > b.minZ - 1e-9 && Math.sin(a) * r < b.maxZ + 1e-9);
      expect(inside(9.999)).toBe(true);
      expect(inside(10 * (1 + 1 / 6))).toBe(false);
    }
  });

  it("every ride's solids are in the park's collision list", () => {
    for (const b of parkRideSolids()) expect(PARK_SOLIDS.some((s) => s.minX === b.minX && s.maxX === b.maxX && s.minZ === b.minZ && s.maxZ === b.maxZ)).toBe(true);
  });
});

describe("no collider blocks a real way in", () => {
  /** Whether `to` can be walked to from `from` (a flood over a 0.15 m grid of free body positions inside the window round both). */
  function reachable(from: [number, number], to: [number, number], margin = 14): boolean {
    const cell = 0.15;
    const x0 = Math.min(from[0], to[0]) - margin;
    const z0 = Math.min(from[1], to[1]) - margin;
    const nx = Math.ceil((Math.max(from[0], to[0]) + margin - x0) / cell);
    const nz = Math.ceil((Math.max(from[1], to[1]) + margin - z0) / cell);
    const near = PARK_SOLIDS.filter((b) => b.maxX > x0 - 1 && b.minX < x0 + nx * cell + 1 && b.maxZ > z0 - 1 && b.minZ < z0 + nz * cell + 1);
    const seen = new Uint8Array(nx * nz);
    const ix = (x: number): number => Math.round((x - x0) / cell);
    const iz = (z: number): number => Math.round((z - z0) / cell);
    const goal = iz(to[1]) * nx + ix(to[0]);
    const stack = [iz(from[1]) * nx + ix(from[0])];
    seen[stack[0]!] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      if (k === goal) return true;
      const cx = k % nx;
      const cz = (k - cx) / nx;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ax = cx + dx;
        const az = cz + dz;
        if (ax < 0 || az < 0 || ax >= nx || az >= nz) continue;
        const j = az * nx + ax;
        if (seen[j]) continue;
        seen[j] = 1;
        if (!isBlocked(x0 + ax * cell, z0 + az * cell, R, near)) stack.push(j);
      }
    }
    return false;
  }

  const pads: [string, { x: number; z: number; radius: number }, [number, number]][] = [
    ["달배", MOON_BOAT_PAD, [MOON_BOAT_PAD.x + 14, MOON_BOAT_PAD.z + 9]],
    ["구름 낙하탑", DROP_PAD, [DROP_PAD.x + 14, DROP_PAD.z - 9]],
    ["하늘 등불 바퀴", WHEEL_PAD, [WHEEL_PAD.x - 12, WHEEL_PAD.z + 12]],
    ["달빛 회전목마", CAROUSEL_PAD, [CAROUSEL_PAD.x + 10, CAROUSEL_PAD.z + 8]],
    ["별똥별 급행", COASTER_PAD, [COASTER_PAD.x + 12, COASTER_PAD.z - 12]],
  ];
  for (const [name, pad, from] of pads) {
    it(`${name}: the boarding pad's centre is open ground and can be walked to from the lawn`, () => {
      expect(isBlocked(pad.x, pad.z, R, PARK_SOLIDS)).toBe(false);
      expect(isBlocked(from[0], from[1], R, PARK_SOLIDS)).toBe(false);
      expect(reachable(from, [pad.x, pad.z])).toBe(true);
    });
  }

  it("the pads of the 달배 and the 구름 낙하탑 lie in the lane between their queue fences, at the foot of the steps", () => {
    expect(MOON_BOAT_PAD.x - MOON_BOAT_SITE_AT.x).toBeCloseTo(MOON_PAD_DX, 6);
    expect(MOON_BOAT_PAD.x - M.x).toBeGreaterThan(MOON_STEPS.x1 + R);
    expect(MOON_BOAT_PAD.x - M.x).toBeLessThan(MOON_QUEUE.x1);
    expect(DROP_PAD.x - DROP_SITE_AT.x).toBeGreaterThan(DROP_STEPS.x1 + R);
    expect(DROP_PAD.x - D.x).toBeLessThan(DROP_QUEUE.x1 + 0.5);
    // the lanes are wide enough for two bodies side by side
    expect(2 * (MOON_QUEUE.z - RIDE_FENCE_HALF)).toBeGreaterThan(4 * R + 1);
    expect(2 * (DROP_QUEUE.z - RIDE_FENCE_HALF)).toBeGreaterThan(4 * R + 1);
  });

  it("a walker pushed into a fence slides along it to its open end (never stuck in the lane)", () => {
    // from inside the 달배's lane, pushing diagonally out and east: slides along the fence and comes out past its end
    const path = walk(M.x + MOON_STEPS.x1 + 0.6, M.z + 1.2, M.x + MOON_QUEUE.x1 + 6, M.z + 7);
    const end = path[path.length - 1]!;
    expect(end.x).toBeGreaterThan(M.x + MOON_QUEUE.x1);
    expect(end.z).toBeGreaterThan(M.z + MOON_QUEUE.z);
  });
});
