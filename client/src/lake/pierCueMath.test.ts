import { describe, expect, it } from "vitest";
import { nearestFreeChairStand, screenBearing } from "./pierCueMath";
import { FISHING_CHAIRS } from "./lakeNearby";

describe("the pier cue (UX 2026-11-16)", () => {
  it("points up the screen at what is ahead of the camera, right at what is to its right", () => {
    // camera yaw 0 looks toward -z (north): north is straight up, east is to the right
    expect(screenBearing(0, 0, 0, -10, 0)).toBeCloseTo(0, 6);
    expect(screenBearing(0, 0, 10, 0, 0)).toBeCloseTo(Math.PI / 2, 6);
    expect(Math.abs(screenBearing(0, 0, 0, 10, 0))).toBeCloseTo(Math.PI, 6);
    // turned half round, north is behind
    expect(Math.abs(screenBearing(0, 0, 0, -10, Math.PI))).toBeCloseTo(Math.PI, 6);
  });

  it("leads to the nearest free fishing chair, skipping taken ones", () => {
    const c0 = FISHING_CHAIRS[0]!;
    const g = nearestFreeChairStand(c0.standX, c0.standZ, new Set());
    expect(g?.spot).toBe(0);
    const g2 = nearestFreeChairStand(c0.standX, c0.standZ, new Set([0]));
    expect(g2?.spot).not.toBe(0);
    expect(nearestFreeChairStand(0, 0, new Set(FISHING_CHAIRS.map((_, i) => i)))).toBeNull();
  });
});
