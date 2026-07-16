import { describe, it, expect } from "vitest";
import {
  MAZE_SEED,
  MAZE_GRID,
  MAZE_CELL,
  MAZE_WALL_T,
  MAZE_ORIGIN,
  MAZE_ZONE,
  MAZE_WALLS,
  MAZE_GOAL,
  MAZE_PORTAL,
  MAZE_RETURN,
  ESCAPE_COOLDOWN_MS,
  buildMazeWalls,
  isInMazeGoal,
  isOnMazePortal,
  pointInAABB,
  escapeAllowed,
  escapeMessage,
} from "./maze";
import { PLAYER_RADIUS } from "./worldMap";
import { isBlocked, type AABB } from "./collision";

// Reconstruct the cell graph from the DERIVED wall AABBs (not the internal grid):
// two adjacent cells are connected iff a radius-body fits at the midpoint of their
// centres. This tests the geometry the game actually collides against.
const cx = (i: number) => MAZE_ORIGIN.x + (i + 0.5) * MAZE_CELL;
const cz = (j: number) => MAZE_ORIGIN.z + (j + 0.5) * MAZE_CELL;
const connected = (x1: number, z1: number, x2: number, z2: number) =>
  !isBlocked((cx(x1) + cx(x2)) / 2, (cz(z1) + cz(z2)) / 2, PLAYER_RADIUS, MAZE_WALLS);

const ENTRANCE: [number, number] = [MAZE_GRID - 1, 7]; // east middle cell
const GOAL_CELL: [number, number] = [6, 6]; // corner of the 2×2 chamber

/** BFS the cell graph from `start`; returns the visited grid. */
function reachable(start: [number, number]): boolean[][] {
  const G = MAZE_GRID;
  const seen = Array.from({ length: G }, () => Array<boolean>(G).fill(false));
  const q: Array<[number, number]> = [start];
  seen[start[1]][start[0]] = true;
  while (q.length) {
    const [x, z] = q.shift()!;
    for (const [nx, nz] of [
      [x, z - 1],
      [x, z + 1],
      [x - 1, z],
      [x + 1, z],
    ] as Array<[number, number]>) {
      if (nx < 0 || nz < 0 || nx >= G || nz >= G || seen[nz][nx]) continue;
      if (connected(x, z, nx, nz)) {
        seen[nz][nx] = true;
        q.push([nx, nz]);
      }
    }
  }
  return seen;
}

describe("maze — generation invariants", () => {
  it("uses the validated parameters (seed 12, 15×15, 2.4m, 0.3m)", () => {
    expect(MAZE_SEED).toBe(12);
    expect(MAZE_GRID).toBe(15);
    expect(MAZE_CELL).toBe(2.4);
    expect(MAZE_WALL_T).toBe(0.3);
  });

  it("merges walls run-length to ≤150 AABBs (seed 12 → 114)", () => {
    expect(MAZE_WALLS.length).toBeLessThanOrEqual(150);
    expect(MAZE_WALLS.length).toBe(114);
  });

  it("is deterministic: the same seed rebuilds byte-identical AABBs", () => {
    expect(buildMazeWalls(MAZE_SEED)).toEqual(buildMazeWalls(MAZE_SEED));
    expect(buildMazeWalls(MAZE_SEED)).toEqual([...MAZE_WALLS]);
  });

  it("gives a DIFFERENT layout for a different seed (PRNG actually drives it)", () => {
    expect(buildMazeWalls(MAZE_SEED + 1)).not.toEqual([...MAZE_WALLS]);
  });

  it("has only well-formed wall AABBs (min < max on both axes)", () => {
    for (const w of MAZE_WALLS) {
      expect(w.maxX).toBeGreaterThan(w.minX);
      expect(w.maxZ).toBeGreaterThan(w.minZ);
    }
  });

  it("fits the maze grid exactly into the 36×36 zone", () => {
    expect(MAZE_ZONE.maxX - MAZE_ZONE.minX).toBeCloseTo(MAZE_GRID * MAZE_CELL, 9);
    expect(MAZE_ZONE.maxZ - MAZE_ZONE.minZ).toBeCloseTo(MAZE_GRID * MAZE_CELL, 9);
  });
});

describe("maze — reachability + corridor width", () => {
  it("reaches EVERY cell from the entrance (perfect connectivity)", () => {
    const seen = reachable(ENTRANCE);
    let unreached = 0;
    for (let z = 0; z < MAZE_GRID; z++) for (let x = 0; x < MAZE_GRID; x++) if (!seen[z][x]) unreached++;
    expect(unreached).toBe(0);
  });

  it("reaches the goal chamber from the entrance", () => {
    expect(reachable(ENTRANCE)[GOAL_CELL[1]][GOAL_CELL[0]]).toBe(true);
  });

  it("keeps corridors ≥ 2·PLAYER_RADIUS wide (a body fits in every cell)", () => {
    expect(MAZE_CELL - MAZE_WALL_T).toBeGreaterThanOrEqual(2 * PLAYER_RADIUS);
    for (let z = 0; z < MAZE_GRID; z++) {
      for (let x = 0; x < MAZE_GRID; x++) {
        expect(isBlocked(cx(x), cz(z), PLAYER_RADIUS, MAZE_WALLS)).toBe(false);
      }
    }
  });

  it("opens the east entrance at z≈0 (no wall overlaps the door gap)", () => {
    // The middle-row east opening is walkable …
    expect(isBlocked(MAZE_ZONE.maxX, 0, PLAYER_RADIUS, MAZE_WALLS)).toBe(false);
    // … while the east wall off the opening (z = 8) is solid.
    expect(isBlocked(MAZE_ZONE.maxX, 8, PLAYER_RADIUS, MAZE_WALLS)).toBe(true);
  });
});

describe("maze — goal / portal / return", () => {
  const overlaps = (a: AABB, b: AABB) =>
    a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

  it("places goal and portal inside the maze zone, not overlapping each other", () => {
    for (const box of [MAZE_GOAL, MAZE_PORTAL]) {
      expect(box.minX).toBeGreaterThanOrEqual(MAZE_ZONE.minX);
      expect(box.maxX).toBeLessThanOrEqual(MAZE_ZONE.maxX);
      expect(box.minZ).toBeGreaterThanOrEqual(MAZE_ZONE.minZ);
      expect(box.maxZ).toBeLessThanOrEqual(MAZE_ZONE.maxZ);
    }
    expect(overlaps(MAZE_GOAL, MAZE_PORTAL)).toBe(false);
  });

  it("keeps goal and portal clear of every maze wall", () => {
    for (const w of MAZE_WALLS) {
      expect(overlaps(MAZE_GOAL, w)).toBe(false);
      expect(overlaps(MAZE_PORTAL, w)).toBe(false);
    }
  });

  it("returns to the lounge side of the door (east of the maze, not the maze)", () => {
    expect(MAZE_RETURN.x).toBeGreaterThan(MAZE_ZONE.maxX); // x=-28 > -30
  });

  it("point-in-AABB helpers agree with the boxes", () => {
    expect(isInMazeGoal(-49.2, -1.2)).toBe(true);
    expect(isInMazeGoal(0, 0)).toBe(false);
    expect(isOnMazePortal(-49.2, 0.5)).toBe(true);
    expect(isOnMazePortal(-49.2, -1.2)).toBe(false); // the goal, not the portal
    expect(pointInAABB(MAZE_GOAL.minX, MAZE_GOAL.minZ, MAZE_GOAL)).toBe(true);
  });
});

describe("maze — escape cooldown + message (clock-injected)", () => {
  it("allows the first escape and re-allows only after the cooldown", () => {
    expect(escapeAllowed(Number.NEGATIVE_INFINITY, 0)).toBe(true); // first ever
    const last = 1_000_000;
    expect(escapeAllowed(last, last)).toBe(false); // immediate repeat
    expect(escapeAllowed(last, last + ESCAPE_COOLDOWN_MS - 1)).toBe(false);
    expect(escapeAllowed(last, last + ESCAPE_COOLDOWN_MS)).toBe(true); // exactly at the boundary
  });

  it("uses a 30-second cooldown", () => {
    expect(ESCAPE_COOLDOWN_MS).toBe(30_000);
  });

  it("formats the Korean escape notice with the nickname", () => {
    // Emoji kept out of the assertion (\uXXXX test hygiene); check the Korean body.
    expect(escapeMessage("케이슬")).toContain("케이슬님이 미로를 탈출했습니다!");
  });
});
