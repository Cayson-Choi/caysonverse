import { describe, expect, it } from "vitest";
import { HOUSE_NUMBERS, HOUSE_PLACES } from "@caysonverse/shared/village/houseAreas";
import { ARRIVAL_MAX_TURN, arrivalCamera } from "./houseArrivalCamera";
import { normalizeAngle } from "../game/yaw";

describe("the arrival camera of a house", () => {
  it("at the entry spot (the wall 3.1 m behind) it turns away from straight behind to the side with room, within 110°, tilted to read the room", () => {
    for (const n of HOUSE_NUMBERS) {
      const p = HOUSE_PLACES[n].spawnIn;
      const c = arrivalCamera(n, 1, p.x, p.z, p.yaw, 6);
      expect(c.pitch).toBeCloseTo(0.55, 6);
      expect(Math.abs(normalizeAngle(c.yaw - (p.yaw + Math.PI)))).toBeLessThanOrEqual(ARRIVAL_MAX_TURN + 1e-9);
      expect(c.clear).toBeGreaterThan(3.2);
    }
  });
  it("stair arrivals on both floors get a direction too, never fully blocked", () => {
    for (const n of HOUSE_NUMBERS) {
      for (const [f, p] of [[2, HOUSE_PLACES[n].spawnUp], [1, HOUSE_PLACES[n].spawnDown]] as const) {
        expect(arrivalCamera(n, f, p.x, p.z, p.yaw, 6).clear, `house ${n} floor ${f}`).toBeGreaterThan(1.5);
      }
    }
  });
});
