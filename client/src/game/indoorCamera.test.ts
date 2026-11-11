import { describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { CAMERA, HEAD_HEIGHT } from "./constants";
import {
  HALL_CAMERA_LIMIT,
  indoorCameraClamp,
  limitedDistance,
  limitedY,
  limitsDiffer,
  overviewAllowed,
  type CameraLimit,
} from "./indoorCamera";
import { MAZE_CAMERA_LIMIT, MAZE_CAM_MAX_DISTANCE, MAZE_CAM_MAX_Y, cappedCameraY, cappedFollowDistance } from "./mazeCamera";

const EPS = 1e-9;

/** The camera spot CameraRig asks for before any limit: `distance` behind the head at (yaw, pitch). */
function wanted(distance: number, pitch: number, yaw: number, fx: number, fz: number) {
  const horiz = distance * Math.cos(pitch);
  const height = distance * Math.sin(pitch);
  return {
    desired: { x: fx + horiz * Math.sin(yaw), y: HEAD_HEIGHT + height, z: fz + horiz * Math.cos(yaw) },
    target: { x: fx, y: HEAD_HEIGHT, z: fz },
  };
}

describe("HALL_CAMERA_LIMIT", () => {
  it("is derived from the enlarged B memorial hall ceiling, keeps overview off and has no distance cap", () => {
    expect({ ...HALL_CAMERA_LIMIT }).toEqual({ maxY: 4.1, overview: false });
    expect(HALL_CAMERA_LIMIT.maxDistance).toBeUndefined();
  });

  it("keeps the camera under the hall's ceiling", () => {
    expect(HALL_CAMERA_LIMIT.maxY).toBeLessThan(VILLAGE_LAYOUT.memorial.interior.ceilingHeight);
  });
});

describe("indoorCameraClamp — the hall never lets the camera reach the ceiling", () => {
  it("every pitch 0..1.2 and zoom 2.5..18 (and the 1.6x portrait pull-back) stays at y <= maxY, never farther than asked", () => {
    const yaws = [0, 0.7, Math.PI / 2, 2.4, Math.PI, -1.3];
    let swept = 0;
    for (let pitch = 0; pitch <= CAMERA.maxPitch + 1e-9; pitch += 0.05) {
      for (let zoom = CAMERA.minDistance; zoom <= CAMERA.maxDistance * 1.6 + 1e-9; zoom += 0.5) {
        for (const yaw of yaws) {
          const { desired, target } = wanted(zoom, pitch, yaw, 300, 2);
          const c = indoorCameraClamp(desired, target, HALL_CAMERA_LIMIT);
          expect(c.y).toBeLessThanOrEqual(HALL_CAMERA_LIMIT.maxY + EPS);
          expect(Math.hypot(c.x - target.x, c.y - target.y, c.z - target.z)).toBeLessThanOrEqual(zoom + EPS);
          swept++;
        }
      }
    }
    expect(swept).toBeGreaterThan(1000);
  });

  it("no zoom-in at the door: the hall keeps the player's horizontal reach for every zoom (only the height is capped)", () => {
    for (const zoom of [CAMERA.minDistance, 6, 9.5, CAMERA.maxDistance]) {
      const { desired, target } = wanted(zoom, 0.35, 0.7, 300, 2);
      const c = indoorCameraClamp(desired, target, HALL_CAMERA_LIMIT);
      expect(Math.hypot(c.x - target.x, c.z - target.z)).toBeCloseTo(zoom * Math.cos(0.35), 9);
      expect(limitedDistance(zoom, HALL_CAMERA_LIMIT)).toBe(zoom);
    }
  });

  it("the extremes: max pitch at max zoom-out is pinned under the ceiling, in front of the player's back", () => {
    const { desired, target } = wanted(CAMERA.maxDistance, CAMERA.maxPitch, 0, 300, 0);
    expect(desired.y).toBeGreaterThan(10); // unclamped, it is far above the 3.4 m ceiling
    const c = indoorCameraClamp(desired, target, HALL_CAMERA_LIMIT);
    expect(c.y).toBeCloseTo(HALL_CAMERA_LIMIT.maxY, 9);
    expect(c.z).toBeGreaterThan(target.z); // still behind the player (yaw 0 -> +z), never over the head
  });

  it("leaves a camera already inside the limit exactly where it was", () => {
    const { desired, target } = wanted(2.5, 0.35, 1.1, 300, 1);
    const c = indoorCameraClamp(desired, target, HALL_CAMERA_LIMIT);
    expect(c.x).toBeCloseTo(desired.x, 12);
    expect(c.y).toBeCloseTo(desired.y, 12);
    expect(c.z).toBeCloseTo(desired.z, 12);
  });

  it("keeps the direction: a shortened arm lies on the same ray from the player's head", () => {
    const { desired, target } = wanted(9, 0.5, 0.9, 300, 1);
    const c = indoorCameraClamp(desired, target, { maxY: 99, maxDistance: 3.6, overview: false });
    const k = 3.6 / 9;
    expect(c.x - target.x).toBeCloseTo((desired.x - target.x) * k, 9);
    expect(c.y - target.y).toBeCloseTo((desired.y - target.y) * k, 9);
    expect(c.z - target.z).toBeCloseTo((desired.z - target.z) * k, 9);
  });

  it("does not move the camera at engage 0, and eases halfway at 0.5", () => {
    const { desired, target } = wanted(18, 1.2, 0.4, 300, 0);
    const off = indoorCameraClamp(desired, target, HALL_CAMERA_LIMIT, 0);
    expect(off.x).toBeCloseTo(desired.x, 12);
    expect(off.y).toBeCloseTo(desired.y, 12);
    expect(off.z).toBeCloseTo(desired.z, 12);
    const half = indoorCameraClamp(desired, target, HALL_CAMERA_LIMIT, 0.5);
    const full = indoorCameraClamp(desired, target, HALL_CAMERA_LIMIT, 1);
    expect(half.y).toBeLessThan(desired.y);
    expect(half.y).toBeGreaterThan(full.y);
  });

  it("writes into the `out` it is given (no allocation per frame) and never touches its inputs", () => {
    const { desired, target } = wanted(18, 1.2, 0.4, 300, 0);
    const before = { desired: { ...desired }, target: { ...target } };
    const out = { x: 0, y: 0, z: 0 };
    const res = indoorCameraClamp(desired, target, HALL_CAMERA_LIMIT, 1, out);
    expect(res).toBe(out);
    expect(desired).toEqual(before.desired);
    expect(target).toEqual(before.target);
  });

  it("a camera sitting on the head does not divide by zero", () => {
    const t = { x: 300, y: HEAD_HEIGHT, z: 0 };
    const c = indoorCameraClamp({ ...t }, t, HALL_CAMERA_LIMIT);
    expect(c).toEqual(t);
  });
});

describe("indoorCameraClamp — the maze gives the same results as before (golden values)", () => {
  it("is the maze's 6 m / 3.5 m cap, and the maze keeps its overview", () => {
    expect({ ...MAZE_CAMERA_LIMIT }).toEqual({ maxY: MAZE_CAM_MAX_Y, maxDistance: MAZE_CAM_MAX_DISTANCE, overview: true });
    expect(MAZE_CAM_MAX_Y).toBe(3.5);
    expect(MAZE_CAM_MAX_DISTANCE).toBe(6);
  });

  // Values computed with the pre-generalisation formulas of CameraRig (cappedFollowDistance, then cappedCameraY).
  const golden: Array<{ d: number; pitch: number; yaw: number; fx: number; fz: number; e: number; x: number; y: number; z: number }> = [
    { d: 18, pitch: 1.2, yaw: 0.7, fx: -48, fz: 3, e: 1, x: -46.59937635275037, y: 3.5, z: 4.662878985080608 },
    { d: 18, pitch: 0.35, yaw: 0.7, fx: -48, fz: 3, e: 1, x: -44.3690369008516, y: 3.457386844732708, z: 7.310831282217317 },
    { d: 10, pitch: 0.35, yaw: -1.1, fx: -40, fz: -5, e: 0.5, x: -46.69740700424369, y: 3.8215912298218053, z: -1.591233447035251 },
    { d: 28.8, pitch: 1.2, yaw: 2.0, fx: -40, fz: -5, e: 1, x: -38.02305415758417, y: 3.5, z: -5.904764199342763 },
    { d: 6, pitch: 0.35, yaw: 0, fx: 0, fz: 0, e: 1, x: 0, y: 3.457386844732708, z: 5.636236277084273 },
  ];
  for (const g of golden) {
    it(`distance ${g.d}, pitch ${g.pitch}, engage ${g.e}`, () => {
      const { desired, target } = wanted(g.d, g.pitch, g.yaw, g.fx, g.fz);
      const c = indoorCameraClamp(desired, target, MAZE_CAMERA_LIMIT, g.e);
      expect(c.x).toBeCloseTo(g.x, 9);
      expect(c.y).toBeCloseTo(g.y, 9);
      expect(c.z).toBeCloseTo(g.z, 9);
    });
  }

  it("agrees with the maze's own scalar caps over a sweep of pitch, zoom and engagement", () => {
    for (let pitch = -0.1; pitch <= 1.2 + 1e-9; pitch += 0.1) {
      for (let zoom = 2.5; zoom <= 28.8; zoom += 1.3) {
        for (const e of [0, 0.25, 0.5, 1]) {
          const { desired, target } = wanted(zoom, pitch, 0.6, -45, 2);
          const c = indoorCameraClamp(desired, target, MAZE_CAMERA_LIMIT, e);
          const d = cappedFollowDistance(zoom, e);
          expect(c.x).toBeCloseTo(-45 + d * Math.cos(pitch) * Math.sin(0.6), 9);
          expect(c.z).toBeCloseTo(2 + d * Math.cos(pitch) * Math.cos(0.6), 9);
          expect(c.y).toBeCloseTo(cappedCameraY(HEAD_HEIGHT + d * Math.sin(pitch), e), 9);
        }
      }
    }
  });

  it("the scalar caps are the same functions the clamp is built from", () => {
    expect(limitedDistance(18, MAZE_CAMERA_LIMIT, 1)).toBe(cappedFollowDistance(18, 1));
    expect(limitedDistance(18, MAZE_CAMERA_LIMIT, 0.5)).toBe(cappedFollowDistance(18, 0.5));
    expect(limitedY(10, MAZE_CAMERA_LIMIT, 1)).toBe(cappedCameraY(10, 1));
    expect(limitedY(10, MAZE_CAMERA_LIMIT, 0.5)).toBe(cappedCameraY(10, 0.5));
  });
});

describe("overviewAllowed — the top-down map", () => {
  it("is refused in the hall, allowed in the maze and where there is no limit", () => {
    expect(overviewAllowed(HALL_CAMERA_LIMIT)).toBe(false);
    expect(overviewAllowed(MAZE_CAMERA_LIMIT)).toBe(true);
    expect(overviewAllowed(undefined)).toBe(true);
  });
});

describe("limitsDiffer — crossing a door into or out of a limited place", () => {
  const other: CameraLimit = { maxY: 2, maxDistance: 2, overview: true };
  it("is true when one side is limited and the other not, or the limits are different", () => {
    expect(limitsDiffer(undefined, HALL_CAMERA_LIMIT)).toBe(true);
    expect(limitsDiffer(HALL_CAMERA_LIMIT, undefined)).toBe(true);
    expect(limitsDiffer(HALL_CAMERA_LIMIT, other)).toBe(true);
  });
  it("is false for two places with the same (or no) limit, so a gate opening is not a snap", () => {
    expect(limitsDiffer(undefined, undefined)).toBe(false);
    expect(limitsDiffer(HALL_CAMERA_LIMIT, HALL_CAMERA_LIMIT)).toBe(false);
  });
});
