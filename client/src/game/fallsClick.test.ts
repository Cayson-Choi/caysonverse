/**
 * B1 waterfall, W5: clicking at the rest area (fallsWalk.ts, clickPlan.ts PlanOptions.shore, seatTap.ts). A click on the
 * pool's water walks to the nearest shore and the ring goes there; the stone seats are tapped from either side; the whole
 * walk is the game's own (simulateWalk + the slide + the bounds clamp, as LocalPlayer), over villageGeometry.
 */
import { describe, it, expect } from "vitest";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { fallsWalkSurfaceOk, onSlab, poolRadius, villageWalkArea } from "@caysonverse/shared/village/fallsWalk";
import { PLAYER_RADIUS, SEAT_REACH, approachesSeat, nearestFreeSeat } from "@caysonverse/shared/worldMap";
import { isBlocked } from "@caysonverse/shared/collision";
import { planClickMove, walkThere } from "./clickPlan";
import { VILLAGE_ACTIVE_MAP, VILLAGE_FURNITURE } from "./activeMap";
import { seatApproachGoal, seatUnderTap } from "./seatTap";

const L = VILLAGE_LAYOUT;
const W = L.backdrop.waterfall;
const R = PLAYER_RADIUS;
const obstacles = villageGeometry.obstacles;
const bounds = villageWalkArea(L);
const water = (x: number, z: number) => ({ x, y: W.pool.waterY, z, ny: 1 });
const options = { furniture: VILLAGE_FURNITURE, shore: VILLAGE_ACTIVE_MAP.shore };

/** Where a player can start: the rest area's open ground, the entry and the village edge beside it. */
const starts: Array<[number, number]> = [];
for (let x = -105.5; x <= -90; x += 1.5) for (let z = -89.5; z <= -68.5; z += 1.5) if (!isBlocked(x, z, R + 0.05, obstacles, 0)) starts.push([x, z]);

describe("a click on the pool's water", () => {
  it("walks to the nearest shore: the ring is on a free spot beside the water, never in it, and the walk arrives", () => {
    const clicks: Array<[number, number]> = [];
    for (let x = W.pool.centre.x - W.pool.radiusX + 0.5; x <= W.pool.centre.x + W.pool.radiusX; x += 2) {
      for (let z = W.pool.centre.z - W.pool.radiusZ + 0.5; z <= W.pool.centre.z + W.pool.radiusZ - 0.5; z += 2) {
        if (poolRadius(L, x, z, 0.6) < 1 && !onSlab(L, x, z)) clicks.push([x, z]);
      }
    }
    expect(clicks.length).toBeGreaterThan(20);
    let plans = 0;
    for (const [sx, sz] of [[-96, -78], [-100, -88], [-100, -69], [-92, -78], [-102.5, -81.6]] as const) {
      for (const [cx, cz] of clicks) {
        const plan = planClickMove(sx, sz, water(cx, cz), obstacles, bounds, false, options);
        expect(plan.ok, `from ${sx},${sz} click ${cx},${cz}`).toBe(true);
        if (!plan.ok) continue;
        plans++;
        expect(isBlocked(plan.x, plan.z, R, obstacles, 0), `ring ${plan.x},${plan.z}`).toBe(false);
        expect(fallsWalkSurfaceOk(L, plan.x, plan.z), `ring ${plan.x},${plan.z}`).toBe(true);
        expect(plan.adjusted).toBe("pushed"); // moved off the water
        expect(walkThere(sx, sz, plan.x, plan.z, obstacles, bounds, plan.via).arrived, `walk ${sx},${sz} -> ${plan.x},${plan.z}`).toBe(true);
      }
    }
    expect(plans).toBeGreaterThan(100);
  });

  it("without the shore rule such a click would only stop at the first thing in the way (the old behaviour this replaces)", () => {
    const plan = planClickMove(-96, -78, water(-111, -78), obstacles, bounds, false, { furniture: VILLAGE_FURNITURE });
    expect(plan.ok && plan.adjusted === "pushed").toBe(false);
  });

  it("from the village, from anywhere in the rest area, to every shore spot: the way is found and walked", () => {
    // a click on the water from across the pocket: no start is cut off from any shore
    for (const [sx, sz] of starts) {
      const plan = planClickMove(sx, sz, water(W.impact.x, W.impact.z), obstacles, bounds, false, options);
      // (a start already on the nearest shore spot, the front rock's lip: 'here', nothing to walk)
      expect(plan.ok || plan.reason === "here", `from ${sx},${sz}`).toBe(true);
    }
  });

  it("a click beside the water, on the shore's gravel, is the ordinary ground rule (pushed out of the margin, no water click)", () => {
    const plan = planClickMove(-96, -78, { x: -100, y: 0, z: -78, ny: 1 }, obstacles, bounds, false, options);
    expect(plan).toMatchObject({ ok: true, adjusted: "none" });
  });
});

describe("the stone seats, tapped", () => {
  const falls = VILLAGE_SEATS.map((s, i) => ({ s, i })).filter(({ s }) => s.bench.startsWith("falls_seat_"));
  const stones = W.seats;

  it("a tap on a stone's top finds the seat of the tapped side and place (every side is a front)", () => {
    expect(falls).toHaveLength(8);
    for (const st of stones) {
      for (const side of [-1, 1]) {
        for (const dz of [-0.6, 0.6]) {
          const x = st.centre.x + side * 0.3;
          const z = st.centre.z + dz;
          const i = seatUnderTap(VILLAGE_SEATS, x, st.seatTop, z);
          expect(i, `${st.id} ${side} ${dz}`).toBeGreaterThanOrEqual(0);
          const s = VILLAGE_SEATS[i];
          expect(s.bench).toBe(st.id);
          expect(Math.sign(s.x - st.centre.x)).toBe(side);
          expect(Math.sign(s.z - st.centre.z)).toBe(Math.sign(dz));
        }
      }
      expect(seatUnderTap(VILLAGE_SEATS, st.centre.x, 1.6, st.centre.z)).toBe(-1); // above it
      expect(seatUnderTap(VILLAGE_SEATS, st.centre.x + 2.5, 0.01, st.centre.z)).toBe(-1); // the ground beside it
    }
  });

  it("every seat has a goal where it is the one offered, a free spot a body stands on", () => {
    for (const { s, i } of falls) {
      const g = seatApproachGoal(VILLAGE_SEATS, i, obstacles, bounds);
      expect(g, `${s.bench} ${i}`).not.toBeNull();
      expect(approachesSeat(s, g!.x, g!.z)).toBe(true);
      expect(Math.hypot(g!.x - s.x, g!.z - s.z)).toBeLessThanOrEqual(SEAT_REACH);
      expect(isBlocked(g!.x, g!.z, R, obstacles, 0)).toBe(false);
      // on the seat's own side of the stone
      expect(Math.sign(g!.x - s.x)).toBe(s.yaw > 0 ? 1 : -1);
      // and it is the nearest free seat from there: the tap-walk's stop offers the tapped one (or one of its own stone's, same side)
      const nearest = nearestFreeSeat(g!.x, g!.z, () => false, SEAT_REACH, VILLAGE_SEATS);
      expect(nearest).not.toBeNull();
      expect(VILLAGE_SEATS[nearest!].bench).toBe(s.bench);
    }
  });

  it("a tap on every seat's goal from the rest area's starts arrives (plan, then the game's walk)", () => {
    const failures: string[] = [];
    let plans = 0;
    for (const { s, i } of falls) {
      const g = seatApproachGoal(VILLAGE_SEATS, i, obstacles, bounds)!;
      for (const [x, z] of starts) {
        if (Math.hypot(x - g.x, z - g.z) < 0.35) continue;
        plans++;
        const plan = planClickMove(x, z, { x: g.x, y: 0.01, z: g.z, ny: 1 }, obstacles, bounds, false, { ...options, farFirst: true });
        if (!plan.ok || Math.hypot(plan.x - g.x, plan.z - g.z) > 0.05 || !walkThere(x, z, plan.x, plan.z, obstacles, bounds, plan.via).arrived) failures.push(`${s.bench}#${i} from ${x},${z}`);
      }
    }
    expect(plans).toBeGreaterThan(100);
    expect(failures).toEqual([]);
  });
});
