import { describe, it, expect } from "vitest";
import {
  OBSTACLES,
  WALLS,
  FURNITURE,
  FURNITURE_MODELS,
  SPAWN_POINT,
  SPAWN_JITTER,
  PLAYER_RADIUS,
  WORLD_BOUNDS,
  ZONES,
  furnitureObstacle,
} from "./worldMap";
import { isBlocked, resolveCollision } from "./collision";

function inside(box: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number) {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

describe("worldMap — structure", () => {
  it("has well-formed obstacles (min < max on both axes)", () => {
    for (const o of OBSTACLES) {
      expect(o.maxX).toBeGreaterThan(o.minX);
      expect(o.maxZ).toBeGreaterThan(o.minZ);
    }
  });

  it("derives OBSTACLES = solid furniture + walls + screen (no others)", () => {
    const solidFurniture = FURNITURE.filter((p) => FURNITURE_MODELS[p.model].solid).length;
    expect(OBSTACLES.length).toBe(solidFurniture + WALLS.length + 1);
  });

  it("excludes non-solid decor (rug, lamp) from obstacles", () => {
    // No obstacle is ever derived from a non-solid model …
    for (const p of FURNITURE) {
      if (FURNITURE_MODELS[p.model].solid) continue;
      const foot = furnitureObstacle(p);
      expect(OBSTACLES).not.toContainEqual(foot);
    }
    // … and a point under the rug but clear of the (solid) coffee table on it is walkable.
    expect(isBlocked(-23.5, 0.8, PLAYER_RADIUS, OBSTACLES)).toBe(false);
  });
});

describe("worldMap — spawn", () => {
  it("spawns inside the lounge and world bounds", () => {
    expect(inside(ZONES.lounge, SPAWN_POINT.x, SPAWN_POINT.z)).toBe(true);
    expect(inside(WORLD_BOUNDS, SPAWN_POINT.x, SPAWN_POINT.z)).toBe(true);
  });

  it("keeps the whole spawn jitter disk (+player radius) clear of obstacles", () => {
    // A circle covering the jitter disk plus the player's body must hit nothing.
    const clearance = SPAWN_JITTER + PLAYER_RADIUS;
    expect(isBlocked(SPAWN_POINT.x, SPAWN_POINT.z, clearance, OBSTACLES, 0)).toBe(false);
  });
});

describe("worldMap — door gap is walkable", () => {
  it("lets a player pass through the divider at z = 0", () => {
    for (let x = -2; x <= 2; x += 0.25) {
      expect(isBlocked(x, 0, PLAYER_RADIUS, OBSTACLES)).toBe(false);
    }
  });

  it("keeps the divider solid away from the door (e.g. z = -8)", () => {
    expect(isBlocked(0, -8, PLAYER_RADIUS, OBSTACLES)).toBe(true);
  });

  it("has a clear straight corridor from the lounge through the door into the hall (z = 0)", () => {
    for (let x = -15; x <= 20; x += 0.5) {
      expect(isBlocked(x, 0, PLAYER_RADIUS, OBSTACLES)).toBe(false);
    }
  });
});

describe("worldMap — walls keep the player in", () => {
  it("blocks a body pressed against each outer bound", () => {
    expect(isBlocked(WORLD_BOUNDS.maxX, 0, PLAYER_RADIUS, OBSTACLES)).toBe(true); // east
    expect(isBlocked(WORLD_BOUNDS.minX, 0, PLAYER_RADIUS, OBSTACLES)).toBe(true); // west
    expect(isBlocked(0, WORLD_BOUNDS.minZ, PLAYER_RADIUS, OBSTACLES)).toBe(true); // south (in the hall/lounge corner is walled)
  });
});

describe("worldMap — E2E sofa collision (deterministic simulation)", () => {
  it("stops a player walking north into the test sofa OUTSIDE its footprint", () => {
    const sofa = FURNITURE.find((p) => p.model === "loungeSofa" && p.x === -15 && p.z === -7)!;
    const footprint = furnitureObstacle(sofa);

    // Simulate the E2E: hold 'w' (moves -Z) from spawn for ~3 s at 4 m/s, 50 ms steps.
    let pos: { x: number; z: number } = { x: SPAWN_POINT.x, z: SPAWN_POINT.z };
    for (let i = 0; i < 60; i++) {
      pos = resolveCollision(pos.x, pos.z, 0, -4 * 0.05, PLAYER_RADIUS, OBSTACLES);
    }

    // Walked a real distance toward the sofa …
    expect(pos.z).toBeLessThan(-5);
    // … but stopped SOUTH of (outside) the footprint — never passed through.
    expect(pos.z).toBeGreaterThan(footprint.maxZ);
    expect(inside(footprint, pos.x, pos.z)).toBe(false);
    // and it is resting ~one radius off the sofa face (proves collision stopped it).
    expect(pos.z).toBeCloseTo(footprint.maxZ + PLAYER_RADIUS, 6);
  });
});
