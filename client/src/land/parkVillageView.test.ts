import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PARK_ARRIVAL, PARK_BOUNDS } from "@caysonverse/shared/village/parkArea";
import { PARK_WALL_RECT, WALL } from "@caysonverse/shared/village/parkWall";
import { VILLAGE_VIEW, VILLAGE_VIEW_MAX_EYE, villageViewGeometry, villageViewHalfAngle, villageViewWeights } from "./ParkVillageView";
import { PARK_ARRIVAL_REACH_M, parkArrivalView } from "./parkArrival";

describe("the village seen through the park's gate arch", () => {
  it("the strip stands wholly beyond the north wall, wide enough for the arch from anywhere on the promenade", () => {
    const g = villageViewGeometry();
    const pos = g.getAttribute("position");
    const outer = PARK_WALL_RECT.minZ - WALL.halfThickness - WALL.footing;
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getZ(i)).toBeLessThan(outer - 3);
      expect(Math.hypot(pos.getX(i) - PARK_ARRIVAL.x, pos.getZ(i) - PARK_ARRIVAL.z)).toBeCloseTo(VILLAGE_VIEW.radius, 4);
    }
    // from the arrival spot the 14 m arch (15.5 m away) spans +-24 degrees: the strip covers far more
    expect(villageViewHalfAngle()).toBeGreaterThan((60 * Math.PI) / 180);
    // its uv runs with the bearing over the stitched strip's 180 degrees: north is the strip's middle
    const uv = g.getAttribute("uv");
    expect(uv.getX(0) + uv.getX(uv.count - 1)).toBeCloseTo(1, 5);
    expect(uv.getX(0)).toBeGreaterThan(0.05);
  });
  it("is hidden from above the wall, and its three pictures always add up to one", () => {
    expect(VILLAGE_VIEW_MAX_EYE).toBeLessThan(WALL.top);
    expect(VILLAGE_VIEW.top).toBeLessThan(16);
    for (const n of [0, 0.1, 0.3, 0.45, 0.6, 0.9, 1]) {
      const w = villageViewWeights(n);
      expect(w[0] + w[1] + w[2]).toBeCloseTo(1, 6);
      for (const x of w) expect(x).toBeGreaterThanOrEqual(0);
    }
    expect(villageViewWeights(0)).toEqual([1, 0, 0]);
    expect(villageViewWeights(1)[2]).toBe(1);
  });
  it("the stitched pictures are in the client (day, dusk, night; the phone's too)", () => {
    const dir = resolve(__dirname, "..", "..", "public", "textures", "park");
    for (const t of ["day", "dusk", "night"]) for (const s of ["", "_1k"]) expect(existsSync(resolve(dir, `village_view_${t}${s}.webp`)), `${t}${s}`).toBe(true);
  });
});

describe("arriving in the park turns the view into it", () => {
  it("at the arrival spot (and beside it, and while the pose still holds the village's coordinates): yes; deep in the park: no", () => {
    expect(parkArrivalView(PARK_ARRIVAL.x, PARK_ARRIVAL.z)).toBe(true);
    expect(parkArrivalView(PARK_ARRIVAL.x + PARK_ARRIVAL_REACH_M - 1, PARK_ARRIVAL.z)).toBe(true);
    expect(parkArrivalView(-24, 92)).toBe(true); // the village's gate pad: outside the park's bounds
    expect(parkArrivalView(110, -119)).toBe(false); // at the carousel
    expect(parkArrivalView(PARK_BOUNDS.minX + 5, -100)).toBe(false);
  });
});
