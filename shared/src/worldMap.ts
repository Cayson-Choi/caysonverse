/**
 * Single source of truth for the world map: bounds, zones, spawn, furniture
 * placements, the derived collision OBSTACLES, and the lecture-hall screen.
 *
 * Browser-safe and data-driven: it imports ONLY the `AABB` type (no THREE, no
 * @colyseus/schema, no clocks), so the client scene renders from it, the client
 * collision resolver and the server drop-check both collide against the SAME
 * `OBSTACLES`, and there is exactly one place a map literal ever lives.
 *
 * Layout ([maze]⇄[lounge]⇄[lecture hall] along X; the GALLERY annex extends the
 * lounge NORTH — north is -Z, matching design 25's "라운지 북벽 z=-18"):
 *
 *                 z=-34 ┌──────────────────┐ z=-34
 *                       │ GALLERY (초상 9점) │  x ∈ [-24, -6]
 *        z=-18 ┌────────┴───── ◘ door ─────┴─────────────────┐ z=-18
 *              │  LOUNGE (warm)      │ ▓  LECTURE HALL (cool) │
 *              │    sofas / table    │ ▓   desks → ▐screen▌   │
 *   [ MAZE ]───┤        · spawn ·    ◘ (door)   lectern       ├───── x=30
 *              │    plants           │ ▓   bookcases          │
 *        z=+18 └─────────────────────┴───────────────────────┘ z=+18
 *                west half (x<0)        east half (x>0)
 */

import type { AABB } from "./collision";
import { MAZE_ZONE, MAZE_WALLS } from "./maze";

export type { AABB };

/** Player collision radius (m) — the circle both sides resolve against. */
export const PLAYER_RADIUS = 0.4;

/**
 * The gallery annex north of the lounge (design 25 — "최무호 일대기"): an
 * 18 m × 16 m room bolted onto the lounge's north wall (its south edge IS the
 * old z = -18 wall line), entered through one central door (below). The nine
 * portraits are wall décor rendered by the client — the room floor contributes
 * ZERO obstacles, so only the three new walls + the split lounge north wall
 * shape collision here.
 */
export const GALLERY_ZONE: AABB = { minX: -24, maxX: -6, minZ: -34, maxZ: -18 };

/** Gallery door centre X on the lounge's north wall (aligned with the spawn column). */
export const GALLERY_DOOR_X = -15;

/** Half-width (m) of the gallery door opening (design 25: ~2.5 m wide). */
export const GALLERY_DOOR_HALF_WIDTH = 1.25;

/**
 * Playable area bounds (final). Walls sit on these lines; the divider is at x=0.
 * The WEST edge is the maze zone's far wall (v2-3 west extension) and the NORTH
 * edge is the gallery annex's far wall (v2-11 north extension): the map runs
 * [maze]⇄[lounge]⇄[lecture] with the gallery on top. `minX` is DERIVED from the
 * maze zone and `minZ` from the gallery zone — the SAME single-source pattern —
 * so the outer walls, the spawn clamp, the server bounds clamp and the overview
 * fit all track one value each. Every pre-existing coordinate is unchanged.
 */
export const WORLD_BOUNDS = {
  minX: MAZE_ZONE.minX,
  maxX: 30,
  minZ: GALLERY_ZONE.minZ,
  maxZ: 18,
} as const;

/** Named zones (AABBs) for ground styling and zone features (camera cap). */
export const ZONES: Readonly<Record<"maze" | "lounge" | "lectureHall" | "gallery", AABB>> = {
  maze: MAZE_ZONE,
  lounge: { minX: -30, maxX: 0, minZ: -18, maxZ: 18 },
  lectureHall: { minX: 0, maxX: 30, minZ: -18, maxZ: 18 },
  gallery: GALLERY_ZONE,
};

/** Spawn origin — centre of the lounge, kept clear of furniture + jitter. */
export const SPAWN_POINT = { x: -15, z: 0 } as const;

/** Random spawn radius (m) so simultaneous joiners don't stack. */
export const SPAWN_JITTER = 2;

// ─────────────────────────────── Walls ────────────────────────────────

const WALL_THICKNESS = 0.5;
/**
 * Half-width (m) of the door opening in the divider, centred on z = 0.
 * Exported as part of the single map-geometry truth: the loadtest bots route
 * their lounge <-> lecture-hall walks through this gap.
 */
export const DOOR_HALF_WIDTH = 2;
const B = WORLD_BOUNDS;
const T = WALL_THICKNESS;

/** The z = -18 wall line: lounge/hall north edge, and the gallery's south side. */
const NORTH_WALL_Z = ZONES.lounge.minZ;
const G = GALLERY_ZONE;

/**
 * Wall AABBs = collision truth AND render geometry (the scene draws a box per
 * wall). Outer walls sit just OUTSIDE each bound (inner face exactly on the
 * bound) so the whole playable rectangle stays usable; the divider at x = 0 is
 * two segments leaving a `2·DOOR_HALF_WIDTH` gap toward the lounge.
 *
 * North extension (v2-11): the old full-width z = -18 outer wall is now TWO
 * segments leaving the gallery door open, and the gallery box adds its own
 * west/north/east walls. Every z-run that used to read `B.minZ` (= -18 then)
 * is pinned to its ZONE edge instead, so extending `WORLD_BOUNDS.minZ` to the
 * gallery does NOT drag the west/east outer walls or the divider into the void
 * strip beside the gallery. Gallery walls overhang by T at their corners so the
 * perimeter is watertight (the wall-seal invariant test proves the whole z<-18
 * region is unreachable except through the door).
 */
export const WALLS: readonly AABB[] = [
  { minX: B.minX - T, maxX: B.maxX + T, minZ: B.maxZ, maxZ: B.maxZ + T }, // south (z=+18), full width
  // North wall (z=-18), split around the gallery door.
  {
    minX: B.minX - T,
    maxX: GALLERY_DOOR_X - GALLERY_DOOR_HALF_WIDTH,
    minZ: NORTH_WALL_Z - T,
    maxZ: NORTH_WALL_Z,
  },
  {
    minX: GALLERY_DOOR_X + GALLERY_DOOR_HALF_WIDTH,
    maxX: B.maxX + T,
    minZ: NORTH_WALL_Z - T,
    maxZ: NORTH_WALL_Z,
  },
  { minX: B.minX - T, maxX: B.minX, minZ: MAZE_ZONE.minZ, maxZ: MAZE_ZONE.maxZ }, // outer west (maze far wall)
  { minX: B.maxX, maxX: B.maxX + T, minZ: ZONES.lectureHall.minZ, maxZ: B.maxZ }, // outer east
  { minX: -T / 2, maxX: T / 2, minZ: ZONES.lounge.minZ, maxZ: -DOOR_HALF_WIDTH }, // divider, north of door
  { minX: -T / 2, maxX: T / 2, minZ: DOOR_HALF_WIDTH, maxZ: B.maxZ }, // divider, south of door
  // Gallery annex (design 25): west, far-north and east walls seal the box.
  { minX: G.minX - T, maxX: G.minX, minZ: G.minZ - T, maxZ: G.maxZ }, // gallery west
  { minX: G.minX - T, maxX: G.maxX + T, minZ: G.minZ - T, maxZ: G.minZ }, // gallery north (the new world edge)
  { minX: G.maxX, maxX: G.maxX + T, minZ: G.minZ - T, maxZ: G.maxZ }, // gallery east
];

/** Height (m) of every wall box in the scene. */
export const WALL_HEIGHT = 4;

// ─────────────────────────── Lecture-hall screen ───────────────────────────

/**
 * The big screen on the east wall (a dark box with a slightly emissive face;
 * v2 screen-share placeholder). `depth` runs along X, `width` along Z, `height`
 * along Y; `y` is the box centre height. It also contributes one obstacle.
 */
export const SCREEN = {
  x: 29.6,
  z: 0,
  y: 2.2,
  width: 9,
  height: 3.2,
  depth: 0.3,
} as const;

function screenObstacle(): AABB {
  return {
    minX: SCREEN.x - SCREEN.depth / 2,
    maxX: SCREEN.x + SCREEN.depth / 2,
    minZ: SCREEN.z - SCREEN.width / 2,
    maxZ: SCREEN.z + SCREEN.width / 2,
  };
}

// ──────────────────────────────── Furniture ────────────────────────────────

/** Uniform up-scale applied to every Kenney model (kit models are ~0.5× life). */
export const FURNITURE_SCALE = 2.2;

/** Public path prefix for the curated furniture GLBs. */
export const FURNITURE_URL_BASE = "/models/furniture/";

/** Per-model geometry, measured from the source GLB (unscaled, metres). */
export interface FurnitureModel {
  /** Unscaled bounding-box size on X and Z. */
  sizeX: number;
  sizeZ: number;
  /** Unscaled bounding-box centre offset (re-centred so a placement point ===
   *  its footprint centre, regardless of the model's own origin). */
  cx: number;
  cz: number;
  /** Whether the model contributes a collision obstacle (flat/thin decor = false). */
  solid: boolean;
}

/**
 * The curated Kenney Furniture Kit models (CC0). The record KEY is the model id
 * used in `FURNITURE`, and its GLB is `${FURNITURE_URL_BASE}${key}.glb`. Sizes
 * come from parsing each GLB's node hierarchy (see models/furniture/LICENSE.md).
 */
export const FURNITURE_MODELS = {
  loungeSofa: { sizeX: 0.98, sizeZ: 0.41, cx: 0.49, cz: -0.205, solid: true },
  loungeSofaLong: { sizeX: 0.98, sizeZ: 0.82, cx: 0.49, cz: 0.0, solid: true },
  tableCoffee: { sizeX: 0.661, sizeZ: 0.4, cx: -0.13, cz: -0.1, solid: true },
  rugRectangle: { sizeX: 1.57, sizeZ: 0.92, cx: 0.785, cz: -0.46, solid: false },
  pottedPlant: { sizeX: 0.212, sizeZ: 0.241, cx: 0.0, cz: 0.0, solid: true },
  lampSquareFloor: { sizeX: 0.12, sizeZ: 0.12, cx: 0.06, cz: -0.06, solid: false },
  desk: { sizeX: 0.734, sizeZ: 0.392, cx: 0.357, cz: -0.184, solid: true },
  chairDesk: { sizeX: 0.335, sizeZ: 0.314, cx: 0.167, cz: -0.157, solid: true },
  bookcaseClosedWide: { sizeX: 0.8, sizeZ: 0.25, cx: 0.4, cz: -0.125, solid: true },
} as const satisfies Record<string, FurnitureModel>;

export type FurnitureModelId = keyof typeof FURNITURE_MODELS;

/** One furniture placement: model id, ground position, and yaw. */
export interface Furniture {
  model: FurnitureModelId;
  x: number;
  z: number;
  /** Yaw (rad) about Y. Any angle is supported; footprints stay exact. */
  rotY: number;
}

const HALF_PI = Math.PI / 2;

/**
 * Classroom placement literals — the SINGLE source both the furniture grid and
 * the derived SEATS read from (no duplicated coordinates). Desks sit at each
 * `STUDENT_ROWS_X` × `STUDENT_COLS_Z` cell; the student chair is `STUDENT_CHAIR_DX`
 * along X from its desk (negative = between the desk and the aisle/screen).
 *
 * The grid is 4 rows (X, receding east→west from the door) × 5 columns (Z) = 20
 * student desks. The 5 columns are shifted south of centre so the door↔screen
 * corridor at z = 0 lands in a clear gap (between the z = -3 and z = 3 columns) —
 * a symmetric 5-column layout would put a column ON z = 0 and wall off the aisle.
 */
const STUDENT_ROWS_X = [4, 9, 14, 19];
const STUDENT_COLS_Z = [-15, -9, -3, 3, 9];
const STUDENT_CHAIR_DX = -1.3;

// Build the classroom's student desk+chair grid: rows recede from the screen,
// columns straddle a central aisle aligned with the door (z = 0). The chair model
// rests facing +Z, so rotY = +HALF_PI turns its seat toward the screen (+X) with
// the backrest to the west — matching the seated player's SEAT_YAW (+PI/2).
function classroomSeating(): Furniture[] {
  const out: Furniture[] = [];
  for (const x of STUDENT_ROWS_X) {
    for (const z of STUDENT_COLS_Z) {
      out.push({ model: "desk", x, z, rotY: -HALF_PI }); // desk faces the screen (+X)
      out.push({ model: "chairDesk", x: x + STUDENT_CHAIR_DX, z, rotY: HALF_PI }); // seat toward the screen
    }
  }
  return out;
}

/**
 * All furniture placements. Lounge (west) is authored explicitly; the lecture
 * hall (east) mixes authored bookcases with the generated student grid. (The
 * former instructor desk/chair in front of the screen were removed on the
 * owner's request — the screen area stays clear.) Rotations are 90° multiples
 * but any angle would stay exact.
 */
export const FURNITURE: readonly Furniture[] = [
  // ── Lounge (x < 0) ──
  { model: "loungeSofa", x: -15, z: -7, rotY: 0 }, // faces spawn; the E2E collision target
  { model: "rugRectangle", x: -22, z: 0, rotY: 0 }, // decorative floor rug (non-solid)
  { model: "loungeSofaLong", x: -26, z: 0, rotY: HALF_PI }, // against the west wall
  { model: "tableCoffee", x: -22, z: 0, rotY: 0 },
  { model: "loungeSofa", x: -22, z: -5, rotY: 0 }, // north of the coffee table
  { model: "loungeSofa", x: -22, z: 5, rotY: Math.PI }, // south of the coffee table
  { model: "lampSquareFloor", x: -28, z: 10, rotY: 0 }, // corner lamp (non-solid)
  { model: "pottedPlant", x: -28, z: -14, rotY: 0 }, // SW corner greenery
  { model: "pottedPlant", x: -3, z: 6, rotY: 0 }, // frames the door (lounge side, north)
  { model: "pottedPlant", x: -3, z: -6, rotY: 0 }, // frames the door (lounge side, south)

  // ── Lecture hall (x > 0) ──
  { model: "bookcaseClosedWide", x: 8, z: 17, rotY: Math.PI }, // against the north wall
  { model: "bookcaseClosedWide", x: 20, z: 17, rotY: Math.PI },
  ...classroomSeating(),
];

// ──────────────────────────── Derived obstacles ────────────────────────────

function halfExtents(m: FurnitureModel, rotY: number): { ex: number; ez: number } {
  const hx = (m.sizeX / 2) * FURNITURE_SCALE;
  const hz = (m.sizeZ / 2) * FURNITURE_SCALE;
  const c = Math.abs(Math.cos(rotY));
  const s = Math.abs(Math.sin(rotY));
  // Exact AABB of the rotated footprint rectangle (valid for ANY yaw).
  return { ex: c * hx + s * hz, ez: s * hx + c * hz };
}

/** The scaled, rotated, floor-plane footprint AABB of one furniture placement. */
export function furnitureObstacle(p: Furniture): AABB {
  const m = FURNITURE_MODELS[p.model];
  const { ex, ez } = halfExtents(m, p.rotY);
  return { minX: p.x - ex, maxX: p.x + ex, minZ: p.z - ez, maxZ: p.z + ez };
}

/**
 * Every collision obstacle, derived at module load: solid furniture footprints
 * + room walls + the screen + the maze walls. Both the client slide resolver and
 * the server drop check import THIS array — no obstacle literal is ever
 * duplicated. The maze's EAST perimeter wall (in `MAZE_WALLS`, at x = -30 with a
 * single middle-row opening) IS the lounge's west door — one wall, one gap, no
 * separate divider.
 */
export const OBSTACLES: readonly AABB[] = [
  ...FURNITURE.filter((p) => FURNITURE_MODELS[p.model].solid).map(furnitureObstacle),
  ...WALLS,
  screenObstacle(),
  ...MAZE_WALLS,
];

// ───────────────────────────────── Seats ─────────────────────────────────

/**
 * Max distance (m) from the player to a seat centre at which sitting is allowed.
 * The client only shows the sit prompt within this radius; the server re-checks
 * it (a farther Sit message is a tampered client → silent drop). Single source.
 */
export const SEAT_REACH = 1.5;

/** Distance (m) the dismount point sits from the chair centre (aisle side). */
export const SEAT_DISMOUNT = 0.9;

/**
 * Seated player-yaw: everyone faces the screen (+X). This is the PLAYER yaw
 * convention `atan2(dirX, dirZ)` (model faces +Z at yaw 0; see client
 * MODEL_FACING_OFFSET/worldDirection) → facing +X is `atan2(1, 0) = +PI/2`.
 *
 * The furniture chair model rests facing +Z (verified EMPIRICALLY by screenshot,
 * 2026-07-16 — an earlier "rests facing -Z" assumption put every chair backwards),
 * so the chair's `rotY` is ALSO +PI/2 to face the screen. The two +PI/2 values
 * agreeing is a coincidence of conventions, not a shared constant: player yaw is
 * `atan2(dirX, dirZ)`, chair rotY is a plain Y-rotation of the model. A regression
 * test asserts all 21 chairs at +PI/2; the E2E screenshot guards the visual.
 */
export const SEAT_YAW = Math.PI / 2;

/** A sittable seat: chair centre, seated facing, and its clear dismount point. */
export interface Seat {
  /** Chair-centre X (== the chairDesk furniture placement). */
  x: number;
  /** Chair-centre Z. */
  z: number;
  /** Seated player-yaw (SEAT_YAW — faces the screen). */
  yaw: number;
  /** Dismount X: SEAT_DISMOUNT from the chair, on the side away from its desk. */
  standX: number;
  /** Dismount Z (same row as the chair). */
  standZ: number;
}

/**
 * Derive one seat from a chair placement and the X of its paired desk. The
 * dismount point is `SEAT_DISMOUNT` from the chair along X, on the side AWAY from
 * the desk (desk to the east ⇒ dismount west into the aisle). Deriving the
 * direction from the desk keeps every dismount clear of that desk by data,
 * not by hand-tuned literals (guaranteed by the worldMap map-invariant tests).
 */
function makeSeat(chairX: number, chairZ: number, deskX: number): Seat {
  const away = Math.sign(chairX - deskX) || -1;
  return { x: chairX, z: chairZ, yaw: SEAT_YAW, standX: chairX + away * SEAT_DISMOUNT, standZ: chairZ };
}

function deriveSeats(): Seat[] {
  const seats: Seat[] = [];
  // Row-major from the front row nearest the door (indices 0..19).
  for (const rowX of STUDENT_ROWS_X) {
    for (const z of STUDENT_COLS_Z) {
      seats.push(makeSeat(rowX + STUDENT_CHAIR_DX, z, rowX));
    }
  }
  return seats;
}

/**
 * The 20 sittable student seats, derived at module load from the SAME placement
 * literals the FURNITURE grid uses — never a duplicated table. Index ===
 * `Player.seatIndex`; the server assigns/validates by this index.
 */
export const SEATS: readonly Seat[] = deriveSeats();

/**
 * Pure client proximity pick: the index of the nearest FREE seat within `reach`
 * of `(x, z)`, or null. `isOccupied(i)` reports seats taken by ANY player
 * (self + remotes, read from the schema-synced `seatIndex`). No allocation, so
 * the throttled prompt loop can call it directly.
 */
export function nearestFreeSeat(
  x: number,
  z: number,
  isOccupied: (index: number) => boolean,
  reach: number = SEAT_REACH,
): number | null {
  let best = -1;
  let bestDist = reach;
  for (let i = 0; i < SEATS.length; i++) {
    if (isOccupied(i)) continue;
    const s = SEATS[i];
    const d = Math.hypot(x - s.x, z - s.z);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best >= 0 ? best : null;
}
