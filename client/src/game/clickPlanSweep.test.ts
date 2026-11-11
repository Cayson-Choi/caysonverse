/**
 * The round 5 review's sweeps over 케이슨 마을's real colliders, kept as tests (clickPlan.ts rules 2-3):
 *
 *  - every seat: the open ground 3 m round it (on a 0.25 m grid: not under the bench's real turned footprint or any
 *    other collider), tapped from the seat — each one gets the avatar up and walks it to its ring (the review: 85 such
 *    taps did nothing, behind a slanted bench's backrest, beside its end);
 *  - Monte Carlo of clicks whose straight walk is blocked, in the plaza, round the houses and across the creek: a way
 *    round the planner finds is always walked to its end (the review: 2 of 160 in the plaza and 9 of 257 at the creek
 *    stuck on a corner the way hugged), and no click on a free spot is refused;
 *  - the real walk (stepClickMove + resolveCollision + the bounds clamp, LocalPlayer's loop) at other frame rates and
 *    at a run follows those ways to the end too: the simulation and the game agree.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MOVE_SPEED, RUN_SPEED } from "@caysonverse/shared/constants";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { resolveCollision } from "@caysonverse/shared/collision";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_BENCHES, VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { findDetour, isFreeSpot, planClickMove, simulateWalk, type ClickPlan } from "./clickPlan";
import { ARRIVE_DIST, clearClickTarget, getClickTarget, setClickTarget, stepClickMove } from "./clickMove";
import { LEGACY_ACTIVE_MAP, VILLAGE_ACTIVE_MAP, VILLAGE_FURNITURE, setActiveMap } from "./activeMap";

const R = PLAYER_RADIUS;
const obstacles = villageGeometry.obstacles;
const village = VILLAGE_LAYOUT.areas.village;
const ground = (x: number, z: number) => ({ x, y: 0.01, z, ny: 1 });
const options = { furniture: VILLAGE_FURNITURE };

/** The plaza benches' footprint (parts_props.py `bench`: 1.9 x 0.66 m, turned to face the fountain); the others are their boxes. */
const footprints = VILLAGE_BENCHES.map((b) => {
  const plaza = b.id.startsWith("plaza_");
  return { b, halfAlong: plaza ? 0.95 : b.length / 2, halfAhead: plaza ? 0.33 : b.frontEdge };
});
const isBenchBox = (o: { minX: number; maxX: number; minZ: number; maxZ: number }) => VILLAGE_FURNITURE.includes(o);
const underABench = (x: number, z: number) =>
  footprints.some(({ b, halfAlong, halfAhead }) => {
    const dx = x - b.centre.x;
    const dz = z - b.centre.z;
    const c = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    return Math.abs(dx * c - dz * s) <= halfAlong && Math.abs(dx * s + dz * c) <= halfAhead;
  });
/** Ground in the open: under no collider — and of a bench's box, only its real footprint covers the ground. */
const openGround = (x: number, z: number) =>
  !obstacles.some((o) => x > o.minX && x < o.maxX && z > o.minZ && z < o.maxZ && (!isBenchBox(o) || underABench(x, z)));

/** A seeded generator (Park-Miller), so the sweep is the same every run. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

describe("clickPlan sweep — seated, every tap on the open ground round a seat gets up and walks (round 5 review)", () => {
  it("all 20 seats, 3 m round each on a 0.25 m grid: no open-ground tap refused, every walk reaches its ring", () => {
    let points = 0;
    const refused: string[] = [];
    let pushedFar = 0;
    VILLAGE_SEATS.forEach((s, i) => {
      const bounds = VILLAGE_LAYOUT.areas[s.area];
      for (let gx = -12; gx <= 12; gx++) {
        for (let gz = -12; gz <= 12; gz++) {
          const x = s.x + gx * 0.25;
          const z = s.z + gz * 0.25;
          if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ || !openGround(x, z)) continue;
          points++;
          const plan = planClickMove(s.standX, s.standZ, ground(x, z), obstacles, bounds, true, options);
          if (!plan.ok) {
            refused.push(`seat ${i} (${x.toFixed(2)}, ${z.toFixed(2)}): ${plan.reason}`);
            continue;
          }
          // the ring is where the avatar stops: the walk there (round, when it goes round) arrives
          const walk = simulateWalk(s.standX, s.standZ, plan.x, plan.z, obstacles, bounds, R, plan.via);
          if (!walk.arrived) refused.push(`seat ${i} (${x.toFixed(2)}, ${z.toFixed(2)}): planned but stuck at (${walk.x.toFixed(2)}, ${walk.z.toFixed(2)})`);
          if (Math.hypot(plan.x - x, plan.z - z) > 0.75) pushedFar++;
        }
      }
    });
    expect(points).toBeGreaterThan(11000);
    expect(refused).toEqual([]);
    expect(pushedFar).toBeGreaterThan(0); // the turned benches' boxes: rings moved out to the nearest place to stand
  });

  it("the review's taps from seat 8: behind the backrest (moved out to where the body stands) and past the bench's end (round it)", () => {
    const s = VILLAGE_SEATS[8];
    const behind = planClickMove(s.standX, s.standZ, ground(-4.68, 10.4), obstacles, village, true, options);
    expect(behind).toMatchObject({ ok: true, adjusted: "pushed" });
    if (behind.ok) {
      expect(Math.hypot(behind.x + 4.68, behind.z - 10.4)).toBeLessThan(1); // just behind the bench's box
      expect(behind.z).toBeGreaterThan(10.83 + R); // behind it, not in front
      expect(simulateWalk(s.standX, s.standZ, behind.x, behind.z, obstacles, village, R, behind.via).arrived).toBe(true);
    }
    const end = planClickMove(s.standX, s.standZ, ground(-5.9, 9.3), obstacles, village, true, options);
    expect(end).toMatchObject({ ok: true, x: -5.9, z: 9.3, adjusted: "none" });
    if (end.ok) expect(simulateWalk(s.standX, s.standZ, -5.9, 9.3, obstacles, village, R, end.via).arrived).toBe(true);
    // without the furniture rule the paving behind the backrest has no spot within MAX_PUSH: nothing would happen
    expect(planClickMove(s.standX, s.standZ, ground(-4.68, 10.4), obstacles, village, true)).toEqual({ ok: false, reason: "unreachable" });
  });
});

/** Blocked clicks between free spots of a region: the plans, and the ways round findDetour gives. */
function blockedClicks(region: readonly [number, number, number, number], n: number, seed: number) {
  const rnd = seeded(seed);
  const [x0, x1, z0, z1] = region;
  const out: Array<{ from: { x: number; z: number }; to: { x: number; z: number }; plan: ClickPlan }> = [];
  let stuck = 0;
  const refused: string[] = [];
  for (let k = 0; k < n; k++) {
    let fx: number, fz: number, tx: number, tz: number;
    do {
      fx = x0 + rnd() * (x1 - x0);
      fz = z0 + rnd() * (z1 - z0);
    } while (!isFreeSpot(fx, fz, obstacles, village));
    do {
      tx = x0 + rnd() * (x1 - x0);
      tz = z0 + rnd() * (z1 - z0);
    } while (!isFreeSpot(tx, tz, obstacles, village));
    if (simulateWalk(fx, fz, tx, tz, obstacles, village).arrived) continue;
    const via = findDetour(fx, fz, tx, tz, obstacles, village);
    if (via && !simulateWalk(fx, fz, tx, tz, obstacles, village, R, via).arrived) stuck++;
    const plan = planClickMove(fx, fz, ground(tx, tz), obstacles, village, false, options);
    if (!plan.ok) refused.push(`(${fx.toFixed(2)}, ${fz.toFixed(2)}) -> (${tx.toFixed(2)}, ${tz.toFixed(2)}): ${plan.reason}`);
    out.push({ from: { x: fx, z: fz }, to: { x: tx, z: tz }, plan });
  }
  return { out, stuck, refused };
}

const REGIONS = {
  plaza: [-16, 16, -16, 16],
  houses: [-58, -30, -22, 6],
  creek: [-30, 12, 54, 90],
} as const;

describe("clickPlan sweep — ways round never stick on a corner (round 5 review Monte Carlo)", () => {
  for (const [name, region] of Object.entries(REGIONS)) {
    it(`${name}: every way round found is walked to its end, no click on a free spot is refused`, () => {
      const { out, stuck, refused } = blockedClicks(region, 700, 7 + name.length);
      expect(out.length).toBeGreaterThan(50); // enough blocked clicks to mean something
      expect(stuck).toBe(0);
      expect(refused).toEqual([]);
      // each plan is honest: the walk to its ring (round, when it goes round) arrives
      for (const { from, plan } of out) {
        if (!plan.ok) continue;
        expect(simulateWalk(from.x, from.z, plan.x, plan.z, obstacles, village, R, plan.via).arrived).toBe(true);
      }
    });
  }
});

/**
 * LocalPlayer's walk, as the game runs it: stepClickMove's direction at `speed` for frames of `dt`, slid by
 * resolveCollision over every collider, clamped a radius inside the area. Where it is when the walk ends (arrival or no
 * progress), and whether it arrived.
 */
function gameWalk(from: { x: number; z: number }, plan: ClickPlan & { ok: true }, dt: number, speed: number) {
  setClickTarget(plan.x, plan.z, plan.y, plan.via);
  let x = from.x;
  let z = from.z;
  for (let i = 0; i < 200 / dt && getClickTarget(); i++) {
    const dir = stepClickMove(x, z, dt);
    if (!dir) break;
    const next = resolveCollision(x, z, dir.x * speed * dt, dir.z * speed * dt, R, obstacles);
    x = Math.min(Math.max(next.x, village.minX + R), village.maxX - R);
    z = Math.min(Math.max(next.z, village.minZ + R), village.maxZ - R);
  }
  clearClickTarget();
  return { x, z, arrived: Math.hypot(plan.x - x, plan.z - z) < ARRIVE_DIST + 1e-9 };
}

describe("clickPlan sweep — the game's walk follows the ways round at any frame rate, walking or running", () => {
  beforeAll(() => setActiveMap(VILLAGE_ACTIVE_MAP));
  afterAll(() => setActiveMap(LEGACY_ACTIVE_MAP));

  it("plaza, houses, creek: 30, 60 and 144 fps at a walk, 30 and 60 fps at a run — every way round arrives", () => {
    const failed: string[] = [];
    let ways = 0;
    for (const [name, region] of Object.entries(REGIONS)) {
      const { out } = blockedClicks(region, 250, 101 + name.length);
      for (const { from, plan } of out) {
        if (!plan.ok || !plan.via) continue;
        ways++;
        for (const [fps, speed] of [
          [30, MOVE_SPEED],
          [60, MOVE_SPEED],
          [144, MOVE_SPEED],
          [30, RUN_SPEED],
          [60, RUN_SPEED],
        ] as const) {
          const w = gameWalk(from, plan, 1 / fps, speed);
          if (!w.arrived) failed.push(`${name} ${fps} fps ${speed} m/s: (${from.x.toFixed(2)}, ${from.z.toFixed(2)}) -> (${plan.x.toFixed(2)}, ${plan.z.toFixed(2)}) stopped at (${w.x.toFixed(2)}, ${w.z.toFixed(2)})`);
        }
      }
    }
    expect(ways).toBeGreaterThan(100);
    expect(failed).toEqual([]);
  });

  it("seated taps that go round a bench: the game's walk from the dismount point arrives too", () => {
    const failed: string[] = [];
    let ways = 0;
    for (const s of VILLAGE_SEATS.filter((v) => v.area === "village")) {
      for (let gx = -12; gx <= 12; gx += 2) {
        for (let gz = -12; gz <= 12; gz += 2) {
          const x = s.x + gx * 0.25;
          const z = s.z + gz * 0.25;
          if (!openGround(x, z)) continue;
          const plan = planClickMove(s.standX, s.standZ, ground(x, z), obstacles, village, true, options);
          if (!plan.ok || !plan.via) continue;
          ways++;
          for (const [fps, speed] of [
            [30, MOVE_SPEED],
            [60, MOVE_SPEED],
            [60, RUN_SPEED],
          ] as const) {
            const w = gameWalk({ x: s.standX, z: s.standZ }, plan, 1 / fps, speed);
            if (!w.arrived) failed.push(`seat ${s.bench} ${fps} fps ${speed}: (${x.toFixed(2)}, ${z.toFixed(2)}) stopped at (${w.x.toFixed(2)}, ${w.z.toFixed(2)})`);
          }
        }
      }
    }
    expect(ways).toBeGreaterThan(50);
    expect(failed).toEqual([]);
  });
});
