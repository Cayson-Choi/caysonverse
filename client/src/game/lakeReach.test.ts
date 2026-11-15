/**
 * The fishing lake (A10, D1) is reachable on foot with the real click planner: from the plaza and from the rental pad, a
 * single tap on each of the 30 fishing chairs (and on the other lake seats, the pad, the pier's end) plans a walk that
 * the walk simulation (stepClickMove's rules: the same slide + bounds clamp as LocalPlayer) carries to its end.
 */
import { describe, it, expect } from "vitest";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { isBlocked } from "@caysonverse/shared/collision";
import { LAKE_FISHING_SPOTS, LAKE_RENTAL_PAD, inLakeWater, lakeSeats, onLakeDeck } from "@caysonverse/shared/village/lakeLayout";
import { planClickMove, simulateWalk } from "./clickPlan";
import { VILLAGE_FURNITURE } from "./activeMap";

const obstacles = villageGeometry.obstacles;
const village = VILLAGE_LAYOUT.areas.village;
const options = { furniture: VILLAGE_FURNITURE };
const ground = (x: number, z: number) => ({ x, y: 0.01, z, ny: 1 });

const starts: Array<[string, number, number]> = [
  ["plaza spawn", VILLAGE_LAYOUT.spawn.x, VILLAGE_LAYOUT.spawn.z],
  ["rental pad", LAKE_RENTAL_PAD.x, LAKE_RENTAL_PAD.z],
];

function walkTo(fromX: number, fromZ: number, x: number, z: number) {
  const plan = planClickMove(fromX, fromZ, ground(x, z), obstacles, village, false, options);
  if (!plan.ok) return { ok: false as const, why: plan.reason };
  const walk = simulateWalk(fromX, fromZ, plan.x, plan.z, obstacles, village, undefined, plan.via);
  return { ok: walk.arrived, why: walk.arrived ? "" : `stuck at (${walk.x.toFixed(1)}, ${walk.z.toFixed(1)})`, plan };
}

describe("walking to the fishing lake with the click planner (design 12.1)", () => {
  it("the village area now holds the lake zone", () => {
    expect(village.maxX).toBeGreaterThanOrEqual(186);
    expect(village.minX).toBe(-95);
  });

  for (const [name, fx, fz] of starts) {
    it(`from the ${name}: a tap on the rental pad, the pier's mouth and the pier's end walks there`, () => {
      const bad: string[] = [];
      for (const [label, x, z] of [["pad", LAKE_RENTAL_PAD.x, LAKE_RENTAL_PAD.z], ["pier mouth", 108, -12], ["pier T", 144, -12], ["좌대 A walkway", 143, -22], ["좌대 B", 143, 7.5]] as const) {
        if (name === "rental pad" && label === "pad") continue;
        const r = walkTo(fx, fz, x, z);
        if (!r.ok) bad.push(`${label}: ${r.why}`);
      }
      expect(bad).toEqual([]);
    });

    it(`from the ${name}: a tap on each of the 30 fishing chairs walks there (nothing refused, nothing stuck)`, () => {
      const bad: string[] = [];
      const chairs = lakeSeats().filter((s) => s.kind === "fishing_chair");
      expect(chairs).toHaveLength(30);
      for (const c of chairs) {
        // the tap lands on the chair; the walk ends at its get-up spot's neighbourhood
        const r = walkTo(fx, fz, c.x, c.z);
        if (!r.ok) bad.push(`${c.spot}: ${r.why}`);
        else if (r.plan && Math.hypot(r.plan.x - c.x, r.plan.z - c.z) > 1.6) bad.push(`${c.spot}: ring ${Math.hypot(r.plan.x - c.x, r.plan.z - c.z).toFixed(2)} m from the chair`);
      }
      expect(bad).toEqual([]);
    }, 120_000);

    it(`from the ${name}: every other lake seat's get-up spot can be walked to`, () => {
      const bad: string[] = [];
      for (const s of lakeSeats().filter((q) => q.kind !== "fishing_chair")) {
        for (const [x, z] of [[s.standX, s.standZ], ...(s.other ? [[s.other.standX, s.other.standZ] as [number, number]] : [])] as Array<[number, number]>) {
          const r = walkTo(fx, fz, x, z);
          if (!r.ok) bad.push(`${s.id}: ${r.why}`);
        }
      }
      expect(bad).toEqual([]);
    }, 120_000);
  }

  it("a tap on the water: the walk (if any) stops on the shore or a deck, the ring is never in the lake", () => {
    for (const s of LAKE_FISHING_SPOTS) {
      const r = planClickMove(LAKE_RENTAL_PAD.x, LAKE_RENTAL_PAD.z, ground(s.float.x, s.float.z), obstacles, village, false, options);
      if (r.ok) {
        expect(inLakeWater(r.x, r.z) && !onLakeDeck(r.x, r.z), `${s.id}: ring (${r.x.toFixed(1)}, ${r.z.toFixed(1)}) in the water`).toBe(false);
        expect(isBlocked(r.x, r.z, 0.4, obstacles), `${s.id}: ring inside a collider`).toBe(false);
      }
    }
  });
});
