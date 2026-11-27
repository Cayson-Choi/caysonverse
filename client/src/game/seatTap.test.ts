/**
 * Tapping a marked chair or porch bench (seatTap.ts): the tap is found on the right seat, the goal is a spot that offers
 * THAT seat, and the walk there — from the road side, from the building side, from the bus waiting pavement across the
 * planter, from another chair — arrives at it (round 5 review: 10 of 24 taps sat on another chair, 2 could not sit).
 */
import { describe, it, expect } from "vitest";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { SEAT_REACH, approachesSeat, PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { VILLAGE_SEAT_MARKERS } from "@caysonverse/shared/village/benchSeats";
import { isBlocked } from "@caysonverse/shared/collision";
import { isFreeSpot, planClickMove, simulateWalk } from "./clickPlan";
import { HALL_ACTIVE_MAP, VILLAGE_FURNITURE } from "./activeMap";
import { seatApproachGoal, seatUnderTap, warmSeatApproachGoals } from "./seatTap";

const obstacles = villageGeometry.obstacles;
const village = VILLAGE_LAYOUT.areas.village;
const marked = VILLAGE_SEATS.map((s, i) => ({ s, i })).filter(({ s }) => /^cafe_terrace_|_porch$/.test(s.bench));
const cafe = marked.filter(({ s }) => s.bench.startsWith("cafe_terrace_"));

describe("seatUnderTap", () => {
  it("finds the seat from points on its chair, not from the ground beside it nor a body's height above it", () => {
    expect(marked.length).toBe(15);
    for (const { s, i } of marked) {
      const m = VILLAGE_SEAT_MARKERS.find((k) => k.id === s.bench)!; // the chair's centre, 0.46 m up (its seat)
      expect(seatUnderTap(VILLAGE_SEATS, m.x, 0.46, m.z)).toBe(i);
      expect(seatUnderTap(VILLAGE_SEATS, m.x, 0.0, m.z)).toBe(i); // the ground seen between its legs
      expect(seatUnderTap(VILLAGE_SEATS, m.x, 0.0, m.z + 2.5)).toBe(-1); // the ground beside it
      expect(seatUnderTap(VILLAGE_SEATS, m.x, 1.6, m.z)).toBe(-1); // above a chair's back
    }
    expect(seatUnderTap(VILLAGE_SEATS, 0, 0.5, 0)).toBe(-1); // the plaza
  });
});

describe("a tap on a chair walks to that chair's own spot", () => {
  it("every marked seat has a goal where it is the one offered", () => {
    for (const { s, i } of marked) {
      const g = seatApproachGoal(VILLAGE_SEATS, i, obstacles, village);
      expect(g, s.bench).not.toBeNull();
      expect(approachesSeat(s, g!.x, g!.z)).toBe(true);
      // a tap-walk stops up to 0.35 m short: the seat is offered on the ring of 0.4 m round the goal wherever a body stands
      const spots = [{ x: g!.x, z: g!.z }, ...Array.from({ length: 16 }, (_, k) => ({ x: g!.x + 0.4 * Math.cos((k * Math.PI) / 8), z: g!.z + 0.4 * Math.sin((k * Math.PI) / 8) }))];
      for (const q of spots) if (isFreeSpot(q.x, q.z, obstacles, village)) expect(approachesSeat(s, q.x, q.z) && Math.hypot(q.x - s.x, q.z - s.z) <= SEAT_REACH, `${s.bench} at ${q.x.toFixed(2)},${q.z.toFixed(2)}`).toBe(true);
      expect(isBlocked(g!.x, g!.z, PLAYER_RADIUS, obstacles, 0)).toBe(false);
    }
  });

  it("from the road, the building side, the terrace's lanes and the pavement across the planter: arrives at the goal", () => {
    const starts: Array<[number, number]> = [];
    for (let x = 38; x <= 47; x += 0.5) for (let z = -24; z <= -4; z += 0.5) {
      if (!isBlocked(x, z, PLAYER_RADIUS + 0.15, obstacles, 0)) starts.push([x, z]);
    }
    const failures: string[] = [];
    let plans = 0;
    for (const { s, i } of cafe) {
      const g = seatApproachGoal(VILLAGE_SEATS, i, obstacles, village)!;
      for (const [x, z] of starts) {
        if (Math.hypot(x - g.x, z - g.z) < 0.35) continue; // already there
        plans++;
        const plan = planClickMove(x, z, { x: g.x, y: 0.01, z: g.z, ny: 1 }, obstacles, village, false, { furniture: VILLAGE_FURNITURE, farFirst: true });
        if (!plan.ok) {
          failures.push(`${s.bench} from ${x},${z}: ${plan.reason}`);
          continue;
        }
        const walk = simulateWalk(x, z, plan.x, plan.z, obstacles, village, PLAYER_RADIUS, plan.via);
        if (!walk.arrived || Math.hypot(plan.x - g.x, plan.z - g.z) > 0.02) failures.push(`${s.bench} from ${x},${z}: arrived ${walk.arrived}, ends ${plan.x.toFixed(2)},${plan.z.toFixed(2)}`);
      }
    }
    expect(plans).toBeGreaterThan(5000);
    expect(failures).toEqual([]);
  }, 90_000); // ~10 s alone (every start on a 0.5 m grid walked to the chair), ~30 s under the full suite

  it("a seated player tapping another chair gets up and walks to it", () => {
    let plans = 0;
    for (const a of cafe) for (const b of cafe) {
      if (a.i === b.i) continue;
      const g = seatApproachGoal(VILLAGE_SEATS, b.i, obstacles, village)!;
      plans++;
      const plan = planClickMove(a.s.standX, a.s.standZ, { x: g.x, y: 0.01, z: g.z, ny: 1 }, obstacles, village, true, { furniture: VILLAGE_FURNITURE, farFirst: true });
      expect(plan.ok, `${a.s.bench} -> ${b.s.bench}`).toBe(true);
      if (plan.ok) expect(simulateWalk(a.s.standX, a.s.standZ, plan.x, plan.z, obstacles, village, PLAYER_RADIUS, plan.via).arrived).toBe(true);
    }
    expect(plans).toBe(132);
  });
});

describe("the goals are worked out ahead, one seat at a time (review 2026-11-15: 20 ms in a pointerup handler)", () => {
  it("reconnecting inside the hall preserves each outdoor chair's approach on exit", () => {
    const seats = VILLAGE_SEATS.slice();
    const ticks: (() => void)[] = [];
    warmSeatApproachGoals(seats, HALL_ACTIVE_MAP.geometry.obstacles, HALL_ACTIVE_MAP.bounds!, (run) => ticks.push(run));
    expect(ticks).toHaveLength(0);
    while (ticks.length) ticks.shift()!();
    const { i } = cafe[0];
    expect(seatApproachGoal(seats, i, obstacles, HALL_ACTIVE_MAP.bounds!)).toBeNull();
    expect(seatApproachGoal(seats, i, obstacles, village)).toEqual(seatApproachGoal(VILLAGE_SEATS, i, obstacles, village));
    expect(seatApproachGoal(seats, i, obstacles, village)).not.toBeNull();
  });

  it("warmSeatApproachGoals fills every marked seat's goal, one per tick; each seat's search stays short", async () => {
    const { warmSeatApproachGoals, seatApproachGoalReady, markedSeatIndices } = await import("./seatTap");
    // The budget is per seat (one tick must not hitch a frame). A single wall-clock sample is at the mercy of the machine (a GC,
    // another process: 16.7 and 33 ms were seen on a loaded box for a search that takes a few ms), so the warm-up runs on a cold
    // cache ROUNDS times and each seat keeps its fastest run: a search that really got slow is slow every time.
    const ROUNDS = 3;
    const best = new Map<number, number>();
    for (let round = 0; round < ROUNDS; round++) {
      const seats = VILLAGE_SEATS.slice(); // a fresh list: a cold cache
      const ticks: (() => void)[] = [];
      warmSeatApproachGoals(seats, obstacles, village, (run) => ticks.push(run));
      const marked = markedSeatIndices(seats);
      // the art's 15 marked seats, the lake's 30 fishing chairs (E2), the zelkova deck's 6, lots v2's 32 outdoor places (L5v2)
      expect(marked).toHaveLength(15 + 30 + 6 + 32);
      let n = 0;
      while (ticks.length > 0) {
        const t0 = performance.now();
        ticks.shift()!();
        const ms = performance.now() - t0;
        best.set(n, Math.min(best.get(n) ?? Infinity, ms));
        n++;
      }
      expect(n).toBe(15 + 30 + 6 + 32);
      expect(marked.every((i) => seatApproachGoalReady(seats, i, obstacles, village))).toBe(true);
    }
    const worst = Math.max(...best.values());
    console.log(`seatApproachGoal: worst seat ${worst.toFixed(2)} ms (fastest of ${ROUNDS} cold runs)`);
    expect(worst).toBeLessThan(15); // was up to 20 ms before the goals were worked out ahead
  }, 60_000);
});
