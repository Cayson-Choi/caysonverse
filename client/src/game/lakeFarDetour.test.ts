/**
 * D1's open issue (fishing lake, chunk E): from a 좌대's deck a tap on the north shore (N2) stopped at the deck's edge — the way
 * round (walkway, T, pier, bank) is about 4 times the straight line, over DETOUR_MAX_RATIO. A walk inside the lake area now takes
 * the far limits; the village keeps its own (the creek's tests in clickPlan.test.ts).
 */
import { describe, it, expect } from "vitest";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { LAKE_FISHING_SPOTS, lakeSeats } from "@caysonverse/shared/village/lakeLayout";
import { planClickMove, simulateWalk } from "./clickPlan";
import { VILLAGE_FURNITURE } from "./activeMap";

const obstacles = villageGeometry.obstacles;
const village = VILLAGE_LAYOUT.areas.village;
const options = { furniture: VILLAGE_FURNITURE };
const ground = (x: number, z: number) => ({ x, y: 0.01, z, ny: 1 });

function walk(fx: number, fz: number, x: number, z: number) {
  const plan = planClickMove(fx, fz, ground(x, z), obstacles, village, false, options);
  if (!plan.ok) return { ok: false as const, why: plan.reason };
  const w = simulateWalk(fx, fz, plan.x, plan.z, obstacles, village, undefined, plan.via);
  return { ok: w.arrived, plan, why: w.arrived ? "" : `stuck (${w.x.toFixed(1)}, ${w.z.toFixed(1)})` };
}

describe("a long way round inside the lake area (D1's open issue)", () => {
  const chair = (id: string) => lakeSeats().find((s) => s.spot === id)!;
  it("from 좌대 A to the north shore chairs (N1..N3) and from 좌대 B to the south shore chairs: arrives", () => {
    const bad: string[] = [];
    for (const [from, tos] of [["A3", ["N1", "N2", "N3"]], ["A4", ["N2"]], ["B3", ["S1", "S2", "S3"]]] as const) {
      const f = chair(from);
      for (const to of tos) {
        const t = chair(to);
        const r = walk(f.standX, f.standZ, t.x, t.z);
        if (!r.ok) bad.push(`${from}->${to}: ${r.why}`);
        else if (Math.hypot(r.plan!.x - t.x, r.plan!.z - t.z) > 1.6) bad.push(`${from}->${to}: stops ${Math.hypot(r.plan!.x - t.x, r.plan!.z - t.z).toFixed(1)} m short`);
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it("between every pair of the 30 spots' chairs on a sample (A <-> N, B <-> S, pier <-> A)", () => {
    const sample = LAKE_FISHING_SPOTS.filter((_, i) => i % 3 === 0).map((s) => s.id);
    const bad: string[] = [];
    for (const a of sample) for (const b of sample) {
      if (a === b) continue;
      const f = chair(a), t = chair(b);
      const r = walk(f.standX, f.standZ, t.x, t.z);
      if (!r.ok) bad.push(`${a}->${b}: ${r.why}`);
    }
    expect(bad).toEqual([]);
  }, 300_000);
});
