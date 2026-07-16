/**
 * Deterministic fixed-maze geometry — the SINGLE source the client render, the
 * client collision resolver, and the server move validation all derive from
 * (mirrors worldMap.ts's single-source discipline). Browser-safe: it imports
 * ONLY the `AABB` type (no THREE, no @colyseus/schema, no clocks), so it is
 * fully unit-testable and safe in the client bundle.
 *
 * The maze zone is a 36 m × 36 m room bolted onto the WEST edge of the lounge
 * (its east wall coincides with the lounge's west edge at x = -30). A perfect
 * maze is carved by a seeded recursive backtracker; a 2×2 goal chamber is opened
 * at the centre (holding the escape GOAL trigger and the return PORTAL pad); the
 * east wall has ONE opening at the middle row, aligned with the lounge door at
 * z ≈ 0. Wall runs are merged run-length into world-space AABBs (≤150; seed 12
 * yields 114) so both collision and render stay cheap.
 *
 * The algorithm was prototyped/validated separately, then ported here verbatim
 * (mulberry32 PRNG → recursive backtracker → centre chamber → east entrance →
 * run-length merge). The determinism/reachability/merge-count invariants are
 * pinned by maze.test.ts.
 */

import type { AABB } from "./collision";

/** Deterministic maze seed (validated: 137-cell solution, 25 dead ends, 114 walls). */
export const MAZE_SEED = 12;

/** Cells per side (15 × 15 grid). */
export const MAZE_GRID = 15;

/** Metres per cell — corridor ≈ CELL − WALL_T = 2.1 m (≥ 2·PLAYER_RADIUS). */
export const MAZE_CELL = 2.4;

/** Wall thickness (m); walls are centred on the grid lines. */
export const MAZE_WALL_T = 0.3;

/** Full side length of the maze zone (m). */
export const MAZE_SIZE = MAZE_GRID * MAZE_CELL; // 36

/**
 * Min (SW) corner of the maze zone in world space. The maze's EAST wall lands on
 * x = -30 (the lounge's west edge), so the zone spans x ∈ [-66, -30]. Z matches
 * the lounge/hall depth (z ∈ [-18, 18]).
 */
export const MAZE_ORIGIN = { x: -30 - MAZE_SIZE, z: -18 } as const; // { x: -66, z: -18 }

/** The maze zone AABB (consumed by worldMap ZONES.maze + the client camera cap). */
export const MAZE_ZONE: AABB = {
  minX: MAZE_ORIGIN.x,
  maxX: MAZE_ORIGIN.x + MAZE_SIZE,
  minZ: MAZE_ORIGIN.z,
  maxZ: MAZE_ORIGIN.z + MAZE_SIZE,
};

/** Grid row of the east entrance / goal chamber — the middle row, aligned to z ≈ 0. */
const ENTRANCE_ROW = 7;

// The 2×2 goal chamber occupies the centre cells [6,7] × [6,7]; its four internal
// walls are opened in `generate` so it is one open room holding the goal + portal.

// ─────────────────────────── Maze generation (pure) ───────────────────────────

/** mulberry32 — a tiny deterministic PRNG (identical seed ⇒ identical stream). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The raw wall grid. `H[cz][cx]` = a wall on the north side of cell (cx,cz)
 * (a horizontal segment, one per (row line cz, column cx)); `V[cz][cx]` = a wall
 * on the west side (a vertical segment). Boundary lines use the extra row/col.
 */
interface MazeGrid {
  H: boolean[][]; // (GRID+1) rows × GRID cols
  V: boolean[][]; // GRID rows × (GRID+1) cols
}

/** Carve the maze for `seed` (recursive backtracker + centre chamber + east door). */
function generate(seed: number): MazeGrid {
  const G = MAZE_GRID;
  const rnd = mulberry32(seed);
  const H: boolean[][] = Array.from({ length: G + 1 }, () => Array(G).fill(true));
  const V: boolean[][] = Array.from({ length: G }, () => Array(G + 1).fill(true));
  const visited: boolean[][] = Array.from({ length: G }, () => Array(G).fill(false));

  // Open the 2×2 goal chamber's internal walls (it is one open room, not carved).
  V[6][7] = false;
  V[7][7] = false;
  H[7][6] = false;
  H[7][7] = false;

  const stack: Array<[number, number]> = [[0, 0]];
  visited[0][0] = true;
  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    const nbrs: Array<[number, number, "N" | "S" | "W" | "E"]> = [];
    if (cz > 0 && !visited[cz - 1][cx]) nbrs.push([cx, cz - 1, "N"]);
    if (cz < G - 1 && !visited[cz + 1][cx]) nbrs.push([cx, cz + 1, "S"]);
    if (cx > 0 && !visited[cz][cx - 1]) nbrs.push([cx - 1, cz, "W"]);
    if (cx < G - 1 && !visited[cz][cx + 1]) nbrs.push([cx + 1, cz, "E"]);
    if (!nbrs.length) {
      stack.pop();
      continue;
    }
    const [nx, nz, dir] = nbrs[Math.floor(rnd() * nbrs.length)];
    if (dir === "N") H[cz][cx] = false;
    if (dir === "S") H[cz + 1][cx] = false;
    if (dir === "W") V[cz][cx] = false;
    if (dir === "E") V[cz][cx + 1] = false;
    visited[nz][nx] = true;
    stack.push([nx, nz]);
  }

  // East-side entrance: open the middle-row east boundary wall (aligns to z ≈ 0).
  V[ENTRANCE_ROW][G] = false;
  return { H, V };
}

// ─────────────────────── Grid → world-space AABB derivation ────────────────────

/** World X of the vertical grid line `i` (0..GRID). */
function lineX(i: number): number {
  return MAZE_ORIGIN.x + i * MAZE_CELL;
}
/** World Z of the horizontal grid line `j` (0..GRID). */
function lineZ(j: number): number {
  return MAZE_ORIGIN.z + j * MAZE_CELL;
}

const HT = MAZE_WALL_T / 2;

/**
 * Run-length-merge the wall grid into world-space AABBs: consecutive collinear
 * segments become ONE box. Boxes overhang by HALF the wall thickness at each end
 * so perpendicular walls overlap cleanly at corners (watertight; overlaps are
 * harmless for both collision and render). Deterministic given the grid.
 */
function mergeWalls({ H, V }: MazeGrid): AABB[] {
  const G = MAZE_GRID;
  const out: AABB[] = [];

  // Horizontal runs along X, per row line j.
  for (let j = 0; j <= G; j++) {
    let start = -1;
    for (let x = 0; x <= G; x++) {
      const solid = x < G && H[j][x];
      if (solid && start < 0) start = x;
      else if (!solid && start >= 0) {
        out.push({
          minX: lineX(start) - HT,
          maxX: lineX(x) + HT,
          minZ: lineZ(j) - HT,
          maxZ: lineZ(j) + HT,
        });
        start = -1;
      }
    }
  }

  // Vertical runs along Z, per column line i.
  for (let i = 0; i <= G; i++) {
    let start = -1;
    for (let z = 0; z <= G; z++) {
      const solid = z < G && V[z][i];
      if (solid && start < 0) start = z;
      else if (!solid && start >= 0) {
        out.push({
          minX: lineX(i) - HT,
          maxX: lineX(i) + HT,
          minZ: lineZ(start) - HT,
          maxZ: lineZ(z) + HT,
        });
        start = -1;
      }
    }
  }

  return out;
}

/**
 * Build the merged wall AABBs for an arbitrary seed. Deterministic: same seed ⇒
 * byte-identical output. Exported so the determinism invariant can rebuild and
 * compare; production uses the memoized `MAZE_WALLS` below.
 */
export function buildMazeWalls(seed: number): AABB[] {
  return mergeWalls(generate(seed));
}

/**
 * The merged maze wall AABBs (world space), derived ONCE at module load from the
 * seeded grid. Consumed by worldMap's OBSTACLES (collision + server) and the
 * client MazeWalls render — never duplicated. Seed 12 ⇒ 114 boxes.
 */
export const MAZE_WALLS: readonly AABB[] = buildMazeWalls(MAZE_SEED);

// ───────────────────────────── Goal / portal / return ─────────────────────────

/**
 * The escape trigger: a box at the chamber centre. Stepping in broadcasts the
 * escape notice (server-judged, per-session cooldown). Sits fully inside the 2×2
 * chamber interior, clear of every chamber wall and of the portal pad.
 */
export const MAZE_GOAL: AABB = { minX: -50.2, maxX: -48.2, minZ: -2.2, maxZ: -0.2 };

/**
 * The return portal pad: a distinct tile in the south of the chamber (rendered as
 * a glowing floor tile). Stepping on it teleports the player back to the lounge
 * side of the maze door. Non-overlapping with MAZE_GOAL so the two triggers are
 * independent.
 */
export const MAZE_PORTAL: AABB = { minX: -49.8, maxX: -48.6, minZ: 0.1, maxZ: 0.9 };

/**
 * Where the portal drops the player: a clear lounge-floor spot just EAST of the
 * maze door (NOT the spawn — avoids spawn-jitter collisions). Verified clear of
 * every obstacle by the worldMap invariant tests.
 */
export const MAZE_RETURN = { x: -28, z: 0 } as const;

/** Cooldown (ms) between a player's escape broadcasts — suppresses re-entry spam. */
export const ESCAPE_COOLDOWN_MS = 30_000;

/** True if the point (x,z) lies inside `box` (inclusive). No allocation. */
export function pointInAABB(x: number, z: number, box: AABB): boolean {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

/** True if (x,z) is inside the escape GOAL trigger. */
export function isInMazeGoal(x: number, z: number): boolean {
  return pointInAABB(x, z, MAZE_GOAL);
}

/** True if (x,z) is on the return PORTAL pad. */
export function isOnMazePortal(x: number, z: number): boolean {
  return pointInAABB(x, z, MAZE_PORTAL);
}

/**
 * Whether an escape broadcast is allowed now, given the player's last escape
 * time. Pure + clock-injected so the room's 30 s cooldown is unit-testable
 * without time mocking (`lastEscapeAt = -Infinity` ⇒ always allowed the first time).
 */
export function escapeAllowed(lastEscapeAt: number, now: number): boolean {
  return now - lastEscapeAt >= ESCAPE_COOLDOWN_MS;
}

/** The Korean escape broadcast text for `nickname`. */
export function escapeMessage(nickname: string): string {
  return `\u{1F389} ${nickname}님이 미로를 탈출했습니다!`;
}
