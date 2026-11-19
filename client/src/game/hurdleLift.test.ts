import { describe, it, expect } from "vitest";
import type { CameraBox } from "@caysonverse/shared/collision";
import { PARK_HURDLES } from "@caysonverse/shared/village/parkArea";
import { LOT_HURDLES, lotGeometryColliders } from "@caysonverse/shared/village/villageLots";
import { villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { HURDLE, hurdleLift, stepHurdleLift } from "./cameraCollision";

// A 1 m high, 2 m deep basin 3 m north of the avatar (the camera is south, behind the avatar: no hurdle between them).
const BOWL: CameraBox = { minX: -2, maxX: 2, minZ: -5, maxZ: -3, height: 1 };

describe("hurdleLift: the camera rises over a low solid between it and the avatar", () => {
  it("nothing in the way: no lift", () => {
    // avatar at the origin, camera south of it (z +6): the bowl is behind the avatar, not between
    expect(hurdleLift(0, 0, 0, 0, 3, 6, [BOWL])).toBe(0);
    expect(hurdleLift(0, 0, 0, 0, 3, 6, [])).toBe(0);
  });
  it("a bowl between: the camera at a low height is raised until the line to the hip clears the rim", () => {
    // camera north of the bowl at z -8, avatar at z -1 (2 m south of the bowl's near face z -3), camera only 1.8 m high
    const lift = hurdleLift(0, -1, 0, 0, 1.8, -8, [BOWL]);
    expect(lift).toBeGreaterThan(0);
    const camY = 1.8 + lift;
    // at the bowl's near face (t0 = 2/7 along the line) the line is above the rim (+ clearance), unless the cap bound the lift
    const t0 = 2 / 7;
    const y = HURDLE.bodyY + (camY - HURDLE.bodyY) * t0;
    if (lift < HURDLE.maxLift) expect(y).toBeGreaterThanOrEqual(1 + HURDLE.clear - 1e-9);
  });
  it("a high camera needs no lift", () => {
    expect(hurdleLift(0, -1, 0, 0, 9, -8, [BOWL])).toBe(0);
  });
  it("a bowl hugging the avatar is capped (finite lift)", () => {
    const lift = hurdleLift(0, -2.95, 0, 0, 1.5, -9, [BOWL]);
    expect(lift).toBeLessThanOrEqual(HURDLE.maxLift);
    expect(lift).toBeGreaterThan(0);
  });
  it("standing in the box (on its steps) sends the camera nowhere", () => {
    expect(hurdleLift(0, -4, 0, 0, 1.5, -9, [BOWL])).toBe(0);
  });
  it("a segment that never reaches the box or passes beside it is clear", () => {
    expect(hurdleLift(6, -1, 0, 6, 1.5, -8, [BOWL])).toBe(0);
  });
  it("is eased: up fast, down slowly", () => {
    expect(stepHurdleLift(0, 2, 0.1)).toBeCloseTo(0.8);
    expect(stepHurdleLift(2, 0, 0.1)).toBeCloseTo(1.7);
    expect(stepHurdleLift(0.5, 0.6, 1)).toBe(0.6);
  });
});

describe("the maps' hurdles", () => {
  it("the village geometry carries the lots' low solids with their real heights", () => {
    const h = villageGeometry.hurdles ?? [];
    expect(h.length).toBe(Object.keys(LOT_HURDLES).length);
    expect(h.length).toBe(lotGeometryColliders().hurdles.length);
    expect(h.some((b) => b.height === 1.5)).toBe(true); // the temple's stone wall
  });
  it("a hurdle is never also a camera box (those shorten the arm)", () => {
    const cams = new Set(villageGeometry.cameraBoxes);
    for (const b of villageGeometry.hurdles ?? []) expect(cams.has(b)).toBe(false);
  });
  it("the park's fountain basin is a hurdle", () => {
    expect(PARK_HURDLES.some((b) => b.height === 1.1)).toBe(true);
  });
});
