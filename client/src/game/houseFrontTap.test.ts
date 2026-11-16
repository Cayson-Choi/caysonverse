/**
 * 집 외관 A8 (X0) design 8 B4 on the walk grid: a tap on each house's keypad pad, on its steps and on the lawn in front of it is
 * planned and walked to the end on the A8 map (a8Staging.ts), from the plaza spawn and from the sidewalk nearest the house —
 * house 8 included (the design audit's tap at (-40, 41) stopped on house 4's porch: a picking matter, not the grid's).
 */
import { describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { keypadEntries } from "@caysonverse/shared/village/buildingAccess";
import { HOUSE_Z_EDGE, houseLocalToWorld } from "@caysonverse/shared/village/houseExterior";
import { planClickMove, walkThere } from "./clickPlan";
import { VILLAGE_FURNITURE } from "./activeMap";

const obstacles = villageGeometry.obstacles;
const village = VILLAGE_LAYOUT.areas.village;
const ground = (x: number, z: number) => ({ x, y: 0.01, z, ny: 1 });
const houses = VILLAGE_LAYOUT.sceneryHouses.filter((h) => h.kind === "house");

function tapArrives(from: { x: number; z: number }, to: { x: number; z: number }): string | null {
  const plan = planClickMove(from.x, from.z, ground(to.x, to.z), obstacles, village, false, { furniture: VILLAGE_FURNITURE });
  if (!plan.ok) return `refused (${plan.reason})`;
  if (Math.hypot(plan.x - to.x, plan.z - to.z) > 0.8) return `ring ${Math.hypot(plan.x - to.x, plan.z - to.z).toFixed(2)} m off`;
  if (!walkThere(from.x, from.z, plan.x, plan.z, obstacles, village, plan.via).arrived) return "stuck on the way";
  return null;
}

describe("B4: tap to every house's front door (A8 map)", { timeout: 120_000 }, () => {
  const spawn = { x: VILLAGE_LAYOUT.spawn.x, z: VILLAGE_LAYOUT.spawn.z };
  for (const h of houses) {
    it(`${h.id}: the keypad pad, the steps and the lawn in front, from the sidewalk and from the spawn`, () => {
      const pad = keypadEntries().find((e) => e.buildingId === h.id)!.pad;
      const lawn = houseLocalToWorld(h, 0, HOUSE_Z_EDGE + 2.0);
      const step = houseLocalToWorld(h, 0, HOUSE_Z_EDGE + 0.5);
      // the sidewalk (r 38) on the line from the plaza to the house's front
      const r = Math.hypot(lawn.x, lawn.z);
      const walk = { x: (lawn.x / r) * 38, z: (lawn.z / r) * 38 };
      for (const [name, from] of [["sidewalk", walk], ["lawn", lawn]] as const) {
        for (const [what, to] of [["pad", pad], ["step", step]] as const) expect(tapArrives(from, to), `${h.id} ${name} -> ${what}`).toBeNull();
      }
      expect(tapArrives(spawn, lawn), `${h.id} spawn -> lawn`).toBeNull();
    });
  }
});
