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
  SEATS,
  SEAT_REACH,
  SEAT_YAW,
  furnitureObstacle,
  nearestFreeSeat,
} from "./worldMap";
import { MAZE_WALLS, MAZE_ZONE, MAZE_GOAL, MAZE_PORTAL, MAZE_RETURN } from "./maze";
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

  it("derives OBSTACLES = solid furniture + walls + screen + maze walls (no others)", () => {
    const solidFurniture = FURNITURE.filter((p) => FURNITURE_MODELS[p.model].solid).length;
    expect(OBSTACLES.length).toBe(solidFurniture + WALLS.length + 1 + MAZE_WALLS.length);
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

describe("worldMap — maze zone integration (v2-3 west extension)", () => {
  it("extends WORLD_BOUNDS west to the maze zone, lounge/hall unchanged", () => {
    expect(WORLD_BOUNDS.minX).toBe(MAZE_ZONE.minX); // derived, not a bumped literal
    expect(WORLD_BOUNDS.maxX).toBe(30);
    expect(ZONES.lounge).toEqual({ minX: -30, maxX: 0, minZ: -18, maxZ: 18 });
    expect(ZONES.lectureHall).toEqual({ minX: 0, maxX: 30, minZ: -18, maxZ: 18 });
    // The maze is a full 36×36 room west of the lounge.
    expect(ZONES.maze.maxX - ZONES.maze.minX).toBe(36);
    expect(ZONES.maze.maxZ - ZONES.maze.minZ).toBe(36);
    expect(ZONES.maze.maxX).toBe(-30); // its east wall == the lounge's west edge
  });

  it("joins the merged maze walls into OBSTACLES (single derivation)", () => {
    for (const w of MAZE_WALLS) expect(OBSTACLES).toContainEqual(w);
  });

  it("connects lounge⇄maze through the door at z≈0 (walk west through the opening)", () => {
    // From the lounge (x=-29) west through the door into the maze entrance cell
    // (centre ≈ x=-31.2) the path is clear — the maze's east wall opens at z≈0.
    for (let x = -29; x >= -31.2; x -= 0.3) {
      expect(isBlocked(x, 0, PLAYER_RADIUS, OBSTACLES)).toBe(false);
    }
  });

  it("keeps the lounge⇄maze wall solid away from the door (e.g. z = 8)", () => {
    // A body pressed against the maze's east wall off the opening is blocked —
    // the only way in is the z≈0 door.
    expect(isBlocked(-30, 8, PLAYER_RADIUS, OBSTACLES)).toBe(true);
  });

  it("keeps the whole spawn jitter disk clear after the west extension", () => {
    const clearance = SPAWN_JITTER + PLAYER_RADIUS;
    expect(isBlocked(SPAWN_POINT.x, SPAWN_POINT.z, clearance, OBSTACLES, 0)).toBe(false);
  });

  it("puts goal + portal inside the maze zone, on clear chamber floor", () => {
    for (const box of [MAZE_GOAL, MAZE_PORTAL]) {
      expect(box.minX).toBeGreaterThanOrEqual(MAZE_ZONE.minX);
      expect(box.maxX).toBeLessThanOrEqual(MAZE_ZONE.maxX);
      expect(box.minZ).toBeGreaterThanOrEqual(MAZE_ZONE.minZ);
      expect(box.maxZ).toBeLessThanOrEqual(MAZE_ZONE.maxZ);
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      expect(isBlocked(cx, cz, PLAYER_RADIUS, OBSTACLES)).toBe(false);
    }
  });

  it("teleports returns to a clear lounge spot near the door (not the spawn)", () => {
    expect(isBlocked(MAZE_RETURN.x, MAZE_RETURN.z, PLAYER_RADIUS, OBSTACLES)).toBe(false);
    // In the lounge, east of the maze wall, and NOT the spawn point.
    expect(MAZE_RETURN.x).toBeGreaterThan(-30);
    expect(MAZE_RETURN.x).toBeLessThan(0);
    expect(Math.hypot(MAZE_RETURN.x - SPAWN_POINT.x, MAZE_RETURN.z - SPAWN_POINT.z)).toBeGreaterThan(2);
  });

  it("blocks a body pushed into a maze wall (server drop / client slide truth)", () => {
    // Straight west from the entrance cell centre (-31.2, 0) is a wall (x≈-32.4);
    // a body there overlaps it — the move validator would drop the tunnel attempt.
    expect(isBlocked(-32.4, 0, PLAYER_RADIUS, OBSTACLES)).toBe(true);
  });
});

describe("worldMap — walls keep the player in", () => {
  it("blocks a body pressed against each outer bound", () => {
    expect(isBlocked(WORLD_BOUNDS.maxX, 0, PLAYER_RADIUS, OBSTACLES)).toBe(true); // east
    expect(isBlocked(WORLD_BOUNDS.minX, 0, PLAYER_RADIUS, OBSTACLES)).toBe(true); // west
    expect(isBlocked(0, WORLD_BOUNDS.minZ, PLAYER_RADIUS, OBSTACLES)).toBe(true); // south (in the hall/lounge corner is walled)
  });
});

describe("worldMap — seats (derived from the classroom placement)", () => {
  it("derives exactly 13 seats (12 students + 1 instructor)", () => {
    expect(SEATS.length).toBe(13);
  });

  it("places every seat inside the lecture-hall zone", () => {
    for (const s of SEATS) {
      expect(inside(ZONES.lectureHall, s.x, s.z)).toBe(true);
    }
  });

  it("faces every seat toward the screen (+X): player-yaw = +PI/2", () => {
    // Player-yaw convention is atan2(dirX, dirZ) with the model facing +Z at yaw 0
    // (see client MODEL_FACING_OFFSET/worldDirection). Facing +X ⇒ atan2(1,0) = +PI/2.
    // NOT the furniture chair's rotY (-PI/2), which uses a different convention.
    for (const s of SEATS) {
      expect(s.yaw).toBeCloseTo(Math.PI / 2, 10);
    }
    expect(SEAT_YAW).toBeCloseTo(Math.PI / 2, 10);
  });

  it("keeps every dismount point clear of all obstacles (chair, desk, walls)", () => {
    for (const s of SEATS) {
      expect(isBlocked(s.standX, s.standZ, PLAYER_RADIUS, OBSTACLES)).toBe(false);
    }
  });

  it("keeps every dismount point inside the world bounds (inset by the body radius)", () => {
    for (const s of SEATS) {
      expect(s.standX).toBeGreaterThanOrEqual(WORLD_BOUNDS.minX + PLAYER_RADIUS);
      expect(s.standX).toBeLessThanOrEqual(WORLD_BOUNDS.maxX - PLAYER_RADIUS);
      expect(s.standZ).toBeGreaterThanOrEqual(WORLD_BOUNDS.minZ + PLAYER_RADIUS);
      expect(s.standZ).toBeLessThanOrEqual(WORLD_BOUNDS.maxZ - PLAYER_RADIUS);
    }
  });

  it("keeps each seat↔dismount distance sane (0.5..2 m) and within reach", () => {
    for (const s of SEATS) {
      const d = Math.hypot(s.x - s.standX, s.z - s.standZ);
      expect(d).toBeGreaterThanOrEqual(0.5);
      expect(d).toBeLessThanOrEqual(2);
      // A player standing at the dismount point can always sit back down.
      expect(d).toBeLessThanOrEqual(SEAT_REACH);
    }
  });

  it("dismounts the instructor to the EAST (its desk is to the west), students to the west", () => {
    // The 12 students dismount west (-X, aisle); the instructor's desk sits west of
    // its chair, so its dismount must be east (+X) — proving 'away from the desk'.
    const students = SEATS.slice(0, 12);
    for (const s of students) expect(s.standX).toBeLessThan(s.x);
    const instructor = SEATS[12];
    expect(instructor.standX).toBeGreaterThan(instructor.x);
  });

  it("puts each seat on the same chairDesk footprint the furniture renders", () => {
    // Every seat centre must coincide with a real chairDesk placement (single truth).
    const chairs = FURNITURE.filter((p) => p.model === "chairDesk");
    for (const s of SEATS) {
      const match = chairs.find((c) => Math.abs(c.x - s.x) < 1e-9 && Math.abs(c.z - s.z) < 1e-9);
      expect(match).toBeDefined();
    }
  });
});

describe("worldMap — nearestFreeSeat (client proximity, pure)", () => {
  const none = () => false;

  it("returns null when no seat is within reach", () => {
    expect(nearestFreeSeat(SPAWN_POINT.x, SPAWN_POINT.z, none)).toBeNull();
  });

  it("returns the seat whose dismount point you are standing on", () => {
    const target = 5;
    const s = SEATS[target];
    expect(nearestFreeSeat(s.standX, s.standZ, none)).toBe(target);
  });

  it("skips an occupied seat and offers the next nearest free one", () => {
    const target = 5;
    const s = SEATS[target];
    // Standing on seat 5's dismount but seat 5 is taken → no OTHER seat is in reach.
    expect(nearestFreeSeat(s.standX, s.standZ, (i) => i === target)).toBeNull();
  });

  it("never offers a seat beyond SEAT_REACH", () => {
    const s = SEATS[0];
    // A point exactly SEAT_REACH + a hair past the seat centre is out of reach.
    expect(nearestFreeSeat(s.x - (SEAT_REACH + 0.01), s.z, none)).toBeNull();
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
