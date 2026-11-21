/**
 * Click-to-walk in 케이슨랜드 once its street furniture is solid (owner 2026-11-21: lamp posts, benches, planted islands, the fountain's
 * round basin, the booths' counters, the south hedge): the same sweeps clickPlanSweep.test.ts runs over the village.
 *
 *  - a click on open ground anywhere on the promenade, the plaza, the avenue and the lawns beside them is never refused, and the
 *    walk the plan gives (straight, or round what stands in the way) is walked to its end;
 *  - a click ON a prop (a lamp's base, a bench, the middle of a planted island, a trough, a bin, the fountain) is a walk to the
 *    nearest spot a body stands on, or toward it up to its face: the body never ends inside it;
 *  - the real walk (stepClickMove + resolveCollision, LocalPlayer's loop) agrees with the plan's simulation.
 */
import { describe, expect, it } from "vitest";
import { MOVE_SPEED } from "@caysonverse/shared/constants";
import { isBlocked, resolveCollision } from "@caysonverse/shared/collision";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { PARK_ARRIVAL, PARK_BINS, PARK_BOUNDS, PARK_LAMPS, PARK_PLANTERS, PARK_PLAZA, PARK_TROUGHS, parkGeometry, parkStreetSolids } from "@caysonverse/shared/village/parkArea";
import { PARK_BENCHES } from "@caysonverse/shared/village/parkBenches";
import { PARK_ISLANDS } from "@caysonverse/shared/village/parkIslands";
import { planClickMove, simulateWalk } from "./clickPlan";

const R = PLAYER_RADIUS;
const obstacles = parkGeometry.obstacles;
const bounds = PARK_BOUNDS;
const ground = (x: number, z: number) => ({ x, y: 0.01, z, ny: 1 });
const free = (x: number, z: number) => x > bounds.minX + R && x < bounds.maxX - R && z > bounds.minZ + R && z < bounds.maxZ - R && !isBlocked(x, z, R, obstacles, 0);
/** Under no collider (a click there is a click on the ground, not on a prop). */
const open = (x: number, z: number) => !obstacles.some((o) => x > o.minX - R && x < o.maxX + R && z > o.minZ - R && z < o.maxZ + R);

function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** The places visitors walk: [x0, x1, z0, z1]. */
const ZONES: ReadonlyArray<readonly [number, number, number, number]> = [
  [26, 54, -180, -136], // the promenade and the lawn strips where the hedges stood
  [14, 66, -138, -86], // the star plaza
  [60, 200, -120, -98], // the avenue, its benches and the islands along it
  [-12, 16, -104, -8], // the station approach and its islands
];

describe("케이슨랜드 click-to-walk with solid street furniture", () => {
  it("a click on open ground is never refused and its walk arrives (600 clicks across the promenade, plaza, avenue and approach)", () => {
    const rnd = seeded(20261121);
    const bad: string[] = [];
    let walked = 0;
    let round = 0;
    for (let n = 0; n < 600; n++) {
      const za = ZONES[Math.floor(rnd() * ZONES.length)]!;
      // most walks stay in or next to their zone (a click is rarely farther than the screen shows)
      const zb = rnd() < 0.75 ? za : ZONES[Math.floor(rnd() * ZONES.length)]!;
      const from = { x: za[0] + rnd() * (za[1] - za[0]), z: za[2] + rnd() * (za[3] - za[2]) };
      const to = { x: zb[0] + rnd() * (zb[1] - zb[0]), z: zb[2] + rnd() * (zb[3] - zb[2]) };
      if (!free(from.x, from.z) || !open(to.x, to.z) || !free(to.x, to.z) || Math.hypot(to.x - from.x, to.z - from.z) < 1 || Math.hypot(to.x - from.x, to.z - from.z) > 70) continue;
      walked++;
      const plan = planClickMove(from.x, from.z, ground(to.x, to.z), obstacles, bounds);
      if (!plan.ok) {
        bad.push(`(${from.x.toFixed(1)}, ${from.z.toFixed(1)}) -> (${to.x.toFixed(1)}, ${to.z.toFixed(1)}): ${plan.reason}`);
        continue;
      }
      if (plan.via?.length) round++;
      const walk = simulateWalk(from.x, from.z, plan.x, plan.z, obstacles, bounds, R, plan.via);
      if (!walk.arrived) bad.push(`(${from.x.toFixed(1)}, ${from.z.toFixed(1)}) -> (${to.x.toFixed(1)}, ${to.z.toFixed(1)}): stuck at (${walk.x.toFixed(2)}, ${walk.z.toFixed(2)})`);
      else if (Math.hypot(plan.x - to.x, plan.z - to.z) > 0.05) bad.push(`(${to.x.toFixed(1)}, ${to.z.toFixed(1)}): open ground, yet the ring went ${Math.hypot(plan.x - to.x, plan.z - to.z).toFixed(2)} m off`);
    }
    expect(walked).toBeGreaterThan(300);
    expect(round).toBeGreaterThan(20); // (the furniture is in the way often enough: the ways round are exercised)
    expect(bad).toEqual([]);
  }, 180000);

  it("a click ON a prop walks beside it or up to its face: never refused for want of a spot, never ending inside", () => {
    const props: Array<{ name: string; x: number; z: number }> = [
      ...PARK_LAMPS.map((l) => ({ name: "lamp", x: l.x, z: l.z })),
      ...PARK_BENCHES.map(([x, z]) => ({ name: "bench", x, z })),
      ...PARK_BINS.map((b) => ({ name: "bin", x: b.x, z: b.z })),
      ...PARK_PLANTERS.map((p) => ({ name: "planter", x: p.x, z: p.z })),
      ...PARK_TROUGHS.map((t) => ({ name: "trough", x: (t.x0 + t.x1) / 2, z: (t.z0 + t.z1) / 2 })),
      ...PARK_ISLANDS.map((i) => ({ name: "island", x: i[0], z: i[1] })),
      { name: "fountain", x: PARK_PLAZA.x, z: PARK_PLAZA.z },
    ];
    const bad: string[] = [];
    const counts: Record<string, number> = {};
    for (const p of props) {
      // from four sides, 4 m off (the nearest free spot there)
      for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]] as const) {
        let from: { x: number; z: number } | null = null;
        for (const k of [1, 1.25, 1.5, 0.75]) if (free(p.x + dx * k, p.z + dz * k)) { from = { x: p.x + dx * k, z: p.z + dz * k }; break; }
        if (!from) continue;
        counts[p.name] = (counts[p.name] ?? 0) + 1;
        const plan = planClickMove(from.x, from.z, ground(p.x, p.z), obstacles, bounds);
        if (!plan.ok) {
          // the only honest refusals: the walk toward it does not get going (the body already stands at its face)
          if (plan.reason !== "here" && plan.reason !== "unreachable") bad.push(`${p.name} (${p.x}, ${p.z}) from ${dx},${dz}: ${plan.reason}`);
          continue;
        }
        const walk = simulateWalk(from.x, from.z, plan.x, plan.z, obstacles, bounds, R, plan.via);
        if (isBlocked(walk.x, walk.z, R, obstacles)) bad.push(`${p.name} (${p.x}, ${p.z}) from ${dx},${dz}: ended inside at (${walk.x.toFixed(2)}, ${walk.z.toFixed(2)})`);
        if (!walk.arrived) bad.push(`${p.name} (${p.x}, ${p.z}) from ${dx},${dz}: planned to (${plan.x.toFixed(2)}, ${plan.z.toFixed(2)}) but stuck at (${walk.x.toFixed(2)}, ${walk.z.toFixed(2)})`);
      }
    }
    expect(counts.lamp).toBeGreaterThan(150);
    expect(counts.bench).toBeGreaterThan(50);
    expect(counts.island).toBeGreaterThan(30);
    expect(bad).toEqual([]);
  }, 180000);

  it("walking straight into any street solid from four sides slides to rest outside it (the game's own step: resolveCollision at 60 Hz)", () => {
    const bad: string[] = [];
    let tried = 0;
    for (const b of parkStreetSolids()) {
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        let x = cx + dx * ((b.maxX - b.minX) / 2 + 1.6);
        let z = cz + dz * ((b.maxZ - b.minZ) / 2 + 1.6);
        // (a start in the open: outside every box grown SQUARE by the body, as the walk's own slide leaves it. A spot inside a grown
        // box's rounded corner is free by the circle test, but the slide does not stop a body that is already past the face.)
        if (!free(x, z) || !open(x, z)) continue;
        tried++;
        for (let i = 0; i < 240; i++) {
          const n = Math.hypot(cx - x, cz - z);
          if (n < 0.02) break;
          const step = Math.min(n, MOVE_SPEED / 60);
          const p = resolveCollision(x, z, ((cx - x) / n) * step, ((cz - z) / n) * step, R, obstacles);
          x = p.x;
          z = p.z;
        }
        if (isBlocked(x, z, R, obstacles)) bad.push(`${JSON.stringify(b)} from ${dx},${dz}: inside at (${x.toFixed(2)}, ${z.toFixed(2)})`);
      }
    }
    expect(tried).toBeGreaterThan(400);
    expect(bad).toEqual([]);
  });

  it("the arrival spot's first steps are open: from the gate arch down the promenade", () => {
    const plan = planClickMove(PARK_ARRIVAL.x, PARK_ARRIVAL.z, ground(40, -140), obstacles, bounds);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.via ?? []).toEqual([]); // a straight walk: nothing stands in the promenade's middle
  });
});
