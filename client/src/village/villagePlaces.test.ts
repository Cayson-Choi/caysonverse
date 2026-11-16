import { describe, expect, it } from "vitest";
import { VILLAGE_ACTIVE_MAP, mapBounds } from "../game/activeMap";
import { planClickMove, simulateWalk } from "../game/clickPlan";
import { MAP_PLACES, PLAZA_HUB, houseFront, mapPlace, wayTo } from "./villagePlaces";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";

const obstacles = VILLAGE_ACTIVE_MAP.geometry.obstacles;
const bounds = mapBounds(VILLAGE_ACTIVE_MAP);
const furniture = VILLAGE_ACTIVE_MAP.furniture;

/** Walk the legs as mapWalk does: each planned like a click from where the last ended. Returns where it stopped and why. */
function walkWay(fromX: number, fromZ: number, way: readonly { x: number; z: number }[]) {
  let x = fromX;
  let z = fromZ;
  for (let i = 0; i < way.length; i++) {
    const w = way[i]!;
    if (Math.hypot(w.x - x, w.z - z) < 0.6) continue;
    const plan = planClickMove(x, z, { x: w.x, y: 0, z: w.z, ny: 1 }, obstacles, bounds, false, { furniture });
    if (!plan.ok) return { ok: false, leg: i, at: { x, z }, why: plan.reason };
    const walk = simulateWalk(x, z, plan.x, plan.z, obstacles, bounds, undefined, plan.via ?? []);
    x = walk.x;
    z = walk.z;
    if (Math.hypot(w.x - x, w.z - z) > 1.5) return { ok: false, leg: i, at: { x, z }, why: `stopped ${plan.adjusted}` };
  }
  return { ok: true, leg: way.length, at: { x, z }, why: "" };
}

const STARTS: Record<string, { x: number; z: number }> = {
  spawn: { x: 0, z: 14 },
  plazaNorth: { x: 3, z: -18 },
  plazaWest: { x: -18, z: 6 },
  memorialDoor: { x: 0, z: -48.8 },
  lakePad: { x: 102, z: -14.6 },
  busStop: { x: 38.6, z: -3.6 },
  house5: houseFront(VILLAGE_LAYOUT.sceneryHouses.find((h) => h.id === "house_5")!),
};

describe("map places", () => {
  it("names the main places: 추모관, 버스정류장, 카페, 케이슨 낚시터, 광장 and the ten houses (N번 집)", () => {
    const names = MAP_PLACES.map((m) => m.name);
    for (const n of ["추모관", "버스정류장", "카페", "케이슨 낚시터", "광장"]) expect(names).toContain(n);
    for (let i = 1; i <= 10; i++) expect(names).toContain(`${i}번 집`);
    for (const m of MAP_PLACES) expect(m.icon.length).toBeGreaterThan(0);
  });

  it("every route starts on the plaza's hub side and ends on free ground", () => {
    expect(Math.hypot(PLAZA_HUB.x, PLAZA_HUB.z)).toBeLessThan(30);
    for (const m of MAP_PLACES) {
      const end = m.route[m.route.length - 1]!;
      const plan = planClickMove(end.x, end.z + 0.01, { x: end.x, y: 0, z: end.z, ny: 1 }, obstacles, bounds, false, { furniture });
      // standing there is either "here" (a free spot) or a walk of a few cm
      expect(plan.ok || plan.reason === "here", `${m.name} ${JSON.stringify(plan)}`).toBe(true);
    }
  });

  for (const [startName, s] of Object.entries(STARTS)) {
    it(`from ${startName}, every place is reached along its way`, () => {
      const fails: string[] = [];
      for (const m of MAP_PLACES) {
        const r = walkWay(s.x, s.z, wayTo(m, s.x, s.z));
        if (!r.ok) fails.push(`${m.name}: leg ${r.leg} at ${r.at.x.toFixed(1)},${r.at.z.toFixed(1)} (${r.why})`);
      }
      expect(fails).toEqual([]);
    });
  }

  it("wayTo leaves out what is behind: halfway to the lake, the lake's walk goes on from there", () => {
    const lake = mapPlace("lake")!;
    const way = wayTo(lake, 73, -7.5); // between (66, -6) and (80, -9) on the trail
    expect(way[0]).toEqual({ x: 80, z: -9 });
  });
});
