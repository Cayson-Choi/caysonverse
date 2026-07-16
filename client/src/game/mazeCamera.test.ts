import { describe, it, expect } from "vitest";
import { ZONES } from "@caysonverse/shared/worldMap";
import {
  MAZE_CAM_MAX_DISTANCE,
  MAZE_CAM_MAX_Y,
  MAZE_CAP_ENGAGE_SEC,
  isInMaze,
  stepMazeCapEngage,
  cappedFollowDistance,
  cappedCameraY,
} from "./mazeCamera";

describe("mazeCamera — zone test", () => {
  it("is true inside the maze zone, false in the lounge/hall", () => {
    const c = { x: (ZONES.maze.minX + ZONES.maze.maxX) / 2, z: 0 };
    expect(isInMaze(c.x, c.z)).toBe(true);
    expect(isInMaze(-15, 0)).toBe(false); // lounge spawn
    expect(isInMaze(15, 0)).toBe(false); // lecture hall
  });

  it("includes the zone edges", () => {
    expect(isInMaze(ZONES.maze.minX, 0)).toBe(true);
    expect(isInMaze(ZONES.maze.maxX, ZONES.maze.maxZ)).toBe(true);
    expect(isInMaze(ZONES.maze.maxX + 0.01, 0)).toBe(false);
  });
});

describe("mazeCamera — cap engagement lerp", () => {
  it("eases toward 1 inside over MAZE_CAP_ENGAGE_SEC and clamps at 1", () => {
    const half = stepMazeCapEngage(0, true, MAZE_CAP_ENGAGE_SEC / 2);
    expect(half).toBeCloseTo(0.5, 6);
    expect(stepMazeCapEngage(0, true, MAZE_CAP_ENGAGE_SEC)).toBe(1); // full step
    expect(stepMazeCapEngage(0.9, true, 1)).toBe(1); // big delta cannot overshoot
  });

  it("eases back toward 0 outside and clamps at 0", () => {
    expect(stepMazeCapEngage(1, false, MAZE_CAP_ENGAGE_SEC)).toBe(0);
    expect(stepMazeCapEngage(0.2, false, 1)).toBe(0);
  });

  it("holds when already at the target", () => {
    expect(stepMazeCapEngage(1, true, 0.1)).toBe(1);
    expect(stepMazeCapEngage(0, false, 0.1)).toBe(0);
  });
});

describe("mazeCamera — distance cap", () => {
  it("passes the distance through when disengaged", () => {
    expect(cappedFollowDistance(18, 0)).toBe(18);
  });

  it("clamps to the max when fully engaged", () => {
    expect(cappedFollowDistance(18, 1)).toBe(MAZE_CAM_MAX_DISTANCE);
  });

  it("lerps at partial engagement", () => {
    expect(cappedFollowDistance(18, 0.5)).toBeCloseTo((18 + MAZE_CAM_MAX_DISTANCE) / 2, 6);
  });

  it("leaves an already-close distance untouched at any engagement", () => {
    expect(cappedFollowDistance(4, 1)).toBe(4);
    expect(cappedFollowDistance(4, 0.5)).toBe(4);
  });

  it("caps even after a portrait pull-back multiplier (18 × 1.6 = 28.8)", () => {
    // aspectDistanceScale can push the effective distance well past 6; the cap
    // still pins it (this is applied to the ALREADY-scaled distance).
    expect(cappedFollowDistance(28.8, 1)).toBe(MAZE_CAM_MAX_DISTANCE);
  });
});

describe("mazeCamera — camera-height cap", () => {
  it("passes Y through when disengaged and clamps below the wall top when engaged", () => {
    expect(cappedCameraY(10, 0)).toBe(10);
    expect(cappedCameraY(10, 1)).toBe(MAZE_CAM_MAX_Y);
    expect(MAZE_CAM_MAX_Y).toBeLessThan(4); // below WALL_HEIGHT → cannot peek over
  });

  it("leaves a low camera untouched and lerps a high one", () => {
    expect(cappedCameraY(2, 1)).toBe(2);
    expect(cappedCameraY(10, 0.5)).toBeCloseTo((10 + MAZE_CAM_MAX_Y) / 2, 6);
  });
});
